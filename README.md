# Hermes Cockpit — Windows & Android

Client Tauri v2 untuk backend Hermes Cockpit spec v1. Workspace, agen, node, misi, pesan, event, serta log berasal dari backend. Tidak ada data demo, jawaban agen simulasi, atau metrik hardware bawaan. Perangkat yang belum dipasangkan menampilkan workspace kosong.

## Jaringan deployment ini

| Perangkat | LAN | Tailscale |
| --- | --- | --- |
| VM server Hermes | `192.168.1.4` | Melalui subnet router Proxmox |
| PC Windows, node `pc` | `192.168.1.26` | `100.122.253.126` |
| Proxmox, subnet router | — | `100.114.42.71` |

API dan WebSocket client selalu menuju VM: `http://192.168.1.4:3450` dan `ws://192.168.1.4:3450/ws/telemetry`. Di LAN gunakan rute lokal; di luar LAN aktifkan Tailscale pada client dan pastikan subnet route menuju VM disetujui dan diterima client. OS menentukan rute yang dipakai. Alamat Tailscale Proxmox bukan alamat API VM dan aplikasi tidak mengalihkan permintaan ke port 3450 pada host Proxmox.

Antarmuka menunjukkan status koneksi aktual, bukan menebak apakah paket melewati LAN atau Tailscale. Prioritas rute dan kasus jaringan lain dengan subnet yang tumpang tindih harus diperiksa pada perangkat asli. Cockpit tidak menginstal VPN atau mengubah tabel routing Windows/Android.

Windows dan Android merupakan client untuk workspace yang sama. Menjalankan Cockpit pada PC `192.168.1.26` tidak membuat node duplikat; menjalankannya pada Windows lain tidak mendaftarkan worker baru. Bridge mTLS port `8795` dipakai worker/backend, bukan client aplikasi.

## Data hardware saat ini

Menurut konfigurasi backend yang diberikan pengguna, node `pc` sudah terdaftar tetapi worker belum terhubung. Kedua node saat ini melaporkan `metrics: null` dan `metrics_stale: true`. UI menampilkan **Belum ada metrik** dan status node dari backend. Nilai null tidak diubah menjadi nol atau angka contoh. Field metrik yang kelak dilaporkan ditampilkan dengan nama/unit yang diberikan backend.

Worker Windows menggunakan service `hermes-node` dan perintah:

```powershell
hermes-node.exe serve --config "C:\ProgramData\hermes-node\node.yaml"
```

Binary worker, sertifikat mTLS, file konfigurasi, desktop helper, serta collector hardware server berada di luar repository client ini. Jalankan worker dengan konfigurasi yang sudah diterbitkan backend. Tidak ada konfigurasi sertifikat atau kredensial contoh yang dibuat aplikasi.

## Pengembangan

