# MyTBL Box — Versi PWA (Progressive Web App)

Versi ini bisa di-"Add to Home Screen" / "Install" di **Android, iOS, Windows, Mac** — jalan kayak aplikasi asli (ada ikon sendiri, buka full-screen tanpa address bar browser), tapi tetap 100% berbasis web, gratis, dan gak butuh App Store/Play Store.

## Apa bedanya dengan versi Chrome Extension?

| | Extension | PWA (ini) |
|---|---|---|
| Jalan di | Chrome desktop aja | Semua device (HP, tablet, laptop) |
| Import otomatis dari Gramedia/Shopee | ✅ Ada | ❌ Tidak ada — ini murni kemampuan extension (content script), gak ada padanannya di web biasa |
| Genre & total volume otomatis (Jikan/Google Books) | ✅ Ada | ✅ Ada juga (fetch langsung dari halaman) |
| Mode Baca PDF (teks reflow) | ✅ Ada | ✅ Ada juga |
| Data tersimpan | `chrome.storage.local` | `localStorage` browser |
| Cara pasang | Load unpacked | Install dari browser / Add to Home Screen |

Kedua versi **punya data terpisah sendiri-sendiri** (gak otomatis sinkron satu sama lain) — pakai fitur Ekspor/Impor Backup kalau mau pindahin data antar versi.

## ⚠️ Penting: harus di-hosting, gak bisa cuma dibuka dari file di komputer

Browser (terutama di HP) **menolak** menawarkan "Add to Home Screen"/install kalau halamannya dibuka langsung dari file (`file://...`) — harus diakses lewat `https://` (atau `localhost` khusus buat development). Ini aturan keamanan bawaan browser, bukan keterbatasan dari aplikasinya.

### Cara paling gampang & gratis: GitHub Pages

1. Buat akun GitHub kalau belum punya (gratis) di [github.com](https://github.com)
2. Buat repository baru, misal namanya `mytbl-box`
3. Upload semua isi folder `mytbl-box-pwa` ini ke repo tersebut (lewat web GitHub: "Add file" → "Upload files", drag semua isinya)
4. Buka **Settings** → **Pages** di repo itu → pada bagian "Source" pilih branch `main` folder `/ (root)` → Save
5. Tunggu 1-2 menit, GitHub kasih kamu URL seperti `https://namamu.github.io/mytbl-box/`
6. Buka URL itu di HP (Chrome Android / Safari iOS) → akan muncul opsi **"Tambahkan ke Layar Utama"** / **"Install App"**

Alternatif lain yang sama gratisnya: **Netlify** atau **Vercel** (tinggal drag-drop folder ini ke dashboard mereka, dapat URL HTTPS otomatis) — malah lebih cepat dari GitHub Pages kalau kamu udah punya akun.

### Testing lokal (opsional, buat yang familiar coding)

```bash
cd mytbl-box-pwa
python3 -m http.server 8000
# buka http://localhost:8000 — localhost dianggap "secure context" jadi PWA tetap jalan
```

## Cara Install di HP

**Android (Chrome):** buka URL-nya → akan muncul banner "Tambahkan MyTBL Box ke layar utama" di bawah, atau lewat menu titik tiga → "Install app" / "Tambahkan ke Layar Utama".

**iOS (Safari — WAJIB Safari, Chrome iOS gak bisa install PWA):** buka URL-nya → tombol Share (kotak dengan panah ke atas) → "Add to Home Screen".

## Struktur Folder

```
mytbl-box-pwa/
├── index.html              # Halaman utama aplikasi
├── manifest.webmanifest    # Metadata PWA (nama, ikon, warna tema)
├── sw.js                   # Service worker (bikin app bisa offline & installable)
├── app.css / app.js        # Sama seperti versi extension
├── vendor/                 # PDF.js (Mozilla, open-source) untuk Mode Baca
├── icons/                  # Ikon app (192px, 512px, + versi maskable buat Android)
└── fonts/
```

## Batasan yang jujur perlu kamu tau

- **Data gak sinkron otomatis** antar device — tiap browser/device punya `localStorage` sendiri-sendiri. Backup manual (Ekspor/Impor JSON) tetap jadi cara pindahin data
- **Import otomatis dari Gramedia/Shopee gak ada** di versi ini (jelasin di atas)
- Kalau kamu **clear browsing data / cache** di browser, data koleksi kamu (yang di localStorage) **ikut hilang** — jangan lupa backup berkala
