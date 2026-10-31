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
| `index.html` | Kerangka halaman: tab Catat, Ringkasan, Dompet, Terakhir, dan Pengaturan |
| `styles.css` | Tampilan mobile-first, otomatis terang/gelap |
| `core.js` | Logika murni: parser jumlah, validasi form, format uang/tanggal, pengelompokan per hari, keputusan antrean per hasil server |
| `app.js` | Penyimpanan (IndexedDB), sinkron, tampilan |
| `mascot.js` | Satu konstanta: ekstensi file maskot dan daftar ekspresinya (dipakai halaman dan service worker) |
| `wallets.js` | Tampilan kartu tiap dompet: warna, tulisan merek, dan file logo (opsional) |
| `tests.html` | Halaman self-check berbasis assert untuk `core.js` |
| `sw.js` | Service worker: menyimpan file aplikasi di cache (cache-first) |
| `mock-api.js` | API tiruan untuk uji coba sebelum API asli siap (`?mock=1`) |
| `manifest.webmanifest` | Nama, ikon, dan warna saat dipasang ke layar utama |
| `icons/` | Ikon 192 px, 512 px, maskable 512 px, dan SVG |
| `icons/mascot/` | Maskot: `idle`, `happy`, `sleepy`, `worried`, `wave` |

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
3. Muat ulang: aplikasi tetap muncul, dengan banner "Lagi offline". Catat beberapa transaksi: muncul label "n menunggu kirim".
4. Kembalikan ke **No throttling**: antrean terkirim otomatis dan badge hilang.

Tambahan di mode demo (Pengaturan → Mode demo):

- **Pura-pura server tidak terjangkau**: HP online tapi server gagal dihubungi.
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
4. Pertama kali: ketuk ikon ⚙ (kanan atas), lalu ikuti 3 langkah: tempel **URL web app (/exec)**, tempel **token rahasia**, lalu **Simpan & tes koneksi**.

Tips: setelah dipasang, Chrome biasanya mengizinkan penyimpanan permanen. Statusnya terlihat di Pengaturan → Data di HP.
Jika ada transaksi yang lama tidak terkirim, **Salin data belum terkirim** menyalin isinya sebagai JSON untuk cadangan.

## Cara pakai singkat

- **Catat** (biasanya cukup 3 ketukan: jumlah, kategori, Simpan):
  - Pilih jenis di atas: **Keluar**, **Masuk**, atau **Pindah/Tabung**.
  - Ketik jumlah (`25000`, `25rb`, `1,5jt`, `1.250.000`) atau ketuk **10rb / 20rb / 50rb / 100rb**.
  - Kategori: 6 teratas langsung tampil, sisanya di **Lainnya**.
  - Dompet otomatis memakai yang terakhir dipakai (atau default dari sheet). Tanggal: **Hari ini**, **Kemarin**, atau **Pilih**.
  - Catatan bersifat opsional, di balik **+ catatan**.
  - Tombol **Simpan Rp…** di bawah baru aktif kalau semua sudah lengkap. Kalau belum, tombol menyebut apa yang kurang.
  - **Tabungan** meminta Goal. **Transfer** meminta **Ke dompet**.
  - Setelah menyimpan, ada 5 detik untuk **Batalkan**. Selama itu catatan belum dikirim. Form dikosongkan, tapi dompet dan tanggal tetap.
- **Ringkasan**: sisa bulan ini (masuk dan keluar) dan budget per kategori dengan label **Lewat budget**. Transaksi yang belum terkirim belum dihitung.
- **Dompet**: total saldo dan kartu tiap dompet (lihat bagian di bawah). Dompet minus ditandai **minus**.
- **Terakhir**: antrean ("menunggu" / "gagal" + alasan, tombol **Kirim sekarang**) di atas, lalu transaksi dari sheet dikelompokkan per hari.
- Sinkron berjalan otomatis saat aplikasi dibuka, saat HP kembali online, 5 detik setelah menyimpan, dan lewat tombol sinkron di kanan atas.

## Kartu dompet & nomor rekening

Tab **Dompet** (tombol ketiga di bawah) menampilkan total saldo dan semua kartu dompet bertumpuk seperti Apple Wallet: hanya bagian atas tiap kartu yang terlihat (nama dan saldo), dan kartu terakhir tampil penuh.

- **Buka detail:** ketuk kartu atau geser ke atas. Kartu naik ke paling atas dan mengkilap sekilas, kartu lain turun dan memudar, lalu muncul detailnya di bawah:
  - Saldo.
  - Nomor rekening dengan tombol **Salin**.
  - Transaksi terakhir dompet itu.
- **Kembali ke tumpukan:** ketuk **Selesai** di kiri atas, ketuk kartunya lagi, atau geser kartu ke bawah.
- **Salin** hanya menyalin angkanya (tanpa spasi atau tanda -), jadi langsung bisa ditempel di aplikasi transfer.
- Saat pertama dibuka di setiap sesi, kartu-kartu naik ke tempatnya satu per satu.
- Dompet dengan saldo minus diberi label putih dengan tanda peringatan dan tanda minus.

**Mengisi nomor:** buka Pengaturan, bagian **Nomor rekening & e-wallet**, lalu isi nomor tiap dompet dan (opsional) atas nama. Nomor ini hanya disimpan di HP ini. Tombol **Isi nomor** di halaman detail kartu juga langsung membuka bagian itu.

**Dari spreadsheet (opsional):** kalau ringkasan dari Apps Script menyertakan `account` dan `holder` di tiap item `wallets`, nomor itu dipakai saat isian di HP kosong. Isian di HP selalu menang.

