/* Catat Cepat — offline-first front-end for Theo's Finance Tracker & Planner.
 * Entries go to an IndexedDB outbox first, then sync to the Apps Script JSON API.
 * Pure logic (parseAmount, toWire, settleBatch) lives in core.js.
 * Keep APP_VERSION in step with VERSION in sw.js. */
'use strict';

const APP_VERSION = '1.1.0';

// Used until the first summary arrives from the server.
// shortcut: category names here are placeholders, replace them with the sheet's real lists if the first-run view matters.
const FALLBACK = {
  wallets: ['Cash', 'BCA', 'CIMB Niaga', 'GoPay', 'OVO', 'ShopeePay', 'Superbank', 'Seabank', 'Jago'],
  expenseCats: ['Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan', 'Kesehatan', 'Pendidikan', 'Rumah Tangga', 'Sosial & Donasi', 'Lainnya'],
  incomeCats: ['Gaji', 'Bonus', 'Freelance', 'Investasi', 'Hadiah', 'Pemasukan Lain'],
  defaultWallet: 'Superbank',
};
const SAVING_CAT = 'Tabungan';
const TRANSFER_CAT = 'Transfer';
const TYPE_LABEL = { Expense: 'Pengeluaran', Income: 'Pemasukan', Saving: 'Tabungan', Transfer: 'Transfer' };
// shortcut: URL and token sit in localStorage (visible on an unlocked phone), move to a real sign-in if the app is ever shared.
const LS = { url: 'cc.apiUrl', token: 'cc.token', mock: 'cc.mock', mockDown: 'cc.mockDown', lastSync: 'cc.lastSync' };
// shortcut: fixed batch size, lower it if Apps Script starts timing out on large backlogs.
const BATCH_SIZE = 25;
const TIMEOUT_MS = 30000;
const VIEWS = ['catat', 'ringkasan', 'terakhir', 'settings'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  summary: null,
  summaryAt: 0,         // when the cached summary was fetched
  outbox: [],
  category: '',
  editing: null,        // clientId of a rejected outbox item loaded back into the form
  walletTouched: false,
  dateTouched: false,
  syncing: null,        // promise while a sync runs
  server: null,         // 'ok' | 'unreachable' | null (unknown)
  lastError: '',
};

/* ---------- Storage ---------- */

