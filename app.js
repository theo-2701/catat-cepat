/* Catat Cepat — offline-first front-end for Theo's Finance Tracker & Planner.
 * Entries go to an IndexedDB outbox first, then sync to the Apps Script JSON API.
 * Pure logic (parsing, validation, grouping, formatting, outbox decisions) lives in core.js.
 * Keep APP_VERSION in step with VERSION in sw.js. */
'use strict';

const APP_VERSION = '1.3.1';

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
// shortcut: URL and token sit in localStorage (visible on an unlocked phone), move to a real sign-in if the app is ever shared.
const LS = { url: 'cc.apiUrl', token: 'cc.token', mock: 'cc.mock', mockDown: 'cc.mockDown', lastSync: 'cc.lastSync', lastWallet: 'cc.lastWallet', accounts: 'cc.accounts' };
// shortcut: fixed batch size, lower it if Apps Script starts timing out on large backlogs.
const BATCH_SIZE = 25;
const TIMEOUT_MS = 30000;
const UNDO_MS = 5000;
const TOP_CATS = 6;
const VIEWS = ['catat', 'ringkasan', 'dompet', 'terakhir', 'settings'];
const MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MASCOT_ALT = {
  idle: 'Maskot anjing berbaret, santai',
  happy: 'Maskot anjing berbaret, senang',
  sleepy: 'Maskot anjing berbaret, tertidur',
  worried: 'Maskot anjing berbaret, cemas',
  wave: 'Maskot anjing berbaret, melambai',
};
const ICON = {
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6 3.5 2.1-.8 1.3L11 13V7h2v5.6Z',
  alert: 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z',
  chev: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
};
// Decorative card art per wallet kind (static, trusted markup).
const CARD_ART = {
  bank: '<svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true"><rect width="44" height="34" rx="7" fill="#E9C46A"/><rect x=".5" y=".5" width="43" height="33" rx="6.5" fill="none" stroke="#B8902F"/><path d="M0 12h14v10H0M44 12H30v10h14M14 0v34M30 0v34M14 17h16" fill="none" stroke="#B8902F" stroke-width="1.2"/></svg>',
  ewallet: '<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 7.5a7 7 0 0 1 0 9M12 5a10.5 10.5 0 0 1 0 14M15.5 2.5a14 14 0 0 1 0 19"/></svg>',
  cash: '<svg width="46" height="30" viewBox="0 0 46 30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="1" width="44" height="28" rx="5"/><circle cx="23" cy="15" r="6"/><path d="M8 8v14M38 8v14"/></svg>',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  summary: null,
  summaryAt: 0,         // when the cached summary was fetched
  outbox: [],
  mode: 'out',          // 'out' | 'in' | 'move'
  category: '',
  wallet: '',
  to: '',
  goal: '',
  dateMode: 'today',    // 'today' | 'yesterday' | 'pick'
  moreCats: false,
  notesOpen: false,
  editing: null,        // clientId of a rejected outbox item loaded back into the form
  held: new Set(),      // clientIds inside their undo window; sync skips them so "Batalkan" can never race a send
  happyUntil: 0,
  animateCats: false,   // stagger the chips once after a mode switch or "Lainnya"
  openWallet: '',       // wallet card currently pulled out of the stack
  dealt: false,         // the stack fans out once per session
  rendered: {},         // last rendered data per section, to skip rebuilds (and re-animations) when nothing changed
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

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  const time = `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dayLabel(ymd(d), ymd(new Date())).toLowerCase()} ${time}`;
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

function icon(name, cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON[name]);
  svg.append(path);
  return svg;
}

