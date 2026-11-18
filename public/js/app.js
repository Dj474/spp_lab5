import { gql, subscribe, getLastTraceId } from './api.js';
import {
  $, $$, esc, money, num, dateTime, dateShort, stars, statusBadge, truncate,
  toast, openModal, closeModal, openDrawer, closeDrawer, loadingHtml, errorHtml,
} from './ui.js';

const STATUSES = ['created', 'paid', 'shipped', 'delivered', 'cancelled'];

const state = {
  entity: 'products',
  page: 1,
  limit: 20,
  search: '',
  sortBy: 'id',
  sortDir: 'asc',
  filterField: '',
  filterOp: 'eq',
  filterValue: '',
  topology: null,
  feed: [],
};

// ---------- Конфигурация сущностей ----------
const ENTITIES = {
  products: {
    page: 'products',
    sort: ['id', 'title', 'price', 'stock', 'rating', 'categoryName'],
    filter: ['id', 'title', 'price', 'stock', 'rating', 'categoryName'],
    searchFields: ['title', 'categoryName'],
    columns: [
      { key: 'id', label: 'ID', cls: 'cell-muted' },
      { key: 'title', label: 'Название', cls: 'cell-strong', render: (v) => esc(truncate(v, 52)) },
      { key: 'price', label: 'Цена', render: (v) => money(v) },
      { key: 'stock', label: 'Остаток' },
      { key: 'rating', label: 'Рейтинг', render: (v) => stars(v) },
      { key: 'categoryName', label: 'Категория', cls: 'cell-muted' },
    ],
    query: (p) => `products(params:${p}){ pageInfo{ total page pages } items{ id title price stock rating categoryName } }`,
  },
  orders: {
    page: 'orders',
    sort: ['id', 'status', 'total', 'createdAt', 'userName'],
    filter: ['id', 'status', 'total', 'userName', 'userEmail'],
    searchFields: ['userName', 'userEmail'],
    columns: [
      { key: 'id', label: '№', cls: 'cell-muted' },
      { key: 'userName', label: 'Клиент', cls: 'cell-strong' },
      { key: 'status', label: 'Статус', render: (v) => statusBadge(v) },
      { key: 'total', label: 'Сумма', render: (v) => money(v) },
      { key: 'createdAt', label: 'Дата', render: (v) => dateShort(v) },
    ],
    query: (p) => `orders(params:${p}){ pageInfo{ total page pages } items{ id userName status total createdAt } }`,
    action: { label: '＋ Создать заказ', handler: 'createOrder' },
  },
  users: {
    page: 'users',
    sort: ['id', 'name', 'email', 'city', 'country', 'registeredAt'],
    filter: ['id', 'name', 'email', 'city', 'country'],
    searchFields: ['name', 'email', 'city'],
    columns: [
      { key: 'id', label: 'ID', cls: 'cell-muted' },
      { key: 'name', label: 'Имя', cls: 'cell-strong' },
      { key: 'email', label: 'E-mail', cls: 'cell-muted' },
      { key: 'city', label: 'Город' },
      { key: 'country', label: 'Страна' },
    ],
    query: (p) => `users(params:${p}){ pageInfo{ total page pages } items{ id name email city country } }`,
  },
  reviews: {
    page: 'reviews',
    sort: ['id', 'rating', 'createdAt', 'productTitle', 'userName'],
    filter: ['id', 'rating', 'productTitle', 'userName'],
    searchFields: ['productTitle', 'userName', 'comment'],
    columns: [
      { key: 'id', label: 'ID', cls: 'cell-muted' },
      { key: 'productTitle', label: 'Товар', cls: 'cell-strong', render: (v) => esc(truncate(v, 40)) },
      { key: 'userName', label: 'Пользователь' },
      { key: 'rating', label: 'Оценка', render: (v) => stars(v) },
      { key: 'comment', label: 'Комментарий', cls: 'cell-muted', render: (v) => esc(truncate(v, 46)) },
    ],
    query: (p) => `reviews(params:${p}){ pageInfo{ total page pages } items{ id productTitle userName rating comment } }`,
    action: { label: '＋ Создать отзыв', handler: 'createReview' },
  },
};

// ---------- Инициализация ----------
async function init() {
  wireChrome();
  await Promise.all([loadInfo(), loadTopology()]);
  startRealtime();
  switchEntity('products');
}