const db = (() => {
  let opening;
  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const req = indexedDB.open('catat-cepat', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('outbox', { keyPath: 'clientId' });
          d.createObjectStore('summary', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return opening;
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      let out;
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }
  return {
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    put: (store, val) => run(store, 'readwrite', (s) => s.put(val)),
    del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  };
})();

const settings = {
  get url() { return (localStorage.getItem(LS.url) || '').trim(); },
  get token() { return localStorage.getItem(LS.token) || ''; },
  get mock() { return localStorage.getItem(LS.mock) === '1'; },
  configured() { return this.mock || (!!this.url && !!this.token); },
};

/* ---------- Helpers ---------- */

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRp(n, sign) {
  const v = Math.round(Math.abs(Number(n) || 0)).toLocaleString('id-ID');
  const neg = sign === undefined ? Number(n) < 0 : sign === '-';
  return `${neg ? '−' : sign === '+' ? '+' : ''}Rp${v}`;
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function formatDate(s) {
  const d = parseYmd(s);
  if (!d) return String(s || '');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  const time = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
  return ymd(d) === ymd(new Date()) ? `hari ini ${time}` : `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false || c === '') continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function lists() {
  const s = state.summary || {};
  const names = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x) => x.name) : null);
  const plain = (c) => c !== SAVING_CAT && c !== TRANSFER_CAT;
  return {
    wallets: names(s.wallets) || FALLBACK.wallets,
    expenseCats: (names(s.expense) || FALLBACK.expenseCats).filter(plain),
    incomeCats: (names(s.income) || FALLBACK.incomeCats).filter(plain),
    goals: names(s.goals) || [],
    defaultWallet: s.defaultWallet || FALLBACK.defaultWallet,
  };
}

function iconOf(category) {
  const s = state.summary || {};
  const hit = [...(s.expense || []), ...(s.income || [])].find((c) => c.name === category);
  return (hit && hit.icon) || '';
}

function typeOf(category) {
  if (category === SAVING_CAT) return 'Saving';
  if (category === TRANSFER_CAT) return 'Transfer';
  return lists().incomeCats.includes(category) ? 'Income' : 'Expense';
}

let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- API ---------- */

class ApiError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; } // kind: 'network' | 'server'
}

let mockLoading;
function loadMock() {
  if (window.MockApi) return Promise.resolve(window.MockApi);
  if (!mockLoading) {
    mockLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'mock-api.js';
      s.onload = () => resolve(window.MockApi);
      s.onerror = () => { mockLoading = null; reject(new ApiError('mock-api.js gagal dimuat', 'network')); };
      document.head.append(s);
    });
  }
  return mockLoading;
}

async function request(method, payload) {
  if (settings.mock) {
    const mock = await loadMock();
    try {
      return method === 'GET' ? await mock.get(payload) : await mock.post(payload);
    } catch (e) {
      throw new ApiError('Server tidak terjangkau', 'network');
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    // Apps Script answers via a 302 to googleusercontent.com; fetch follows it by default.
    if (method === 'GET') {
      const u = new URL(settings.url);
      for (const [k, v] of Object.entries(payload)) u.searchParams.set(k, v);
      res = await fetch(u, { cache: 'no-store', signal: ctrl.signal });
    } else {
      res = await fetch(settings.url, {
        method: 'POST',
        // text/plain keeps this a "simple" request, so no CORS preflight.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    }
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? 'Server terlalu lama merespons' : 'Server tidak terjangkau', 'network');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ApiError(`Respons bukan JSON (HTTP ${res.status}). Pastikan web app di-deploy dengan akses "Siapa saja".`, 'server');
  }
}

async function fetchSummary() {
  // POST, not GET: the token must never appear in a URL (logs, history).
  const json = await request('POST', { action: 'summary', token: settings.token });
  if (!json || !json.ok) throw new ApiError((json && json.error) || 'Gagal mengambil ringkasan', 'server');
  state.summary = json.data || {};
  state.summaryAt = Date.now();
  await db.put('summary', { key: 'last', data: state.summary, savedAt: state.summaryAt });
  return state.summary;
}

/* ---------- Outbox & sync ---------- */

async function reloadOutbox() {
  state.outbox = (await db.all('outbox')).sort((a, b) => a.createdAt - b.createdAt);
}

// shortcut: rejected items are resent on every sync with no backoff, add one if a permanent server error ever floods the log.
async function pushOutbox() {
  await reloadOutbox();
  const items = state.outbox.slice();
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const json = await request('POST', { action: 'add', token: settings.token, items: batch.map(toWire) });
    const result = settleBatch(batch, json);
    for (const id of result.sent) await db.del('outbox', id);
    for (const f of result.failed) await db.put('outbox', { ...f.item, status: 'error', error: f.error });
    sent += result.sent.length;
    failed += result.failed.length;
    if (result.fatal) throw new ApiError(result.fatal, 'server');
  }
  await reloadOutbox();
  return { sent, failed };
}

// shortcut: syncs only while the app is open (open, online, resume, button), add Background Sync if entries often sit unsent.
function sync({ quiet = false } = {}) {
  if (state.syncing) return state.syncing;
  state.syncing = (async () => {
    renderStatus();
    if (!settings.configured()) {
      state.lastError = 'URL API belum diatur';
      if (!quiet) toast('Atur URL API dan token di Pengaturan dulu.');
      return;
    }
    if (!navigator.onLine) {
      if (!quiet) toast('Sedang offline. Data aman di HP dan dikirim saat online.');
      return;
    }
    let pushed = { sent: 0, failed: 0 };
    try {
      if ((await db.all('outbox')).length) pushed = await pushOutbox();
      await fetchSummary();
      state.server = 'ok';
      state.lastError = pushed.failed ? `${pushed.failed} transaksi ditolak server` : '';
      localStorage.setItem(LS.lastSync, String(Date.now()));
      if (pushed.failed) toast(`${pushed.sent} terkirim, ${pushed.failed} gagal. Lihat tab Terakhir.`, 5000);
      else if (pushed.sent) toast(`${pushed.sent} transaksi terkirim.`);
      else if (!quiet) toast('Sudah sinkron.');
    } catch (e) {
      await reloadOutbox().catch(() => {});
      state.server = e.kind === 'network' ? 'unreachable' : 'ok';
      state.lastError = e.message;
      if (pushed.sent) toast(`${pushed.sent} terkirim, tapi ringkasan gagal dimuat: ${e.message}`, 5000);
      else if (!quiet || e.kind !== 'network') toast(e.kind === 'network' ? `${e.message}. Data aman di HP.` : `Gagal: ${e.message}`, 5000);
    }
  })().finally(() => {
    state.syncing = null;
    renderAll();
  });
  renderStatus();
  return state.syncing;
}

/* ---------- Rendering ---------- */

function renderStatus() {
  let st = 'online';
  let label = 'Online';
  if (!navigator.onLine) { st = 'offline'; label = 'Offline'; }
  else if (state.server === 'unreachable') { st = 'unreachable'; label = 'Tak terhubung'; }
  if (settings.mock) label += ' · Demo';
  $('#net-status').dataset.state = st;
  $('#net-label').textContent = label;

  const n = state.outbox.length;
  const errs = state.outbox.filter((it) => it.status === 'error').length;
  const badge = $('#pending-badge');
  badge.hidden = n === 0;
  badge.textContent = errs ? `${n} belum terkirim · ${errs} gagal` : `${n} belum terkirim`;
  badge.classList.toggle('badge-err', errs > 0);

  const btn = $('#btn-sync');
  btn.disabled = !!state.syncing;
  btn.setAttribute('aria-busy', String(!!state.syncing));
  btn.classList.toggle('spinning', !!state.syncing);
  btn.querySelector('span').textContent = state.syncing ? 'Menyinkron…' : 'Sinkron';

  const last = Number(localStorage.getItem(LS.lastSync)) || 0;
  let info = last ? `Sinkron terakhir ${formatTime(last)}` : 'Belum pernah sinkron';
  if (state.lastError) info += ` · ${state.lastError}`;
  $('#sync-info').textContent = info;

  $('#setup-banner').hidden = settings.configured();
}

function catLabel(category) {
  const icon = iconOf(category);
  return [icon ? el('span', { class: 'cat-icon', 'aria-hidden': 'true' }, icon) : null, category];
}

function renderCategories() {
  const { expenseCats, incomeCats } = lists();
  const groups = [
    ['Pengeluaran', expenseCats],
    ['Pemasukan', incomeCats],
    ['Tabungan & transfer', [SAVING_CAT, TRANSFER_CAT]],
  ];
  if (state.category && !groups.some((g) => g[1].includes(state.category))) state.category = '';
  $('#category-chips').replaceChildren(...groups.filter((g) => g[1].length).map(([title, cats]) =>
    el('div', { class: 'chip-group' },
      el('div', { class: 'chip-group-title' }, title),
      el('div', { class: 'chip-wrap' }, cats.map((c) =>
        el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(c === state.category), dataset: { cat: c } },
          catLabel(c)))))));
  renderCategoryDependent();
}

function fillSelect(select, names, value) {
  select.replaceChildren(...names.map((n) => el('option', { value: n }, n)));
  if (value && names.includes(value)) select.value = value;
}

function renderWallets() {
  const { wallets, defaultWallet } = lists();
  const sel = $('#wallet');
  fillSelect(sel, wallets, (state.walletTouched && sel.value) || defaultWallet);
  renderCategoryDependent();
}

function renderCategoryDependent() {
  const cat = state.category;
  const type = cat ? typeOf(cat) : '';
  const tag = $('#type-tag');
  tag.hidden = !type;
  tag.textContent = TYPE_LABEL[type] || '';
  for (const b of $$('#category-chips .chip')) b.setAttribute('aria-checked', String(b.dataset.cat === cat));

  $('#field-goal').hidden = type !== 'Saving';
  $('#field-to').hidden = type !== 'Transfer';
  $('#wallet-label').textContent = type === 'Transfer' ? 'Dari dompet' : 'Dompet';
  if (type === 'Saving') {
    $('#goal-list').replaceChildren(...lists().goals.map((g) => el('option', { value: g })));
  } else if (type === 'Transfer') {
    const toWallet = $('#to-wallet');
    const from = $('#wallet').value;
    const prev = toWallet.value;
    fillSelect(toWallet, lists().wallets.filter((w) => w !== from), prev);
    toWallet.prepend(el('option', { value: '', disabled: true }, 'Pilih dompet tujuan'));
    if (!prev || prev === from) toWallet.value = '';
  }
}

function renderAmountPreview() {
  const hint = $('#amount-preview');
  const n = parseAmount($('#amount').value);
  hint.classList.toggle('ok', n > 0);
  hint.classList.toggle('bad', n !== null && !(n > 0));
  hint.textContent = n > 0 ? `= ${formatRp(n)}` : n === null ? 'Contoh: 25000, 25k, 25rb, 1,5jt' : 'Format jumlah tidak dikenali';
}

function txRow(tx, pending) {
  const category = tx.category || tx.cat;
  const type = tx.type || typeOf(category);
  const sign = type === 'Expense' ? '-' : type === 'Income' ? '+' : '';
  // In the sheet the Goal column holds the destination wallet for transfers, so recent rows carry it in `goal`.
  const dest = type === 'Transfer' ? tx.to || tx.goal || '?' : type === 'Saving' ? tx.goal || 'Tabungan' : '';
  const meta = [formatDate(tx.date), dest ? `${tx.wallet} → ${dest}` : tx.wallet, tx.notes].filter(Boolean).join(' · ');
  const failed = pending && tx.status === 'error';
  return el('li', { class: `tx${pending ? ' pending' : ''}` },
    el('span', { class: 'tx-cat' },
      pending ? el('span', { class: `tx-tag${failed ? ' err' : ''}` }, failed ? 'gagal' : 'menunggu') : null,
      tx.icon ? el('span', { class: 'cat-icon', 'aria-hidden': 'true' }, tx.icon) : catLabel(category)[0],
      category),
    el('span', { class: `tx-amt ${sign === '-' ? 'neg' : sign === '+' ? 'pos' : ''}` }, formatRp(tx.amount, sign)),
    el('span', { class: 'tx-meta' }, meta),
    failed && tx.error ? el('span', { class: 'tx-err' }, `Alasan: ${tx.error}`) : null,
    pending ? el('div', { class: 'tx-actions' },
      failed ? el('button', { type: 'button', class: 'chip chip-tool', dataset: { edit: tx.clientId } }, 'Ubah') : null,
      el('button', { type: 'button', class: 'chip chip-tool', dataset: { del: tx.clientId } }, 'Hapus')) : null);
}

function renderRecent() {
  const pending = state.outbox.slice().reverse();
  $('#outbox-section').hidden = pending.length === 0;
  $('#outbox-list').replaceChildren(...pending.map((it) => txRow(it, true)));
  const recent = (state.summary && Array.isArray(state.summary.recent)) ? state.summary.recent : [];
  $('#recent-list').replaceChildren(...recent.map((tx) => txRow(tx, false)));
  $('#recent-empty').hidden = recent.length > 0;
}

function monthLabel(today) {
  const d = parseYmd(today) || new Date();
  return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function renderSummary() {
  const s = state.summary;
  $('#summary-empty').hidden = !!s;
  $('#summary-body').hidden = !s;
  if (!s) return;
  const st = s.stats || {};
  const income = Number(st.monthIn) || 0;
  const expense = Number(st.monthOut) || 0;
  $('#month-label').textContent = monthLabel(s.today);
  $('#m-income').textContent = formatRp(income);
  $('#m-expense').textContent = formatRp(expense);
  const rem = $('#m-remaining');
  rem.textContent = formatRp(income - expense);
  rem.className = income - expense < 0 ? 'neg' : 'pos';
  $('#m-today').textContent = formatRp(Number(st.todayOut) || 0);
  // shortcut: totals come straight from the sheet and ignore unsent entries, only flagged here, add local adjustment if that confuses.
  const noteParts = [];
  if (state.outbox.length) noteParts.push(`${state.outbox.length} transaksi belum terkirim belum masuk hitungan ini.`);
  if (state.summaryAt) noteParts.push(`Data per ${formatTime(state.summaryAt)}.`);
  const note = $('#pending-note');
  note.hidden = noteParts.length === 0;
  note.textContent = noteParts.join(' ');

  const wallets = Array.isArray(s.wallets) ? s.wallets : [];
  $('#wallet-list').replaceChildren(...wallets.map((w) =>
    el('li', {}, el('span', {}, w.name), el('b', { class: w.balance < 0 ? 'neg' : '' }, formatRp(w.balance)))));
  $('#wallet-total').textContent = formatRp(wallets.reduce((a, w) => a + (Number(w.balance) || 0), 0));

  const plan = Array.isArray(s.plan) ? s.plan : [];
  $('#plan-list').replaceChildren(...(plan.length ? plan.map((p) => {
    const planned = Number(p.planned) || 0;
    const actual = Number(p.actual) || 0;
    const pct = planned > 0 ? Math.round((actual / planned) * 100) : actual > 0 ? 100 : 0;
    const over = actual > planned;
    return el('li', {},
      el('div', { class: 'plan-head' }, el('span', {}, p.category), el('span', {}, `${formatRp(actual)} / ${formatRp(planned)}`)),
      el('div', { class: `bar${over ? ' over' : ''}`, role: 'progressbar', 'aria-label': p.category, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(pct, 100)) },
        el('i', { style: `width:${Math.min(pct, 100)}%` })),
      el('div', { class: `plan-sub${over ? ' over' : ''}` },
        over ? `${pct}% · lebih ${formatRp(actual - planned)}` : `${pct}% · sisa ${formatRp(planned - actual)}`));
  }) : [el('li', { class: 'hint' }, 'Belum ada rencana bulan ini.')]));
}

function renderSettings() {
  $('#set-url').value = localStorage.getItem(LS.url) || '';
  $('#set-token').value = settings.token;
  $('#set-mock').checked = settings.mock;
  $('#set-mock-down').checked = localStorage.getItem(LS.mockDown) === '1';
  $('#row-mock-down').hidden = !settings.mock;
  $('#btn-mock-reset').hidden = !settings.mock;
  $('#app-version').textContent = APP_VERSION;
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      $('#storage-msg').textContent = p
        ? 'Penyimpanan permanen aktif: data tidak dihapus otomatis oleh browser.'
        : 'Penyimpanan belum permanen. Pasang aplikasi ke layar utama agar data lebih aman.';
    });
  }
}

function renderAll() {
  renderStatus();
  renderCategories();
  renderWallets();
  renderSummary();
  renderRecent();
}

/* ---------- Navigation ---------- */

function route() {
  const name = location.hash.replace('#', '');
  const view = VIEWS.includes(name) ? name : 'catat';
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  for (const t of $$('.tab')) {
    if (t.dataset.goto === view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function goto(view) {
  if (location.hash !== `#${view}`) location.hash = view;
  else route();
}

/* ---------- Form ---------- */

function setDate(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  $('#date').value = ymd(d);
}

// Shows one message under the field it belongs to (data-error-for="<field>").
function showFieldError(field, msg) {
  for (const p of $$('[data-error-for]')) {
    const on = p.dataset.errorFor === field;
    p.hidden = !on;
    p.textContent = on ? msg : '';
    const input = document.getElementById(p.dataset.input || '');
    if (input) {
      if (on) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }
}

function showFormError(msg) {
  const box = $('#form-error');
  box.hidden = !msg;
  box.textContent = msg || '';
}

function resetForm() {
  $('#amount').value = '';
  $('#notes').value = '';
  $('#goal').value = '';
  $('#to-wallet').value = '';
  state.category = '';
  state.editing = null;
  $('#btn-save').textContent = 'Simpan';
  showFieldError('', '');
  showFormError('');
  renderAmountPreview();
  renderCategoryDependent();
}

function readForm() {
  const amount = parseAmount($('#amount').value);
  const category = state.category;
  const wallet = $('#wallet').value;
  const date = $('#date').value;
  const type = category ? typeOf(category) : '';
  const goal = type === 'Saving' ? $('#goal').value.trim() : '';
  const to = type === 'Transfer' ? $('#to-wallet').value : '';
  if (!(amount > 0)) return { field: 'amount', error: 'Isi jumlah yang valid, misalnya 25rb atau 1,5jt.' };
  if (!category) return { field: 'category', error: 'Pilih salah satu kategori.' };
  if (!wallet) return { field: 'wallet', error: 'Pilih dompet.' };
  if (type === 'Saving' && !goal) return { field: 'goal', error: 'Isi nama goal tabungan.' };
  if (type === 'Transfer' && !to) return { field: 'to', error: 'Pilih dompet tujuan.' };
  if (type === 'Transfer' && to === wallet) return { field: 'to', error: 'Dompet asal dan tujuan tidak boleh sama.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { field: 'date', error: 'Isi tanggal.' };
  return { item: { amount, category, wallet, date, goal, to, notes: $('#notes').value.trim(), type } };
}

async function onSubmit(e) {
  e.preventDefault();
  const { field, error, item } = readForm();
  if (error) {
    showFieldError(field, error);
    const focusEl = document.querySelector(`[data-error-for="${field}"]`);
    const target = document.getElementById((focusEl && focusEl.dataset.input) || '') || $('#category-chips .chip');
    if (target) target.focus();
    return;
  }
  showFieldError('', '');
  showFormError('');
  const prev = state.editing && state.outbox.find((it) => it.clientId === state.editing);
  const record = {
    ...item,
    // An edited item was rejected by the server, so reusing its clientId is safe.
    clientId: prev ? prev.clientId : crypto.randomUUID(), // shortcut: needs a secure context, which https and localhost are
    createdAt: prev ? prev.createdAt : Date.now(),
    status: 'pending',
    error: '',
  };
  try {
    await db.put('outbox', record);
  } catch (err) {
    showFormError(`Gagal menyimpan di HP: ${err.message || err}`);
    return;
  }
  await reloadOutbox();
  resetForm();
  renderAll();
  toast(navigator.onLine && settings.configured() ? 'Tersimpan, mengirim…' : 'Tersimpan di HP, dikirim saat online.');
  $('#amount').focus();
  await sync({ quiet: true });
  if (state.server === 'unreachable' && state.outbox.some((it) => it.clientId === record.clientId)) {
    toast('Server tak terjangkau. Tersimpan di HP, dikirim nanti.');
  }
}

function loadIntoForm(clientId) {
  const it = state.outbox.find((x) => x.clientId === clientId);
  if (!it) return;
  goto('catat');
  state.editing = clientId;
  state.category = it.category;
  state.dateTouched = true;
  state.walletTouched = true;
  $('#amount').value = String(it.amount);
  $('#notes').value = it.notes || '';
  $('#date').value = it.date;
  renderCategories();
  fillSelect($('#wallet'), lists().wallets, it.wallet);
  renderCategoryDependent();
  $('#goal').value = it.goal || '';
  if (it.to) $('#to-wallet').value = it.to;
  renderAmountPreview();
  $('#btn-save').textContent = 'Simpan perubahan';
  showFormError(it.error ? `Ditolak server: ${it.error}` : '');
}

/* ---------- Events ---------- */

function bindEvents() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.goto) goto(t.dataset.goto);
    else if (t.dataset.cat) {
      state.category = state.category === t.dataset.cat ? '' : t.dataset.cat;
      showFieldError('', '');
      renderCategoryDependent();
    } else if (t.dataset.suffix) {
      const input = $('#amount');
      if (t.dataset.suffix === 'clear') input.value = '';
      else if (t.dataset.suffix === '000') input.value += '000';
      else input.value = input.value.replace(/\s*(k|rb|ribu|jt|juta)$/i, '') + t.dataset.suffix;
      renderAmountPreview();
      input.focus();
    } else if (t.dataset.date) {
      setDate(Number(t.dataset.date));
      state.dateTouched = t.dataset.date !== '0';
    } else if (t.dataset.edit) {
      loadIntoForm(t.dataset.edit);
    } else if (t.dataset.del) {
      const it = state.outbox.find((x) => x.clientId === t.dataset.del);
      if (!it) return;
      const warn = it.status === 'error' ? '' : '\nCatatan: transaksi ini mungkin sudah sempat diterima server.';
      if (!confirm(`Hapus ${it.category} ${formatRp(it.amount)} dari antrean?${warn}`)) return;
      await db.del('outbox', it.clientId);
      if (state.editing === it.clientId) resetForm();
      await reloadOutbox();
      renderAll();
    }
  });

  $('#btn-settings').addEventListener('click', () => goto('settings'));
  $('#btn-sync').addEventListener('click', () => sync());
  $('#entry-form').addEventListener('submit', onSubmit);
  $('#entry-form').addEventListener('input', () => showFieldError('', ''));
  $('#amount').addEventListener('input', renderAmountPreview);
  $('#wallet').addEventListener('change', () => { state.walletTouched = true; renderCategoryDependent(); });
  $('#date').addEventListener('change', () => { state.dateTouched = true; });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#set-url').value.trim();
    if (url && !/^https:\/\//i.test(url)) {
      showFieldError('url', 'URL harus diawali https://');
      $('#set-url').focus();
      return;
    }
    showFieldError('', '');
    localStorage.setItem(LS.url, url);
    localStorage.setItem(LS.token, $('#set-token').value.trim());
    $('#settings-msg').textContent = 'Tersimpan.';
    state.lastError = '';
    renderStatus();
    sync({ quiet: true });
  });
  $('#btn-toggle-token').addEventListener('click', (e) => {
    const input = $('#set-token');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Sembunyikan' : 'Lihat';
  });
  $('#btn-test').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const msg = $('#settings-msg');
    if (!settings.configured()) { msg.textContent = 'Simpan URL dan token dulu.'; return; }
    btn.disabled = true;
    msg.textContent = 'Menghubungi server…';
    try {
      const s = await fetchSummary();
      state.server = 'ok';
      msg.textContent = `Berhasil: ${(s.wallets || []).length} dompet, ${(s.expense || []).length + (s.income || []).length} kategori.`;
      renderAll();
    } catch (err) {
      if (err.kind === 'network') state.server = 'unreachable';
      msg.textContent = `Gagal: ${err.message}`;
      renderStatus();
    } finally {
      btn.disabled = false;
    }
  });
  $('#set-mock').addEventListener('change', (e) => {
    localStorage.setItem(LS.mock, e.target.checked ? '1' : '0');
    state.server = null;
    state.lastError = '';
    renderSettings();
    renderStatus();
    sync({ quiet: true });
  });
  $('#set-mock-down').addEventListener('change', (e) => {
    localStorage.setItem(LS.mockDown, e.target.checked ? '1' : '0');
  });
  $('#btn-mock-reset').addEventListener('click', async () => {
    if (!confirm('Kembalikan data demo ke awal?')) return;
    (await loadMock()).reset();
    sync();
  });
  $('#btn-export').addEventListener('click', async () => {
    const data = JSON.stringify(state.outbox.map(toWire), null, 2);
    try {
      await navigator.clipboard.writeText(data);
      toast(`${state.outbox.length} transaksi disalin ke clipboard.`);
    } catch (e) {
      prompt('Salin data ini:', data);
    }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { state.server = null; renderStatus(); sync({ quiet: true }); });
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!state.dateTouched) setDate(0);
    const last = Number(localStorage.getItem(LS.lastSync)) || 0;
    if (state.outbox.length || Date.now() - last > 5 * 60 * 1000) sync({ quiet: true });
  });
}

function applyUrlFlags() {
  const p = new URLSearchParams(location.search);
  if (p.has('mock')) localStorage.setItem(LS.mock, p.get('mock') === '0' ? '0' : '1');
}

/* ---------- Service worker ---------- */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      $('#update-banner').hidden = false;
      $('#btn-update').onclick = () => { reloading = true; worker.postMessage({ type: 'SKIP_WAITING' }); };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch((e) => console.warn('SW gagal didaftarkan', e));
}

/* ---------- Boot ---------- */

async function init() {
  applyUrlFlags();
  bindEvents();
  setDate(0);
  try {
    const saved = await db.get('summary', 'last');
    if (saved) { state.summary = saved.data; state.summaryAt = saved.savedAt; }
    await reloadOutbox();
  } catch (e) {
    toast(`Penyimpanan HP tidak tersedia: ${e.message || e}`, 6000);
  }
  renderAll();
  renderAmountPreview();
  route();
  registerSW();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  sync({ quiet: true });
}

init();
