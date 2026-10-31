# Catat Cepat (PWA offline)

Aplikasi web kecil untuk mencatat transaksi ke **Theo's Finance Tracker & Planner** dari HP.
Transaksi selalu disimpan dulu di HP (IndexedDB), lalu dikirim ke Apps Script saat ada internet.
Jadi tidak ada lagi catatan yang hilang karena sinyal jelek.

- Tanpa build step, tanpa CDN. Cukup file statis.
- Setelah dibuka sekali, aplikasi tetap bisa dibuka dan dipakai mencatat walau HP offline.
- Kirim ulang aman: server menolak duplikat berdasarkan `clientId`.

## Isi folder

| File | Fungsi |
|---|---|
| `index.html` | Kerangka halaman: tab Catat, Ringkasan, Terakhir, dan Pengaturan |
| `styles.css` | Tampilan mobile-first, otomatis terang/gelap |
| `core.js` | Logika murni: parser jumlah, bentuk data kiriman, keputusan antrean per hasil server |
| `app.js` | Penyimpanan (IndexedDB), sinkron, tampilan |
| `tests.html` | Halaman self-check berbasis assert untuk `core.js` |
| `sw.js` | Service worker: menyimpan file aplikasi di cache (cache-first) |
| `mock-api.js` | API tiruan untuk uji coba sebelum API asli siap (`?mock=1`) |
| `manifest.webmanifest` | Nama, ikon, dan warna saat dipasang ke layar utama |
| `icons/` | Ikon 192 px, 512 px, maskable 512 px, dan SVG |

## Coba di komputer

Service worker hanya jalan lewat `http://localhost` / `127.0.0.1` atau `https://`, jadi jangan buka `index.html` langsung dengan klik dua kali.

```bash
cd theo-journey-pwa
python -m http.server 8000
```

Buka `http://localhost:8000/?mock=1` di Chrome. Mode demo memakai data contoh yang tersimpan di browser.

Self-check: buka `http://localhost:8000/tests.html`. Harus tertulis "Semua … cek lolos". Halaman ini menguji parser jumlah dan aturan antrean (`settleBatch`: item mana yang dihapus atau ditahan).

Cara menguji offline:

1. Buka halaman sekali sampai muncul, lalu muat ulang (supaya service worker aktif).
2. DevTools → **Network** → pilih **Offline**.
3. Muat ulang: aplikasi tetap muncul. Catat beberapa transaksi: muncul badge "n belum terkirim".
4. Kembalikan ke **No throttling**: antrean terkirim otomatis dan badge hilang.

Tambahan di mode demo (Pengaturan → Mode demo):

- **Simulasikan server tidak terjangkau**: HP online tapi server gagal dihubungi.
- Catatan berisi `#gagal`: server tiruan menolak transaksi itu. Transaksinya tetap di antrean dengan alasan, bisa **Ubah** atau **Hapus** di tab Terakhir.
- Token `salah`: server tiruan membalas `ok:false` (token tidak valid).
- **Reset data demo** mengembalikan data contoh.

Matikan mode demo dengan membuka `?mock=0` atau hapus centang di Pengaturan.

## Deploy ke GitHub Pages

1. Buat repository baru di GitHub, misalnya `catat-cepat`. Boleh **Public**: aplikasi ini tidak berisi data keuangan apa pun. URL API dan token hanya disimpan di HP masing-masing.
2. Upload **isi** folder `theo-journey-pwa/` ke root repository (`index.html` harus ada di root). Lewat web: **Add file → Upload files**, seret semua file dan folder `icons`, lalu **Commit changes**.
   Atau lewat git:
   ```bash
   cd theo-journey-pwa
   git init -b main
   git add .
   git commit -m "Catat Cepat PWA"
   git remote add origin https://github.com/<username>/catat-cepat.git
   git push -u origin main
   ```
3. Di repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pilih branch `main` dan folder `/ (root)`, lalu **Save**.
4. Tunggu 1–2 menit. Alamatnya: `https://<username>.github.io/catat-cepat/`.

Semua path di aplikasi bersifat relatif, jadi tetap jalan di sub-folder seperti `/catat-cepat/`.

### Merilis versi baru

Service worker memakai cache-first, jadi HP akan terus memakai file lama sampai versinya naik.
Setiap kali mengubah file:

1. Naikkan `VERSION` di `sw.js` (misalnya `1.0.0` → `1.0.1`).
2. Samakan `APP_VERSION` di `app.js` (tampil di Pengaturan).
3. Upload/push. Saat aplikasi dibuka berikutnya, muncul banner **"Versi baru tersedia. Muat ulang"**.

Antrean transaksi di IndexedDB tidak terhapus saat update.

## Pasang di Android (Chrome)

1. Buka `https://<username>.github.io/catat-cepat/` di **Chrome** di HP, tunggu sampai tampil penuh.
2. Ketuk menu **⋮** (kanan atas) → **Tambahkan ke layar utama** (di beberapa versi: **Instal aplikasi**) → **Instal / Tambahkan**.
3. Ikon **Catat Cepat** muncul di layar utama. Buka dari ikon itu: tampil layar penuh seperti aplikasi biasa dan bisa dibuka tanpa internet.
4. Pertama kali: ketuk ikon ⚙ → isi **URL web app (/exec)** dan **Token rahasia** → **Simpan pengaturan** → **Tes koneksi**.

Tips: setelah dipasang, Chrome biasanya mengizinkan penyimpanan permanen. Statusnya terlihat di Pengaturan → Data di HP.
Jika ada transaksi yang lama tidak terkirim, **Salin data belum terkirim** menyalin isinya sebagai JSON untuk cadangan.