async function loadInfo() {
  try {
    const data = await gql(`query{ datasetInfo sources{ name status count error } }`);
    const info = data.datasetInfo;
    $('#dataset-info').textContent = `Записей: ${num(info.total)}`;
    $('#sources-list').innerHTML = data.sources
      .map(
        (s) =>
          `<div class="src-item ${s.status}"><span class="s-dot"></span><span title="${esc(s.error || '')}">${esc(s.name)}${s.count ? ` · ${s.count}` : ''}</span></div>`
      )
      .join('');
  } catch {
    $('#dataset-info').textContent = 'нет соединения';
  }
}

// ---------- Топология распределённой системы (через GraphQL) ----------
async function loadTopology() {
  try {
    const data = await gql(`query{ topology }`);
    state.topology = data.topology;
  } catch {
    state.topology = null;
  }
  renderTopology();
}

function renderTopology() {
  const area = $('#topology-area');
  if (!area) return;
  const t = state.topology;
  if (!t) {
    area.innerHTML = '';
    return;
  }
  const services = ['catalog', 'orders', 'analytics'].filter((k) => t[k]);
  area.innerHTML =
    `<span class="fed-label" title="${esc(t.gateway || '')}">federation</span>` +
    services.map((k) => `<span class="pill pill-svc" title="${esc(t[k])}">${esc(k)}</span>`).join('');
}

