// Subgraph «orders»: пользователи, заказы, позиции заказов.
// Владеет сущностями User, Order, OrderItem; ссылается на Product и Review (subgraph catalog).

import { applyQuery } from '../data/store.js';
import { TOPICS } from '../pubsub.js';
import { ORDER_SEARCH, USER_SEARCH, VALID_STATUSES, nextId, badInput, round, guestUser } from './common.js';

export const typeDefs = /* GraphQL */ `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])

  input Condition {
    field: String!
    op: String!
    value: String
  }

  input ListParams {
    conditions: [Condition!]
    search: String
    searchFields: [String!]
    sortBy: String
    sortDir: String
    page: Int
    limit: Int
  }

  input OrderItemInput {
    productId: ID!
    quantity: Int!
  }

  type PageInfo @shareable {
    total: Int!
    page: Int!
    limit: Int!
    pages: Int!
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    email: String!
    city: String
    country: String
    registeredAt: String!
    orderCount: Int!
    orders(status: String): [Order!]!
    reviews: [Review!]!
  }

  type Order @key(fields: "id") {
    id: ID!
    status: String!
    createdAt: String!
    total: Float!
    itemsCount: Int!
    userId: ID!
    userName: String!
    userEmail: String!
    user: User!
    items: [OrderItem!]!
  }

  type OrderItem @key(fields: "id") {
    id: ID!
    quantity: Int!
    price: Float!
    subtotal: Float!
    product: Product!
  }

  "Ссылка на сущность Product, которой владеет subgraph catalog"
  type Product @key(fields: "id") {
    id: ID!
  }

  "Ссылка на сущность Review, которой владеет subgraph catalog"
  type Review @key(fields: "id") {
    id: ID!
  }

  type OrderPage { items: [Order!]! pageInfo: PageInfo! }
  type UserPage { items: [User!]! pageInfo: PageInfo! }

  type Query {
    orders(params: ListParams): OrderPage!
    order(id: ID!): Order
    users(params: ListParams): UserPage!
    user(id: ID!): User
  }

  type Mutation {
    updateOrderStatus(id: ID!, status: String!): Order!
    createOrder(items: [OrderItemInput!]!): Order!
  }

  type Subscription {
    "Новый заказ"
    orderAdded: Order!
    "Изменение статуса заказа"
    orderStatusChanged: Order!
  }
`;

export function buildResolvers(store, { pubsub, persist }) {
  return {
    Query: {
      orders: (_, { params }) => applyQuery(store.orders, params, { searchFields: ORDER_SEARCH, defaultLimit: 20 }),
      order: (_, { id }) => store.ordersById.get(String(id)) || null,
      users: (_, { params }) => applyQuery(store.users, params, { searchFields: USER_SEARCH, defaultLimit: 20 }),
      user: (_, { id }) => store.usersById.get(String(id)) || null,
    },

    Mutation: {
      updateOrderStatus: (_, { id, status }) => {
        const order = store.ordersById.get(String(id));
        if (!order) throw badInput(`Заказ ${id} не найден`);
        if (!VALID_STATUSES.includes(status)) throw badInput(`Недопустимый статус: ${status}`);
        order.status = status;
        if (persist?.orderStatus) persist.orderStatus(order.id, status);
        pubsub?.publish(TOPICS.ORDER_STATUS_CHANGED, order);
        return order;
      },

      createOrder: (_, { items }) => {
        const user = guestUser(store, persist);
        if (!items?.length) throw badInput('Заказ должен содержать хотя бы одну позицию');
        const orderId = nextId(store.orders);
        const baseItemId = nextId(store.orderItems);
        let total = 0;
        const created = items.map((it, idx) => {
          const product = store.productsById.get(String(it.productId));
          if (!product) throw badInput(`Товар ${it.productId} не найден`);
          const quantity = Math.max(1, Number(it.quantity) || 1);
          total += product.price * quantity;
          return {
            id: baseItemId + idx,
            orderId,
            productId: product.id,
            productTitle: product.title,
            quantity,
            price: product.price,
          };
        });
        const order = {
          id: orderId,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          status: 'created',
          createdAt: new Date().toISOString(),
          total: round(total),
        };
        store.orders.push(order);
        store.ordersById.set(String(order.id), order);
        const list = store.ordersByUser.get(String(user.id)) || [];
        list.push(order);
        store.ordersByUser.set(String(user.id), list);
        for (const item of created) store.orderItems.push(item);
        store.itemsByOrder.set(String(order.id), created);
        store.info.orders++;
        store.info.orderItems += created.length;
        store.info.total += 1 + created.length;
        if (persist?.order) persist.order(order, created);
        pubsub?.publish(TOPICS.ORDER_ADDED, order);
        return order;
      },
    },

    Subscription: {
      orderAdded: {
        subscribe: () => pubsub.subscribe(TOPICS.ORDER_ADDED),
        resolve: (p) => p,
      },
      orderStatusChanged: {
        subscribe: () => pubsub.subscribe(TOPICS.ORDER_STATUS_CHANGED),
        resolve: (p) => p,
      },
    },

    User: {
      orders: (u, { status }) => {
        const list = store.ordersByUser.get(String(u.id)) || [];
        return status ? list.filter((o) => o.status === status) : list;
      },
      orderCount: (u) => (store.ordersByUser.get(String(u.id)) || []).length,
      // Ссылки на сущности Review — разрешаются subgraph catalog через федерацию
      reviews: (u) => (store.reviewsByUser.get(String(u.id)) || []).map((r) => ({ __typename: 'Review', id: String(r.id) })),
      __resolveReference: (ref, { loaders }) => loaders.user.load(ref.id),
    },

    Order: {
      user: (o, _a, { loaders }) => loaders.user.load(o.userId),
      items: (o) => store.itemsByOrder.get(String(o.id)) || [],
      itemsCount: (o) => (store.itemsByOrder.get(String(o.id)) || []).length,
      __resolveReference: (ref, { loaders }) => loaders.order.load(ref.id),
    },

    OrderItem: {
      // Ссылка на сущность Product — разрешается subgraph catalog через федерацию
      product: (i) => ({ __typename: 'Product', id: String(i.productId) }),
      subtotal: (i) => round(i.price * i.quantity),
    },
  };
}
