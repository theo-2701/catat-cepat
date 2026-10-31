/* Mock of the Apps Script JSON API, used when demo mode is on (?mock=1).
 * Follows the same contract as the real /exec endpoint: summary (POST, getAppData() shape)
 * and add (POST, deduped by clientId). get() is unused since summary moved to POST.
 * Test hooks: no network (DevTools Offline) or "server tidak terjangkau" in Pengaturan
 * throws like a failed fetch; token "salah" returns ok:false; notes containing "#gagal"
 * return status "error" for that item. */
(function () {
  'use strict';
  // shortcut: demo data lives in this browser's localStorage only, fine for a test double.
  const KEY = 'cc.mockDb';

  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return ymd(d);
  }

  function seed() {
    const db = {
      balances: { Cash: 350000, BCA: 5200000, 'CIMB Niaga': 1250000, GoPay: 180000, OVO: 45000, ShopeePay: 60000, Superbank: 2400000, Seabank: 800000, Jago: 1500000 },
      expense: [
        { name: 'Makan & Minum', icon: '🍜' }, { name: 'Transportasi', icon: '🛵' }, { name: 'Belanja', icon: '🛒' },
        { name: 'Tagihan', icon: '🧾' }, { name: 'Hiburan', icon: '🎬' }, { name: 'Kesehatan', icon: '💊' },
        { name: 'Lainnya', icon: '📦' }, { name: 'Tabungan', icon: '🐷' }, { name: 'Transfer', icon: '🔁' },
      ],
      income: [{ name: 'Gaji', icon: '💼' }, { name: 'Bonus', icon: '🎁' }, { name: 'Freelance', icon: '💻' }],
      goals: [{ name: 'Dana Darurat', target: 30000000, saved: 12000000 }, { name: 'Liburan Jepang', target: 25000000, saved: 4000000 }],
      defaultWallet: 'Superbank',
      plan: { 'Makan & Minum': 2500000, Transportasi: 800000, Belanja: 1000000, Tagihan: 1200000, Hiburan: 500000 },
      tx: [],
      seen: {},
      nextId: 1,
    };
    const sample = [
      [12, 'Gaji', 'BCA', 9500000, 'Gaji bulanan', '', ''],
      [10, 'Tagihan', 'BCA', 650000, 'Listrik + internet', '', ''],
      [6, 'Tabungan', 'Superbank', 1000000, '', 'Dana Darurat', ''],
      [4, 'Belanja', 'ShopeePay', 235000, 'Kebutuhan rumah', '', ''],
      [3, 'Transfer', 'BCA', 500000, 'Isi saldo', '', 'GoPay'],
      [2, 'Transportasi', 'GoPay', 38000, 'Gojek ke kantor', '', ''],
      [1, 'Makan & Minum', 'Superbank', 72000, 'Makan siang', '', ''],
      [0, 'Makan & Minum', 'Cash', 25000, 'Kopi', '', ''],
    ];
    for (const [ago, category, wallet, amount, notes, goal, to] of sample) {
      db.tx.push(row(db, { date: daysAgo(ago), category, wallet, amount, notes, goal, to }));
    }
    return db;
  }

  function typeOf(db, category) {
    if (category === 'Tabungan') return 'Saving';
    if (category === 'Transfer') return 'Transfer';
    return db.income.some((c) => c.name === category) ? 'Income' : 'Expense';
  }

  // Mirrors a _DATABASE row: for transfers the Goal column holds the destination wallet.
  function row(db, item) {
    const type = typeOf(db, item.category);
    return {
      id: `TX-${String(db.nextId++).padStart(5, '0')}`,
      timestamp: new Date().toISOString(),
      date: item.date,
      type,
      wallet: item.wallet,
      category: item.category,
      amount: item.amount,
      notes: item.notes || '',
      goal: type === 'Transfer' ? item.to : item.goal || '',
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through to a fresh seed */ }
    const db = seed();
    save(db);
    return db;
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }

  function summary(db) {
    const today = ymd(new Date());
    const monthTx = db.tx.filter((t) => t.date.slice(0, 7) === today.slice(0, 7));
    const sum = (list, type) => list.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
    const bal = { ...db.balances };
    const uses = {};
    for (const t of db.tx) {
      uses[t.wallet] = (uses[t.wallet] || 0) + 1;
      if (t.type === 'Income') bal[t.wallet] += t.amount;
      else if (t.type === 'Expense' || t.type === 'Saving') bal[t.wallet] -= t.amount;
      else if (t.type === 'Transfer') { bal[t.wallet] -= t.amount; bal[t.goal] += t.amount; }
    }
    const icons = Object.fromEntries([...db.expense, ...db.income].map((c) => [c.name, c.icon]));
    const last = db.tx.reduce((a, t) => (t.date > a ? t.date : a), '');
    return {
      user: 'demo@contoh.id',
      today,
      wallets: Object.keys(db.balances).map((name) => ({ name, balance: bal[name], uses: uses[name] || 0 })),
      defaultWallet: db.defaultWallet,
      expense: db.expense,
      income: db.income,
      goals: db.goals,
      recent: db.tx.slice()
        .sort((a, b) => (b.date + b.timestamp).localeCompare(a.date + a.timestamp))
        .slice(0, 20)
        .map((t) => ({ id: t.id, date: t.date, type: t.type, wallet: t.wallet, cat: t.category, amount: t.amount, notes: t.notes, goal: t.goal, icon: icons[t.category] || '' })),
      stats: {
        monthIn: sum(monthTx, 'Income'),
        monthOut: sum(monthTx, 'Expense'),
        todayOut: sum(db.tx.filter((t) => t.date === today), 'Expense'),
        daysSince: last ? Math.round((new Date(today) - new Date(last)) / 86400000) : null,
      },
      plan: Object.entries(db.plan).map(([category, planned]) => ({
        category,
        planned,
        actual: monthTx.filter((t) => t.type === 'Expense' && t.category === category).reduce((a, t) => a + t.amount, 0),
      })),
    };
  }

  function validate(db, it) {
    const cats = [...db.expense, ...db.income].map((c) => c.name).concat('Tabungan', 'Transfer');
    const wallets = Object.keys(db.balances);
    if (!it || !it.clientId) return 'clientId kosong';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || '')) return 'Format tanggal harus yyyy-mm-dd';
    if (typeof it.amount !== 'number' || !(it.amount > 0)) return 'Jumlah harus angka > 0';
    if (!cats.includes(it.category)) return `Kategori "${it.category}" tidak dikenal`;
    if (!wallets.includes(it.wallet)) return `Dompet "${it.wallet}" tidak dikenal`;
    if (it.category === 'Transfer' && (!wallets.includes(it.to) || it.to === it.wallet)) return 'Dompet tujuan transfer tidak valid';
    if (it.category === 'Tabungan' && !it.goal) return 'Goal tabungan kosong';
    if (/#gagal/i.test(it.notes || '')) return 'Simulasi error dari server (#gagal)';
    return '';
  }

  function network() {
    const delay = 300 + Math.random() * 500;
    return new Promise((resolve, reject) => setTimeout(() => {
      if (!navigator.onLine || localStorage.getItem('cc.mockDown') === '1') reject(new TypeError('Failed to fetch'));
      else resolve();
    }, delay));
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));

  window.MockApi = {
    async get(params) {
      await network();
      if (params.token === 'salah') return { ok: false, error: 'Token tidak valid' };
      if (params.action !== 'summary') return { ok: false, error: `Action tidak dikenal: ${params.action}` };
      return clone({ ok: true, data: summary(load()) });
    },
    async post(body) {
      await network();
      body = clone(body); // same shape the server would see
      if (body.token === 'salah') return { ok: false, error: 'Token tidak valid' };
      if (body.action === 'summary') return clone({ ok: true, data: summary(load()) });
      if (body.action !== 'add' || !Array.isArray(body.items)) return { ok: false, error: 'Body tidak valid' };
      const db = load();
      const results = body.items.map((it) => {
        if (it && db.seen[it.clientId]) return { clientId: it.clientId, status: 'duplicate', ids: db.seen[it.clientId] };
        const error = validate(db, it);
        if (error) return { clientId: it && it.clientId, status: 'error', ids: [], error };
        const r = row(db, it);
        db.tx.push(r);
        db.seen[it.clientId] = [r.id];
        return { clientId: it.clientId, status: 'saved', ids: [r.id] };
      });
      save(db);
      return { ok: true, results };
    },
    reset() { localStorage.removeItem(KEY); },
  };
})();
