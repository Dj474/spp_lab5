import { EventEmitter } from 'node:events';

/**
 * Минимальный PubSub для GraphQL Subscriptions на async-итераторах.
 * Без внешних зависимостей.
 */
export function createPubSub() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const topics = new Map(); // topic -> Map<id, push>

  function getTopic(topic) {
    if (!topics.has(topic)) topics.set(topic, new Map());
    return topics.get(topic);
  }

  return {
    publish(topic, payload) {
      const subs = topics.get(topic);
      if (!subs) return;
      for (const push of subs.values()) push(payload);
    },

    async *subscribe(topic) {
      const id = Math.random().toString(36).slice(2);
      const queue = [];
      let resolveNext = null;

      const push = (payload) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: payload, done: false });
        } else {
          queue.push(payload);
        }
      };

      getTopic(topic).set(id, push);
      try {
        while (true) {
          if (queue.length) {
            yield queue.shift();
            continue;
          }
          const next = await new Promise((resolve) => {
            resolveNext = resolve;
          });
          yield next.value;
        }
      } finally {
        topics.get(topic)?.delete(id);
      }
    },
  };
}

export const TOPICS = {
  REVIEW_ADDED: 'REVIEW_ADDED',
  ORDER_ADDED: 'ORDER_ADDED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
};
