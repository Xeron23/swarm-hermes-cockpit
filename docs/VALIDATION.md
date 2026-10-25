# Validasi client data nyata

Validasi perubahan dilakukan pada 25 Oktober 2026. Kontrak backend berasal dari spesifikasi v1.0.0 yang diberikan pengguna; fixture integrasi adalah data uji terkontrol, bukan pengukuran VPS/PC pengguna.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` | 16 tes client lulus, ditambah tes boundary clipboard/runtime dan WebSocket native (subprotokol, replay awal, ping, close) dengan mock resmi Tauri |
| `npm run check` | Lulus: schema konfigurasi base/Windows/Android, aset, sintaks JS, versi, dan scope HTTP native |
| `npm run web:build` | Lulus; bundle memasukkan transport HTTP/WebSocket native secara dinamis |
| Browser development, viewport desktop | Lulus terhadap fixture kontrak |
| Browser development, viewport Android/touch | Lulus terhadap fixture kontrak, dengan motion normal |
| Browser production preview, viewport desktop dan Android/touch | Lulus terhadap fixture kontrak |
| Native Linux debug tanpa installer | Lulus: Rust, Tauri, plugin HTTP dan WebSocket native; dependency tercatat di Cargo.lock |
| Backend LAN pengguna | Tidak berhasil dijangkau dari cloud; proxy membalas `403 Domain forbidden` |
| GUI/WebView native Linux di cloud | Belum dapat dijalankan: path helper WebKit berada pada direktori sistem read-only; namespace bind mount juga tidak tersedia |
| Binary/installer Windows | Belum dibangun atau dijalankan pada Windows asli |
| APK Android | Belum dibangun atau diuji pada Android asli; SDK/NDK tidak disiapkan untuk tugas ini |
| Rute LAN versus subnet Tailscale asli | Belum diverifikasi dari Windows/Android pengguna |
| Metrik hardware pengguna | Belum tersedia menurut backend yang dijelaskan pengguna; worker PC offline, collector hardware server belum ada |

Tes unit memeriksa scope endpoint, Base32 pairing, rotasi refresh bersamaan, respons refresh hilang, token reuse/revocation, logout saat refresh berjalan, mutasi tanpa retry buta, error typed approval, sequence besar, deduplikasi/reconnect, snapshot workspace yang salah, metrik null, serta rekonsiliasi delta/final message.

Tes integrasi browser memeriksa keadaan belum dipasangkan tanpa node/mission contoh, pairing, snapshot, PC offline, metrik null, filter sentuh, session/chat streaming, mission backend dengan target auto, escaping payload, traces/log, pembaruan metrik dari event, serta keadaan terputus/data lama. Tes juga menolak approval ketika request hash berubah setelah dialog dibuka, lalu memverifikasi keputusan untuk hash yang benar-benar ditinjau.

Tidak ada perintah power yang dikirim ke VPS/PC pengguna oleh tes. Kondisi online/angka fixture bukan klaim bahwa worker atau collector pengguna telah berjalan. Pengujian native dan jaringan asli diperlukan sebelum menyatakan deployment Windows/Android selesai.
