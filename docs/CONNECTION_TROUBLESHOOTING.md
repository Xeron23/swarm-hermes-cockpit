# Health berhasil, pairing gagal

Pada 25 Oktober 2026 pengguna melaporkan Windows satu LAN dengan VM, memakai release berlabel 0.1.1 build 12, dan melihat `Pairing failed: Failed to fetch`. Dari PC yang sama, `http://192.168.1.4:3450/health/ready` mengembalikan `status: ok`, `service: api`, versi 1.0.0, serta checks database dan runtime_binding `ok`.

Respons tersebut membuktikan API port 3450 dapat dijangkau dari PC. Respons itu belum menguji POST pairing, kode pairing, maupun handshake WebSocket. Status worker PC offline dan hardware metrics null tidak menghalangi pairing client.

## Temuan client

Pesan `Pairing failed: ...` ditemukan pada frontend lama di commit `172b051`. Client tersebut mengirim request dengan fetch WebView, sedangkan CSP paket membatasi `connect-src` ke IPC. Reproduksi fetch lama dengan CSP tersebut menghasilkan pesan yang sama, tanpa request mencapai backend. Versi 0.1.2 memakai plugin HTTP dan WebSocket native; versi 0.1.3 mengganti HTTP dengan command Rust khusus backend yang mengikuti rute OS langsung ke VM.

Ini merupakan indikasi frontend lama masih berjalan. Isi installer yang dipasang pengguna belum dapat diambil dan dibandingkan dari cloud, sehingga penyebab pada perangkat belum dipastikan. Pengujian cache build lokal tetap memicu kompilasi ulang ketika frontend berubah.

## Pemeriksaan pada Windows

1. Tutup seluruh proses Hermes Cockpit sebelum memasang installer 0.1.3 dari build terbaru yang berhasil di GitHub Releases.
2. Buka **Server & jaringan**. **Client build** dan **Runtime build** harus menunjukkan versi 0.1.3 dan commit yang sama. Transport harus **Native HTTP + WebSocket**. Identitas yang berbeda memunculkan pesan untuk memasang installer dari build yang sama.
3. Klik **Uji API tanpa pairing**. Tombol ini hanya melakukan GET `/health/ready`, tanpa token atau kode pairing. Hasil sukses seharusnya menampilkan service `api` dan versi backend 1.0.0.
4. Jika health berhasil, lakukan pairing dengan kode sekali pakai yang masih berlaku. Jangan membagikan kode atau token dalam laporan masalah.
5. Jika gagal, salin pesan pada dialog beserta Client build, Runtime build, dan Transport. Error menampilkan tahap/endpoint sehingga health, pairing, bootstrap, dan telemetry dapat dibedakan.

| Hasil diagnostik | Makna dan langkah berikutnya |
| --- | --- |
| `NATIVE_SCOPE_DENIED` | Build aplikasi menolak URL API; cocokkan installer dan alamat VM yang diizinkan. |
| `NATIVE_PERMISSION_DENIED` | Plugin/perintah jaringan native tidak tersedia atau izinnya tidak cocok pada paket. Periksa identitas build. |
| `CONNECTION_REFUSED` | Port API menolak koneksi. Periksa service, bind, dan firewall port 3450. |
| `TIMEOUT` | Jalur tidak merespons dalam batas waktu; periksa akses LAN atau subnet Tailscale dari perangkat. |
| `BROWSER_FETCH_FAILED` | Transport browser digunakan. Jaringan, CORS, CSP, atau izin jaringan lokal dapat menjadi penyebab; pesan ini sendiri tidak membuktikan satu penyebab tertentu. |
| `HTTP 400/401` pada `/api/v1/auth/pair` | API sudah merespons POST; ikuti kode error backend, misalnya kode pairing tidak valid atau kedaluwarsa. |
| Error pada `/api/v1/bootstrap` atau `/ws/telemetry` | Kegagalan terjadi sesudah tahap pairing; periksa error kontrak/otorisasi atau handshake pada tahap tersebut. |

Alamat API tetap `192.168.1.4:3450` melalui LAN maupun subnet Tailscale. `100.114.42.71` adalah Proxmox subnet router, bukan alamat langsung API VM. Transport native tidak memerlukan penambahan izin CORS browser untuk melakukan HTTP API.

Versi 0.1.2 mempertahankan error dalam dialog dan menyamarkan kode pairing/token yang diketahui dari pesan. Error mentah native yang dapat berisi URL tiket atau header tidak ditampilkan. Permintaan mutasi yang hasilnya belum diketahui tidak diputar ulang otomatis.

## Perbaikan 0.1.3

HTTP native kini memakai command Rust yang membatasi request ke API VM dan tidak mewarisi proxy sistem. Dialog membedakan pairing yang diterima dari kegagalan bootstrap/tiket/handshake, mempertahankan error telemetry meskipun health/polling berhasil, dan menyediakan **Salin laporan koneksi**. Lihat [analisis beserta reproduksi](CONNECTION_ANALYSIS.md).