function setMascot(mood, img = $('#mascot')) {
  if (img.dataset.state === mood) return;
  img.dataset.state = mood;
  img.src = `icons/mascot/${mood}.${self.MASCOT.ext}`;
  img.alt = MASCOT_ALT[mood];
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

function modeOf(type) {
  return type === 'Income' ? 'in' : type === 'Saving' || type === 'Transfer' ? 'move' : 'out';
}

function walletDefault() {
  const { wallets, defaultWallet } = lists();
  const last = localStorage.getItem(LS.lastWallet);
  return wallets.includes(last) ? last : wallets.includes(defaultWallet) ? defaultWallet : wallets[0];
}

function currentDate() {
  const d = new Date();
  if (state.dateMode === 'yesterday') d.setDate(d.getDate() - 1);
  return state.dateMode === 'pick' ? $('#date').value : ymd(d);
}

function currentEntry() {
  const category = state.category;
  const type = category ? typeOf(category) : '';
  const goal = type !== 'Saving' ? '' : lists().goals.length ? state.goal : $('#goal').value.trim();
  return {
    amount: parseAmount($('#amount').value),
    category, type, wallet: state.wallet, goal,
    to: type === 'Transfer' ? state.to : '',
    date: currentDate(),
    notes: $('#notes').value.trim(),
  };
}

function moneyWorries() {
  const s = state.summary || {};
  const st = s.stats || {};
  return {
    negative: (Number(st.monthIn) || 0) - (Number(st.monthOut) || 0) < 0,
    over: (s.plan || []).some((p) => Number(p.actual) > Number(p.planned)),
    minusWallet: (s.wallets || []).some((w) => Number(w.balance) < 0),
  };
}

let toastTimer;
function closeToast() {
  delete $('#toast').dataset.open;
}
function toast(msg, { ms = 3200, action } = {}) {
  $('#toast').dataset.open = '';
  $('#toast-text').textContent = msg;
  const btn = $('#toast-action');
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { closeToast(); action.run(); };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(closeToast, ms);
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "Rp" set small next to big digits, like a price tag. */
function money(n) {
  const s = formatRp(n);
  const i = s.indexOf('Rp');
  return [s.slice(0, i), el('span', { class: 'cur' }, 'Rp'), s.slice(i + 2)];
}

/** Blur-crossfade a label change so two states never visibly overlap. */
function morph(node) {
  node.classList.add('morph');
  setTimeout(() => node.classList.remove('morph'), 160);
}

/* ---------- Account numbers ---------- */

function localAccounts() {
  try {
    return { holder: '', numbers: {}, ...JSON.parse(localStorage.getItem(LS.accounts) || '{}') };
  } catch (e) {
    return { holder: '', numbers: {} };
  }
}

// Local entries win; the sheet's optional wallets[].account / .holder fill the gaps.
function accountOf(name) {
  const local = localAccounts();
  const sheet = ((state.summary && state.summary.wallets) || []).find((w) => w.name === name) || {};
  return { number: local.numbers[name] || sheet.account || '', holder: local.holder || sheet.holder || '' };
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
  const items = state.outbox.filter((it) => !state.held.has(it.clientId));
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
    renderHeader();
    if (!settings.configured()) {
      state.lastError = 'URL API belum diatur';
      if (!quiet) toast('Sambungkan ke Sheet dulu di Pengaturan, ya.');
      return;
    }
    if (!navigator.onLine) {
      if (!quiet) toast('Lagi offline. Catatan aman di HP dan terkirim saat online.');
      return;
    }
    let pushed = { sent: 0, failed: 0 };
    try {
      if ((await db.all('outbox')).length) pushed = await pushOutbox();
      await fetchSummary();
      state.server = 'ok';
      state.lastError = pushed.failed ? `${pushed.failed} catatan ditolak server` : '';
      localStorage.setItem(LS.lastSync, String(Date.now()));
      if (pushed.failed) toast(`${pushed.sent} terkirim, ${pushed.failed} gagal. Cek tab Terakhir.`, { ms: 5000 });
      else if (pushed.sent) toast(`${pushed.sent} catatan terkirim ke Sheet.`);
      else if (!quiet) toast('Sudah sinkron.');
    } catch (e) {
      await reloadOutbox().catch(() => {});
      state.server = e.kind === 'network' ? 'unreachable' : 'ok';
      state.lastError = e.message;
      if (pushed.sent) toast(`${pushed.sent} terkirim, tapi ringkasan gagal dimuat: ${e.message}`, { ms: 5000 });
      else if (!quiet || e.kind !== 'network') toast(e.kind === 'network' ? `${e.message}. Catatan aman di HP.` : `Gagal: ${e.message}`, { ms: 5000 });
    }
  })().finally(() => {
    state.syncing = null;
    renderAll();
  });
  renderHeader();
  return state.syncing;
}

/* ---------- Header ---------- */

function headerMood() {
  if (Date.now() < state.happyUntil) return 'happy';
  if (!navigator.onLine) return 'sleepy';
  if (!settings.configured()) return 'wave';
  if (state.server === 'unreachable' || state.lastError || state.outbox.some((it) => it.status === 'error')) return 'worried';
  return 'idle';
}

function renderHeader() {
  // Just the name, the date, and only the states that need attention. No greeting, no numbers that live in Ringkasan.
  // The second line says one thing: what needs attention, or else today's date.
  const s = state.summary;
  $('#greeting').replaceChildren(firstName(s && s.user) || 'Catat Cepat',
    settings.mock ? el('span', { id: 'demo-pill', class: 'tag tag-gray' }, 'Demo') : null);
  const now = new Date();
  const n = state.outbox.length;
  const errs = state.outbox.filter((it) => it.status === 'error').length;
  $('#status-line').replaceChildren(
    state.syncing ? el('span', {}, 'Menyinkron…')
      : n ? el('span', { id: 'pending-badge', class: `status-flag ${errs ? 'is-err' : 'is-pend'}` },
        icon(errs ? 'alert' : 'clock'), errs ? `${n} belum terkirim · ${errs} gagal` : `${n} belum terkirim`)
        : el('span', {}, `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`));
  setMascot(headerMood());

  const btn = $('#btn-sync');
  btn.disabled = !!state.syncing;
  btn.setAttribute('aria-busy', String(!!state.syncing));
  btn.classList.toggle('spinning', !!state.syncing);

  const banner = $('#net-banner');
  const offline = !navigator.onLine;
  banner.hidden = !offline && state.server !== 'unreachable';
  if (!banner.hidden) {
    setMascot(offline ? 'sleepy' : 'worried', banner.querySelector('.mascot'));
    $('#net-text').textContent = offline
      ? 'Lagi offline — catatan aman di HP, nanti terkirim otomatis.'
      : 'Server belum terjangkau — catatan aman di HP, nanti dicoba lagi.';
  }
  $('#setup-banner').hidden = settings.configured() || document.body.dataset.view === 'settings';
}

/* ---------- Catat ---------- */

function chip(label, data, checked, opts = {}) {
  return el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(checked), dataset: data,
    class: `chip${opts.color ? ` tagged c-${opts.color}` : ''}`,
  }, opts.icon ? el('span', { class: 'cat-icon', 'aria-hidden': 'true' }, opts.icon) : null, label);
}

