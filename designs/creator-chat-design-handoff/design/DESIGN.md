# Creator Chat: panduan desain untuk implementasi

Dua produk, satu bahasa visual.

1. **Mini App Telegram** (customer dan creator), mobile 390 px. Chat privat berlangganan antara pelanggan dan creator.
2. **Dashboard Admin web**, aplikasi terpisah. Login username dan password, desktop 1440 px, responsif ke tablet (1024) dan mobile (390).

Sumber kebenaran visual: `png/`. Nilai persis (warna, jarak, radius, font): `html/`. Daftar layar: `INDEX.md`.

## Token

| Token | Nilai | Pakai |
|---|---|---|
| bg | #FFF9FB | latar halaman (60%) |
| pink | #F5DCE5 | permukaan, ikon, aksen lembut (30%) |
| pink-soft | #FBEDF2 | hover baris, panel info, header tabel, sidebar |
| rose | #A83F67 | aksi primer, tautan aktif, grafik (10%) |
| rose-hover | #8E3255 | hover tombol primer |
| ink | #30252C | teks utama |
| ink-2 | #75636D | teks sekunder |
| ink-2-pressed | #66545E | teks sekunder di atas pink |
| line | #E6D3DB | border halus |
| field | #D8C0CA | border input dan tombol outline |
| ok | teks #24634A, latar #E1F0E7 | Active, Berhasil |
| warn | teks #7A4F0D, latar #FBEDD0 | Request, Menunggu |
| err | teks #A3261D, latar #FBE3E0 | Blocked, Gagal, Ditolak |
| exp | teks #5E4E57, latar #EFE7EB | Kedaluwarsa |

- Font **Inter** 400/500/600/700. Ikon outline 1.75–2 px (set kecil di `html/`, SVG inline).
- Radius: tombol dan input 12, kartu 16, dialog 20, chip 14 (pil). Bayangan: `0 1px 2px rgba(48,37,44,.06)` dan `0 4px 16px rgba(48,37,44,.08)`; backdrop dialog `rgba(48,37,44,.5)`.
- Tinggi kontrol: tombol 40 (36 di dalam tabel), input 44, target sentuh mobile minimal 44.

## Aturan produk yang tidak boleh dilanggar

- **Pelanggan tidak tahu ada AI.** Semua balasan tampil sebagai dari creator. Tidak ada label, teks, atau tombol AI di UI customer. Mode AI/manual hanya terlihat di sisi creator dan admin.
- Tidak ada memori AI per pelanggan dan tidak ada ringkasan otomatis.
- Satu akun, satu role. CREATOR hanya lewat persetujuan admin pada akun USER yang sama, dan hanya bila tidak ada langganan pelanggan aktif. Tidak ada role switcher.
- Login user hanya lewat Telegram. Login admin hanya username dan password, tanpa pendaftaran publik.
- Galeri non-subscriber: tampil blur dan tidak bisa dibuka. Blur harus berupa placeholder resolusi rendah buatan server, bukan CSS blur di atas file asli.
- Wording media: "Pilih Galeri" dan "Upload Baru". Kolom isi disebut "pesan", bukan "caption".
- **Tombol tidak boleh dua baris** (`white-space:nowrap`).
- Harga subscription ditentukan creator. Biaya aplikasi per subscription ditampilkan (10% sebagai placeholder).
- Admin: tidak ada pendapatan, pembayaran, payout, komisi, wallet. Tidak pernah menampilkan password, token, API key (hanya masked, tanpa reveal), prompt, memori pelanggan, atau isi chat pribadi. Pemberian akses oleh admin tidak melibatkan transaksi.
- Status selalu memakai ikon dan label, tidak hanya warna.

## Pola yang dipakai ulang (bangun sebagai komponen dulu)

- **Shell admin:** sidebar 248 (Dashboard, Creator, User, Log & History, AI, Pengaturan), topbar 84 (breadcrumb, judul, identitas admin, Logout). Tablet: sidebar menjadi rail 80. Mobile: tanpa sidebar.
- **Tabel data:** pencarian, filter (dropdown), Reset Filter, header sortable dengan panah arah, paginasi (1 2 3 … N), "Baris per halaman" 10/25/50, "Menampilkan a–b dari N hasil", tombol View di setiap baris, kolom identitas dan aksi tetap terlihat saat scroll horizontal. State: loading (skeleton), kosong, tidak ada hasil, error dengan Coba Lagi (lihat `AdmTableStates`). Filter dan sort bertahan saat kembali dari detail; ganti filter mengembalikan ke halaman 1.
- **Dialog aksi:** judul, kotak identitas target, akibat spesifik, Batal, tombol dengan kata kerja jelas, state memproses (cegah klik ganda), toast berhasil atau gagal. Alasan wajib untuk tolak, block, cabut, dan perubahan sensitif. Tanpa dialog untuk View, cari, filter, sort, paginasi, ganti tab, membuka form.
- **Chip status**, **kartu statistik**, **grafik** (judul, legenda, satuan, tooltip, state kosong), **kv-list** (label: nilai) di halaman detail, **tab** (garis bawah rose), **toast** (kanan atas, gelap).

