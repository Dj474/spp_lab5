// Распределённая архитектура: три GraphQL-subgraph сервиса + шлюз (Apollo Gateway),
// который композирует единый supergraph. Клиент работает со шлюзом как с одним GraphQL API.

import { createServer } from 'node:http';
import { parse } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { buildSubgraphSchema } from '@apollo/subgraph';
import { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } from '@apollo/gateway';
import { ApolloServer } from '@apollo/server';

import { createLoaders } from './data/store.js';

/** Поднимает один subgraph как самостоятельный GraphQL-сервис (Yoga + Apollo Subgraph). */
export function startSubgraph({ name, port = 0, typeDefs, resolvers, store, pubsub, logger }) {
  const schema = buildSubgraphSchema({ typeDefs: parse(typeDefs), resolvers });
  const yoga = createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    landingPage: false,
    graphiql: false,
    logging: false,
    maskedErrors: false,
    context: ({ request }) => ({
      store,
      loaders: createLoaders(store),
      pubsub,
      traceId: request?.headers?.get?.('x-trace-id') || undefined,
    }),
  });

  const server = createServer(yoga);
  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      const url = `http://localhost:${actual}/graphql`;
      logger?.info(`subgraph «${name}» → ${url}`);
      resolve({ name, server, port: actual, url });
    });
  });
}

/** Шлюз: композиция subgraph'ов в единый supergraph. */
export async function startGateway({ subgraphs, metrics, logger }) {
  // Data source с трассировкой: прокидывает trace-id в subgraph и замеряет задержку.
  // Замеры храним в context (по subgraph'у), а не в теле запроса: GraphQL-сервер
  // subgraph'а отвергает посторонние поля в теле (Yoga: «Unexpected parameter»).
  const pending = new WeakMap();
  const pushStart = (context, name, t0) => {
    if (!context) return;
    let perSub = pending.get(context);
    if (!perSub) {
      perSub = new Map();
      pending.set(context, perSub);
    }
    const stack = perSub.get(name) || [];
    stack.push(t0);
    perSub.set(name, stack);
  };
  const popStart = (context, name) => {
    const stack = context && pending.get(context)?.get(name);
    return stack && stack.length ? stack.pop() : undefined;
  };

  class TracingDataSource extends RemoteGraphQLDataSource {
    constructor(def) {
      super(def);
      this.subgraphName = def.name;
    }
    willSendRequest({ request, context }) {
      pushStart(context, this.subgraphName, Date.now());
      if (context?.traceId) request.http.headers.set('x-trace-id', context.traceId);
    }
    async didReceiveResponse({ response, context }) {
      const t0 = popStart(context, this.subgraphName);
      if (t0) {
        const ms = Date.now() - t0;
        metrics?.counter('subgraph_requests_total');
        metrics?.observe(`subgraph_latency_ms{subgraph="${this.subgraphName}"}`, ms);
        logger?.debug(`↳ ${this.subgraphName} ${ms}ms`);
      }
      return response;
    }
  }

  const gateway = new ApolloGateway({
    supergraphSdl: new IntrospectAndCompose({
      subgraphs: subgraphs.map((s) => ({ name: s.name, url: s.url })),
      pollIntervalInMs: 30000,
    }),
    buildService: (def) => new TracingDataSource(def),
  });

  const apollo = new ApolloServer({
    gateway,
    introspection: true,
    plugins: [
      {
        async requestDidStart() {
          return {
            async willSendResponse({ operation, response }) {
              const type = operation?.operation || 'unknown';
              metrics?.counter(`graphql_operations_total{type="${type}"}`);
              if (response?.errors?.length) metrics?.counter('graphql_errors_total', response.errors.length);
            },
          };
        },
      },
    ],
    logger: {
      debug: () => {},
      info: () => {},
      warn: (m) => logger?.warn(String(m)),
      error: (m) => logger?.error(String(m)),
    },
  });

  await apollo.start();
  return { gateway, apollo };
}
