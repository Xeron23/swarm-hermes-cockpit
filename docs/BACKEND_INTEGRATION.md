# Menyambungkan Hermes yang sesungguhnya

Dokumen ini menunjukkan batas integrasi source. Endpoint dan koneksi backend **belum diimplementasikan** pada proyek ini.

## Titik yang perlu diganti

| Fitur | Kode demo sekarang | Integrasi berikutnya |
| --- | --- | --- |
| Chat agen | `sendChat`, `chatReply` di `src/app.js` | Client FastAPI, streaming respons, penyimpanan conversation ID per agen |
| Mission | Form `mission-form` dan `missionDetail` | Create mission, status milestone, pause/resume dari backend |
| Swarm | `state.feed`, `addFeed` | Event stream beridentitas run dan agent, deduplikasi event |
| Trace | `openTrace` | Payload dan ringkasan langkah eksekusi yang dicatat backend |
| Terminal/diff/browser | `execution` | Output tool nyata yang disanitasi dan dihubungkan ke run ID |
| Health node | `nodeCard`, `nodeDetail` | CPU/RAM/disk/ping/uptime dari monitoring VPS dan PC |
| Sleep/shutdown/WOL | Handler `pc-power`, `shutdown` | Request ke backend yang sudah mengotorisasi aksi perangkat |
| RAG/Obsidian | Balasan Researcher | Search backend dan pengambilan dokumen sesuai hak akses |

## Struktur integrasi yang disarankan

Tambahkan modul client di `src/services/` dan pisahkan data demo dari renderer. Pertahankan boundary `src/native.js` untuk akses OS aplikasi; jangan memindahkan kunci SSH atau API secret ke source frontend.

Sebelum mengaktifkan mode nyata:

1. Tentukan base URL HTTPS milik backend dan autentikasi yang dipakai.
2. Definisikan contract request/response serta identitas `agent_id`, `conversation_id`, `mission_id`, `run_id`, dan `node_id`.
3. Ganti `setTimeout` pada chat serta nilai metrik statis dengan data client.
4. Hubungkan event stream dan update state tanpa menggandakan event setelah reconnect.
5. Atur izin backend untuk setiap perintah node, termasuk target VPS atau PC.
6. Ubah `connect-src` CSP untuk hanya mengizinkan origin backend yang dipakai; sesuaikan CORS backend dengan origin WebView yang sebenarnya.
7. Tambahkan loading, error, reconnect, dan expired-session states.
8. Uji alur pada perangkat, termasuk jaringan putus, node offline, dan aksi daya yang gagal.

Teks DEMO dan penjelasan simulasi sengaja tetap ada sampai contract dan implementasi tersebut tersedia. Jangan menghapus label itu hanya untuk membuat aplikasi terlihat terhubung.
