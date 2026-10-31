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