// ---------- Тулбар ----------
function renderToolbar() {
  const cfg = ENTITIES[state.entity];
  const bar = $('#toolbar');
  if (!cfg) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = `
    <input type="text" id="f-search" class="grow" placeholder="Поиск…" value="${esc(state.search)}" />
    <select id="f-field">${['', ...cfg.filter].map((f) => `<option value="${f}" ${state.filterField === f ? 'selected' : ''}>${f || '— фильтр —'}</option>`).join('')}</select>
    <select id="f-op">${['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte'].map((o) => `<option value="${o}" ${state.filterOp === o ? 'selected' : ''}>${opLabel(o)}</option>`).join('')}</select>
    <input type="text" id="f-value" placeholder="значение" value="${esc(state.filterValue)}" />
    <select id="f-sort">${cfg.sort.map((s) => `<option value="${s}" ${state.sortBy === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <select id="f-dir"><option value="asc" ${state.sortDir === 'asc' ? 'selected' : ''}>↑ возр.</option><option value="desc" ${state.sortDir === 'desc' ? 'selected' : ''}>↓ убыв.</option></select>
    <select id="f-limit">${[10, 20, 50, 100].map((n) => `<option value="${n}" ${state.limit === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <button class="btn btn-primary" id="f-apply">Применить</button>
    <button class="btn btn-ghost" id="f-reset">Сброс</button>
    ${cfg.action ? `<button class="btn" id="f-action">${cfg.action.label}</button>` : ''}
  `;
  $('#f-apply').onclick = applyFilters;
  $('#f-reset').onclick = () => {
    Object.assign(state, { search: '', filterField: '', filterValue: '', filterOp: 'eq', page: 1 });
    renderToolbar();
    loadList();
  };
  if (cfg.action) $('#f-action').onclick = () => runAction(cfg.action.handler);
  $('#f-search').addEventListener('keydown', (e) => e.key === 'Enter' && applyFilters());
}

function opLabel(op) {
  return { eq: '=', ne: '≠', contains: 'содержит', gt: '>', gte: '≥', lt: '<', lte: '≤' }[op] || op;
}

function applyFilters() {
  state.search = $('#f-search').value.trim();
  state.filterField = $('#f-field').value;
  state.filterOp = $('#f-op').value;
  state.filterValue = $('#f-value').value.trim();
  state.sortBy = $('#f-sort').value;
  state.sortDir = $('#f-dir').value;
  state.limit = Number($('#f-limit').value);
  state.page = 1;
  loadList();
}

// ---------- Список ----------
async function loadList() {
  const cfg = ENTITIES[state.entity];
  const content = $('#content');
  content.innerHTML = loadingHtml();
  $('#pager').innerHTML = '';
  try {
    const data = await gql(`query($p:ListParams){ ${cfg.query('$p')} }`, { p: currentParams() });
    const payload = data[cfg.page];
    renderTable(cfg, payload.items);
    renderPager(payload.pageInfo);
  } catch (e) {
    content.innerHTML = errorHtml(e.message);
  }
}

function currentParams() {
  const conditions = [];
  if (state.filterField && state.filterValue !== '') {
    conditions.push({ field: state.filterField, op: state.filterOp, value: state.filterValue });
  }
  return {
    conditions,
    search: state.search || null,
    sortBy: state.sortBy || null,
    sortDir: state.sortDir,
    page: state.page,
    limit: state.limit,
  };
}

function renderTable(cfg, items) {
  if (!items.length) {
    $('#content').innerHTML = '<div class="empty">Ничего не найдено. Попробуйте изменить фильтры.</div>';
    return;
  }
  const head = cfg.columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const rows = items
    .map((it) => {
      const tds = cfg.columns
        .map((c) => {
          const raw = it[c.key];
          const value = c.render ? c.render(raw, it) : esc(raw ?? '—');
          return `<td class="${c.cls || ''}">${value}</td>`;
        })
        .join('');
      return `<tr data-id="${esc(it.id)}">${tds}</tr>`;
    })
    .join('');
  $('#content').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  $$('#content tbody tr').forEach((tr) => tr.addEventListener('click', () => openDetail(state.entity, tr.dataset.id)));
}

function renderPager(info) {
  const pages = pageNumbers(info.page, info.pages);
  $('#pager').innerHTML = `
    <button id="pg-first" ${info.page <= 1 ? 'disabled' : ''}>«</button>
    <button id="pg-prev" ${info.page <= 1 ? 'disabled' : ''}>◀</button>
    <div class="pages">${pages
      .map((p) => (p === '…' ? '<span>…</span>' : `<button class="${p === info.page ? 'current' : ''}" data-p="${p}">${p}</button>`))
      .join('')}</div>
    <button id="pg-next" ${info.page >= info.pages ? 'disabled' : ''}>▶</button>
    <button id="pg-last" ${info.page >= info.pages ? 'disabled' : ''}>»</button>
    <span>всего ${num(info.total)} записей</span>`;
  const go = (p) => {
    state.page = p;
    loadList();
  };
  $('#pg-first').onclick = () => go(1);
  $('#pg-prev').onclick = () => go(Math.max(1, info.page - 1));
  $('#pg-next').onclick = () => go(Math.min(info.pages, info.page + 1));
  $('#pg-last').onclick = () => go(info.pages);
  $$('#pager .pages button').forEach((b) => (b.onclick = () => go(Number(b.dataset.p))));
}

function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

// ---------- Детали (с вложенностью, через федерацию) ----------
const DETAIL_QUERIES = {
  products: (id) => ({ q: `query($id:ID!){ product(id:$id){
      id title description price stock rating createdAt category{ name productCount }
      reviewCount reviews(limit:6){ id rating comment createdAt userName } } }`, v: { id } }),
  orders: (id) => ({ q: `query($id:ID!){ order(id:$id){
      id status total createdAt userId user{ name email city country }
      items{ id quantity subtotal product{ id title price category{ name } } } } }`, v: { id } }),
  users: (id) => ({ q: `query($id:ID!){ user(id:$id){
      id name email city country registeredAt orderCount
      orders{ id total status createdAt } reviews{ id rating product{ title } } } }`, v: { id } }),
  reviews: (id) => ({ q: `query{ reviews(params:{conditions:[{field:"id",op:"eq",value:"${id}"}]}){
      items{ id rating comment createdAt userId product{ id title category{ name } } userName } } }`, v: {} }),
};

async function openDetail(entity, id) {
  openDrawer(loadingHtml());
  try {
    const { q, v } = DETAIL_QUERIES[entity](id);
    const data = await gql(q, v);
    $('#drawer-body').innerHTML = renderDetail(entity, data);
    wireDetailActions(entity, data);
  } catch (e) {
    $('#drawer-body').innerHTML = errorHtml(e.message);
  }
}

function field(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="field"><b>${esc(label)}</b><span class="val">${value}</span></div>`;
}

function renderDetail(entity, data) {
  if (entity === 'products') {
    const p = data.product;
    return `
      <h2>${esc(p.title)}</h2>
      <div class="subtitle">Товар #${p.id}</div>
      ${field('Цена', `${money(p.price)} BYN`)}
      ${field('Остаток', num(p.stock))}
      ${field('Рейтинг', stars(p.rating))}
      ${field('Категория', `${esc(p.category.name)} · ${p.category.productCount} товаров`)}
      ${field('Отзывов', num(p.reviewCount))}
      ${field('Создан', dateShort(p.createdAt))}
      ${field('Описание', esc(p.description))}
      <div class="sub-block">
        <h4>Отзывы</h4>
        <div class="mini-list">${
          p.reviews.length
            ? p.reviews
                .map(
                  (r) =>
                    `<div class="mini-item">${stars(r.rating)} <span class="cell-muted">${esc(r.userName)}</span><br>${esc(r.comment || '')}</div>`
                )
                .join('')
            : '<div class="mini-item cell-muted">Пока нет отзывов</div>'
        }</div>
      </div>
      <div class="sub-block">
        <button class="btn btn-primary" id="d-review">✍ Оставить отзыв</button>
      </div>`;
  }

  if (entity === 'orders') {
    const o = data.order;
    return `
      <h2>Заказ #${o.id}</h2>
      <div class="subtitle">${dateTime(o.createdAt)}</div>
      ${field('Статус', statusBadge(o.status))}
      ${field('Сумма', `${money(o.total)} BYN`)}
      ${field('Позиций', num(o.itemsCount))}
      ${field('Клиент', `${esc(o.user.name)}<br><span class="cell-muted">${esc(o.user.email)}</span>`)}
      ${field('Город', `${esc(o.user.city || '—')}, ${esc(o.user.country || '—')}`)}
      <div class="sub-block">
        <h4>Состав заказа</h4>
        <div class="mini-list">${o.items
          .map(
            (i) =>
              `<div class="mini-item"><b>${esc(i.product.title)}</b><br>
               <span class="cell-muted">${esc(i.product.category.name)} · ${money(i.product.price)} × ${i.quantity} = <b>${money(i.subtotal)}</b></span></div>`
          )
          .join('')}</div>
      </div>
      <div class="sub-block">
        <h4>Изменить статус</h4>
        <div class="form-row">
          <select id="d-status">${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </div>
        <button class="btn btn-primary" id="d-status-save">Применить</button>
      </div>`;
  }

  if (entity === 'users') {
    const u = data.user;
    return `
      <h2>${esc(u.name)}</h2>
      <div class="subtitle">Пользователь #${u.id}</div>
      ${field('E-mail', esc(u.email))}
      ${field('Город', `${esc(u.city || '—')}, ${esc(u.country || '—')}`)}
      ${field('Регистрация', dateShort(u.registeredAt))}
      ${field('Заказов', num(u.orderCount))}
      <div class="sub-block"><h4>Последние заказы</h4><div class="mini-list">${
        u.orders.length
          ? u.orders
              .slice(0, 8)
              .map((o) => `<div class="mini-item">#${o.id} · ${statusBadge(o.status)} · <b>${money(o.total)}</b> <span class="cell-muted">${dateShort(o.createdAt)}</span></div>`)
              .join('')
          : '<div class="mini-item cell-muted">нет заказов</div>'
      }</div></div>
      <div class="sub-block"><h4>Отзывы</h4><div class="mini-list">${
        u.reviews.length
          ? u.reviews.slice(0, 8).map((r) => `<div class="mini-item">${stars(r.rating)} ${esc(r.product.title)}</div>`).join('')
          : '<div class="mini-item cell-muted">нет отзывов</div>'
      }</div></div>`;
  }

  const r = data.reviews.items[0];
  if (!r) return '<h2>Отзыв не найден</h2>';
  return `
    <h2>Отзыв #${r.id}</h2>
    <div class="subtitle">${dateTime(r.createdAt)}</div>
    ${field('Оценка', stars(r.rating))}
    ${field('Товар', `${esc(r.product.title)}<br><span class="cell-muted">${esc(r.product.category.name)}</span>`)}
    ${field('Пользователь', esc(r.userName))}
    ${field('Комментарий', esc(r.comment || '—'))}
    <div class="sub-block"><button class="btn btn-danger" id="d-delete-review">Удалить отзыв</button></div>`;
}

function wireDetailActions(entity, data) {
  if (entity === 'products' && $('#d-review')) {
    const product = data.product;
    $('#d-review').onclick = () => openReviewModal(product);
  }
  if (entity === 'orders' && $('#d-status-save')) {
    const order = data.order;
    $('#d-status-save').onclick = async () => {
      const status = $('#d-status').value;
      try {
        await gql(`mutation($id:ID!,$s:String!){ updateOrderStatus(id:$id,status:$s){ id status } }`, { id: order.id, s: status });
        toast('Статус обновлён', `${order.id} → ${status}`, 'success');
        closeDrawer();
        refresh();
      } catch (e) {
        toast('Ошибка', e.message, 'error');
      }
    };
  }
  if (entity === 'reviews' && $('#d-delete-review')) {
    const review = data.reviews.items[0];
    $('#d-delete-review').onclick = async () => {
      if (!confirm('Удалить отзыв?')) return;
      try {
        await gql(`mutation($id:ID!){ deleteReview(id:$id) }`, { id: review.id });
        toast('Отзыв удалён', `#${review.id}`, 'success');
        closeDrawer();
        refresh();
      } catch (e) {
        toast('Ошибка', e.message, 'error');
      }
    };
  }
}

// ---------- Мутации из UI (анонимные, без авторизации) ----------
// Если товар не задан (кнопка в разделе «Отзывы»), пользователь выбирает его в форме.
async function openReviewModal(product) {
  let products = [];
  if (!product) {
    try {
      const data = await gql(`query{ products(params:{limit:200,sortBy:"title",sortDir:"asc"}){ items{ id title } } }`);
      products = data.products.items;
    } catch (e) {
      toast('Ошибка', e.message, 'error');
      return;
    }
  }
  const productSelect = product
    ? ''
    : `<div class="form-row"><label>Товар</label><select name="productId">${products
        .map((p) => `<option value="${p.id}">${esc(truncate(p.title, 50))}</option>`)
        .join('')}</select></div>`;
  openModal(`
    <h2>${product ? 'Отзыв о товаре' : 'Новый отзыв'}</h2>
    <div class="subtitle">${product ? esc(truncate(product.title, 60)) : 'Выберите товар и поставьте оценку'}</div>
    <form id="review-form">
      ${productSelect}
      <div class="form-row">
        <label>Оценка</label>
        <select name="rating">${[5, 4, 3, 2, 1].map((r) => `<option value="${r}">${'★'.repeat(r)}${'☆'.repeat(5 - r)} (${r})</option>`).join('')}</select>
      </div>
      <div class="form-row"><label>Комментарий</label><textarea name="comment" placeholder="Поделитесь впечатлением…"></textarea></div>
      <div class="form-error" id="review-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">Отправить</button>
        <button class="btn btn-ghost" type="button" id="review-cancel">Отмена</button>
      </div>
    </form>
  `);
  $('#review-cancel').onclick = closeModal;
  $('#review-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const productId = product ? product.id : fd.get('productId');
    try {
      await gql(`mutation($p:ID!,$r:Int!,$c:String){ createReview(productId:$p,rating:$r,comment:$c){ id } }`, {
        p: productId,
        r: Number(fd.get('rating')),
        c: fd.get('comment'),
      });
      closeModal();
      toast('Спасибо за отзыв!', `Товар #${productId}`, 'success');
      refresh();
    } catch (err) {
      $('#review-error').textContent = err.message;
    }
  };
}

async function openCreateOrderModal() {
  let products = [];
  try {
    const data = await gql(`query{ products(params:{limit:100,sortBy:"title",sortDir:"asc"}){ items{ id title price } } }`);
    products = data.products.items;
  } catch (e) {
    toast('Ошибка', e.message, 'error');
    return;
  }
  const options = products.map((p) => `<option value="${p.id}">${esc(truncate(p.title, 50))} — ${money(p.price)}</option>`).join('');

  const row = () => `
    <div class="order-row">
      <select class="oi-product">${options}</select>
      <input class="oi-qty" type="number" min="1" value="1" />
      <button type="button" class="btn btn-ghost btn-sm oi-remove">✕</button>
    </div>`;

  openModal(`
    <h2>Новый заказ</h2>
    <div class="subtitle">Выберите товары и количество</div>
    <form id="order-form">
      <div id="order-rows">${row()}</div>
      <button type="button" class="btn btn-sm" id="order-add">＋ Добавить позицию</button>
      <div class="form-error" id="order-error"></div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">Создать заказ</button>
        <button class="btn btn-ghost" type="button" id="order-cancel">Отмена</button>
      </div>
    </form>
  `);

  const bindRow = (rowEl) => {
    rowEl.querySelector('.oi-remove').onclick = () => {
      if ($$('#order-rows .order-row').length > 1) rowEl.remove();
    };
  };
  $$('#order-rows .order-row').forEach(bindRow);
  $('#order-add').onclick = () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = row();
    const rowEl = wrap.firstElementChild;
    $('#order-rows').appendChild(rowEl);
    bindRow(rowEl);
  };
  $('#order-cancel').onclick = closeModal;
  $('#order-form').onsubmit = async (e) => {
    e.preventDefault();
    const items = $$('#order-rows .order-row').map((r) => ({
      productId: r.querySelector('.oi-product').value,
      quantity: Number(r.querySelector('.oi-qty').value) || 1,
    }));
    try {
      const data = await gql(`mutation($items:[OrderItemInput!]!){ createOrder(items:$items){ id total } }`, { items });
      closeModal();
      toast('Заказ создан', `#${data.createOrder.id} на сумму ${money(data.createOrder.total)}`, 'success');
      refresh();
    } catch (err) {
      $('#order-error').textContent = err.message;
    }
  };
}

