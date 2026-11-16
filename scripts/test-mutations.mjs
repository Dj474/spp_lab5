// Проверка мутаций (без авторизации: все действия анонимные, от имени «Гостя»).
// Требует запущенного сервера: npm start
const API = 'http://localhost:4000/graphql';

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok — ${msg}`);
}

// 1. createReview от анонимного пользователя → привязывается к «Гостю»
let r = await gql(`mutation{ createReview(productId:1, rating:5, comment:"Отзыв из теста"){
  id rating comment userName user{ email } product{ title } } }`);
assert(r.data?.createReview?.userName === 'Гость', 'createReview выполнен без авторизации (Гость)');
assert(r.data.createReview.user.email.endsWith('@lab5.local'), 'федерация: отзыв (catalog) → пользователь (orders)');
const reviewId = r.data.createReview.id;

// 2. Некорректная оценка отклоняется
r = await gql(`mutation{ createReview(productId:1, rating:9, comment:"x"){ id } }`);
assert(r.errors?.[0]?.extensions?.code === 'BAD_USER_INPUT', 'неверная оценка отклонена (BAD_USER_INPUT)');

// 3. createOrder с позициями
r = await gql(`mutation{ createOrder(items:[{productId:1, quantity:2},{productId:2, quantity:1}]){
  id total items{ quantity subtotal product{ title category{ name } } } user{ email } } }`);
assert(r.data?.createOrder?.items?.length === 2, 'createOrder создаёт заказ с позициями');
assert(r.data.createOrder.items[0].product.category.name, 'федерация: позиция (orders) → товар → категория (catalog)');

// 4. updateOrderStatus
r = await gql(`mutation{ updateOrderStatus(id:1, status:"delivered"){ id status } }`);
assert(r.data?.updateOrderStatus?.status === 'delivered', 'updateOrderStatus меняет статус');

// 5. Недопустимый статус отклоняется
r = await gql(`mutation{ updateOrderStatus(id:1, status:"unknown"){ id } }`);
assert(r.errors?.[0]?.extensions?.code === 'BAD_USER_INPUT', 'недопустимый статус отклонён');

// 6. deleteReview
r = await gql(`mutation($id:ID!){ deleteReview(id:$id) }`, { id: reviewId });
assert(r.data?.deleteReview === true, 'deleteReview удаляет отзыв');

console.log('\nMUTATIONS OK');
