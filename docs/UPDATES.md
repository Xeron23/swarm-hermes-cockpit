# Pembaruan Hermes Cockpit

Windows memakai Tauri updater resmi. Android memakai adapter Hermes yang membaca entry
`android-aarch64` dari manifest Tauri yang sama, memverifikasi Minisign dan signed version,
lalu memeriksa package ID/sertifikat sebelum membuka installer sistem.

Manifest yang dikonfigurasi saat ini:

`https://github.com/Xeron23/swarm-hermes-cockpit/releases/latest/download/latest.json`

Manifest berada di rilis versi yang sama dengan installer dan `.sig`; URL paket di dalamnya
menunjuk tag versi/build yang immutable. Tidak ada publisher channel `updates` pada pipeline ini.

## Alur aplikasi

Pemeriksaan startup, enam jam dan setelah online hanya membaca metadata. Menu **Pembaruan aplikasi**
mendukung unduh saja atau unduh lalu pasang setelah konfirmasi. Paket baru installable setelah
verifikasi signature berhasil; akhir transfer bukan bukti verifikasi. Windows dapat keluar untuk
menjalankan installer/relaunch. Android tetap membutuhkan izin instalasi serta konfirmasi sistem.
Cancel/permission-denied dapat dicoba lagi sesuai status paket yang sudah diverifikasi.
Error feed GitHub tetap error updater dan tidak menghapus sesi workspace.

## Mode publikasi

- Tanpa `TAURI_SIGNING_PRIVATE_KEY`: installer bootstrap tetap terbit sebagai prerelease,
  tanpa feed installable dan tanpa memindahkan stable latest.
- Dengan kunci updater: semua EXE/MSI/APK harus memiliki signature yang cocok dengan public key Hermes.
  `latest.json` disiapkan sebelum satu publisher mengunggah/mempublikasikan seluruh aset.
- Tag stabil `v<versi>` harus cocok dengan versi aplikasi. Rilis signed yang lebih baru dapat menjadi
  stable latest. Main build dan tag prerelease tidak menggantikannya; rilis lama/rerun tidak menimpa
  pasangan paket/metadata immutable yang sudah terbit.
- Actions menggunakan `github.token` dengan `contents: write` pada job publish di repository ini.
  Secret tambahan untuk repository mirror tidak diperlukan.

## Signing Android dan Minisign

APK release sekarang dibangun/di-strip/dioptimasi sebagai ARM64, disejajarkan dan ditandatangani
**Android APK signing** sebelum `scripts/sign-updates.mjs` membuat signature **Minisign**.
Kedua kunci berbeda dan keduanya dibutuhkan untuk jalur in-app Android yang lengkap.
Tanpa secrets Android dan tanpa Minisign, APK bootstrap memakai debug keystore yang dipulihkan
dari cache atau dibuat jika belum ada. APK tetap release non-debug dan tidak menghasilkan feed installable.
Jika Minisign diaktifkan, keystore Android persisten yang cocok dengan pin sertifikat wajib tersedia;
fallback bootstrap tidak dipakai untuk signed updater. Cache bootstrap bukan penyimpanan kunci production.

Ikuti [APK Android release](ANDROID_RELEASE.md) untuk secrets `ANDROID_RELEASE_*`, fingerprint
sertifikat, versionCode dan migrasi debug ke release tanpa mengganti identitas yang sudah dipasang.
`ANDROID_DEBUG_KEYSTORE_BASE64` tetap diterima sebagai transisi dengan verifikasi fingerprint,
tidak lagi bergantung pada ada/tidaknya secret Minisign atau cache debug Actions.
Backup historis privat tetap dipertahankan; pipeline baru memakai secrets dan backup offline terpisah.

Untuk updater, isi `TAURI_SIGNING_PRIVATE_KEY` dan password bila ada. Kunci harus cocok dengan
public key yang sudah dibundel di `src-tauri/updater.json` dan `tauri.conf.json`.
Jangan memakai kunci Warren atau menghasilkan kunci pengganti untuk memperbaiki signature mismatch.
Helper `scripts/setup-updater-key.mjs` hanya untuk provisioning identitas baru sebelum distribusi
pertama atau migrasi kepercayaan yang sudah dirancang secara eksplisit.

Versi signature tetap `semver+build.<run>.<attempt>`, terpisah dari versionCode APK.
Android juga menolak certificate mismatch/downgrade; signature Minisign tidak melewati batas ini.
Binary lama yang mengunci endpoint channel lama perlu satu upgrade manual dengan sertifikat sama.
Tidak ada uninstall otomatis, penghapusan data, atau reset pairing saat memperbarui aplikasi.

## Validasi

Jalankan `npm run check`, `npm test`, `npm run web:build`,
`cargo test --locked --manifest-path scripts/updater-verifier/Cargo.toml`,
serta build dan tes native Windows/Android sesuai toolchain.
Pemeriksaan APK final ada di `scripts/verify-android-apk.py`; hasil CI tersimpan pada
artifact `diagnostics-android-apk`, terpisah dari installer yang diterbitkan.
Tes JavaScript/native IPC yang dimock tidak membuktikan instalasi OS sebenarnya.
Uji dua build signed berurutan pada perangkat nyata, termasuk cancel, izin, relaunch dan retensi sesi.
