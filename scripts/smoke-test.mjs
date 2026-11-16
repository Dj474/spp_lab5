// Комплексная проверка API (без авторизации). Требует запущенного сервера: npm start
const API = 'http://localhost:4000/graphql';

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

const topo = await gql(`query{ topology }`);
console.log('topology:', JSON.stringify(topo.topology));

const info = await gql(`query{ datasetInfo sources{ name status count } }`);
console.log('dataset:', JSON.stringify(info.datasetInfo));
console.log('sources:', info.sources.map((s) => `${s.name}(${s.status}${s.count ? ':' + s.count : ''})`).join(', '));

const d1 = await gql(`query{ search(term:"наушники") }`);
console.log('search "наушники":', d1.search.total, d1.search.products[0]?.title);

const d2 = await gql(`query{ products(params:{ conditions:[{field:"price",op:"gt",value:"500"}], search:"наушники", sortBy:"price", sortDir:"asc", page:1, limit:3 }){ pageInfo{total} items{ id title price category{name} } } }`);
console.log('filtered products:', JSON.stringify(d2.products.pageInfo), d2.products.items.map(p => `${p.title} (${p.price}, ${p.category.name})`));

const d3 = await gql(`query{ order(id:5){ id status total user{ name email city } items{ quantity subtotal product{ title category{ name } } } } }`);
console.log('order 5:', JSON.stringify(d3.order, null, 1));

const d4 = await gql(`query{ categories{ name productCount products(params:{sortBy:"price",sortDir:"desc",limit:2}){ title price } } }`);
console.log('categories[0]:', JSON.stringify(d4.categories[0]));

// Запросы, которые отправляет frontend (все вкладки + детали)
const u = await gql(
  `query($p:ListParams){ users(params:$p){ pageInfo{ total } items{ id name email city country } } }`,
  { p: { page: 1, limit: 20, sortBy: 'id', sortDir: 'asc' } }
);
console.log('users:', u.users.pageInfo.total);

const rv = await gql(
  `query($p:ListParams){ reviews(params:$p){ pageInfo{ total } items{ id productTitle userName rating } } }`,
  { p: { page: 2, limit: 10, sortBy: 'rating', sortDir: 'desc' } }
);
console.log('reviews page 2:', rv.reviews.items.length, '/', rv.reviews.pageInfo.total);

const pd = await gql(
  `query($id:ID!){ product(id:$id){ title category{ name productCount } reviewCount reviews(limit:5){ rating userName } } }`,
  { id: '1' }
);
console.log('product detail:', pd.product.title, 'reviews:', pd.product.reviews.length);

const ud = await gql(
  `query($id:ID!){ user(id:$id){ name orderCount orders(status:"delivered"){ id } reviews{ rating product{ title } } } }`,
  { id: '1' }
);
console.log('user detail:', ud.user.name, 'delivered:', ud.user.orders.length, 'reviews:', ud.user.reviews.length);

// Аналитика и динамический поиск (как на вкладках frontend)
const stats = await gql(`query{
  byCategory: stats(entity:"products", groupBy:"categoryName", metric:"avg", field:"price"){ key value count }
  revenue: stats(entity:"orders", groupBy:"status", metric:"sum", field:"total"){ key value count }
}`);
console.log('stats: категорий', stats.byCategory.length, ', статусов', stats.revenue.length);

const srch = await gql(`query($t:String!){ search(term:$t) }`, { t: 'Минск' });
console.log('search "Минск": найдено', srch.search.total);

// Мониторинг через GraphQL
const mon = await gql(`query{ metrics }`);
console.log('metrics:', JSON.stringify(mon.metrics.counters));

console.log('\nOK — все виды операций работают.');
