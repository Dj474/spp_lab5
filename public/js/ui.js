// UI-хелперы: DOM, форматирование, тосты, модалки, выдвижная панель.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function money(n) {
  return Number(n ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(n) {
  return Number(n ?? 0).toLocaleString('ru-RU');
}

export function dateTime(s) {
  return s ? new Date(s).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function dateShort(s) {
  return s ? new Date(s).toLocaleDateString('ru-RU') : '—';
}

export function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  return `<span class="stars" title="${rating}">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span>`;
}

export function statusBadge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

export function truncate(s, n = 60) {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

// ---- Тосты ----
export function toast(title, message = '', type = 'info', timeout = 4000) {
  const container = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="t-title">${esc(title)}</div>${message ? `<div class="t-msg">${esc(message)}</div>` : ''}`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

// ---- Модалка ----
export function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}

export function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-body').innerHTML = '';
}

// ---- Drawer ----
export function openDrawer(html) {
  $('#drawer-body').innerHTML = html;
  $('#drawer').classList.remove('hidden');
  $('#overlay').classList.remove('hidden');
}

export function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#overlay').classList.add('hidden');
}

export function loadingHtml(text = 'Загрузка…') {
  return `<div class="loading"><div class="spinner"></div>${esc(text)}</div>`;
}

export function errorHtml(message) {
  return `<div class="error">Ошибка: ${esc(message)}</div>`;
}
