// Subgraph «catalog»: товары, категории, отзывы.
// Владеет сущностями Category, Product, Review; ссылается на User (subgraph orders).

import { applyQuery } from '../data/store.js';
import { TOPICS } from '../pubsub.js';
import { PRODUCT_SEARCH, REVIEW_SEARCH, nextId, badInput, guestUser } from './common.js';

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

  type PageInfo @shareable {
    total: Int!
    page: Int!
    limit: Int!
    pages: Int!
  }

  type Category @key(fields: "id") {
    id: ID!
    name: String!
    slug: String!
    productCount: Int!
    products(params: ListParams): [Product!]!
  }

  type Product @key(fields: "id") {
    id: ID!
    title: String!
    description: String
    price: Float!
    stock: Int!
    rating: Float!
    createdAt: String!
    categoryName: String!
    category: Category!
    reviewCount: Int!
    reviews(limit: Int): [Review!]!
  }

  type Review @key(fields: "id") {
    id: ID!
    rating: Int!
    comment: String
    createdAt: String!
    userId: ID!
    productTitle: String!
    userName: String!
    product: Product!
    user: User!
  }

  "Ссылка на сущность User, которой владеет subgraph orders"
  type User @key(fields: "id") {
    id: ID!
  }

  type ProductPage { items: [Product!]! pageInfo: PageInfo! }
  type ReviewPage { items: [Review!]! pageInfo: PageInfo! }

  type Query {
    products(params: ListParams): ProductPage!
    product(id: ID!): Product
    reviews(params: ListParams): ReviewPage!
    categories: [Category!]!
  }

  type Mutation {
    createReview(productId: ID!, rating: Int!, comment: String): Review!
    deleteReview(id: ID!): Boolean!
  }

  type Subscription {
    "Новый отзыв (в реальном времени)"
    reviewAdded: Review!
  }
`;

export function buildResolvers(store, { pubsub, persist }) {
  function pushReview(review) {
    store.reviews.push(review);
    store.reviewsById.set(String(review.id), review);
    const byProduct = store.reviewsByProduct.get(String(review.productId)) || [];
    byProduct.push(review);
    store.reviewsByProduct.set(String(review.productId), byProduct);
    const byUser = store.reviewsByUser.get(String(review.userId)) || [];
    byUser.push(review);
    store.reviewsByUser.set(String(review.userId), byUser);
    store.info.reviews++;
    store.info.total++;
  }

  return {
    Query: {
      products: (_, { params }) => applyQuery(store.products, params, { searchFields: PRODUCT_SEARCH, defaultLimit: 20 }),
      product: (_, { id }) => store.productsById.get(String(id)) || null,
      reviews: (_, { params }) => applyQuery(store.reviews, params, { searchFields: REVIEW_SEARCH, defaultLimit: 20 }),
      categories: () => store.categories,
    },

    Mutation: {
      createReview: (_, { productId, rating, comment }) => {
        const user = guestUser(store, persist);
        const product = store.productsById.get(String(productId));
        if (!product) throw badInput(`Товар ${productId} не найден`);
        const r = Number(rating);
        if (!Number.isInteger(r) || r < 1 || r > 5) throw badInput('Оценка должна быть целым числом от 1 до 5');

        const review = {
          id: nextId(store.reviews),
          productId: product.id,
          productTitle: product.title,
          userId: user.id,
          userName: user.name,
          rating: r,
          comment: comment ? String(comment) : null,
          createdAt: new Date().toISOString(),
        };
        pushReview(review);
        if (persist?.review) persist.review(review);
        pubsub?.publish(TOPICS.REVIEW_ADDED, review);
        return review;
      },

      deleteReview: (_, { id }) => {
        const review = store.reviewsById.get(String(id));
        if (!review) return false;
        store.reviews.splice(store.reviews.indexOf(review), 1);
        store.reviewsById.delete(String(id));
        const bp = store.reviewsByProduct.get(String(review.productId));
        if (bp) store.reviewsByProduct.set(String(review.productId), bp.filter((r) => r.id !== review.id));
        const bu = store.reviewsByUser.get(String(review.userId));
        if (bu) store.reviewsByUser.set(String(review.userId), bu.filter((r) => r.id !== review.id));
        store.info.reviews--;
        store.info.total--;
        if (persist?.removeReview) persist.removeReview(review.id);
        return true;
      },
    },

    Subscription: {
      reviewAdded: {
        subscribe: () => pubsub.subscribe(TOPICS.REVIEW_ADDED),
        resolve: (p) => p,
      },
    },

    Product: {
      category: (p, _a, { loaders }) => loaders.category.load(p.categoryId),
      reviews: (p, { limit }) => {
        const list = store.reviewsByProduct.get(String(p.id)) || [];
        return limit ? list.slice(0, limit) : list;
      },
      reviewCount: (p) => (store.reviewsByProduct.get(String(p.id)) || []).length,
      __resolveReference: (ref, { loaders }) => loaders.product.load(ref.id),
    },

    Category: {
      products: (c, { params }) =>
        applyQuery(store.productsByCategory.get(String(c.id)) || [], params, {
          searchFields: PRODUCT_SEARCH,
          defaultLimit: 20,
          maxLimit: 500,
        }).items,
      productCount: (c) => (store.productsByCategory.get(String(c.id)) || []).length,
      __resolveReference: (ref, { loaders }) => loaders.category.load(ref.id),
    },

    Review: {
      product: (r, _a, { loaders }) => loaders.product.load(r.productId),
      // Ссылка на сущность User — разрешается subgraph orders через федерацию
      user: (r) => ({ __typename: 'User', id: String(r.userId) }),
      __resolveReference: (ref) => store.reviewsById.get(String(ref.id)) || null,
    },
  };
}
