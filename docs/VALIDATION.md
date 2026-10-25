# Validasi client data nyata

Validasi perubahan dilakukan pada 25 Oktober 2026. Kontrak backend berasal dari spesifikasi v1.0.0 yang diberikan pengguna; fixture integrasi adalah data uji terkontrol, bukan pengukuran VPS/PC pengguna.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` | 51 tes client/release/diagnostik/helper Windows lulus; ditambah boundary clipboard/runtime, HTTP native termasuk pairing/Bearer tanpa fetch WebView, dan WebSocket native dengan mock resmi Tauri |
| `npm run check` | Lulus: schema konfigurasi base/Windows/Android, aset, sintaks JS, versi, dan scope HTTP native |
| `npm run web:build` | Lulus untuk 0.1.3; command HTTP Rust, transport WebSocket native, dan manifest identitas build tervalidasi |
| Browser development, viewport desktop | Lulus terhadap fixture kontrak |
| Browser development, viewport Android/touch | Lulus terhadap fixture kontrak, dengan motion normal |
| Browser production preview, viewport desktop dan Android/touch | Lulus terhadap fixture kontrak |
| Native Linux debug tanpa installer | Lulus untuk 0.1.3: Rust, Tauri, HTTP langsung dan WebSocket native; dependency tercatat di Cargo.lock |
| `cargo test --lib --offline --locked` | 5 tes native lulus, juga ketika HTTP_PROXY/HTTPS_PROXY/ALL_PROXY menunjuk proxy uji yang tidak tersedia dan NO_PROXY kosong |
| Backend LAN pengguna | Tidak berhasil dijangkau dari cloud; proxy membalas `403 Domain forbidden` |
| GUI/WebView native Linux di cloud | Belum dapat dijalankan: path helper WebKit berada pada direktori sistem read-only; namespace bind mount juga tidak tersedia |
| Binary/installer Windows | Belum dibangun atau dijalankan pada Windows asli |
| APK Android | Belum dibangun atau diuji pada Android asli; SDK/NDK tidak disiapkan untuk tugas ini |
| Rute LAN versus subnet Tailscale asli | Belum diverifikasi dari Windows/Android pengguna |
| Metrik hardware pengguna | Belum tersedia menurut backend yang dijelaskan pengguna; worker PC offline, collector hardware server belum ada |
| Workflow release | Diperiksa dengan actionlint; helper release diuji tanpa publikasi eksternal |
| Pemantauan GitHub Actions dari cloud | Akses `api.github.com` ditolak proxy; status build/release remote belum dapat dikonfirmasi |

Tes unit memeriksa scope endpoint, Base32 pairing, rotasi refresh bersamaan, respons refresh hilang, token reuse/revocation, logout saat refresh berjalan, mutasi tanpa retry buta, error typed approval, sequence besar, deduplikasi/reconnect, snapshot workspace yang salah, metrik null, serta rekonsiliasi delta/final message.

Tes integrasi browser memeriksa keadaan belum dipasangkan tanpa node/mission contoh, pairing, snapshot, PC offline, metrik null, filter sentuh, session/chat streaming, mission backend dengan target auto, escaping payload, traces/log, pembaruan metrik dari event, serta keadaan terputus/data lama. Tes juga menolak approval ketika request hash berubah setelah dialog dibuka, lalu memverifikasi keputusan untuk hash yang benar-benar ditinjau.

Regresi koneksi 0.1.2 diuji pada production preview desktop dan mobile/touch: versi tampil, uji health mengirim GET tanpa Authorization maupun pairing, respons pairing HTTP 400 menampilkan kode/status/endpoint tanpa nilai kode pairing, dan error tetap tersedia setelah dialog ditutup lalu dibuka. Tes unit membedakan penolakan scope, izin native, koneksi ditolak, timeout, dan kegagalan fetch browser, serta menolak manifest versi/commit/run yang salah.

Regresi 0.1.3 mereproduksi health sukses dengan tiket telemetry 403, membedakan pairing diterima dari tahap tiket yang gagal, mempertahankan error meskipun health/polling berhasil, serta menyalin laporan tanpa token/kode pairing dan reconnect tanpa mengonsumsi kode pairing baru. Native memakai socket HTTP sungguhan untuk POST body, header Bearer, HTTP error, penolakan koneksi OS, redirect, dan pembatasan scope. Command IPC Tauri sungguhan juga diuji: window utama diizinkan, window lain ditolak. Workflow Windows menjalankan suite native setelah build; keberhasilan workflow remote belum dikonfirmasi dari cloud. Rincian reproduksi ada pada [analisis koneksi](CONNECTION_ANALYSIS.md).

Runner Windows kemudian dilaporkan gagal memuat executable unit test dengan `0xc0000139` sebelum harness berjalan. Helper CI menanam dan memverifikasi manifest Common Controls v6 pada EXE tes sebelum menjalankannya. SDK lalu melaporkan `10100ba` karena file awal hanya memiliki identitas dependency; identitas executable x64 kini ditambahkan sebagai anak langsung `assembly`. Sebelas tes helper lulus pada Node 24 dan Node 22.12, termasuk penolakan file lama sebelum kompilasi, validasi SDK lebih awal, dan verifikasi kedua identitas setelah embedding. Metadata Cargo dari crate ini juga diperiksa langsung untuk pemilihan artifact library. Eksekusi loader Windows setelah perbaikan tetap perlu dikonfirmasi di runner. Lihat [analisis startup tes Windows](WINDOWS_NATIVE_TESTS.md).

Pengguna berhasil membuka health API dari PC Windows dan menerima `status: ok`, `database: ok`, serta `runtime_binding: ok`. Ini membuktikan akses HTTP dari PC tersebut, sedangkan pairing dan telemetry native pada perangkat pengguna masih perlu diverifikasi. Kode lama di commit `172b051` memakai fetch WebView dan menampilkan `Pairing failed: ${err.message}`. Reproduksi dengan CSP native yang sama menghasilkan `Pairing failed: Failed to fetch` tanpa request backend. Pengujian cache lokal tetap mengompilasi ulang aplikasi setelah perubahan frontend; cache belum terbukti menjadi penyebab installer yang dilaporkan pengguna.

Tes release memeriksa tag prerelease unik untuk push/rerun, kecocokan tag versi, keberadaan seluruh platform sebelum kontak GitHub, unggahan draft sebelum publikasi, draft tidak lengkap tetap tidak dipublikasikan, penanganan akses GitHub yang ditolak, dan perlindungan rilis versi yang sudah terbit.

Regresi nama installer Windows yang mengandung spasi mereproduksi error `Draft is incomplete` pada pemeriksaan lama. Perbaikan menyiapkan salinan dengan nama aman sebelum upload dan membuat checksum berdasarkan nama tersebut. Tes juga memastikan file asli tidak berubah, persiapan ulang konsisten, nama yang bertabrakan ditolak, serta aset berstatus `starter` atau berukuran salah tidak dipublikasikan. Pesan kegagalan mencantumkan detail aset yang diharapkan dan yang dilaporkan GitHub.

Tidak ada perintah power yang dikirim ke VPS/PC pengguna oleh tes. Kondisi online/angka fixture bukan klaim bahwa worker atau collector pengguna telah berjalan. Pengujian native dan jaringan asli diperlukan sebelum menyatakan deployment Windows/Android selesai.