// Wallet chip with a dot in the card's colors, so the chip and the card read as the same thing.
function walletChip(name, data, checked) {
  const s = walletStyle(name);
  const b = chip(name, data, checked);
  b.prepend(el('span', { class: 'wdot', 'aria-hidden': 'true', style: `--from:${s.from};--to:${s.to}` }));
  return b;
}

function modeCats() {
  const { expenseCats, incomeCats } = lists();
  return state.mode === 'in' ? incomeCats : state.mode === 'move' ? [SAVING_CAT, TRANSFER_CAT] : expenseCats;
}

function renderForm() {
  const modes = $$('[data-mode]');
  for (const b of modes) b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
  const mi = modes.findIndex((b) => b.dataset.mode === state.mode);
  $('.seg-pill').style.transform = `translateX(calc(${mi} * (100% + 8px)))`;

  // Categories: the top few in summary order, the rest behind "Lainnya".
  const cats = modeCats();
  if (state.category && !cats.includes(state.category)) state.category = '';
  const showAll = state.moreCats || cats.indexOf(state.category) >= TOP_CATS;
  $('#cat-chips').replaceChildren(...(showAll ? cats : cats.slice(0, TOP_CATS)).map((c, i) => {
    const b = chip(c, { cat: c }, c === state.category, { color: catColor(c), icon: iconOf(c) });
    if (state.animateCats) { b.classList.add('enter'); b.style.setProperty('--i', Math.min(i, 8)); }
    return b;
  }));
  state.animateCats = false;
  const more = $('#btn-more-cats');
  more.hidden = cats.length <= TOP_CATS;
  more.setAttribute('aria-expanded', String(showAll));
  more.replaceChildren(showAll ? 'Lebih sedikit' : `Lainnya (${cats.length - TOP_CATS})`, icon('chev', 'chev'));

  const { wallets, goals } = lists();
  if (!wallets.includes(state.wallet)) state.wallet = walletDefault();
  const type = state.category ? typeOf(state.category) : '';
  $('#wallet-label').textContent = type === 'Transfer' ? 'Dari dompet' : 'Dompet';
  $('#wallet-chips').replaceChildren(...wallets.map((w) => walletChip(w, { wallet: w }, w === state.wallet)));

  $('#field-to').hidden = type !== 'Transfer';
  if (state.to === state.wallet) state.to = '';
  $('#to-chips').replaceChildren(...wallets.filter((w) => w !== state.wallet).map((w) => walletChip(w, { to: w }, w === state.to)));

  $('#field-goal').hidden = type !== 'Saving';
  $('#goal-chips').hidden = goals.length === 0;
  $('#goal').hidden = goals.length > 0;
  $('#goal-chips').replaceChildren(...goals.map((g) => chip(g, { goal: g }, g === state.goal)));

  for (const b of $$('[data-date]')) b.setAttribute('aria-checked', String(b.dataset.date === state.dateMode));
  const picked = state.dateMode === 'pick' && $('#date').value;
  $('#date-pick-chip').textContent = picked ? dayLabel($('#date').value, ymd(new Date())) : 'Pilih';
  $('#date').hidden = state.dateMode !== 'pick';

  const notesOpen = state.notesOpen || !!$('#notes').value;
  $('#notes-wrap').hidden = !notesOpen;
  $('#btn-notes').hidden = notesOpen;
  $('#btn-notes').setAttribute('aria-expanded', String(notesOpen));

  renderSave();
}

function renderSave() {
  const e = currentEntry();
  const err = validateEntry(e);
  const verb = state.editing ? 'Simpan perubahan' : 'Simpan';
  const btn = $('#btn-save');
  if (btn.getAttribute('aria-disabled') !== String(!!err)) morph(btn);
  btn.setAttribute('aria-disabled', String(!!err));
  $('#save-main').textContent = err ? verb : `${verb} ${formatRp(e.amount)}`;
  $('#save-reason').textContent = err ? err.short : '';
  $('#save-reason').hidden = !err;
}

