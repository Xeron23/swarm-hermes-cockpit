# APK Android release ARM64

## Tujuan dan batas perubahan

GitHub mendistribusikan satu APK standalone `hermes-cockpit-android-arm64-release.apk`.
Variant Gradle dan Cargo adalah release; flag `--debug` hanya untuk development.
Target Rust `aarch64-linux-android` dipaketkan sebagai ABI `arm64-v8a`.
`--split-per-abi` dan pemeriksaan isi ZIP memastikan tidak ada ABI tambahan.
APK bisa langsung dipasang; ini bukan AAB atau kumpulan split APK yang memerlukan installer khusus.

Cargo memakai `opt-level = "s"`, LTO, satu codegen unit, tanpa debug info, dan stripping.
Profil release ini juga berlaku pada build Windows; pengujian native Windows tetap wajib.
Panic/unwinding dan dependency runtime tidak diubah.
Template Tauri CLI 2.12.4 memakai AGP 9.3.1 dan `optimization { enable = true }` untuk R8.
Wrapper mempertahankannya dan menambahkan keep rules bridge/JNI agar optimasi tidak menghapus plugin updater.
Jangan menambahkan `-dontshrink`/`-dontoptimize` global atau mematikan R8 untuk menyembunyikan bug release.

`src-tauri/gen/android` dibangkitkan oleh CLI dan tidak disimpan di Git.
Wrapper menambahkan blok Gradle bertanda yang idempoten setelah `android init`.
Gradle menghasilkan APK release tanpa signing; wrapper menjalankan **zipalign → apksigner → verifikasi → copy final**.
Tidak ada password keystore di Gradle/keystore.properties. Jangan menandatangani ulang atau mengubah APK setelah Minisign dibuat.

## Dua identitas signing yang berbeda

| Identitas | Fungsi | Penyimpanan |
| --- | --- | --- |
| Android APK keystore | Android memeriksa sertifikat paket saat install/upgrade | Secrets `ANDROID_RELEASE_*` dan backup offline |
| Minisign/Tauri updater | Client memverifikasi byte unduhan serta signed version | `TAURI_SIGNING_PRIVATE_KEY`, password opsional, public key bawaan Hermes |

APK wajib ditandatangani meskipun updater masih bootstrap tanpa Minisign.
Minisign tidak bisa memperbaiki certificate mismatch Android.

## Migrasi instalasi yang sudah ada

APK build `build-26-b6232682dc28-1` yang diaudit memiliki:

- Package ID: `app.hermes.cockpit`.
- versionCode: `1005`.
- Sertifikat SHA-256: `6dfe2b88fbceb0e71a8f3f98765215d23866c0c0abfe3a1133a27f52797dd8ba`.
- Subject sertifikat: `CN=Android Debug, O=Android, C=US`.

Fingerprint ini dipin di `src-tauri/android-release.json`. Ini identitas publik, bukan private key.
Fingerprint hanya membuktikan identitas APK yang diaudit; instalasi dari rilis lebih lama mungkin memakai sertifikat lain jika cache debug pernah berganti.
Bandingkan APK yang benar-benar dipakai pengguna sebelum rollout.

Untuk upgrade tanpa uninstall, **gunakan private key/keystore asli dengan sertifikat yang sama**.
Build type release tidak mewajibkan mengganti sertifikat: APK release non-debug boleh ditandatangani dengan identitas lama untuk kompatibilitas distribusi GitHub.
Sertifikat debug lama merupakan kompromi migrasi, bukan identitas signing baru untuk publikasi Google Play.
Wrapper tidak menghasilkan debug keystore baru dan tidak mengandalkan cache Actions untuk identitas distribusi.

Jika masih ada secret `ANDROID_DEBUG_KEYSTORE_BASE64`, wrapper dapat memakainya sementara dengan alias `androiddebugkey` dan password `android`.
Fingerprint tetap diverifikasi; secret yang menunjuk debug keystore berbeda akan ditolak.
Migrasikan secret tersebut ke empat `ANDROID_RELEASE_*` berikut dengan **isi keystore yang sama**.
Nama secret yang baru tidak mengubah sertifikat.