Gunakan Node >=22.12, npm, Rust stable >=1.90, serta prasyarat platform [Tauri](https://v2.tauri.app/start/prerequisites/). Windows membutuhkan C++ Build Tools dan WebView2. Android membutuhkan JDK, SDK, NDK, serta target Rust Android.

```bash
npm ci
npm run check
npm test
npm run web:build
```

Untuk client native:

```bash
npm run dev
```

Untuk tampilan web development: `npm run web:dev`. Browser memakai fetch/WebSocket browser dan memerlukan CORS serta izin jaringan lokal yang sesuai. Tauri Windows/Android memakai command HTTP Rust khusus backend dan WebSocket native, sehingga permintaan backend tidak bergantung pada izin koneksi eksternal WebView. HTTP native membatasi origin/path di Rust dan memakai koneksi langsung mengikuti rute OS, tanpa proxy HTTP sistem; command dibatasi ke window utama melalui capability; verifikasi TLS tidak dimatikan. API deployment saat ini masih HTTP, bukan HTTPS.

## Pairing dan penggunaan

1. Pastikan perangkat bisa menjangkau API VM melalui LAN atau subnet Tailscale.
2. Buka **Server & jaringan** dan klik **Uji API tanpa pairing** untuk memeriksa `/health/ready`. Dialog menampilkan versi/commit frontend dan runtime serta transport yang dipakai; installer Windows/Android menggunakan **Native HTTP + WebSocket**. Setelah API dapat dijangkau, masukkan kode pairing Base32 sekali pakai (26 karakter A–Z/2–7), lalu beri nama perangkat.
3. Tunggu snapshot workspace dan WebSocket berhasil terhubung. Token tersimpan saja tidak membuat status menjadi Terhubung.
4. Lihat Nodes untuk status dan metrik; buka Agents untuk session chat; buat misi dari Overview. Target `auto` diserahkan ke scheduler backend.
5. Event asli muncul di Swarm selama sesi koneksi. Event dengan task ID dapat membuka traces dan log backend. Persetujuan dan pertanyaan ada pada tombol lonceng.

Refresh token berotasi secara bersama untuk permintaan bersamaan. Jika hasil POST refresh hilang karena koneksi putus, token lama tidak dikirim ulang otomatis; pairing ulang diperlukan. Kredensial disimpan dalam penyimpanan lokal WebView per endpoint. Penyimpanan ini belum memakai Windows Credential Manager atau Android Keystore; gunakan perangkat tepercaya. Cache dan token demo versi lama tidak dimigrasikan otomatis.

Kode pairing yang ditempel dibersihkan dari spasi dan karakter format tersembunyi, lalu huruf kecil diubah ke huruf besar. Kolom dan API client memakai aturan yang sama: 26 karakter A–Z/2–7. Kode yang salah panjang atau mengandung karakter lain ditandai sebelum dikirim; input panjang tidak dipotong diam-diam.

Saat offline, snapshot yang sudah diterima diberi label data lama dan aksi dinonaktifkan. POST tugas/aksi tidak diulang otomatis setelah kegagalan jaringan. Periksa keadaan backend sebelum mengirim ulang permintaan yang hasilnya belum diketahui. Perintah daya memerlukan konfirmasi, kemudian mengikuti otorisasi dan typed approval backend; UI menunggu laporan worker untuk mengubah status. Wake tidak dibuat-buat: kontrak yang tersedia belum menyediakan endpoint wake client.

Jika Connect gagal, dialog menampilkan tahap health/bootstrap/tiket/handshake serta mempertahankan pesan error beserta kode, status HTTP jika tersedia, dan endpoint. Pairing yang sudah diterima backend dibedakan dari kegagalan telemetry. Gunakan **Salin laporan koneksi** untuk menyalin identitas build dan hasil diagnostik. Kode pairing dan token yang diketahui disamarkan dari pesan diagnostik. Lihat [analisis koneksi 0.1.3](docs/CONNECTION_ANALYSIS.md) dan [diagnosis koneksi](docs/CONNECTION_TROUBLESHOOTING.md) untuk kasus health berhasil tetapi pairing gagal.

## Build

Windows dan Android mendukung pembaruan dari menu **Pembaruan aplikasi**. Pemeriksaan berjalan otomatis; unduh dan pasang menunggu klik pengguna. Untuk distribusi melalui GitHub Releases repository ini dan pengaturan signing, ikuti [pengaturan pembaruan](docs/UPDATES.md) serta [APK Android release](docs/ANDROID_RELEASE.md).

```bash
# Desktop pada OS target
npm run build

# Android release; setelah SDK/NDK, target Rust dan identitas APK persisten siap
# Pada build lokal, set ANDROID_VERSION_CODE ke angka baru yang sesuai panduan.
npm run android:init
npm run android:build
```

`package-lock.json` dan `src-tauri/Cargo.lock` mengunci dependency client. Build Windows dilakukan di Windows; APK memerlukan toolchain Android. Installer dan APK baru belum dibuat atau diuji pada perangkat asli di cloud ini. Workflow release menjalankan pemeriksaan frontend sebelum build.

## Build dan release otomatis di GitHub

- Push ke `main` menjalankan validasi, lalu build installer Windows x86_64 (NSIS dan MSI) serta APK Android ARM64 release teroptimasi. Setelah keduanya berhasil, satu job menerbitkan prerelease dengan tag unik `build-<run>-<commit>-<attempt>`.
- Push tag `v<versi>` yang sesuai versi aplikasi menghasilkan rilis versi tersebut. Versi di npm, konfigurasi Tauri, dan Cargo harus sama. Versi seperti `v0.2.0-rc.1` tetap ditandai sebagai prerelease.
- Workflow juga dapat dijalankan dari **Actions → Build and release Windows & Android → Run workflow**.
- Setiap frontend menyertakan `build-info.json` berisi versi, commit, run, dan attempt. CI memvalidasinya terhadap sumber build. Runtime native juga menyertakan commit/run; perubahan `dist` menjadi input rebuild Cargo, dan output installer Windows lama dibersihkan sebelum bundling.
- Setiap release menyertakan installer, APK, dan `SHA256SUMS.txt`. Draft baru dipublikasikan setelah seluruh file berhasil diunggah. Build platform yang gagal menghentikan publikasi.
- Nama aset dinormalisasi sebelum upload (misalnya spasi pada `Hermes Cockpit` menjadi `Hermes-Cockpit`), sehingga checksum menggunakan nama file yang benar-benar diunduh. File build asli tetap dipertahankan. Pemeriksaan draft memvalidasi nama, status upload, dan ukuran setiap aset.
- Build `main` tidak menimpa rilis versi yang sudah terbit. Tag versi yang sudah dipublikasikan dipertahankan; gunakan versi baru untuk perubahan kode.
- APK release ditandatangani menggunakan keystore persisten dari Actions secrets dan fingerprint yang dipin. Identitas lama dipertahankan untuk upgrade tanpa uninstall; cache bukan sumber identitas baru. Lihat [migrasi sertifikat dan setup signing](docs/ANDROID_RELEASE.md). Code-signing Windows dan distribusi Google Play terpisah dari APK GitHub.

SDK CI mengikuti template CLI Tauri yang dikunci: platform Android 37.0, Build-Tools 37.0.0, NDK 28.2.13676358, dan JDK 21. Wrapper menemukan satu APK release, memverifikasi ABI, versi, sertifikat, simbol native, batas ukuran dan alignment, lalu menghasilkan aset `hermes-cockpit-android-arm64-release.apk`. Laporan tersedia sebagai artifact `diagnostics-android-apk`.

Tes native Windows dikompilasi terpisah lalu dijalankan melalui `node scripts/test-windows-native.mjs`. Helper memakai Windows SDK `mt.exe` untuk menanam dan memverifikasi manifest Common Controls v6 pada executable unit test; semua tes tetap wajib lulus sebelum publikasi. Rincian ada pada [startup tes Windows](docs/WINDOWS_NATIVE_TESTS.md).

## Pengujian integrasi browser

Dengan Python Playwright dan Chromium terpasang, jalankan Vite atau production preview, lalu:

```bash
python3 scripts/smoke-live.py http://127.0.0.1:1420/
```

Tes memakai fixture kontrak API yang terisolasi; tidak mengakses server atau mengirim aksi ke PC pengguna. Pengujian viewport Windows/Android tidak menggantikan pengujian binary native dan rute jaringan pada perangkat asli.

Lihat [integrasi backend](docs/BACKEND_INTEGRATION.md), [hasil validasi](docs/VALIDATION.md), dan [rancangan jaringan](docs/REAL_DATA_NETWORK_PLAN.md).
