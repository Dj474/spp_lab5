import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  // Персистентность
  dbPath: process.env.DB_PATH || 'data/lab5.db',
  resetDb: process.env.RESET_DB === 'true',

  // Логирование
  logLevel: process.env.LOG_LEVEL || 'info',

  // Контроль нагрузки
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 5000,
  },

  // Порты subgraph-сервисов (распределённая архитектура)
  subgraphs: {
    catalog: Number(process.env.CATALOG_PORT) || 4001,
    orders: Number(process.env.ORDERS_PORT) || 4002,
    analytics: Number(process.env.ANALYTICS_PORT) || 4003,
  },

  // Сбор данных
  collect: {
    timeoutMs: Number(process.env.COLLECT_TIMEOUT_MS) || 6000,
    retries: Number(process.env.COLLECT_RETRIES) || 2,
    targets: {
      users: Number(process.env.TARGET_USERS) || 800,
      products: Number(process.env.TARGET_PRODUCTS) || 2000,
      orders: Number(process.env.TARGET_ORDERS) || 6000,
      reviews: Number(process.env.TARGET_REVIEWS) || 8000,
    },
  },
};
