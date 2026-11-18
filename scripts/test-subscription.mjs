// Проверка подписок GraphQL. Подписки обслуживаются самими subgraph-сервисами
// (шлюз их не проксирует), поэтому подключаемся напрямую:
//   catalog  (http://localhost:4001) — reviewAdded
//   orders   (http://localhost:4002) — orderAdded, orderStatusChanged
// Авторизации нет. Требует запущенного сервера: npm start
const CATALOG = 'http://localhost:4001/graphql';
const ORDERS = 'http://localhost:4002/graphql';

async function gql(query, variables) {
  const res = await fetch('http://localhost:4000/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

/** Открывает SSE-подписку и вызывает onEvent для каждого события. Возвращает { stop }. */
function subscribe(endpoint, query, onEvent) {
  const ctrl = new AbortController();
  (async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.data) onEvent(parsed.data);
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  })();
  return { stop: () => ctrl.abort() };
}

const reviews = [];
const orders = [];
const statuses = [];

const s1 = subscribe(CATALOG, `subscription{ reviewAdded{ id rating comment userName productTitle } }`, (d) => d.reviewAdded && reviews.push(d.reviewAdded));
const s2 = subscribe(ORDERS, `subscription{ orderAdded{ id total userName } }`, (d) => d.orderAdded && orders.push(d.orderAdded));
const s3 = subscribe(ORDERS, `subscription{ orderStatusChanged{ id status userName } }`, (d) => d.orderStatusChanged && statuses.push(d.orderStatusChanged));

await new Promise((r) => setTimeout(r, 900)); // ждём установления соединений

await gql(`mutation{ createReview(productId:3, rating:4, comment:"Realtime отзыв"){ id } }`);
await gql(`mutation{ createOrder(items:[{productId:1, quantity:1}]){ id } }`);
await gql(`mutation{ updateOrderStatus(id:1, status:"shipped"){ id } }`);
await new Promise((r) => setTimeout(r, 900));

s1.stop();
s2.stop();
s3.stop();

if (!reviews.length) throw new Error('FAIL: событие reviewAdded не получено');
if (!orders.length) throw new Error('FAIL: событие orderAdded не получено');
if (!statuses.length) throw new Error('FAIL: событие orderStatusChanged не получено');

console.log('ok — reviewAdded:', JSON.stringify(reviews[0]));
console.log('ok — orderAdded:', JSON.stringify(orders[0]));
console.log('ok — orderStatusChanged:', JSON.stringify(statuses[0]));
console.log('\nSUBSCRIPTIONS OK');
