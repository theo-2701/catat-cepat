/* Pure logic shared by app.js and tests.html: no DOM, no storage, no network. */
'use strict';

/**
 * Parses "25000", "25.000", "25k", "25rb", "1,5jt", "1.250.000,50", "Rp 30rb".
 * Returns a rounded integer, null for empty input, NaN when unreadable.
 */
function parseAmount(raw) {
  const s = String(raw || '').toLowerCase().replace(/\s+/g, '').replace(/^rp\.?/, '');
  if (!s) return null;
  const m = /^([0-9.,]*[0-9][0-9.,]*)(k|rb|ribu|jt|juta)?$/.exec(s);
  if (!m) return NaN;
  const suffix = m[2];
  const mult = !suffix ? 1 : suffix === 'jt' || suffix === 'juta' ? 1e6 : 1e3;
  let num = m[1];
  const dots = (num.match(/\./g) || []).length;
  const commas = (num.match(/,/g) || []).length;
  if (dots && commas) {
    // The last separator is the decimal one, the other groups thousands.
    const dec = num.lastIndexOf('.') > num.lastIndexOf(',') ? '.' : ',';
    num = num.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (dots + commas > 1) {
    const sep = dots ? '.' : ',';
    if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(num)) return NaN;
    num = num.split(sep).join('');
  } else if (dots + commas === 1) {
    const [a, b] = num.split(dots ? '.' : ',');
    // "25.000" without suffix is thousands; "1,5jt" or "12,50" is a decimal.
    num = !suffix && b.length === 3 && a ? a + b : `${a || '0'}.${b || '0'}`;
  }
  const n = Number(num) * mult;
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** The fields the add API expects; local bookkeeping (status, error, createdAt) stays on the phone. */
function toWire(it) {
  return {
    clientId: it.clientId, date: it.date, amount: it.amount, category: it.category,
    wallet: it.wallet, notes: it.notes || '', goal: it.goal || '', to: it.to || '',
  };
}

/**
 * Decides the fate of each item sent in one add request.
 * Only "saved" and "duplicate" leave the outbox; everything else stays with a reason.
 */
function settleBatch(batch, json) {
  if (!json || !json.ok) {
    const error = (json && json.error) || 'Server menolak permintaan';
    return { sent: [], failed: batch.map((item) => ({ item, error })), fatal: error };
  }
  const byId = new Map((json.results || []).map((r) => [r.clientId, r]));
  const out = { sent: [], failed: [], fatal: '' };
  for (const item of batch) {
    const r = byId.get(item.clientId);
    if (r && (r.status === 'saved' || r.status === 'duplicate')) out.sent.push(item.clientId);
    else out.failed.push({ item, error: (r && r.error) || 'Tidak ada hasil dari server untuk transaksi ini' });
  }
  return out;
}

/**
 * First problem with an entry, or null when it can be saved.
 * `short` labels the disabled save button; `error` is shown under the field.
 * e: { amount, category, type: 'Expense'|'Income'|'Saving'|'Transfer', wallet, goal, to, date }
 */
function validateEntry(e) {
  if (!(e.amount > 0)) return { field: 'amount', short: 'Isi jumlah dulu', error: 'Isi jumlah yang valid, misalnya 25rb atau 1,5jt.' };
  if (!e.category) return { field: 'category', short: 'Pilih kategori', error: 'Pilih salah satu kategori.' };
  if (!e.wallet) return { field: 'wallet', short: 'Pilih dompet', error: 'Pilih dompet.' };
  if (e.type === 'Saving' && !e.goal) return { field: 'goal', short: 'Pilih goal', error: 'Pilih atau isi goal tabungan.' };
  if (e.type === 'Transfer' && !e.to) return { field: 'to', short: 'Pilih dompet tujuan', error: 'Pilih dompet tujuan.' };
  if (e.type === 'Transfer' && e.to === e.wallet) return { field: 'to', short: 'Dompet tujuan sama', error: 'Dompet asal dan tujuan tidak boleh sama.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return { field: 'date', short: 'Pilih tanggal', error: 'Pilih tanggal.' };
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** "Hari ini", "Kemarin" or "Sel, 28 Okt" (with the year when it differs from today's). */
function dayLabel(date, today) {
  const d = parseYmd(date);
  const t = parseYmd(today);
  if (!d || !t) return String(date || '');
  const diff = Math.round((t - d) / 86400000);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Kemarin';
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === t.getFullYear() ? '' : ' ' + d.getFullYear()}`;
}

/** Groups transactions by date, newest day first, keeping the given order within a day. */
function groupByDay(items, today) {
  const groups = new Map();
  for (const it of items.slice().sort((a, b) => String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10)))) {
    const key = String(it.date).slice(0, 10);
    if (!groups.has(key)) groups.set(key, { date: key, label: dayLabel(key, today), items: [] });
    groups.get(key).items.push(it);
  }
  return [...groups.values()];
}

function formatRp(n, sign) {
  const v = Math.round(Math.abs(Number(n) || 0)).toLocaleString('id-ID');
  const neg = sign === undefined ? Number(n) < 0 : sign === '-';
  return `${neg ? '−' : sign === '+' ? '+' : ''}Rp${v}`;
}

/** Compact money for one-liners: millions as "Rp2,4jt", smaller amounts in full. */
function formatShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 1e6) return formatRp(v);
  const jt = (Math.round(Math.abs(v) / 1e5) / 10).toString().replace('.', ',');
  return `${v < 0 ? '−' : ''}Rp${jt}jt`;
}

/** "Theo" from "theo.wijaya@gmail.com" or "theo wijaya"; '' when unknown. */
function firstName(user) {
  const word = String(user || '').trim().split('@')[0].split(/[\s._-]+/)[0];
  return word ? word[0].toUpperCase() + word.slice(1) : '';
}

/** Account / phone numbers may contain digits, spaces, dashes, dots and a leading +. */
function isValidAccount(s) {
  return /^\+?[0-9 .-]*$/.test(String(s || '').trim());
}

/** What gets copied: digits only (plus a leading +), ready to paste into a transfer form. */
function cleanAccount(s) {
  const t = String(s || '').trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '');
}

/** "1234 5678 90" for reading on the card. */
function groupDigits(s) {
  const c = cleanAccount(s);
  const plus = c.startsWith('+') ? '+' : '';
  return plus + (c.slice(plus.length).match(/.{1,4}/g) || []).join(' ');
}

const TAG_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'pink', 'brown'];

/** Stable Notion-style tag color for a category name. */
function catColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
