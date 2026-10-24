# Hermes Cockpit — Tauri v2

Source aplikasi dari desain Hermes terbaru: peach sebagai warna utama, krem sebagai warna kedua, filter Swarm yang muat di layar kecil, navigasi aktif yang jelas, animasi, dan modal yang dapat ditarik ke bawah.

**Status:** aplikasi berjalan dalam **mode demo**. UI dan interaksinya sudah dikemas untuk Tauri v2; chat agen, telemetry, dispatch task, SSH, dan kontrol daya masih menggunakan simulasi. Backend Hermes/FastAPI tidak termasuk dalam paket ini. ZIP ini berisi source dan build frontend, bukan APK atau installer yang sudah dikompilasi.

## Yang tersedia

- Overview, Agents, Swarm, Nodes, dan workspace chat terpisah.
- Misi, milestone, pemilihan VPS/PC, event feed, trace, task tree, payload, dan token inspector.
- Modal dengan gesture turun, scroll isi terpisah, dan tombol aksi tetap terlihat.
- Clipboard native untuk tombol salin payload melalui plugin resmi Tauri.
- Penyimpanan riwayat demo di localStorage WebView pada perangkat.
- Kerangka Rust, konfigurasi Tauri v2, capability minimal, ikon desktop/Android, dan npm lockfile.
- Build frontend lokal di `dist/`; aplikasi native memuat aset ini, bukan URL hosting prototype.

## Persiapan

1. Instal **Node.js 22.12+** (disarankan Node LTS terbaru) beserta npm.
2. Instal Rust stable melalui rustup. Proyek meminta minimal Rust 1.90.
3. Pasang dependency platform sesuai [panduan resmi Tauri](https://v2.tauri.app/start/prerequisites/).
4. Ekstrak ZIP, lalu buka terminal di folder `hermes-tauri-v2` yang berisi `package.json`.

Dependency npm dan Cargo perlu diunduh saat setup/build pertama. Folder `node_modules` dan cache Cargo tidak disertakan.

## Lihat UI tanpa compiler native

```bash
npm ci
npm run check
npm test
npm run web:dev
```

Buka `http://localhost:1420`. Ini hanya preview web, sehingga clipboard memakai API browser. Untuk membuat ulang aset frontend:

```bash
npm run web:build
npm run web:preview
```

Jangan membuka `dist/index.html` langsung melalui `file://`; gunakan server preview atau aplikasi Tauri.

## Desktop: Windows, Linux, macOS

Setelah persiapan platform selesai:

```bash
npm ci
npm run dev
```

Tauri menjalankan Vite dan mengompilasi Rust. Jendela awal berukuran 430 × 900 dan dapat diperbesar untuk menggunakan layout desktop.

Untuk build distribusi:

```bash
npm run build
```

Hasil bundle berada di bawah `src-tauri/target/release/bundle/`. Di Windows, konfigurasi platform memilih installer NSIS. Build installer Windows di Windows, dan bundle macOS di macOS. Linux membutuhkan dependency WebKitGTK dari panduan resmi.

Windows memerlukan Microsoft C++ Build Tools dan WebView2. macOS memerlukan toolchain Xcode. Gunakan browser/WebView yang mutakhir untuk animasi dan fitur layout mobile.

## Android

Instal Android Studio beserta SDK Platform, Platform-Tools, Build-Tools, Command-line Tools, dan NDK melalui SDK Manager. Set `JAVA_HOME`, `ANDROID_HOME`, dan `NDK_HOME` sesuai lokasi instalasi Anda, lalu restart terminal.

Tambahkan target Rust Android:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

Kemudian:

```bash
npm ci
npm run android:init
npm run android:dev
```

`android:init` menghasilkan proyek Gradle di `src-tauri/gen/android/` menggunakan SDK/NDK komputer Anda. Folder hasil generate tersebut belum disertakan. Untuk development, siapkan emulator atau perangkat dengan USB debugging. CLI akan memilih perangkat yang tersedia.

Build APK debug untuk pengujian:

```bash
npm run android:build:debug
```

Untuk membangun satu arsitektur lebih cepat, misalnya perangkat ARM64:

```bash
npm run android:build:debug -- --target aarch64
```

Output APK berada di bawah `src-tauri/gen/android/app/build/outputs/apk/`.

Untuk release:

```bash
npm run android:build
```

Release APK perlu konfigurasi signing milik Anda. Ikuti [panduan signing Android Tauri](https://v2.tauri.app/distribute/sign/android/). Minimum SDK pada konfigurasi proyek adalah 24. Jangan memasukkan keystore atau password signing ke source frontend.

## Struktur source

| Lokasi | Isi |
| --- | --- |
| `src/app.js` | Demo state, rendering halaman, dan handler interaksi |
| `src/interactions.js` | Animasi, gesture modal, focus, dan visual viewport |
| `src/styles.css` | Layout responsive dan perbaikan komponen |
| `src/motion.css` | Transisi dan perilaku mobile |
| `src/theme.css` | Hierarki warna peach, krem, mint, biru |
| `src/native.js` | Batas integrasi clipboard dan command Rust |
| `src/main.js` | Entry frontend Vite |
| `src-tauri/src/lib.rs` | Entry Tauri mobile/desktop dan command `runtime_info` |
| `src-tauri/tauri.conf.json` | App, build, CSP, window, dan bundle |
| `src-tauri/capabilities/default.json` | Izin core dan clipboard tulis teks |
| `docs/BACKEND_INTEGRATION.md` | Titik penggantian simulasi dengan backend |
| `docs/VALIDATION.md` | Hasil verifikasi dan batas pengujian |

Identifier aplikasi saat ini `app.hermes.cockpit`. Sesuaikan identifier dan metadata dengan identitas produk Anda sebelum distribusi; lakukan sebelum `android:init` jika ingin nama package Android ikut berubah.

## Batas paket

- Belum ada koneksi ke `hermes-cockpit :3450`, model AI, VPS, SSH bridge, Obsidian, atau Windows PC.
- Tombol sleep/shutdown/WOL hanya mengubah status demo.
- Belum ada autentikasi backend, sinkronisasi multi-perangkat, signing release, atau auto-update.
- Build native dan pengujian pada perangkat nyata belum dijalankan pada lingkungan pembuatan ZIP ini.
- `package-lock.json` mengunci dependency npm. `Cargo.lock` akan dihasilkan pada build Rust pertama; simpan file tersebut di repository aplikasi Anda setelah build berhasil.

## Referensi implementasi

- [Menambahkan Tauri pada frontend yang sudah ada](https://v2.tauri.app/start/create-project/)
- [Konfigurasi Vite untuk Tauri](https://v2.tauri.app/start/frontend/vite/)
- [Konfigurasi Tauri v2](https://v2.tauri.app/reference/config/)
- [Clipboard plugin dan izin](https://v2.tauri.app/plugin/clipboard/)
- [Content Security Policy](https://v2.tauri.app/security/csp/)
- [Prasyarat desktop dan mobile](https://v2.tauri.app/start/prerequisites/)