Jika keystore hanya ada di cache lama/draft privat, pulihkan secara privat oleh maintainer sebelum menjalankan pipeline baru.
Jangan mencetak Base64/password ke log atau mengunggah keystore sebagai release asset/artifact biasa.
Helper lama `scripts/android-signing.mjs` dipertahankan untuk pemulihan backup historis privat, tetapi tidak dipanggil pipeline baru.
Jangan hapus backup historis sebelum backup offline sudah teruji.
Sertifikat publik dari APK tidak dapat dipakai untuk membuat ulang private key yang hilang.

Jika private key lama hilang, patch ini tidak bisa menyediakan upgrade mulus untuk instalasi itu.
Plugin Hermes saat ini membandingkan set sertifikat secara tepat; rotasi Android signing lineage belum diimplementasikan.
Memakai kunci baru membutuhkan rencana migrasi tersendiri, misalnya aplikasi dengan package ID baru dan pemindahan data yang dirancang eksplisit.
Jangan otomatis uninstall, hapus data, menonaktifkan pemeriksaan sertifikat, atau mengganti fingerprint hanya agar CI lolos.

## Menyiapkan secrets

Di mesin tepercaya yang memiliki keystore asli, verifikasi fingerprint terlebih dahulu:

```bash
keytool -list -v -keystore /secure/path/original.keystore -alias androiddebugkey
# Masukkan password melalui prompt. Cocokkan SHA256 dengan pin di android-release.json.

python3 -c "import base64,pathlib; print(base64.b64encode(pathlib.Path('/secure/path/original.keystore').read_bytes()).decode())"
# Salin hasil secara privat ke GitHub Actions secret; jangan jalankan ini di log Actions.
```

Di Settings → Secrets and variables → Actions, tetapkan:

| Secret | Isi |
| --- | --- |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | Base64 keystore asli |
| `ANDROID_RELEASE_STORE_PASSWORD` | Password store |
| `ANDROID_RELEASE_KEY_ALIAS` | Alias private key, misalnya `androiddebugkey` untuk keystore lama |
| `ANDROID_RELEASE_KEY_PASSWORD` | Password private key |
| `TAURI_SIGNING_PRIVATE_KEY` | Kunci updater Hermes yang cocok dengan public key bawaan, bila mengaktifkan feed |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password kunci updater bila ada |

Jika secret release utama sudah diisi tetapi password/alias belum lengkap, build gagal; tidak ada fallback diam-diam.
Semua APK release, termasuk bootstrap, memerlukan identitas Android persisten.
Jika belum ada secret Android yang sesuai, validasi berhenti dengan pesan konfigurasi, bukan menerbitkan APK dengan sertifikat baru.

Untuk aplikasi yang **belum pernah didistribusikan**, buat kunci app signing mandiri di luar repository:

```bash
keytool -genkeypair -v -keystore /secure/path/hermes-app-signing.jks \
  -storetype JKS -alias hermes -keyalg RSA -keysize 3072 -validity 10000
keytool -list -v -keystore /secure/path/hermes-app-signing.jks -alias hermes
```

Isi secrets dari keystore itu dan pin fingerprint-nya sebelum distribusi pertama.
Perintah ini **bukan** cara mengganti kunci untuk instalasi Hermes lama tanpa migration.
Untuk distribusi APK GitHub, ini app signing key; jangan menganggap Google Play upload key selalu sama dengan app signing key yang diterima perangkat.
Simpan backup terenkripsi offline beserta alias/password, uji pemulihan, dan batasi akses maintainer.

## versionCode

CI memakai `1000000 + GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT`.
Run 26 attempt 1 menghasilkan `1002601`, lebih besar dari APK lama `1005`.
Attempt harus 1–99, dan nilai akhir maksimal `2100000000`.
Skema ini berlaku pada satu workflow release yang sama; jangan reset nomor run/menambah publisher lain tanpa rencana versionCode baru.
Jika memindahkan workflow/repository, pilih base baru di atas seluruh versionCode yang sudah didistribusikan.
Selalu build rilis pengganti pada run yang lebih baru; jangan menerbitkan ulang binary lama sebagai pembaruan baru.
`versionName` tetap versi aplikasi dan feed tetap `semver+build.run.attempt`; keduanya tidak diganti oleh versionCode Android.

