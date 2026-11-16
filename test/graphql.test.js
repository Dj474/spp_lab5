import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp, run } from './helpers.js';

let app;
beforeEach(async () => {
  app = await buildTestApp();
});
afterEach(async () => {
  await app.stop();
});

describe('GraphQL: запросы', () => {
  it('пагинация + сортировка списка товаров', async () => {
    const res = await run(
      app,
      `query($p:ListParams){ products(params:$p){ pageInfo{ total page limit pages } items{ id price } } }`,
      { variableValues: { p: { sortBy: 'price', sortDir: 'asc', page: 1, limit: 3 } } }
    );
    expect(res.errors).toBeUndefined();
    expect(res.data.products.pageInfo.total).toBe(10);
    expect(res.data.products.items).toHaveLength(3);
    const prices = res.data.products.items.map((p) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('вложенность: товар → категория', async () => {
    const res = await run(app, `query{ product(id:1){ id title category{ id name productCount } } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.product.category.name).toBeTruthy();
    expect(typeof res.data.product.category.productCount).toBe('number');
  });

  it('вложенность: заказ → позиции → товар → категория (через федерацию)', async () => {
    const res = await run(
      app,
      `query{ order(id:1){ id items{ quantity product{ title category{ name } } } user{ name } } }`
    );
    expect(res.errors).toBeUndefined();
    expect(res.data.order.items.length).toBeGreaterThan(0);
    expect(res.data.order.items[0].product.category.name).toBeTruthy();
  });

  it('фильтрация + поиск через ListParams', async () => {
    const res = await run(
      app,
      `query{ products(params:{ conditions:[{field:"price",op:"gt",value:"0"}] search:"a" }){ pageInfo{ total } } }`
    );
    expect(res.errors).toBeUndefined();
    expect(res.data.products.pageInfo.total).toBeGreaterThanOrEqual(0);
  });

  it('динамическая агрегация stats', async () => {
    const res = await run(app, `query{ stats(entity:"products", groupBy:"categoryName", metric:"count"){ key value count } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.stats.length).toBeGreaterThan(0);
    expect(res.data.stats[0]).toHaveProperty('value');
  });

  it('динамический поиск по сущностям', async () => {
    const res = await run(app, `query{ search(term:"a") }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.search).toHaveProperty('total');
    expect(res.data.search).toHaveProperty('products');
  });

  it('datasetInfo отражает объёмы', async () => {
    const res = await run(app, `query{ datasetInfo }`);
    expect(res.data.datasetInfo.products).toBe(10);
    expect(res.data.datasetInfo.orders).toBe(5);
  });
});

describe('GraphQL Federation', () => {
  it('данные доступны без токена (авторизации нет)', async () => {
    const o = await run(app, `query{ orders{ pageInfo{ total } } }`);
    expect(o.errors).toBeUndefined();
    expect(o.data.orders.pageInfo.total).toBeGreaterThan(0);
    const u = await run(app, `query{ users{ pageInfo{ total } } }`);
    expect(u.errors).toBeUndefined();
  });

  it('межсервисный обход: отзыв (catalog) → пользователь (orders)', async () => {
    const res = await run(app, `query{ reviews{ items{ userName user{ email city } } } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.reviews.items[0].user.email).toContain('@');
  });

  it('межсервисный обход: пользователь (orders) → отзывы (catalog)', async () => {
    const res = await run(app, `query{ user(id:1){ name reviews{ id productTitle rating } } }`);
    expect(res.errors).toBeUndefined();
    expect(Array.isArray(res.data.user.reviews)).toBe(true);
  });

  it('топология распределённой системы', async () => {
    const res = await run(app, `query{ topology }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.topology).toHaveProperty('catalog');
    expect(res.data.topology).toHaveProperty('orders');
  });
});

describe('GraphQL: мутации (анонимные)', () => {
  it('createReview привязывает «Гостя» и публикует событие', async () => {
    const res = await run(app, `mutation{ createReview(productId:1, rating:4, comment:"норм"){ id rating userName } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.createReview.userName).toBe('Гость');
    expect(app.pubsub.published.some((e) => e.t === 'REVIEW_ADDED')).toBe(true);
  });

  it('createReview отклоняет неверную оценку', async () => {
    const res = await run(app, `mutation{ createReview(productId:1, rating:9, comment:"x"){ id } }`);
    expect(res.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  });

  it('createOrder создаёт заказ с позициями', async () => {
    const res = await run(app, `mutation{ createOrder(items:[{productId:1,quantity:2}]){ id total items{ product{ id } } user{ email } } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.createOrder.items).toHaveLength(1);
    expect(res.data.createOrder.total).toBeGreaterThan(0);
  });

  it('updateOrderStatus меняет статус', async () => {
    const res = await run(app, `mutation{ updateOrderStatus(id:1, status:"delivered"){ id status } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.updateOrderStatus.status).toBe('delivered');
  });

  it('deleteReview удаляет отзыв', async () => {
    const res = await run(app, `mutation{ deleteReview(id:1) }`);
    expect(res.errors).toBeUndefined();
    expect(res.data.deleteReview).toBe(true);
  });
});