## Alur prototipe (klik di `html/`, mulai dari `AdmMain.html`)

1. Login → Dashboard: `AdmLogin` → `AdmDashboard`.
2. Request → Detail → Setujui → Active: `AdmCreators` → `AdmCrReq` → `AdmDlgApprove` → `AdmCrApproved`. Varian gagal karena langganan aktif: `AdmDlgApproveFail`. Tolak: `AdmDlgReject` → `AdmCreatorsToastRej`.
3. Active → Block → Blocked: `AdmCrActive` → `AdmDlgBlock` → `AdmCrBlockedDone`. Unblock: `AdmCrBlocked` → `AdmDlgUnblock`.
4. User → Detail → Berikan atau perpanjang akses: `AdmUsers` → `AdmUserSummary` → `AdmUserSubs` → `AdmDlgGrant`/`AdmDlgExtend`/`AdmDlgRevoke`.
5. AI Usage → permintaan gagal: `AdmAiUsage` → `AdmAiReqFail`.
6. Pengaturan → Edit → Konfirmasi → Berhasil: `AdmSetGeneral` → `AdmSetEdit` → `AdmDlgSetSave` → `AdmSetSaved`.

Detail dari baris daftar memakai contoh representatif (Maya = Request, Salsa = Active, Citra = Blocked, Raka = User). Pada implementasi, detail memuat data sesuai ID baris.

## Saran rute dan pemetaan

| Rute | Board acuan |
|---|---|
| /login | AdmLogin |
| / (dashboard, `?period=today|7|30|custom`) | AdmDashboard, AdmDashToday, AdmDash30, AdmDashCustom, AdmDashEmpty |
| /creators | AdmCreators |
| /creators/:id (tab ringkasan, subscribers, gallery, persona, history) | AdmCrActive, AdmCrReq, AdmCrBlocked, AdmCrSubs, AdmCrGallery, AdmCrPersona, AdmCrHistory |
| /creators/:id/gallery/:mediaId | AdmMediaDetail |
| /users, /users/:id (tab ringkasan, subscriptions, creator-request, history) | AdmUsers, AdmUserSummary, AdmUserSubs, AdmUserRequest, AdmUserHistory |
| /users/:id/subscriptions/:subId, /users/:id/requests/:reqId | AdmSubDetail, AdmReqDetail |
| /logs/(audit|system|notifications|access), /logs/:id | AdmLogAudit, AdmLogSystem, AdmLogNotif, AdmLogAccess, AdmLogDetail, AdmLogNotifFail |
| /ai/(overview|usage|config|history), /ai/requests/:id, /ai/history/:id | AdmAiOverview, AdmAiUsage, AdmAiConfig, AdmAiHistory, AdmAiReqOk, AdmAiReqFail, AdmAiHistDetail |
| /settings/(general|telegram|media|notifications|account), /settings/sessions/:id | AdmSetGeneral, AdmSetTelegram, AdmSetMedia, AdmSetNotif, AdmSetAccount, AdmSessDetail |

Mini App: customer Chat / Jelajahi / Langganan / Profil (`Chats`, `Explore`, `Subscriptions`, `Profile`); creator Inbox / Galeri / Broadcast / Pengaturan (`CrInbox`, `CrGallery`, `CrBroadcast`, `CrSettings`). Layar login, profil, edit profil, dan permintaan jadi creator: `Auth*`, `Profile*`, `EditProfile`, `CreatorRequest*`, `Request*`.

## Data sampel (fiktif, konsisten)

Total user aktif 1.248; creator aktif 14; permintaan menunggu 3 (Maya Lestari, Raka Putra, Luna Aurora); langganan aktif 412 (jumlah subscriber 14 creator aktif); daftar creator 19 baris (contoh: Salsa 58 subscriber, Kirana 46, Dinda 41). Raka Putra sengaja punya 1 langganan aktif sehingga persetujuannya gagal. Gunakan sebagai seed.
