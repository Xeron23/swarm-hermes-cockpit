# Sistem Tema & Palet Warna Hermes Cockpit

## 1. Empat Palet Preset
Hermes Cockpit menyediakan 4 preset tema warna:

| ID | Nama Tampilan | Primary | Secondary | Supporting 1 | Supporting 2 | Tipe |
|---|---|---|---|---|---|---|
| `ocean-mist` | **Ocean Mist (Default)** | `#3368A0` | `#66A3BF` | `#C8DFDB` | `#F2EFE7` | Light |
| `sunset-gold` | **Sunset Gold** | `#FF933E` | `#FFCB56` | `#FFE9A9` | `#73A5CA` | Light |
| `tropical-tide` | **Tropical Tide** | `#8AD6D1` | `#359FA0` | `#FFF0C5` | `#FF8C52` | Light |
| `midnight-slate` | **Midnight Slate** | `#1B3C53` | `#234C6A` | `#456882` | `#D2C1B6` | Dark |

### Aturan Palet
1. Warna pertama selalu **Brand Primary** (aksi utama, penanda aktif, header aksen).
2. Warna kedua selalu **Brand Secondary** (aksi pendukung, pill running, hover border).
3. Dua warna berikutnya adalah **Supporting Colors** (background panel, border, text contrast, surface-raised).
4. Default instalasi dan fallback ID invalid selalu **Ocean Mist**.

## 2. Penyimpanan Preferensi
- Key localStorage: `hermes_theme_v1`
- Dipisahkan dari auth/token session agar penggantian tema tidak mempengaruhi sesi login atau WebSocket.
- Tema diinisialisasi pada `src/main.js` sebelum render pertama untuk mencegah kilatan warna lama saat startup.