## Build dan verifikasi

CI memakai JDK 21, Build Tools 37.0.0, NDK 28.2.13676358, dan Rust target aarch64.
NDK r28 dipakai untuk default alignment ELF 16 KiB; verifier tetap menguji ELF dan ZIP APK final.
Keberhasilan alignment bukan pengganti uji runtime pada perangkat 4 KiB dan 16 KiB.
Pengaturan cleartext release dipertahankan karena endpoint backend Hermes saat ini HTTP/WS LAN.
TLS dan pembatasan endpoint di transport native tetap berlaku; tidak ada perubahan autentikasi/session.

```bash
npm ci
npm run check
npm test
npm run web:build

# Setelah SDK/NDK, target Rust dan secrets tersedia di environment lokal tepercaya:
npm run android:init
# Untuk build lokal, pilih kode yang belum dipakai dan lebih tinggi dari semua APK yang ingin diganti.
export ANDROID_VERSION_CODE=1002701
npm run android:build

# Periksa lagi byte APK final; ambil versionCode aktual dari reports/android-apk-release.json.
python3 scripts/verify-android-apk.py \
  release-assets/hermes-cockpit-android-arm64-release.apk \
  --config src-tauri/android-release.json \
  --version-code 1002701 --version-name 0.1.5 \
  --build-tools "$ANDROID_HOME/build-tools/37.0.0" \
  --report reports/android-apk-release.json
```

Nomor di contoh lokal adalah contoh, bukan konstanta untuk setiap rilis.
Build Windows tetap memakai `npm run build`; `npm run android:build:debug -- --target aarch64` tetap untuk development dan tidak dipublikasikan workflow release.
Python 3 dibutuhkan oleh pengujian/verifier APK. Windows dapat memakai environment `PYTHON` untuk lokasi interpreter.

Verifier menolak ukuran di atas 40 MiB, APK debuggable/testOnly, ABI tambahan, versi/package ID salah,
izin updater hilang, simbol `.debug_*`/`.symtab`, sertifikat berbeda, atau alignment yang salah.
Budget 40 MiB adalah batas awal untuk mencegah regresi, **bukan klaim ukuran hasil build yang sudah diukur**.
Laporan berisi SHA-256, ukuran byte, native sections, ABI, versi dan fingerprint; tidak berisi keystore/password.
Artifact `diagnostics-android-apk` terpisah dari `release-*` agar laporan tidak menjadi input publisher.

Uji upgrade nyata pada perangkat yang sudah memiliki APK lama:

```bash
# Tanpa -d dan tanpa uninstall: mismatch/downgrade harus terlihat sebagai kegagalan.
adb install -r release-assets/hermes-cockpit-android-arm64-release.apk
adb shell dumpsys package app.hermes.cockpit
```

Pastikan pairing/data bertahan, HTTP dan WebSocket LAN tersambung, clipboard berfungsi,
plugin updater tidak rusak oleh R8, dan pembaruan berikutnya dapat dipasang dari dalam aplikasi.
Untuk jalur in-app: gunakan dua build signed yang berurutan, izinkan instalasi dari Hermes,
uji cancel/permission-denied/retry, serta konfirmasi aplikasi menjalankan build baru setelah dibuka kembali.
Jangan memakai `adb install -d`, `pm clear`, atau uninstall untuk menyamarkan kegagalan migrasi.
APK lama yang belum menyertakan endpoint updater baru tetap memerlukan satu instalasi manual dengan identitas yang cocok.

Pipeline tetap memakai publisher versi dan manifest `latest.json` yang ada.
`scripts/sign-updates.mjs` menandatangani APK **setelah** byte final diverifikasi.
Tanpa Minisign, installer bootstrap tetap berupa APK release bertanda tangan Android, tetapi tidak mengiklankan feed installable.
Dengan Minisign, `.apk.sig`, installer Windows, signatures dan feed dipublikasikan bersama sesuai aturan stable/prerelease yang ada.