function runAction(handler) {
  if (handler === 'createOrder') openCreateOrderModal();
  if (handler === 'createReview') openReviewModal();
}

// ---------- Аналитика ----------
async function renderAnalytics() {
  $('#toolbar').innerHTML = '';
  const content = $('#content');
  content.innerHTML = loadingHtml('Считаю статистику…');
  $('#pager').innerHTML = '';
  try {
    const data = await gql(`query{
      datasetInfo
      sources{ name status count error }
      avgPrice: stats(entity:"products", groupBy:"categoryName", metric:"avg", field:"price"){ key value count }
      revenue: stats(entity:"orders", groupBy:"status", metric:"sum", field:"total"){ key value count }
      ratings: stats(entity:"reviews", groupBy:"rating", metric:"count"){ key value count }
      topCategories: stats(entity:"products", groupBy:"categoryName", metric:"count"){ key value count }
    }`);
    const info = data.datasetInfo;
    const cards = [
      ['Всего записей', info.total],
      ['Товары', info.products],
      ['Заказы', info.orders],
      ['Позиции заказов', info.orderItems],
      ['Пользователи', info.users],
      ['Отзывы', info.reviews],
    ]
      .map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${num(v)}</div></div>`)
      .join('');

    const sources = data.sources
      .map(
        (s) =>
          `<div class="src-item ${s.status}"><span class="s-dot"></span>${esc(s.name)} — ${s.status}${s.count ? ` (${s.count})` : ''}${s.error ? ` · ${esc(s.error)}` : ''}</div>`
      )
      .join('');

    content.innerHTML = `
      <div class="section-title">Объём данных</div>
      <div class="grid-cards">${cards}</div>

      <div class="section-title">Источники данных (отказоустойчивость)</div>
      <div class="chart">${sources}</div>

      <div class="section-title">Средняя цена по категориям</div>
      <div class="chart">${barChart(data.avgPrice, (v) => money(v))}</div>

      <div class="section-title">Сумма заказов по статусам</div>
      <div class="chart">${barChart(data.revenue, (v) => money(v))}</div>

      <div class="section-title">Распределение оценок</div>
      <div class="chart">${barChart(data.ratings, (v) => `${num(v)} отз.`, (k) => `${'★'.repeat(Number(k))}`)}</div>

      <div class="section-title">Количество товаров по категориям</div>
      <div class="chart">${barChart(data.topCategories, (v) => num(v))}</div>
    `;
  } catch (e) {
    content.innerHTML = errorHtml(e.message);
  }
}

function barChart(rows, fmtValue, fmtKey) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return rows
    .map(
      (r) => `
      <div class="stat-row">
        <div>${fmtKey ? fmtKey(r.key) : esc(r.key)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((r.value / max) * 100)}%"></div></div>
        <div class="num">${fmtValue(r.value)}</div>
      </div>`
    )
    .join('');
}

// ---------- Мониторинг (контроль нагрузки, метрики, трассировка) ----------
async function renderMonitoring() {
  $('#toolbar').innerHTML = '';
  $('#pager').innerHTML = '';
  const content = $('#content');
  content.innerHTML = loadingHtml('Собираю метрики…');
  try {
    const data = await gql(`query{
      datasetInfo
      topology
      metrics
      sources{ name status count error }
    }`);
    const m = data.metrics || {};
    const counters = m.counters || {};
    const latency = m.latency || {};
    const t = data.topology || {};

    const cards = [
      ['Аптайм, с', num(m.uptimeSec || 0)],
      ['Записей', num(data.datasetInfo.total)],
      ['HTTP-запросов', num(counters.http_requests_total || 0)],
      ['Ошибок HTTP', num(counters.http_errors_total || 0)],
      ['Ограничено (429)', num(counters.http_rate_limited_total || 0)],
      ['Обращений к subgraph', num(counters.subgraph_requests_total || 0)],
    ]
      .map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join('');

    const counterRows = Object.entries(counters)
      .map(([k, v]) => `<tr><td class="cell-muted">${esc(k)}</td><td>${num(v)}</td></tr>`)
      .join('');

    const latencyRows = Object.entries(latency)
      .map(
        ([k, h]) =>
          `<tr><td class="cell-muted">${esc(k)}</td><td>${num(h.count)}</td><td>${h.avgMs} мс</td><td>${h.maxMs} мс</td></tr>`
      )
      .join('');

    const topoRows = Object.entries(t)
      .map(([k, url]) => `<tr><td>${esc(k)}</td><td class="cell-muted">${esc(url)}</td></tr>`)
      .join('');

    const srcRows = data.sources
      .map((s) => `<div class="src-item ${s.status}"><span class="s-dot"></span>${esc(s.name)} — ${s.status}${s.count ? ` (${s.count})` : ''}</div>`)
      .join('');

    content.innerHTML = `
      <div class="section-title">Контроль нагрузки</div>
      <div class="grid-cards">${cards}</div>

      <div class="section-title">Трассировка</div>
      <div class="chart">
        <div class="mini-item">Последний trace-id: <code>${esc(getLastTraceId() || '—')}</code></div>
        <div class="mini-item cell-muted">trace-id передаётся из клиента в шлюз и далее в каждый subgraph (заголовок x-trace-id).</div>
      </div>

      <div class="section-title">Распределённая архитектура (Federation)</div>
      <div class="chart"><table><thead><tr><th>Сервис</th><th>Адрес</th></tr></thead><tbody>${topoRows}</tbody></table></div>

      <div class="section-title">Счётчики</div>
      <div class="chart"><table><thead><tr><th>Метрика</th><th>Значение</th></tr></thead><tbody>${counterRows || '<tr><td colspan="2" class="cell-muted">нет данных</td></tr>'}</tbody></table></div>

      <div class="section-title">Задержки</div>
      <div class="chart"><table><thead><tr><th>Метрика</th><th>Замеров</th><th>Средн.</th><th>Макс.</th></tr></thead><tbody>${latencyRows || '<tr><td colspan="4" class="cell-muted">нет данных</td></tr>'}</tbody></table></div>

      <div class="section-title">Источники данных</div>
      <div class="chart">${srcRows}</div>
    `;
  } catch (e) {
    content.innerHTML = errorHtml(e.message);
  }
}

// ---------- Поиск ----------
async function renderSearch() {
  const term = state.search || 'наушники';
  const bar = $('#toolbar');
  bar.innerHTML = `
    <input type="text" id="s-term" class="grow" placeholder="Что искать по всем сущностям…" value="${esc(term)}" />
    <button class="btn btn-primary" id="s-go">Искать</button>`;
  $('#s-go').onclick = () => {
    state.search = $('#s-term').value.trim();
    renderSearch();
  };
  $('#s-term').addEventListener('keydown', (e) => e.key === 'Enter' && $('#s-go').click());

  const content = $('#content');
  content.innerHTML = loadingHtml('Поиск…');
  $('#pager').innerHTML = '';
  try {
    const data = await gql(`query($t:String!){ search(term:$t) }`, { t: term });
    const r = data.search;
    const section = (title, items, fmt) =>
      `<div class="sub-block"><h4>${title} · ${items.length}</h4><div class="mini-list">${
        items.length ? items.map(fmt).join('') : '<div class="mini-item cell-muted">—</div>'
      }</div></div>`;
    content.innerHTML = `<div class="chart">
      ${section('Товары', r.products, (p) => `<div class="mini-item">#${p.id} · ${esc(p.title)} · <b>${money(p.price)}</b></div>`)}
      ${section('Заказы', r.orders, (o) => `<div class="mini-item">#${o.id} · ${esc(o.userName)} · ${money(o.total)} · ${statusBadge(o.status)}</div>`)}
      ${section('Пользователи', r.users, (u) => `<div class="mini-item">#${u.id} · ${esc(u.name)} · <span class="cell-muted">${esc(u.email)}</span></div>`)}
      ${section('Отзывы', r.reviews, (v) => `<div class="mini-item">#${v.id} · ${esc(v.productTitle)} · ${stars(v.rating)}</div>`)}
    </div>`;
  } catch (e) {
    content.innerHTML = errorHtml(e.message);
  }
}

// ---------- Realtime ----------
let realtimeStops = [];

// Подписки GraphQL идут напрямую к subgraph-сервисам (шлюз подписки не проксирует).
// Два разных сервиса — catalog (reviewAdded) и orders (orderAdded, orderStatusChanged).
function startRealtime() {
  const t = state.topology;
  if (!t || realtimeStops.length) return;
  const subs = [
    [t.catalog, `subscription{ reviewAdded{ id rating comment userName productTitle createdAt } }`,
      ({ reviewAdded: r }) => r && pushFeed('review', '⭐', `Новый отзыв на «${truncate(r.productTitle, 40)}»`, `${r.userName} · ${r.rating}★`)],
    [t.orders, `subscription{ orderAdded{ id status total userName createdAt } }`,
      ({ orderAdded: o }) => o && pushFeed('order', '🧾', `Новый заказ #${o.id}`, `${o.userName} · ${money(o.total)}`)],
    [t.orders, `subscription{ orderStatusChanged{ id status total userName } }`,
      ({ orderStatusChanged: o }) => o && pushFeed('status', '🔄', `Заказ #${o.id}: статус → ${o.status}`, o.userName)],
  ];
  realtimeStops = subs
    .filter(([endpoint]) => Boolean(endpoint))
    .map(([endpoint, query, handler]) =>
      subscribe(endpoint, query, {
        onData: (data) => handler(data),
        onError: () => setLive(false),
        onOpen: () => setLive(true),
      })
    );
}

