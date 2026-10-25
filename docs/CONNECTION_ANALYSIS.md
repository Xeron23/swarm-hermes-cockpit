# Analisis koneksi Windows, 25 Oktober 2026

API VM `192.168.1.4:3450` mengembalikan health siap ketika dibuka dari PC pengguna. Backend memang dapat dijangkau dari browser PC tersebut. Cloud tidak berada pada LAN/Tailnet pengguna, dan belum mendapatkan hasil diagnostik dari aplikasi yang dipasang. Penyebab tunggal pada PC pengguna belum dapat dipastikan.

## Temuan yang direproduksi

| Kasus | Bukti | Perbaikan 0.1.3 |
| --- | --- | --- |
| HTTP native mewarisi proxy, meskipun URL dapat dijangkau langsung | Uji dengan plugin HTTP 2.8.3 dan socket lokal: URL health yang sama menghasilkan HTTP 502 melalui proxy uji, sedangkan client langsung menghasilkan 200 | Command Rust khusus backend memakai `no_proxy()`, mengikuti rute OS ke VM pada LAN maupun subnet Tailscale |
| Detail kegagalan transport native hilang | Plugin lama mengirim `reqwest::Error` sebagai teks Display. Error sumber OS dapat tersembunyi di balik pesan umum pengiriman request | Rust memeriksa rantai error dan mengirim kode aman untuk refused, timeout, akses OS ditolak, atau rute tidak tersedia |
| Error WebSocket hilang setelah polling REST | Fixture handshake 403 menghasilkan error telemetry; setelah `workspace.refresh()` berhasil, error berubah menjadi string kosong meskipun socket tetap belum tersambung | Snapshot REST tidak menghapus error koneksi telemetry; hanya koneksi siap yang menghapusnya |
| Health sukses menutupi error tahap lain pada dialog | Dialog mengutamakan hasil health yang tersimpan dibanding error workspace | Hasil health dan error workspace ditampilkan bersama; tahap koneksi ditampilkan tersendiri |
| Pairing berhasil tetapi tahap berikutnya gagal | Alur lama menutup dialog segera setelah token diterima, sementara koneksi berjalan di background | Alur menunggu percobaan pertama, mempertahankan dialog jika bootstrap/tiket/handshake gagal, dan menjelaskan bahwa pairing telah diterima |
| WebSocket browser ditutup sebelum open | Promise koneksi lama dapat tertinggal karena onclose menghapus timeout tanpa menolak promise | Penutupan sebelum handshake menolak promise dan mengizinkan percobaan baru |

Perbedaan jalur browser dan aplikasi adalah kandidat penyebab yang kuat untuk diperiksa. Uji proxy membuktikan perilaku client pada kondisi tersebut; uji itu tidak membuktikan PC pengguna sedang memakai proxy.

Ada temuan terpisah pada versi lama: tag `v0.1.1` menunjuk commit `172b051`, yang masih memakai fetch WebView dan belum memiliki transport HTTP/WebSocket native. Fetch tersebut ditolak CSP paket pada reproduksi. Identitas build tetap diperlukan untuk membedakan masalah versi lama dan kegagalan build baru.

## Jalur koneksi yang sebenarnya

1. POST `/api/v1/auth/pair` mengirim kode sekali pakai dan nama perangkat. Respons sukses menyimpan token.
2. GET `/health/ready` memeriksa HTTP API dari transport aplikasi.
3. GET `/api/v1/bootstrap` memeriksa snapshot dan identitas workspace/perangkat. List mission/session/approval/question disinkronkan.
4. POST `/api/v1/auth/ws-ticket` meminta tiket sekali pakai.
5. Handshake `/ws/telemetry` menggunakan tiket dan subprotokol `hermes.telemetry.v1`.

Health sukses hanya mencakup tahap HTTP readiness. Token tersimpan juga belum membuktikan bootstrap dan telemetry berhasil. Ketika telemetry belum tersambung, client tetap menunjukkan kegagalan tahap tersebut dan menahan aksi yang membutuhkan workspace siap.

## Batas transport baru

Rust hanya menerima origin tetap `http://192.168.1.4:3450`, path health atau `/api/v1/`, serta metode GET/POST yang dipakai client. Port bridge 8795, origin lain, URL berisi kredensial, header Host, dan perpindahan origin melalui redirect ditolak. Hanya header Accept, Content-Type, dan Authorization diteruskan. Origin browser serta cookie tidak ditambahkan otomatis; autentikasi menggunakan kontrak Bearer backend.

Koneksi HTTP native mengikuti rute OS langsung. Di luar LAN, rute tersebut tetap perlu tersedia melalui subnet Tailscale. Perubahan ini tidak membuat route baru pada perangkat dan tidak membuktikan worker PC sudah online. WebSocket native juga memakai koneksi langsung ke VM.

Timeout, respons refresh yang hilang, dan mutasi yang hasilnya belum diketahui tetap tidak memicu pengulangan POST secara buta. Error tidak menampilkan rantai exception mentah, URL tiket, kode pairing, atau token yang diketahui.

## Verifikasi

Uji socket native mencakup body pairing POST, header Authorization bootstrap, respons HTTP 403, tidak adanya Origin/cookie otomatis, pembatasan origin/path/metode/header, koneksi ditolak dari OS, redirect, serta command IPC dari window yang diizinkan dan penolakan window lain. Suite dijalankan dengan proxy uji yang tidak tersedia untuk memastikan request fixture tetap langsung. Workflow Windows menjalankan suite native yang sama setelah build.

Uji antarmuka desktop/mobile mencakup pairing diterima lalu tiket telemetry ditolak 403, health tetap sukses, error telemetry tetap terlihat, laporan dapat disalin tanpa token/kode pairing, dan reconnect memakai sesi yang ada. Uji ini tidak menjalankan aksi power pada perangkat pengguna.

Verifikasi terakhir tetap memerlukan aplikasi Windows pengguna. Dialog **Server & jaringan → Salin laporan koneksi** menghasilkan versi frontend/runtime, alamat API, status, tahap, dan pesan diagnostik tanpa token atau kode pairing. Laporan tersebut membedakan kegagalan sebelum HTTP, autentikasi, kontrak bootstrap, tiket, dan handshake.
