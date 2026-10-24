# Hasil verifikasi

Tanggal ekspor: 24 Oktober 2026. Source UI mengikuti commit yang dicatat di `SOURCE_PROVENANCE.json`.

| Pemeriksaan | Hasil |
| --- | --- |
| Instalasi dependency npm | Lolos; lockfile memakai registry publik npm |
| Tauri CLI | 2.12.4 berhasil dijalankan |
| API JavaScript Tauri | 2.12.4 |
| Clipboard JavaScript | 2.5.0 |
| Vite | 8.3.5 |
| `npm run check` | Lolos: schema konfigurasi Tauri, merge Android/Windows, aset, sintaks JS, capability, versi |
| `npm test` | Lolos: fallback clipboard browser dan routing native/runtime-info melalui IPC mock resmi |
| `npm run web:build` | Lolos: bundle produksi berhasil dibuat |
| Ikon aplikasi | Dihasilkan melalui Tauri CLI; format PNG, ICO, ICNS, Android, dan iOS |
| Smoke test bundle produksi di browser | Lolos: Overview, Swarm, filter, demo event, trace, dan payload |
| Error konsol dari aplikasi pada smoke test | Tidak ditemukan |
| Dependency opsional Windows/macOS di lockfile | Tersedia |
| Kompilasi Rust desktop | Belum dijalankan; Rust/cargo tidak tersedia pada lingkungan ekspor |
| Generate/build Android | Belum dijalankan; Android SDK/NDK belum dikonfigurasi pada lingkungan ekspor |
| Clipboard pada perangkat native nyata | Belum diuji; pengujian native menggunakan mock |
| Signing / instalasi APK atau desktop installer | Belum dijalankan |

`dist/` berisi build frontend produksi yang sudah dibuat. APK, EXE, MSI, DMG, AppImage, dan executable native tidak disertakan. Folder Gradle Android dibuat oleh `npm run android:init` di komputer dengan toolchain yang sesuai.

Pengujian di browser memeriksa kode frontend yang sudah dibundel; hasil itu tidak menggantikan pengujian WebView native pada perangkat sasaran.

## Ulangi pemeriksaan

```bash
npm ci
npm run check
npm test
npm run web:build
```

Setelah prasyarat native tersedia, lanjutkan dengan `npm run dev`, `npm run build`, atau langkah Android pada README.
