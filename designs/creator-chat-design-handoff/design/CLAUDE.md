# Creator Chat

Implementasikan desain di folder `design/` (isi paket ini) 1:1.

## Sumber kebenaran
- Visual: `design/png/<miniapp|admin>/<Board>.png`. Lihat gambarnya dulu sebelum menulis kode satu layar.
- Nilai persis: `design/html/<Board>.html` (HTML statis dengan style inline). Ambil warna, jarak, radius, ukuran font dari sini, jangan menebak dari gambar.
- Aturan, token, pola, alur, rute: `design/DESIGN.md`. Daftar layar: `design/INDEX.md`.

## Cara kerja
1. Bangun fondasi dulu: token (CSS variables), font Inter, ikon, lalu komponen bersama (tombol, input, chip status, kartu, tabel data, dialog, toast, tab, grafik, shell). Referensi komponen: `AdmMain`, `Main`, `CrMain`.
2. Satu layar per langkah. Setelah selesai, ambil screenshot dengan Playwright pada ukuran board (lihat `INDEX.md`) dan bandingkan dengan PNG acuan. Perbaiki selisih sebelum lanjut.
3. Jangan menambah fitur atau teks di luar desain. Teks UI memakai bahasa Indonesia persis seperti di desain.
4. Mulai dengan dashboard admin (`Adm*`), lalu Mini App.

## Aturan yang tidak boleh dilanggar
Lihat bagian "Aturan produk" di `DESIGN.md`. Intinya: pelanggan tidak tahu ada AI, tombol tidak pernah dua baris, admin tidak menampilkan pendapatan, secret, prompt, atau isi chat, dan status selalu punya label.
