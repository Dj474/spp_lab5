// Subgraph «analytics»: динамические агрегации, полнотекстовый поиск по всем сущностям,
// информация о собранном датасете и статусах источников.

import { JSONScalar, computeStats, dynamicSearch } from './common.js';

export const typeDefs = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3")

  scalar JSON

  type Stat {
    key: String!
    value: Float!
    count: Int!
  }

  "Статус сбора данных по источнику (отказоустойчивость)"
  type SourceStatus {
    name: String!
    status: String!
    count: Int!
    error: String
  }

  type Query {
    "Информация о собранном датасете (объём по сущностям)"
    datasetInfo: JSON!
    "Статусы источников данных"
    sources: [SourceStatus!]!
    "Динамическая агрегация: groupBy + metric(field)"
    stats(entity: String!, groupBy: String!, metric: String, field: String): [Stat!]!
    "Динамический поиск сразу по нескольким сущностям"
    search(term: String!): JSON!
    "Топология распределённой системы: адреса subgraph-сервисов"
    topology: JSON!
    "Метрики нагрузки/задержек (мониторинг и трассировка)"
    metrics: JSON!
  }
`;

export function buildResolvers(store, { services = {}, metrics } = {}) {
  return {
    JSON: JSONScalar,
    Query: {
      datasetInfo: () => store.info,
      sources: () => store.sources,
      stats: (_, args) => computeStats(store, args),
      search: (_, { term }) => dynamicSearch(store, term),
      topology: () => services,
      metrics: () => metrics?.snapshot?.() ?? {},
    },
  };
}