## Cara pakai singkat

- **Catat**: ketik jumlah (`25000`, `25k`, `25rb`, `1,5jt`, `1.250.000`). Tombol `000`, `rb`, `jt` membantu saat keyboard angka. Pilih kategori, dompet (default dari pengaturan sheet), tanggal (**Hari ini** / **Kemarin**), catatan.
  - **Tabungan**: muncul kolom **Goal** (daftar goal dari sheet).
  - **Transfer**: dompet menjadi **Dari dompet**, dan muncul **Ke dompet**.
- **Ringkasan**: saldo dompet, pemasukan/pengeluaran/sisa bulan ini, rencana vs realisasi per kategori. Data dari sinkron terakhir; transaksi yang belum terkirim belum dihitung.
- **Terakhir**: antrean ("menunggu" / "gagal" + alasan) di atas, lalu transaksi terakhir dari sheet.
- Sinkron berjalan otomatis saat aplikasi dibuka, saat HP kembali online, setelah menyimpan, dan lewat tombol **Sinkron**.

Sebelum sinkron pertama, daftar dompet dan kategori memakai daftar bawaan di `FALLBACK` (awal `app.js`). Dompetnya sesuai sheet. Nama kategori di sana hanya contoh: setelah sinkron pertama, daftar diganti dengan yang dari sheet. Sesuaikan `FALLBACK` jika ingin tampilan pertama sudah tepat.

## Kontrak API (untuk sisi Apps Script)

Semua respons berupa JSON (`ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)`).
Web app harus di-deploy dengan **Execute as: Me** dan **Who has access: Anyone** (Siapa saja). Kalau tidak, respons berupa halaman login HTML dan aplikasi menampilkan "Respons bukan JSON".

Apps Script menjawab lewat redirect 302 ke `googleusercontent.com`. `fetch` biasa mengikutinya otomatis.

**Ringkasan**: `POST {url}` dengan body `{ "action": "summary", "token": "..." }` (header sama seperti Tambah di bawah). Token tidak pernah masuk URL. Bentuk `data` sama dengan `getAppData()`:

```json
{ "ok": true, "data": {
  "user": "…", "today": "2026-10-31",
  "wallets": [{ "name": "BCA", "balance": 5200000, "uses": 12 }],
  "defaultWallet": "Superbank",
  "expense": [{ "name": "Makan & Minum", "icon": "🍜" }],
  "income": [{ "name": "Gaji", "icon": "💼" }],
  "goals": [{ "name": "Dana Darurat", "target": 30000000, "saved": 12000000 }],
  "recent": [{ "id": "TX-1", "date": "2026-10-31", "type": "Expense", "wallet": "Cash",
               "cat": "Makan & Minum", "amount": 25000, "notes": "Kopi", "goal": "", "icon": "🍜" }],
  "stats": { "monthIn": 9500000, "monthOut": 1020000, "todayOut": 25000, "daysSince": 0 },
  "plan": [{ "category": "Makan & Minum", "planned": 2500000, "actual": 97000 }] } }
```

Yang dipakai aplikasi: nama dan ikon kategori (chip), nama dompet dan saldo, nama goal (pilihan Tabungan), `recent`, `stats.monthIn/monthOut/todayOut`, dan `plan`. Nama bulan diambil dari `today` (format `yyyy-mm-dd`). Untuk Transfer di `recent`, `goal` dibaca sebagai dompet tujuan (kolom Goal/Ke di sheet). Jika "Tabungan" atau "Transfer" ada di daftar `expense`, aplikasi menampilkannya di grup sendiri.

**Tambah**: `POST {url}` dengan header `Content-Type: text/plain;charset=utf-8` (supaya tidak ada CORS preflight). Di Apps Script, baca body dengan `JSON.parse(e.postData.contents)`.

```json
{ "action": "add", "token": "...", "items": [
  { "clientId": "uuid", "date": "2026-10-31", "amount": 25000, "category": "Makan & Minum",
    "wallet": "Cash", "notes": "Kopi", "goal": "", "to": "" } ] }
```

`goal` diisi untuk Tabungan (nama goal). `to` diisi untuk Transfer (dompet tujuan; `wallet` = dompet asal).

Balasan: `{ "ok": true, "results": [{ "clientId": "uuid", "status": "saved" | "duplicate" | "error", "ids": ["TX-1"], "error": "..." }] }`.
Jika gagal total: `{ "ok": false, "error": "Token tidak valid" }`.

Aturan di aplikasi:

- Item dihapus dari antrean hanya jika statusnya `saved` atau `duplicate`.
- Status `error` membuat item tetap di antrean dengan alasan dari server. Item itu ikut dikirim ulang di sinkron berikutnya.
- `ok:false` membuat semua item di kiriman itu ditandai gagal dengan pesan tersebut, lalu dicoba lagi nanti.
- Kiriman dipecah per 25 item. Batas waktu tiap request 30 detik.

Batasan yang disengaja ditandai di kode dengan komentar `// shortcut:` (cari dengan `grep -n "shortcut:"`), lengkap dengan kapan perlu ditingkatkan.

## Catatan keamanan

- Token hanya dikirim di body POST, tidak pernah di URL. Kalau bocor atau HP hilang: menu 💰 ▸ ♻️ Ganti token HP di spreadsheet, token lama langsung tidak berlaku.
- Web app hanya menerima 2 aksi (`summary`, `add`). Tidak ada aksi hapus, edit, atau akses lain ke akun Google.
- URL dan token disimpan di `localStorage` HP. Siapa pun yang memegang HP yang tidak terkunci bisa melihatnya di Pengaturan.
