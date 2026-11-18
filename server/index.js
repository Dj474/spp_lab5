import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import express from 'express';
import cors from 'cors';
import { expressMiddleware } from '@apollo/server/express4';

import { config } from './config.js';
import { logger } from './logger.js';
import { createMetrics, newTraceId } from './observability.js';
import { collectDataset } from './data/collect.js';
import { createStore } from './data/store.js';
import { createPubSub } from './pubsub.js';
import { startSubgraph, startGateway } from './federation.js';

import * as catalog from './graphql/catalog.js';
import * as orders from './graphql/orders.js';
import * as analytics from './graphql/analytics.js';

import {
  openDatabase,
  ensureSchema,
  isSeeded,
  loadDataset,
  saveDataset,
  setMeta,
  getMeta,
  persistUser,
  persistReview,
  persistOrder,
  persistOrderStatus,
  removeReview,
} from './data/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = logger.child('app');

// ---------- 1. Хранилище (SQLite) ----------
if (config.resetDb) {
  const abs = path.resolve(config.dbPath);
  for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
  log.warn('RESET_DB=true — база данных пересоздана');
}
const db = openDatabase(config.dbPath);
ensureSchema(db);

// ---------- 2. Данные: загрузка из БД или сбор из источников ----------
let dataset;
let sources;

if (isSeeded(db)) {
  log.info('Найдена сохранённая база — загружаю данные из SQLite');
  dataset = loadDataset(db);
  try {
    sources = JSON.parse(getMeta(db, 'sources') || '[]');
  } catch {
    sources = [];
  }
  if (!sources.length) sources = [{ name: 'SQLite (кэш)', status: 'online', count: 0, error: null }];
} else {
  log.info('База пуста — выполняю автоматизированный сбор из источников...');
  dataset = await collectDataset();
  sources = dataset.sources;
  saveDataset(db, dataset);
  setMeta(db, 'sources', JSON.stringify(sources));
}
dataset.sources = sources;

const store = createStore(dataset);

// ---------- 3. Realtime + персистентность мутаций ----------
const pubsub = createPubSub();
const persist = {
  user: (u) => persistUser(db, u),
  review: (r) => persistReview(db, r),
  order: (o, items) => persistOrder(db, o, items),
  orderStatus: (id, status) => persistOrderStatus(db, id, status),
  removeReview: (id) => removeReview(db, id),
};

// ---------- 4. Метрики (мониторинг/трассировка) ----------
const metrics = createMetrics();

// ---------- 5. Распределённая архитектура: subgraph'ы + шлюз ----------
const subgraphDefs = [
  { key: 'catalog', module: catalog, port: config.subgraphs.catalog },
  { key: 'orders', module: orders, port: config.subgraphs.orders },
  { key: 'analytics', module: analytics, port: config.subgraphs.analytics },
];

const subgraphs = [];
// Топология распределённой системы (доступна клиенту через GraphQL: query { topology })
const services = { gateway: `http://localhost:${config.port}/graphql` };

for (const def of subgraphDefs) {
  const resolvers = def.module.buildResolvers(store, { pubsub, persist, services, metrics });
  const service = await startSubgraph({
    name: def.key,
    port: def.port,
    typeDefs: def.module.typeDefs,
    resolvers,
    store,
    pubsub,
    logger: log,
  });
  subgraphs.push(service);
}

Object.assign(services, {
  catalog: subgraphs.find((s) => s.name === 'catalog').url,
  orders: subgraphs.find((s) => s.name === 'orders').url,
  analytics: subgraphs.find((s) => s.name === 'analytics').url,
});

const { apollo } = await startGateway({ subgraphs, metrics, logger: log });

// ---------- 6. HTTP: статика + шлюз + мониторинг ----------
const app = express();
app.use(cors());

// Контроль нагрузки: rate-limit + трассировка + метрики задержек.
let windowStart = Date.now();
let hits = 0;
app.use((req, res, next) => {
  const now = Date.now();
  if (now - windowStart > config.rateLimit.windowMs) {
    windowStart = now;
    hits = 0;
  }
  hits++;
  req.traceId = req.headers['x-trace-id'] || newTraceId();
  res.setHeader('x-trace-id', req.traceId);
  if (req.path === '/graphql') {
    const started = now;
    res.on('finish', () => {
      metrics.counter('http_requests_total');
      metrics.observe('http_request_ms', Date.now() - started);
      if (res.statusCode >= 400) metrics.counter('http_errors_total');
      log.debug(`[${req.traceId}] ${req.method} /graphql ${res.statusCode} ${Date.now() - started}ms`);
    });
    if (hits > config.rateLimit.max) {
      metrics.counter('http_rate_limited_total');
      return res.status(429).json({ errors: [{ message: 'Too Many Requests' }] });
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Healthcheck (мониторинг)
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    records: store.info.total,
    uptime: Math.round(process.uptime()),
    subgraphs: subgraphs.map((s) => ({ name: s.name, url: s.url })),
  });
});

// Метрики (мониторинг)
app.get('/metrics', (req, res) => {
  res.json({ ...metrics.snapshot(), dataset: store.info, sources: store.sources.length });
});

app.use('/graphql', express.json(), expressMiddleware(apollo, { context: async ({ req }) => ({ traceId: req.traceId }) }));

// Глобальные обработчики => процесс не падает (отказоустойчивость)
process.on('unhandledRejection', (err) => log.error('unhandledRejection', String(err?.stack || err)));
process.on('uncaughtException', (err) => log.error('uncaughtException', String(err?.stack || err)));

const server = createServer(app);
server.listen(config.port, () => {
  log.info(`Gateway   -> http://localhost:${config.port}/graphql`);
  log.info(`Frontend  -> http://localhost:${config.port}/`);
  log.info(`Metrics   -> http://localhost:${config.port}/metrics`);
  log.info(`SQLite    -> ${path.resolve(config.dbPath)}`);
  log.info('Источники данных:');
  for (const s of sources) {
    log.info(`  - ${s.name}: ${s.status}${s.count ? `, записей ${s.count}` : ''}${s.error ? ` (${s.error})` : ''}`);
  }
  log.info(
    `Всего записей: ${store.info.total} ` +
      `(товары=${store.info.products}, заказы=${store.info.orders}, позиции=${store.info.orderItems}, ` +
      `пользователи=${store.info.users}, отзывы=${store.info.reviews})`
  );
});

const shutdown = (signal) => {
  log.warn(`Получен ${signal} — завершаю работу`);
  server.close(async () => {
    for (const s of subgraphs) s.server.close();
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
