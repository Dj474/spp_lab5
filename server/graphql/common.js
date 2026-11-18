// Общие части GraphQL-слоя: скаляр JSON, списки полей поиска,
// вспомогательные функции (агрегации, динамический поиск, «гость»).

import { GraphQLScalarType, Kind, GraphQLError } from 'graphql';
import { getPath, groupBy } from '../data/store.js';

export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Произвольная JSON-структура',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral(ast) {
    const parse = (node) => {
      switch (node.kind) {
        case Kind.STRING:
        case Kind.BOOLEAN:
          return node.value;
        case Kind.INT:
          return parseInt(node.value, 10);
        case Kind.FLOAT:
          return parseFloat(node.value);
        case Kind.NULL:
          return null;
        case Kind.LIST:
          return node.values.map(parse);
        case Kind.OBJECT:
          return node.fields.reduce((o, f) => ((o[f.name.value] = parse(f.value)), o), {});
        default:
          return null;
      }
    };
    return parse(ast);
  },
});

export const PRODUCT_SEARCH = ['title', 'categoryName', 'description'];
export const ORDER_SEARCH = ['userName', 'userEmail', 'status'];
export const USER_SEARCH = ['name', 'email', 'city', 'country'];
export const REVIEW_SEARCH = ['productTitle', 'userName', 'comment'];

export const VALID_STATUSES = ['created', 'paid', 'shipped', 'delivered', 'cancelled'];

export function round(n, digits = 2) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export const nextId = (list) => list.reduce((max, x) => Math.max(max, Number(x.id) || 0), 0) + 1;

export function badInput(message) {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

// Авторизации нет: анонимные действия привязываются к служебному
// пользователю «Гость», который создаётся при первом обращении.
export const GUEST_EMAIL = 'guest@lab5.local';
export function guestUser(store, persist) {
  let user = store.usersByEmail.get(GUEST_EMAIL);
  if (user) return user;
  user = {
    id: nextId(store.users),
    name: 'Гость',
    email: GUEST_EMAIL,
    city: 'Минск',
    country: 'Беларусь',
    role: 'guest',
    registeredAt: new Date().toISOString(),
  };
  store.users.push(user);
  store.usersById.set(String(user.id), user);
  store.usersByEmail.set(GUEST_EMAIL, user);
  store.info.users++;
  store.info.total++;
  persist?.user?.(user);
  return user;
}

export function computeStats(store, { entity, groupBy: groupField, metric = 'count', field }) {
  const table = {
    products: store.products,
    orders: store.orders,
    users: store.users,
    reviews: store.reviews,
    categories: store.categories,
  };
  const rows = table[String(entity).toLowerCase()];
  if (!rows) throw badInput(`Неизвестная сущность: ${entity}`);

  const groups = groupBy(rows, (r) => String(getPath(r, groupField) ?? '—'));
  const out = [];
  for (const [key, items] of groups) {
    let value = items.length;
    if (metric !== 'count') {
      const nums = items.map((i) => Number(getPath(i, field))).filter((n) => !Number.isNaN(n));
      if (metric === 'sum') value = nums.reduce((a, b) => a + b, 0);
      else if (metric === 'avg') value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      else if (metric === 'min') value = nums.length ? Math.min(...nums) : 0;
      else if (metric === 'max') value = nums.length ? Math.max(...nums) : 0;
    }
    out.push({ key, value: round(value), count: items.length });
  }
  return out.sort((a, b) => b.value - a.value);
}

export function dynamicSearch(store, term) {
  const q = String(term || '').trim().toLowerCase();
  const contains = (val, fields) => fields.some((f) => String(getPath(val, f) ?? '').toLowerCase().includes(q));
  const limit = 10;
  const products = store.products.filter((p) => contains(p, PRODUCT_SEARCH)).slice(0, limit);
  const orders = store.orders.filter((o) => contains(o, ORDER_SEARCH)).slice(0, limit);
  const users = store.users.filter((u) => contains(u, USER_SEARCH)).slice(0, limit);
  const reviews = store.reviews.filter((r) => contains(r, REVIEW_SEARCH)).slice(0, limit);
  return { term, products, orders, users, reviews, total: products.length + orders.length + users.length + reviews.length };
}
