# Integrasi backend Hermes spec v1

Kontrak implementasi berasal dari spesifikasi API v1.0.0 dan EventEnvelope yang diberikan pengguna pada percakapan ini. File OpenAPI backend lengkap dan source worker belum disertakan di repository client. Source backend yang berjalan berada pada `/opt/projects/hermes-cockpit/backend` di VM pengguna.

## Pembagian modul

| Modul | Tanggung jawab |
| --- | --- |
| `src/transport.js` | Endpoint VM, fetch dan WebSocket browser/native, batas waktu koneksi |
| `src/api_client.js` | Error terstruktur, pairing, refresh berotasi, endpoint REST, lifecycle dan cursor telemetry |
| `src/workspace.js` | Snapshot workspace, sinkronisasi daftar, rekonsiliasi pesan, penyimpanan event selama sesi |
| `src/views.js` | Renderer data backend, status koneksi, metrik null/stale dan empty state |
| `src/app.js` | Navigasi, form, interaksi pengguna, konfirmasi daya, approval/question dengan request hash |
| `src/native.js` | Clipboard dan informasi runtime perangkat client |

## Kontrak yang dipakai

- Auth: `POST /api/v1/auth/pair`, `/refresh`, `/revoke`, `/ws-ticket`.
- Snapshot: `GET /health/ready`, `/api/v1/bootstrap`.
- Daftar: `GET /api/v1/nodes`, `/sessions`, `/missions`, `/approvals`, `/questions`.
- Chat: `POST /api/v1/sessions`, `GET/POST /api/v1/sessions/{id}/messages`.
- Misi: `POST /api/v1/missions`, `/api/v1/missions/{id}/pause|resume|cancel`.
- Node: `GET /api/v1/nodes/{id}`, `POST /api/v1/nodes/{id}/diagnostics|power`.
- Eksekusi: `GET /api/v1/tasks/{id}/traces`, `/api/v1/traces/{id}/logs`.
- Interaksi: `POST /api/v1/approvals/{id}/decision`, `/api/v1/questions/{id}/answer`.

Error HTTP dibaca dari `{error: {code, message, details, retryable}}`. Daftar memakai `{items: [...]}`; array langsung juga diterima. Respons create session/mission dapat berupa record langsung atau pembungkus `session`/`mission`. Respons kirim pesan mengikuti Message, bukan objek task buatan frontend.

Bootstrap harus cocok dengan `workspace_id` dan `device_id` hasil pairing, berisi array `agents`, `nodes`, `active_missions`, serta cursor string `last_event_seq`. `features.real_mode` dan `features.runtime_ready` harus true sebelum aksi tugas dibuka. Keberadaan token bukan bukti server atau worker online.

`metrics: null` menghasilkan keadaan belum ada metrik. `metrics_stale` dan keadaan koneksi menentukan label data lama. Client tidak menganggap PC sleep hanya karena heartbeat hilang dan tidak menganggap backend online berarti worker PC online. Field metrik hardware belum ditetapkan bentuknya dalam kontrak yang diberikan; renderer menampilkan field yang benar-benar dikirim tanpa menghitung unit atau angka fallback.

## Telemetry

Koneksi memakai `/ws/telemetry?ticket=...&after_seq=...` dan subprotokol `hermes.telemetry.v1`. Tiket baru diminta untuk setiap koneksi. Sebelum reconnect, client mengambil snapshot dan cursor baru, kemudian server mengejar event setelah snapshot tersebut. Client mengirim `ping` setiap 15 detik dan mengabaikan `pong` sebagai keepalive.

Event harus berisi `schema_version: "1.0"`, workspace yang sesuai, event ID, tipe, dan sequence string desimal. Sequence dibandingkan sebagai string desimal agar presisi tetap utuh melampaui batas Number dan tidak memerlukan BigInt pada WebView lama. Event duplikat, cursor lama, serta pesan socket yang sudah diganti diabaikan.

`MESSAGE_DELTA` merangkai pesan berdasarkan session/message ID; `MESSAGE_FINAL` memuat kembali daftar pesan authoritative. Perubahan agen, node, misi, task, approval, pertanyaan, dan artifact memicu sinkronisasi backend. Log aktif dimuat ulang saat event `TOOL_LOG_CHUNK` untuk trace yang sama diterima. Snapshot juga diperiksa berkala setiap 15 detik. Swarm menyimpan maksimal 300 event yang diterima selama sesi; riwayat event sebelum sesi tidak direkayasa oleh client.

## Token dan mutasi

Refresh menggunakan satu promise bersama untuk semua respons 401 bersamaan. Refresh token baru disimpan bersama access token baru. Respons jaringan yang hilang ketika refresh tidak diulang otomatis, karena backend mungkin sudah merotasi token. Ketidakpastian tersebut disimpan agar restart aplikasi tidak memakai kembali refresh token lama.

POST pesan, misi, diagnostik, atau daya tidak diulang setelah timeout/kegagalan transport. Refresh lalu retry satu kali setelah 401 diperbolehkan; 403 tidak memicu refresh atau fallback ke alamat lain. Penghapusan sesi mencegah refresh yang masih berjalan menghidupkan kembali kredensial.

Approval mengirim `request_hash` persis dari tindakan yang ditampilkan saat dialog dibuka. Jika hash telah berubah pada sinkronisasi berikutnya, dialog menolak keputusan dan meminta tinjauan ulang. Client tidak membuat proof, memalsukan hasil eksekusi, atau menyetujui tindakan secara otomatis.

## Batas deployment yang masih nyata

- Worker Windows `hermes-node` belum berjalan menurut laporan pengguna. Frontend tidak menggantikannya dengan data simulasi.
- Collector CPU/RAM/disk Linux juga belum disediakan backend; `/api/status` berisi metrik aplikasi, bukan metrik hardware node.
- Backend bertanggung jawab atas collector, runner, identitas mTLS, otorisasi, typed proof, dan kelanjutan task. Binary/source/config worker tidak dibuat dari kontrak REST frontend.
- Wake-on-LAN membutuhkan dukungan backend dan relay LAN yang tetap hidup; tidak ada endpoint wake yang ditebak.
- Penentuan rute subnet berada pada Windows/Android dan Tailscale. Client tidak dapat menjamin LAN diprioritaskan tanpa memeriksa tabel routing pada perangkat asli.
- HTTP/WS saat ini sesuai deployment pengguna; autentikasi memakai transport itu. Identitas workspace pada snapshot bukan verifikasi kriptografis endpoint HTTP. HTTPS atau mekanisme identitas terverifikasi memerlukan konfigurasi backend untuk pemakaian di jaringan yang tidak dipercaya.
- Data token disimpan di local storage WebView; integrasi secure credential storage native belum tersedia.