function setLive(on) {
  const pill = $('#realtime-pill');
  if (pill) pill.classList.toggle('off', !on);
}

function pushFeed(kind, icon, title, meta) {
  state.feed.unshift({ kind, icon, title, meta, at: new Date() });
  state.feed = state.feed.slice(0, 60);
  if (state.entity === 'realtime') renderRealtime();
  toast(title, meta, kind === 'review' ? 'info' : 'success', 3000);
}

function renderRealtime() {
  $('#toolbar').innerHTML = '';
  $('#pager').innerHTML = '';
  const content = $('#content');
  if (!state.feed.length) {
    content.innerHTML = '<div class="empty">Ожидание событий… Создайте отзыв или заказ — событие появится здесь мгновенно.</div>';
    return;
  }
  content.innerHTML = `<div class="feed">${state.feed
    .map(
      (f) => `<div class="feed-item ${f.kind}">
        <div class="ico">${f.icon}</div>
        <div><div>${esc(f.title)}</div><div class="meta">${esc(f.meta || '')} · ${f.at.toLocaleTimeString('ru-RU')}</div></div>
      </div>`
    )
    .join('')}</div>`;
}

// ---------- Навигация ----------
function switchEntity(entity) {
  state.entity = entity;
  state.page = 1;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.entity === entity));
  closeDrawer();

  if (entity === 'analytics') return renderAnalytics();
  if (entity === 'monitoring') return renderMonitoring();
  if (entity === 'search') return renderSearch();
  if (entity === 'realtime') return renderRealtime();

  renderToolbar();
  loadList();
}

function refresh() {
  if (state.entity === 'analytics') return renderAnalytics();
  if (state.entity === 'monitoring') return renderMonitoring();
  if (state.entity === 'search') return renderSearch();
  if (state.entity === 'realtime') return renderRealtime();
  return loadList();
}

// ---------- Общие обработчики ----------
function wireChrome() {
  $$('#nav button').forEach((b) => b.addEventListener('click', () => switchEntity(b.dataset.entity)));
  $('#drawer-close').onclick = closeDrawer;
  $('#overlay').onclick = closeDrawer;
  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').classList.contains('hidden')) closeModal();
    else if (!$('#drawer').classList.contains('hidden')) closeDrawer();
  });
}

init();