**Warna dan logo:** atur di `wallets.js`.
- Warna kartu (`from`/`to`) dan warna tulisan (`ink`).
- Tulisan merek (`mark`) dipakai kalau belum ada logo.
- Untuk logo resmi: simpan file di `icons/wallets/`, misalnya `bca.svg`, lalu isi `logo: 'bca.svg'`. Service worker otomatis menyimpannya untuk offline. Setelah itu naikkan versi.

Warnanya sengaja sedikit lebih gelap dari warna asli merek, supaya tulisan putih tetap terbaca (kontras ≥ 4,5:1).

## Gerak & animasi

Mengikuti prinsip desain Emil Kowalski (skills di github.com/emilkowalski/skills):

- **Kurva dan durasi:** pakai kurva kustom yang tegas, tidak ada `ease-in`, dan animasi UI di bawah 300ms. Pengecualiannya laci atau kartu, sampai sekitar 400ms.
- **Yang bergerak:** hanya `transform` dan `opacity`. Semua tombol mengecil sedikit (`scale(.97)`) saat ditekan.
- **Indikator:** pilihan Keluar/Masuk/Pindah dan indikator tab bawah meluncur ke posisi baru, tidak melompat.
- **Toast:** gaya Sonner, masuk dan keluar dari bawah, dan keluar lebih cepat daripada masuk.
- **Hanya di momen yang jarang terjadi:** kartu dompet naik ke tempatnya sekali per sesi, kartu naik ke atas dan yang lain memudar saat membuka detail, kilap saat kartu dibuka, kategori muncul berurutan saat ganti jenis atau buka "Lainnya", dan maskot melompat setelah menyimpan.
- **Yang sering dipakai tetap cepat:** memilih chip dan mengetik jumlah tidak dianimasikan berlebihan.
- **Kalau HP diatur "kurangi gerakan":** hanya animasi pudar (fade) yang tersisa. Gerakan dan kilap kartu dimatikan.

## Ganti maskot

Maskot sementara adalah versi chibi seekor anjing tricolor berbaret navy dengan tali rumbai oranye, dengan sedikit volume (gradasi cahaya dari kiri atas dan bayangan di bawahnya). Ada 5 ekspresi di `icons/mascot/`:

| File | Muncul saat |
|---|---|
| `idle` | Biasa |
| `happy` | Baru menyimpan; Ringkasan dan Dompet aman |
| `sleepy` | Offline |
| `worried` | Server tak terjangkau atau ada catatan gagal; di Ringkasan: minus atau lewat budget; di Dompet: ada dompet minus |
| `wave` | Belum tersambung, layar kosong, dan Pengaturan |

Cara mengganti:

1. Simpan gambar baru dengan nama yang sama di `icons/mascot/`, misalnya `happy.png`. Gambar persegi dengan latar transparan, minimal 256×256 px.
2. Kalau formatnya PNG, ubah `ext: 'svg'` menjadi `ext: 'png'` di `mascot.js`. Itu satu-satunya tempat yang perlu diubah: halaman dan service worker sama-sama membacanya.
3. Naikkan versi (lihat **Merilis versi baru**) supaya HP mengambil gambar baru.

Semua 5 file harus ada, karena service worker menyimpannya untuk dipakai offline.

Sebelum sinkron pertama, daftar dompet dan kategori memakai daftar bawaan di `FALLBACK` (awal `app.js`). Dompetnya sesuai sheet. Nama kategori di sana hanya contoh: setelah sinkron pertama, daftar diganti dengan yang dari sheet. Sesuaikan `FALLBACK` jika ingin tampilan pertama sudah tepat.

## Kontrak API (untuk sisi Apps Script)

Semua respons berupa JSON (`ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)`).
Web app harus di-deploy dengan **Execute as: Me** dan **Who has access: Anyone** (Siapa saja). Kalau tidak, respons berupa halaman login HTML dan aplikasi menampilkan "Respons bukan JSON".

Apps Script menjawab lewat redirect 302 ke `googleusercontent.com`. `fetch` biasa mengikutinya otomatis.

**Ringkasan**: `POST {url}` dengan body `{ "action": "summary", "token": "..." }` (header sama seperti Tambah di bawah). Token tidak pernah masuk URL. Bentuk `data` sama dengan `getAppData()`:

```json
{ "ok": true, "data": {
  "user": "…", "today": "2026-10-31",
  "wallets": [{ "name": "BCA", "balance": 5200000, "uses": 12, "account": "1234567890", "holder": "Theo" }],
  "defaultWallet": "Superbank",
  "expense": [{ "name": "Makan & Minum", "icon": "🍜" }],
  "income": [{ "name": "Gaji", "icon": "💼" }],
  "goals": [{ "name": "Dana Darurat", "target": 30000000, "saved": 12000000 }],
  "recent": [{ "id": "TX-1", "date": "2026-10-31", "type": "Expense", "wallet": "Cash",
               "cat": "Makan & Minum", "amount": 25000, "notes": "Kopi", "goal": "", "icon": "🍜" }],
  "stats": { "monthIn": 9500000, "monthOut": 1020000, "todayOut": 25000, "daysSince": 0 },
  "plan": [{ "category": "Makan & Minum", "planned": 2500000, "actual": 97000 }] } }
```

`account` dan `holder` di `wallets` opsional (nomor rekening/HP dan atas nama untuk kartu dompet).

Yang dipakai aplikasi: nama dan ikon kategori (chip), nama dompet, saldo, dan nomor (opsional), nama goal (pilihan Tabungan), `recent`, `stats.monthIn/monthOut/todayOut`, dan `plan`. Nama bulan diambil dari `today` (format `yyyy-mm-dd`). Untuk Transfer di `recent`, `goal` dibaca sebagai dompet tujuan (kolom Goal/Ke di sheet). Jika "Tabungan" atau "Transfer" ada di daftar `expense`, aplikasi menampilkannya di grup sendiri.

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
