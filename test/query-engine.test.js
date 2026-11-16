import { describe, it, expect } from 'vitest';
import { applyQuery } from '../server/data/store.js';

const data = [
  { id: 1, title: 'Alpha', price: 100, category: 'A', tags: ['x'] },
  { id: 2, title: 'beta', price: 50, category: 'B', tags: [] },
  { id: 3, title: 'Gamma', price: 300, category: 'A', tags: ['y'] },
  { id: 4, title: 'delta', price: 200, category: 'B', tags: [] },
  { id: 5, title: 'Epsilon', price: 150, category: 'C', tags: ['x', 'y'] },
];

describe('applyQuery', () => {
  it('фильтрация по операторам', () => {
    expect(applyQuery(data, { conditions: [{ field: 'price', op: 'gt', value: '150' }] }).items.map((x) => x.id)).toEqual([3, 4]);
    expect(applyQuery(data, { conditions: [{ field: 'category', op: 'eq', value: 'A' }] }).items.map((x) => x.id)).toEqual([1, 3]);
    expect(applyQuery(data, { conditions: [{ field: 'category', op: 'ne', value: 'A' }] }).items).toHaveLength(3);
    expect(applyQuery(data, { conditions: [{ field: 'price', op: 'lte', value: '150' }] }).items.map((x) => x.id)).toEqual([1, 2, 5]);
  });

  it('несколько условий применяются как AND', () => {
    const res = applyQuery(data, {
      conditions: [
        { field: 'price', op: 'gte', value: '100' },
        { field: 'category', op: 'eq', value: 'B' },
      ],
    });
    expect(res.items.map((x) => x.id)).toEqual([4]);
  });

  it('поиск по полям (регистронезависимый)', () => {
    const res = applyQuery(data, { search: 'ALP', searchFields: ['title'] });
    expect(res.items.map((x) => x.id)).toEqual([1]);
    const res2 = applyQuery(data, { search: 'gamma', searchFields: ['title'] });
    expect(res2.items.map((x) => x.id)).toEqual([3]);
  });

  it('сортировка по возрастанию и убыванию', () => {
    expect(applyQuery(data, { sortBy: 'price', sortDir: 'asc' }).items.map((x) => x.price)).toEqual([50, 100, 150, 200, 300]);
    expect(applyQuery(data, { sortBy: 'price', sortDir: 'desc' }).items.map((x) => x.price)).toEqual([300, 200, 150, 100, 50]);
  });

  it('пагинация и метаданные', () => {
    const res = applyQuery(data, { page: 2, limit: 2, sortBy: 'id' });
    expect(res.items.map((x) => x.id)).toEqual([3, 4]);
    expect(res.pageInfo).toMatchObject({ total: 5, page: 2, limit: 2, pages: 3 });
  });

  it('страница вне диапазона обрезается', () => {
    const res = applyQuery(data, { page: 99, limit: 2 });
    expect(res.pageInfo.page).toBe(3);
    expect(res.items.map((x) => x.id)).toEqual([5]);
  });

  it('лимит ограничен сверху', () => {
    const res = applyQuery(data, { limit: 9999 }, { maxLimit: 100 });
    expect(res.pageInfo.limit).toBe(100);
  });
});
