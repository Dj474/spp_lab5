// Клиент GraphQL: обычные запросы/мутации через шлюз + подписки через SSE.
// Авторизации нет. Каждый запрос помечается trace-id (трассировка).

const GATEWAY = '/graphql';

let lastTraceId = null;
export function getLastTraceId() {
  return lastTraceId;
}

function traceHeaders() {
  const id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return { 'x-trace-id': id };
}

export async function gql(query, variables) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...traceHeaders() },
    body: JSON.stringify({ query, variables }),
  });
  lastTraceId = res.headers.get('x-trace-id') || lastTraceId;
  const json = await res.json();
  if (json.errors?.length) {
    const first = json.errors[0];
    const err = new Error(first.message);
    err.code = first.extensions?.code;
    err.errors = json.errors;
    throw err;
  }
  return json.data;
}

/**
 * Подписка GraphQL поверх SSE к конкретному subgraph-сервису.
 * `endpoint` — адрес subgraph'а, полученный через query { topology }.
 * Возвращает функцию отписки.
 */
export function subscribe(endpoint, query, { onData, onError, onOpen } = {}) {
  const ctrl = new AbortController();

  (async () => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...traceHeaders(),
        },
        body: JSON.stringify({ query }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`subscription HTTP ${res.status}`);
      onOpen?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
            if (!payload || payload === '{}') continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.data) onData?.(parsed.data);
              else if (parsed.errors) onError?.(parsed.errors);
            } catch {
              /* игнорируем неполные чанки */
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') onError?.([err]);
    }
  })();

  return () => ctrl.abort();
}