function renderAmountPreview() {
  const hint = $('#amount-preview');
  const n = parseAmount($('#amount').value);
  hint.classList.toggle('ok', n > 0);
  hint.classList.toggle('bad', n !== null && !(n > 0));
  hint.textContent = n > 0 ? `= ${formatRp(n)}` : n === null ? 'Bisa ketik 25rb atau 1,5jt' : 'Format jumlah tidak dikenali';
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

function focusField(field) {
  const p = document.querySelector(`[data-error-for="${field}"]`);
  const target = document.getElementById((p && p.dataset.input) || '')
    || (p && p.closest('.field').querySelector('.chip, input:not([hidden])'));
  if (target) {
    target.focus();
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function showFormError(msg) {
  $('#form-error').hidden = !msg;
  $('#form-error').textContent = msg || '';
}

function resetForm() {
  // Keeps wallet, date and mode: the next entry usually shares them.
  $('#amount').value = '';
  $('#notes').value = '';
  $('#goal').value = '';
  Object.assign(state, { category: '', to: '', goal: '', editing: null, notesOpen: false, moreCats: false });
  showFieldError('', '');
  showFormError('');
  renderAmountPreview();
}

function celebrate() {
  state.happyUntil = Date.now() + 2500;
  const img = $('#mascot');
  img.classList.remove('bounce');
  void img.offsetWidth; // restart the animation
  img.classList.add('bounce');
  setTimeout(renderHeader, 2600);
}

async function onSubmit(ev) {
  ev.preventDefault();
  const e = currentEntry();
  const err = validateEntry(e);
  if (err) {
    showFieldError(err.field, err.error);
    focusField(err.field);
    return;
  }
  const prev = state.editing && state.outbox.find((it) => it.clientId === state.editing);
  const record = {
    ...e,
    // An edited item was rejected by the server, so reusing its clientId is safe.
    clientId: prev ? prev.clientId : crypto.randomUUID(), // shortcut: needs a secure context, which https and localhost are
    createdAt: prev ? prev.createdAt : Date.now(),
    status: 'pending',
    error: '',
  };
  try {
    await db.put('outbox', record);
  } catch (err2) {
    showFormError(`Gagal menyimpan di HP: ${err2.message || err2}`);
    return;
  }
  localStorage.setItem(LS.lastWallet, e.wallet);
  if (!prev) state.held.add(record.clientId);
  await reloadOutbox();
  resetForm();
  celebrate();
  renderAll();
  if (prev) {
    toast('Perubahan tersimpan, mengirim…');
    sync({ quiet: true });
    return;
  }
  toast('Tersimpan! Menunggu kirim.', { ms: UNDO_MS, action: { label: 'Batalkan', run: () => undo(record.clientId) } });
  setTimeout(async () => {
    if (!state.held.delete(record.clientId)) return; // undone
    await sync({ quiet: true });
    if (state.server === 'unreachable' && state.outbox.some((it) => it.clientId === record.clientId)) {
      toast('Server belum terjangkau. Catatan aman di HP, nanti dikirim otomatis.');
    }
  }, UNDO_MS);
}

async function undo(clientId) {
  if (state.held.delete(clientId)) {
    await db.del('outbox', clientId);
    await reloadOutbox();
    renderAll();
    toast('Dibatalkan. Catatan dihapus dari HP.');
  } else {
    toast('Sudah terkirim ke Sheet. Kalau mau dihapus, hapus langsung di Sheet, ya.', { ms: 6000 });
  }
}

function loadIntoForm(clientId) {
  const it = state.outbox.find((x) => x.clientId === clientId);
  if (!it) return;
  const today = ymd(new Date());
  Object.assign(state, {
    editing: clientId, mode: modeOf(it.type || typeOf(it.category)), category: it.category,
    wallet: it.wallet, to: it.to || '', goal: it.goal || '', notesOpen: !!it.notes,
    dateMode: it.date === today ? 'today' : dayLabel(it.date, today) === 'Kemarin' ? 'yesterday' : 'pick',
  });
  $('#amount').value = String(it.amount);
  $('#notes').value = it.notes || '';
  $('#goal').value = it.goal || '';
  $('#date').value = it.date;
  goto('catat');
  renderAmountPreview();
  renderForm();
  showFormError(it.error ? `Ditolak server: ${it.error}` : '');
}

/* ---------- Ringkasan ---------- */

function monthLabel(today) {
  const d = parseYmd(today) || new Date();
  return `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`;
}

function renderSummary() {
  const s = state.summary;
  $('#summary-empty').hidden = !!s;
  $('#summary-body').hidden = !s;
  $('#wallets-empty').hidden = !!s;
  $('#wallets-body').hidden = !s;
  if (!s) return;
  const st = s.stats || {};
  const income = Number(st.monthIn) || 0;
  const expense = Number(st.monthOut) || 0;
  const worries = moneyWorries();
  $('#month-label').textContent = monthLabel(s.today);
  $('#m-remaining').replaceChildren(...money(income - expense));
  $('#m-remaining').className = `hero-num${income - expense < 0 ? ' neg' : ''}`;
  $('#m-income').textContent = formatRp(income);
  $('#m-expense').textContent = formatRp(expense);
  $('#m-today').textContent = formatRp(Number(st.todayOut) || 0);
  setMascot(worries.negative || worries.over || worries.minusWallet ? 'worried' : 'happy', $('#hero-mascot'));
  // shortcut: totals come straight from the sheet and ignore unsent entries, only flagged here, add local adjustment if that confuses.
  const noteParts = [];
  if (state.outbox.length) noteParts.push(`${state.outbox.length} catatan yang belum terkirim belum dihitung.`);
  if (state.summaryAt) noteParts.push(`Data per ${formatTime(state.summaryAt)}.`);
  $('#pending-note').hidden = noteParts.length === 0;
  $('#pending-note').textContent = noteParts.join(' ');

  const plan = Array.isArray(s.plan) ? s.plan : [];
  if (state.rendered.plan !== JSON.stringify(plan)) {
    state.rendered.plan = JSON.stringify(plan);
    renderPlan(plan);
  }

  const wallets = Array.isArray(s.wallets) ? s.wallets : [];
  const walletKey = JSON.stringify([wallets, localStorage.getItem(LS.accounts)]);
  if (state.rendered.wallets !== walletKey) {
    state.rendered.wallets = walletKey;
    renderWallets(wallets);
  }
  $('#wallet-mascot').hidden = false;
  setMascot(worries.minusWallet ? 'worried' : 'happy', $('#wallet-mascot'));
  $('#wallet-total').replaceChildren(...money(wallets.reduce((a, w) => a + (Number(w.balance) || 0), 0)));
}

function renderPlan(plan) {
  $('#plan-list').replaceChildren(...(plan.length ? plan.map((p) => {
    const planned = Number(p.planned) || 0;
    const actual = Number(p.actual) || 0;
    const pct = planned > 0 ? Math.round((actual / planned) * 100) : actual > 0 ? 100 : 0;
    const over = actual > planned;
    return el('li', {},
      el('div', { class: 'plan-head' },
        el('span', { class: `tag c-${catColor(p.category)}` }, iconOf(p.category) ? el('span', { 'aria-hidden': 'true' }, iconOf(p.category)) : null, p.category),
        el('span', { class: 'plan-nums' }, `${formatShort(actual)} / ${formatShort(planned)}`)),
      el('div', { class: `bar${over ? ' over' : ''}`, role: 'progressbar', 'aria-label': `Budget ${p.category}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(pct, 100)) },
        el('i', { style: `transform:scaleX(${Math.min(pct, 100) / 100})` })),
      el('div', { class: 'plan-sub' }, over
        ? [el('span', { class: 'tag c-red' }, icon('alert'), 'Lewat budget'), `${pct}% · lebih ${formatRp(actual - planned)}`]
        : `${pct}% terpakai · sisa ${formatRp(planned - actual)}`));
  }) : [el('li', { class: 'hint' }, 'Belum ada rencana bulan ini.')]));
}

/* ---------- Wallet cards ---------- */

function walletCard(w) {
  const s = walletStyle(w.name);
  const acc = accountOf(w.name);
  const minus = Number(w.balance) < 0;
  const art = el('span', { class: 'wcard-art', 'aria-hidden': 'true' });
  art.innerHTML = CARD_ART[s.kind] || CARD_ART.bank;
  return el('li', { class: 'wcard', dataset: { wallet: w.name, key: s.key }, style: `--from:${s.from};--to:${s.to};--ink:${s.ink}` },
    el('div', { class: 'wcard-inner' },
      el('button', {
        type: 'button', class: 'wcard-toggle', 'aria-expanded': 'false',
        'aria-label': `${w.name}, saldo ${formatRp(w.balance)}${minus ? ', minus' : ''}${acc.number ? `, no. ${groupDigits(acc.number)}` : ''}`,
      }),
      el('div', { class: 'wcard-top', 'aria-hidden': 'true' },
        s.logo ? el('img', { class: 'wcard-logo', src: `icons/wallets/${s.logo}`, alt: '' }) : el('span', { class: 'wcard-mark' }, s.mark),
        el('span', { class: `wcard-bal${minus ? ' is-minus' : ''}` }, minus ? icon('alert') : null, el('span', {}, money(w.balance)))),
      art,
      acc.number ? el('div', { class: 'wcard-bottom', 'aria-hidden': 'true' },
        el('div', {}, el('div', { class: 'wcard-acc' }, groupDigits(acc.number)), acc.holder ? el('div', { class: 'wcard-holder' }, acc.holder) : null)) : null));
}

function renderWallets(wallets) {
  $('#wallet-stack').replaceChildren(...wallets.map(walletCard));
  if (!wallets.some((w) => w.name === state.openWallet)) state.openWallet = '';
  layoutWallets();
  if (state.openWallet) renderWalletDetail(state.openWallet);
}

// List mode: cards overlap so only their top strip shows, the last card in full.
// Detail mode: the chosen card rises to the top, the others drop away and fade, details slide in below.
function layoutWallets() {
  const stack = $('#wallet-stack');
  const cards = [...stack.children];
  if (!cards.length || stack.offsetParent === null) return;
  const full = cards[0].firstChild.offsetHeight;
  const step = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--peek')) || 52;
  const openIdx = cards.findIndex((c) => c.dataset.wallet === state.openWallet);
  const detail = openIdx >= 0;
  cards.forEach((c, i) => {
    const open = i === openIdx;
    const away = detail && !open;
    const y = !detail ? i * step : open ? 0 : full + 48 + Math.abs(i - openIdx) * 18;
    c.dataset.y = String(y);
    c.classList.toggle('open', open);
    c.style.transform = `translateY(${y}px)`;
    c.style.opacity = away ? '0' : '';
    c.style.transitionDelay = away ? `${Math.min(Math.abs(i - openIdx), 6) * 25}ms` : '0ms';
    c.style.zIndex = String(open ? cards.length + 1 : i + 1);
    c.inert = away;
    c.querySelector('.wcard-toggle').setAttribute('aria-expanded', String(open));
  });
  stack.style.height = `${detail ? full : (cards.length - 1) * step + full}px`;
  $('#wallet-head').dataset.mode = detail ? 'detail' : 'list';
  $('#wallet-hint').hidden = detail;
  $('#wallet-detail').hidden = !detail;
}

// The first time the wallet is seen in a session, the cards rise into place one by one.
function dealWallets() {
  const cards = [...$('#wallet-stack').children];
  if (state.dealt || !cards.length || reduceMotion()) { state.dealt = true; return; }
  state.dealt = true;
  cards.forEach((c, i) => c.animate(
    [{ transform: `translateY(${Number(c.dataset.y) + 60}px)`, opacity: 0 }, { transform: c.style.transform, opacity: 1 }],
    { duration: 500, delay: i * 40, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'backwards' }));
}

// The detail page under a raised card: balance, account number to copy, and this wallet's recent activity.
function renderWalletDetail(name) {
  const s = state.summary || {};
  const w = (s.wallets || []).find((x) => x.name === name);
  if (!w) return;
  const acc = accountOf(name);
  const minus = Number(w.balance) < 0;
  const recent = (s.recent || []).filter((tx) => tx.wallet === name || (tx.type === 'Transfer' && tx.goal === name)).slice(0, 6);
  $('#wallet-detail').replaceChildren(
    el('div', { class: 'detail-bal' },
      el('div', {}, el('p', { class: 'eyebrow' }, `Saldo ${name}`), el('p', { class: `hero-num${minus ? ' neg' : ''}` }, money(w.balance))),
      minus ? el('span', { class: 'tag c-red' }, icon('alert'), 'Saldo minus') : null),
    el('div', { class: 'detail-acc' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'No. rekening / no. HP'),
        acc.number ? el('p', { class: 'acc-num' }, groupDigits(acc.number)) : el('p', { class: 'hint' }, 'Belum diisi.'),
        acc.holder && acc.number ? el('p', { class: 'hint' }, `a.n. ${acc.holder}`) : null),
      acc.number
        ? el('button', { type: 'button', class: 'small-btn', dataset: { copy: name }, 'aria-label': `Salin nomor ${name}` }, icon('copy'), el('span', {}, 'Salin'))
        : el('button', { type: 'button', class: 'small-btn', dataset: { accounts: '' } }, el('span', {}, 'Isi nomor'))),
    el('h2', {}, 'Transaksi terakhir'),
    recent.length ? el('ul', { class: 'tx-list' }, recent.map((tx) => txRow(tx, false)))
      : el('p', { class: 'hint' }, 'Belum ada transaksi dompet ini di data terakhir.'));
}

function setOpenWallet(name) {
  state.openWallet = name;
  if (name) renderWalletDetail(name);
  layoutWallets();
  const card = name && $$('#wallet-stack .wcard').find((c) => c.dataset.wallet === name);
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  if (!card) return;
  card.classList.remove('shine');
  void card.offsetWidth; // restart the sweep
  card.classList.add('shine');
}

function toggleWallet(card) {
  if (card.dataset.dragged) { delete card.dataset.dragged; return; } // the swipe already handled it
  setOpenWallet(state.openWallet === card.dataset.wallet ? '' : card.dataset.wallet);
}

// Swipe a card up to pull it out, swipe the open card down to put it back.
// It follows the finger; dragging the "wrong" way meets friction instead of a wall.
let drag = null;
function onCardPointerDown(e) {
  const toggle = e.target.closest('.wcard-toggle');
  if (!toggle || drag || e.button > 0) return;
  const card = toggle.closest('.wcard');
  drag = { card, id: e.pointerId, y0: e.clientY, t0: performance.now(), base: Number(card.dataset.y), open: card.classList.contains('open'), moved: false };
  toggle.setPointerCapture(e.pointerId);
}
function onCardPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true;
  const withGrain = drag.open ? dy > 0 : dy < 0;
  drag.card.style.transition = 'none';
  drag.card.style.zIndex = '45';
  drag.card.style.transform = `translateY(${drag.base + (withGrain ? dy : dy * 0.2)}px)`;
}
function onCardPointerUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  d.card.style.transition = '';
  if (!d.moved) return; // a plain tap: the click handler toggles
  d.card.dataset.dragged = '1';
  setTimeout(() => { delete d.card.dataset.dragged; }, 400);
  const dy = e.clientY - d.y0;
  const fast = Math.abs(dy) / (performance.now() - d.t0) > 0.11; // a flick counts, not just distance
  if (!d.open && dy < 0 && (dy < -40 || fast)) setOpenWallet(d.card.dataset.wallet);
  else if (d.open && dy > 0 && (dy > 40 || fast)) setOpenWallet('');
  else layoutWallets();
}

async function copyAccount(btn) {
  const name = btn.dataset.copy;
  const number = cleanAccount(accountOf(name).number);
  try {
    await navigator.clipboard.writeText(number);
  } catch (e) {
    prompt(`Salin nomor ${name}:`, number);
    return;
  }
  morph(btn);
  btn.replaceChildren(icon('check'), el('span', {}, 'Disalin'));
  setTimeout(() => { morph(btn); btn.replaceChildren(icon('copy'), el('span', {}, 'Salin')); }, 1600);
  toast(`Nomor ${name} disalin: ${number}`);
}

/* ---------- Account settings ---------- */

function renderAccountsForm() {
  const local = localAccounts();
  $('#acc-holder').value = local.holder || '';
  $('#acc-rows').replaceChildren(...lists().wallets.map((name, i) => {
    const s = walletStyle(name);
    const sheet = ((state.summary && state.summary.wallets) || []).find((w) => w.name === name) || {};
    return el('div', { class: 'field acc-row' },
      el('label', { for: `acc-${i}` }, el('span', { class: 'wdot', 'aria-hidden': 'true', style: `--from:${s.from};--to:${s.to}` }), name),
      el('input', {
        id: `acc-${i}`, dataset: { wallet: name }, inputmode: 'tel', autocomplete: 'off',
        placeholder: sheet.account ? `Dari Sheet: ${sheet.account}` : 'No. rekening / no. HP',
        value: local.numbers[name] || '',
      }),
      el('p', { class: 'field-error', dataset: { errorFor: `acc-${i}`, input: `acc-${i}` }, role: 'alert', hidden: true }));
  }));
}

function onAccountsSubmit(ev) {
  ev.preventDefault();
  const inputs = $$('#acc-rows input');
  const bad = inputs.find((inp) => !isValidAccount(inp.value));
  if (bad) {
    showFieldError(bad.id, 'Hanya angka, spasi, tanda - atau + di depan.');
    bad.focus();
    return;
  }
  showFieldError('', '');
  const numbers = {};
  for (const inp of inputs) if (inp.value.trim()) numbers[inp.dataset.wallet] = inp.value.trim();
  localStorage.setItem(LS.accounts, JSON.stringify({ holder: $('#acc-holder').value.trim(), numbers }));
  $('#acc-msg').textContent = `Tersimpan. ${Object.keys(numbers).length} nomor siap disalin dari kartu dompet.`;
  renderSummary();
}

/* ---------- Terakhir ---------- */

function txRow(tx, pending) {
  const category = tx.category || tx.cat;
  const type = tx.type || typeOf(category);
  const sign = type === 'Expense' ? '-' : type === 'Income' ? '+' : '';
  // In the sheet the Goal column holds the destination wallet for transfers, so recent rows carry it in `goal`.
  const dest = type === 'Transfer' ? tx.to || tx.goal || '?' : type === 'Saving' ? tx.goal || 'Tabungan' : '';
  const today = ymd(new Date());
  const meta = [pending ? dayLabel(tx.date, today) : '', dest ? `${tx.wallet} → ${dest}` : tx.wallet, tx.notes].filter(Boolean).join(' · ');
  const failed = pending && tx.status === 'error';
  return el('li', { class: 'tx' },
    el('span', { class: `tx-icon c-${catColor(category)}`, 'aria-hidden': 'true' }, tx.icon || iconOf(category) || String(category || '?')[0]),
    el('span', { class: 'tx-cat' }, category,
      pending ? el('span', { class: `tag ${failed ? 'c-red' : 'c-yellow'}` }, icon(failed ? 'alert' : 'clock'), failed ? 'gagal' : 'menunggu') : null),
    el('span', { class: `tx-amt ${sign === '-' ? 'neg' : sign === '+' ? 'pos' : ''}` }, formatRp(tx.amount, sign)),
    el('span', { class: 'tx-meta' }, meta),
    failed && tx.error ? el('span', { class: 'tx-err' }, `Alasan: ${tx.error}`) : null,
    pending ? el('div', { class: 'tx-actions' },
      failed ? el('button', { type: 'button', class: 'chip', dataset: { edit: tx.clientId } }, 'Ubah') : null,
      el('button', { type: 'button', class: 'chip', dataset: { del: tx.clientId } }, 'Hapus')) : null);
}

function renderRecent() {
  const pending = state.outbox.slice().reverse();
  $('#outbox-section').hidden = pending.length === 0;
  $('#outbox-list').replaceChildren(...pending.map((it) => txRow(it, true)));
  const recent = (state.summary && Array.isArray(state.summary.recent)) ? state.summary.recent : [];
  $('#recent-groups').replaceChildren(...groupByDay(recent, ymd(new Date())).flatMap((g) => [
    el('h2', { class: 'day-title' }, g.label),
    el('ul', { class: 'tx-list' }, g.items.map((tx) => txRow(tx, false))),
  ]));
  $('#recent-empty').hidden = recent.length > 0 || pending.length > 0;
  const last = Number(localStorage.getItem(LS.lastSync)) || 0;
  $('#last-sync').textContent = (last ? `Sinkron terakhir ${formatTime(last)}` : 'Belum pernah sinkron') + (state.lastError ? ` · ${state.lastError}` : '');
}

/* ---------- Pengaturan ---------- */

function renderSettings() {
  $('#set-url').value = localStorage.getItem(LS.url) || '';
  $('#set-token').value = settings.token;
  $('#set-mock').checked = settings.mock;
  $('#set-mock-down').checked = localStorage.getItem(LS.mockDown) === '1';
  $('#row-mock-down').hidden = !settings.mock;
  $('#btn-mock-reset').hidden = !settings.mock;
  $('#app-version').textContent = APP_VERSION;
  renderAccountsForm();
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      $('#storage-msg').textContent = p
        ? 'Penyimpanan permanen aktif: data tidak dihapus otomatis oleh browser.'
        : 'Penyimpanan belum permanen. Pasang aplikasi ke layar utama agar data lebih aman.';
    });
  }
}

function showResult(mood, msg) {
  $('#settings-result').hidden = false;
  setMascot(mood, $('#result-mascot'));
  $('#settings-msg').textContent = msg;
}

async function onSettingsSubmit(ev) {
  ev.preventDefault();
  const url = $('#set-url').value.trim();
  const token = $('#set-token').value.trim();
  const problem = !settings.mock && !url ? ['url', 'set-url', 'Tempel URL web app dulu.']
    : url && !/^https:\/\//i.test(url) ? ['url', 'set-url', 'URL harus diawali https://']
      : !settings.mock && !token ? ['token', 'set-token', 'Tempel token dulu.'] : null;
  if (problem) {
    showFieldError(problem[0], problem[2]);
    document.getElementById(problem[1]).focus();
    return;
  }
  showFieldError('', '');
  localStorage.setItem(LS.url, url);
  localStorage.setItem(LS.token, token);
  state.lastError = '';
  const btn = $('#btn-test');
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  showResult('idle', 'Tersimpan. Menghubungi server…');
  try {
    const s = await fetchSummary();
    state.server = 'ok';
    showResult('happy', `Tersambung! ${(s.wallets || []).length} dompet dan ${(s.expense || []).length + (s.income || []).length} kategori siap dipakai.`);
    sync({ quiet: true });
  } catch (err) {
    if (err.kind === 'network') state.server = 'unreachable';
    showResult('worried', `Belum berhasil: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    renderAll();
  }
}

/* ---------- Navigation ---------- */

function renderAll() {
  renderHeader();
  renderForm();
  renderSummary();
  renderRecent();
}

function route() {
  const name = location.hash.replace('#', '');
  const view = VIEWS.includes(name) ? name : 'catat';
  document.body.dataset.view = view;
  for (const v of $$('.view')) v.hidden = v.dataset.view !== view;
  const tabs = $$('.tab');
  for (const t of tabs) {
    if (t.dataset.goto === view) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  const ti = tabs.findIndex((t) => t.dataset.goto === view);
  $('.tab-ind').style.opacity = ti < 0 ? '0' : '1';
  if (ti >= 0) $('.tab-ind').style.transform = `translateX(${ti * 100}%)`;
  if (view === 'settings') renderSettings();
  renderHeader();
  window.scrollTo(0, 0);
  if (view === 'dompet') { layoutWallets(); dealWallets(); }
}

function goto(view) {
  if (location.hash !== `#${view}`) location.hash = view;
  else route();
}

/* ---------- Events ---------- */

function bindEvents() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.goto) return goto(d.goto);
    if (t.classList.contains('wcard-toggle')) return toggleWallet(t.closest('.wcard'));
    if (d.copy) return copyAccount(t);
    if ('accounts' in d) {
      goto('settings');
      return setTimeout(() => { $('#accounts').scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' }); $('#acc-rows input').focus({ preventScroll: true }); }, 50);
    }
    if (d.edit) return loadIntoForm(d.edit);
    if (d.del) {
      const it = state.outbox.find((x) => x.clientId === d.del);
      if (!it) return;
      const warn = it.status === 'error' ? '' : '\nCatatan: mungkin sudah sempat diterima server.';
      if (!confirm(`Hapus ${it.category} ${formatRp(it.amount)} dari antrean?${warn}`)) return;
      state.held.delete(it.clientId);
      await db.del('outbox', it.clientId);
      if (state.editing === it.clientId) resetForm();
      await reloadOutbox();
      return renderAll();
    }
    if (!t.closest('#entry-form')) return;
    if (d.mode) {
      if (d.mode === state.mode) return;
      Object.assign(state, { mode: d.mode, category: '', moreCats: false, animateCats: true });
    }
    else if (d.cat) state.category = state.category === d.cat ? '' : d.cat;
    else if (d.quick) { $('#amount').value = t.textContent; renderAmountPreview(); }
    else if (d.wallet) state.wallet = d.wallet;
    else if (d.to) state.to = d.to;
    else if (d.goal) state.goal = d.goal;
    else if (d.date) {
      state.dateMode = d.date;
      if (d.date === 'pick') {
        if (!$('#date').value) $('#date').value = ymd(new Date());
        renderForm();
        $('#date').focus();
        try { $('#date').showPicker(); } catch (err) { /* not supported: the visible input is enough */ }
      }
    } else if (t.id === 'btn-more-cats') {
      state.moreCats = t.getAttribute('aria-expanded') !== 'true';
      state.animateCats = state.moreCats;
    }
    else if (t.id === 'btn-notes') state.notesOpen = true;
    else return;
    showFieldError('', '');
    renderForm();
    if (t.id === 'btn-notes') $('#notes').focus();
  });

  $('#btn-settings').addEventListener('click', () => goto('settings'));
  $('#btn-sync').addEventListener('click', () => sync());
  $('#btn-retry').addEventListener('click', () => sync());
  $('#entry-form').addEventListener('submit', onSubmit);
  $('#amount').addEventListener('input', () => { showFieldError('', ''); renderAmountPreview(); renderSave(); });
  $('#goal').addEventListener('input', () => { showFieldError('', ''); renderSave(); });
  $('#date').addEventListener('change', () => { showFieldError('', ''); renderForm(); });

  $('#accounts').addEventListener('submit', onAccountsSubmit);
  $('#accounts').addEventListener('input', () => showFieldError('', ''));
  $('#wallet-stack').addEventListener('pointerdown', onCardPointerDown);
  $('#wallet-stack').addEventListener('pointermove', onCardPointerMove);
  $('#wallet-stack').addEventListener('pointerup', onCardPointerUp);
  $('#wallet-stack').addEventListener('pointercancel', onCardPointerUp);
  $('#wallet-done').addEventListener('click', () => setOpenWallet(''));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.openWallet && document.body.dataset.view === 'dompet') setOpenWallet('');
  });
  window.addEventListener('resize', layoutWallets);
  $('#settings-form').addEventListener('submit', onSettingsSubmit);
  $('#settings-form').addEventListener('input', () => showFieldError('', ''));
  $('#btn-toggle-token').addEventListener('click', (e) => {
    const input = $('#set-token');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Sembunyikan' : 'Lihat';
  });
  $('#set-mock').addEventListener('change', (e) => {
    localStorage.setItem(LS.mock, e.target.checked ? '1' : '0');
    state.server = null;
    state.lastError = '';
    renderSettings();
    renderHeader();
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
      toast(`${state.outbox.length} catatan disalin ke clipboard.`);
    } catch (e) {
      prompt('Salin data ini:', data);
    }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { state.server = null; renderHeader(); sync({ quiet: true }); });
  window.addEventListener('offline', renderHeader);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderForm(); // "Hari ini" may have rolled over
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
  for (const img of $$('img[data-mascot]')) setMascot(img.dataset.mascot, img);
  bindEvents();
  try {
    const saved = await db.get('summary', 'last');
    if (saved) { state.summary = saved.data; state.summaryAt = saved.savedAt; }
    await reloadOutbox();
  } catch (e) {
    toast(`Penyimpanan HP tidak tersedia: ${e.message || e}`, { ms: 6000 });
  }
  state.wallet = walletDefault();
  route();
  renderAll();
  renderAmountPreview();
  registerSW();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  sync({ quiet: true });
}

init();
