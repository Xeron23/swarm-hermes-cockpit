# Auto-connect dan pemulihan sesi frontend

## Alur koneksi

Startup dengan sesi tersimpan mencoba health, snapshot, daftar, tiket baru, lalu handshake WebSocket.
Hanya handshake sukses menandai telemetry `connected`; sukses GET tidak membuktikan WebSocket hidup.
GET/HEAD transient diulang paling banyak sekali per operasi. Loop koneksi memakai backoff jitter
sekitar 1, 2, 4, 8, 16, lalu maksimal 30 detik. Pemeriksaan recovery yang belum terbukti dijadwalkan 60 detik.
Tidak ada auto-retry umum untuk pairing, rotasi refresh, pesan, misi, approval, atau aksi daya.
Setiap upaya handshake menggunakan tiket baru sesuai kontrak existing.

Native HTTP memakai connect timeout 10 detik dan total 20 detik; deadline JS 22 detik.
Timeout JS saja tidak dapat melampaui limit Rust. Abort frontend juga bukan bukti POST native dibatalkan.
Hasil mutasi yang timeout tetap tidak diketahui dan tidak dikirim ulang otomatis.

Lifecycle mendebounce online/pageshow/focus, berhenti saat pagehide/hidden dan melanjutkan saat aktif.
Focus singkat mempertahankan socket; kembali dari blur >=15 detik membuka koneksi baru.
Jika tidak ada event resume, watchdog pong menutup socket yang tidak menjawab lebih dari 45 detik.
`navigator.onLine` tidak dipakai untuk mengunci akses LAN: itu petunjuk OS, bukan bukti backend tidak terjangkau.
Sesi, pairing dan draft tidak dihapus oleh offline, timeout, hide atau close.

Refresh topbar mempunyai busy state, disabled sementara dan animasi yang menghormati reduced motion.
Klik ganda berbagi operasi yang sama. Jika belum terhubung, tombol membangunkan loop koneksi;
jika telemetry hidup, tombol memperbarui snapshot. Error aksi dan error koneksi dipisahkan.
Snapshot/handshake yang pulih hanya menghapus error koneksi lama, bukan hasil mutasi yang belum diketahui.
Chat yang sedang dibuka memuat kembali riwayat saat koneksi pulih.

## Mengapa health tidak boleh menghapus refresh_uncertain

Respons refresh yang hilang dapat terjadi sebelum atau sesudah backend mengonsumsi token lama.
Health 200 sama-sama mungkin pada kedua kondisi. Mencoba token lama lagi setelah rotasi berhasil
dapat memicu reuse detection dan pencabutan keluarga token.
Perbaikan bug backend 500 tidak membuktikan apakah suatu request historis sudah sempat commit.

Client menyimpan intent `refresh_uncertain` dan `refresh_attempt_id` sebelum POST rotasi.
Restart di tengah request tidak dapat mengulang token itu secara buta. Marker tersebut bukan
idempotency key backend; kontrak rotating refresh existing tidak diubah.
Rotasi 200 menyimpan pasangan token baru dan menghapus marker. Recovery menunggu rotasi lokal
yang masih berjalan agar tidak menghapus intent sebelum responsnya diterima.
Jika storage yang tersedia tidak dapat menulis intent, rotasi ditunda. Mode memory-only tetap
tidak menjanjikan persistensi setelah proses ditutup.

Tanpa kontrak recovery di bawah, client mencoba bootstrap menggunakan access token secara langsung,
tanpa auto-refresh. Jika masih valid, workspace dapat dibaca sementara aksi dinonaktifkan.
Jika access token kedaluwarsa, status menjadi `recovery_required`, sesi tetap disimpan dan
probe dijadwalkan lagi. Pairing ulang tersedia sebagai pilihan eksplisit, bukan efek timeout.

## Kontrak backend BARU yang diperlukan untuk recovery penuh

Kontrak berikut merupakan usulan integrasi, **bukan endpoint yang sudah diverifikasi tersedia**.
Source backend tidak ada di repository client; dokumentasi existing menunjuk
`/opt/projects/hermes-cockpit/backend` pada VM. Agent backend perlu mengimplementasikan kontrak ini
sebelum mengiklankan capability. Sekadar mengubah frontend tidak bisa membuktikan status token opaque lama.

Health siap mengiklankan:

```json
{
  "status": "ok",
  "capabilities": { "refresh_token_status_v1": true }
}
```

Jika field tidak ada/false, client tidak memanggil endpoint baru.

`POST /api/v1/auth/refresh-status` harus merupakan query autentikasi yang **tidak merotasi token**:

```json
{
  "refresh_token": "<token tersimpan>",
  "workspace_id": "<workspace tersimpan>",
  "device_id": "<device tersimpan>",
  "request_id": "<32 karakter hex acak per pemeriksaan>"
}
```

Token berada dalam body, bukan URL; access token kedaluwarsa tidak dikirim sebagai Authorization.
Server memverifikasi hash/token dan hubungan device/workspace pada penyimpanan authoritative.
Jangan memanggil service rotasi untuk mengimplementasikan query ini, jangan memicu reuse revocation,
jangan memperpanjang expiry, dan jangan mencatat body/token pada log. Respons memakai `Cache-Control: no-store`.

Hanya token yang terbukti masih current boleh menghasilkan:

```json
{
  "request_id": "<nonce dari request yang sama>",
  "workspace_id": "<workspace yang diverifikasi>",
  "device_id": "<device yang diverifikasi>",
  "refresh_token_state": "current",
  "rotation_performed": false
}
```

Frontend mengecek seluruh field tersebut dan auth epoch sebelum menghapus flag lokal.
Pemeriksaan status ini tidak mengembalikan token baru; setelah terbukti current, alur refresh existing
boleh berjalan satu kali jika access token membutuhkan pembaruan.

Untuk token yang sudah dipakai/rotated, balas 200 dengan state `spent` dan identitas/nonce yang sesuai;
client tetap mempertahankan uncertainty dan tidak memakai token itu pada endpoint rotasi.
Untuk pencabutan/expiry yang benar-benar terbukti, balas 401 dengan error terstruktur existing,
misalnya `DEVICE_REVOKED`, `REFRESH_TOKEN_EXPIRED` atau `SESSION_EXPIRED`.
Unknown state, nonce/identity salah atau bukti tidak lengkap tidak boleh menjadi izin retry rotasi.
Kegagalan network/5xx query tetap dapat diperiksa lagi tanpa replay rotating POST.

Endpoint perlu diuji di backend: current tidak berubah setelah query berulang, spent tidak merotasi
atau mencabut keluarga, device/workspace foreign ditolak, nonce di-echo tepat, serta rollback/500
tidak salah dilaporkan sebagai current. Aktifkan capability hanya setelah seluruh invariant lulus.
Jika token memang sudah spent dan tidak ada mekanisme successor recovery terautentikasi,
query ini tidak dapat mengembalikan token pengganti; provisioning/pairing eksplisit masih diperlukan.

## Verifikasi

Jalankan `npm run check`, `npm test`, `npm run web:build` dan, dengan Playwright/Chromium tersedia,
`python3 scripts/smoke-resilience.py <preview-url>`.
Fixture browser mengintersep seluruh endpoint Hermes; tidak mengakses VM pengguna.
Tes Rust/native, Android resume dan Windows sleep/wake tetap perlu dijalankan pada perangkat sebenarnya.
Uji legacy flag dengan access valid, access expired tanpa capability, dan capability dengan proof current.
Jangan memakai penghapusan localStorage atau reset flag manual sebagai bukti recovery berhasil.
