import { startSubgraph, startGateway } from '../server/federation.js';
import { createStore } from '../server/data/store.js';
import { createMetrics } from '../server/observability.js';
import * as catalogModule from '../server/graphql/catalog.js';
import * as ordersModule from '../server/graphql/orders.js';
import * as analyticsModule from '../server/graphql/analytics.js';
import {
  mulberry32,
  generateCategories,
  generateUsers,
  generateProducts,
  generateOrders,
  generateReviews,
} from '../server/data/generate.js';

/**
 * Поднимает полноценную распределённую систему (3 subgraph + шлюз) на
 * детерминированном небольшом датасете, без БД.
 */
export async function buildTestApp({ users = 5, products = 10, orders = 5, reviews = 8 } = {}) {
  const rnd = mulberry32(42);
  const categories = generateCategories();
  const u = generateUsers(users, rnd, 1);
  const p = generateProducts(products, rnd, categories, 1);
  const { orders: o, items } = generateOrders(orders, rnd, u, p, 1, 1);
  const r = generateReviews(reviews, rnd, u, p, 1);

  const store = createStore({ categories, users: u, products: p, orders: o, orderItems: items, reviews: r, sources: [] });
  const pubsub = {
    published: [],
    publish(topic, payload) {
      this.published.push({ t: topic, payload });
    },
    async *subscribe() {},
  };
  const metrics = createMetrics();
  const services = { gateway: 'http://test.local/graphql' };

  const subgraphs = [];
  for (const [name, mod] of [
    ['catalog', catalogModule],
    ['orders', ordersModule],
    ['analytics', analyticsModule],
  ]) {
    subgraphs.push(
      await startSubgraph({
        name,
        port: 0,
        typeDefs: mod.typeDefs,
        resolvers: mod.buildResolvers(store, { pubsub, persist: {}, services }),
        store,
        pubsub,
      })
    );
  }
  Object.assign(services, {
    catalog: subgraphs[0].url,
    orders: subgraphs[1].url,
    analytics: subgraphs[2].url,
  });

  const { apollo } = await startGateway({ subgraphs, metrics });

  const stop = async () => {
    await Promise.all(subgraphs.map((s) => new Promise((res) => s.server.close(res))));
  };

  return { store, apollo, pubsub, metrics, subgraphs, stop };
}

/** Выполняет GraphQL-операцию через шлюз (как единый API). */
export async function run(app, source, { variableValues } = {}) {
  const res = await app.apollo.executeOperation({ query: source, variables: variableValues });
  return res.body?.singleResult ?? res.body ?? res;
}
