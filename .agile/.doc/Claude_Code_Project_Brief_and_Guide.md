# Telegram Creator Chat — Project Brief & Claude Code Guide

Versi konsolidasi: 14 November 2026
Pemilik proyek: Pandu. Nama produk final belum ditentukan.

## 0. Instruksi awal untuk Claude Code

Anda membantu mengimplementasikan aplikasi ini dari desain yang telah dibuat di Claude Design. Baca dokumen ini secara utuh, lalu periksa repository dan seluruh export desain yang diberikan pengguna sebelum mengubah kode.

**Desain visual 100% mengikuti hasil Claude Design yang disediakan pengguna.** Jangan membuat ulang arah desain, mengganti layout, menambahkan design system alternatif, atau menghasilkan interpretasi visual baru. Gunakan source, komponen, aset, font, ikon, copy, spacing, warna, responsivitas, dan interaksi desain yang tersedia. Sambungkan UI tersebut ke implementasi nyata.

Dokumen ini belum menyertakan file export desain. Jangan mengklaim telah melihat, memverifikasi, atau mengimplementasikan desain sebelum export/source benar-benar tersedia. Jika belum ditemukan setelah memeriksa repo, minta lokasi/export Claude Design; pekerjaan backend yang tidak tergantung desain dapat dilanjutkan.

Prioritas saat ada konflik:
1. Instruksi terbaru pengguna.
2. Aturan produk terbaru dalam dokumen ini.
3. Export Claude Design sebagai sumber kebenaran visual.
4. Dokumen/brief lama.

Jika export memuat fitur yang sudah dibatalkan, jangan membangun fitur lama. Catat konflik dan sesuaikan bagian minimum dengan pola visual yang sama. Jika layar yang diperlukan belum didesain, jangan mengarang layar final; sampaikan gap spesifik dan lanjutkan pekerjaan independen.

Jangan menganggap file ini sebagai permintaan deployment produksi. Kerjakan lokal/development sampai ada instruksi deployment. Jangan mengisi kredensial nyata, memanggil AI berbayar untuk pengujian, atau mengirim broadcast nyata tanpa konfigurasi dan otorisasi yang sesuai.

## 1. Ringkasan produk

Telegram Mini App untuk private chat dengan creator/influencer. Creator dapat berupa orang asli atau karakter AI dari Instagram. Pilot sudah memiliki tiga calon creator asli.

Satu pelanggan dapat berlangganan ke banyak creator. Setiap pasangan pelanggan–creator mempunyai ruang chat, akses, dan memori AI yang terpisah. Creator membalas manual atau menggunakan AI yang dipersonalisasi. Creator memiliki galeri khusus subscriber dan dapat mengirim media dalam chat maupun broadcast.

Bot Telegram adalah pintu masuk, penghubung deep link, serta pengirim notifikasi. Mini App menampung UI pelanggan/creator. Admin menggunakan dashboard web terpisah.

## 2. Scope MVP dan keputusan bisnis

| Bagian | Keputusan |
|---|---|
| Pembayaran | Tidak ada pada MVP |
| Aktivasi/perpanjangan akses | Dikelola admin dengan tanggal mulai/berakhir |
| Pilot | Rencana gratis 14 hari; bukan grant otomatis tanpa persetujuan admin |
| Harga rencana | Rp79.000/bulan per creator, hipotesis untuk validasi berikutnya |
| Revenue share rencana | Creator 70%, platform 30% dari pendapatan bersih; belum diimplementasikan |
| Role | Satu akun Telegram, satu role |
| Creator | Diajukan user, disetujui admin |
| Media | Satu galeri; upload chat privat; upload broadcast opsional simpan galeri |
| Scheduling media | Dibatalkan, tidak dibangun |

Tidak membangun checkout, wallet, koin, tip, payout, komisi aktif, pembelian media satuan, bundling, panggilan, voice note, live stream, marketplace creator terbuka tanpa review, atau segmentasi broadcast.

Harga dan bagi hasil bukan aturan penagihan. Bila pembayaran ditambahkan kelak, evaluasi kembali persyaratan Telegram yang berlaku saat itu.

## 3. Role, akun, dan autentikasi

### User/pelanggan

Semua akun baru otomatis mempunyai role USER. User dapat menjadi subscriber banyak creator; subscriber adalah status akses per creator, bukan role global tambahan.

Login hanya melalui Telegram. Halaman login mempunyai tombol Lanjutkan dengan Telegram. Dalam Mini App, server memvalidasi initData dan menerbitkan sesi aplikasi. Di luar Telegram, tampilkan Buka di Telegram yang menuju bot; jangan membuat login website Telegram alternatif pada MVP.

Telegram user ID adalah identitas permanen, bukan username yang dapat berubah. Simpan sebagai bigint dan serialisasikan string pada API. Nama/foto Telegram menjadi nilai awal profil aplikasi. Edit profil aplikasi tidak mengubah akun Telegram.

### Creator

Role CREATOR diberikan admin setelah menyetujui permintaan. Akun yang sama berganti role, bukan membuat akun baru. Tidak ada mode pelanggan untuk creator dan tidak ada role switcher. Creator tidak dapat subscribe ke creator lain pada MVP.

### Admin

Identitas admin berada pada sistem/tabel terpisah. Login menggunakan username/password; backend menerbitkan JWT. Tidak ada registrasi admin publik. Pembuatan admin awal melalui CLI/seed yang aman, bukan password default pada repo.

Password hash Argon2id; access token berumur pendek, refresh token berotasi dan dapat dicabut. Cookie Secure/HttpOnly dengan konfigurasi SameSite, origin/CORS, dan CSRF yang sesuai topologi deployment. Jangan menyimpan token admin di localStorage. Semua API memeriksa role/ownership, bukan hanya menyembunyikan menu.

### Validasi Telegram

Validasi signature, auth_date/max age, dan payload initData di backend. Jangan percaya initDataUnsafe, username, query string, role atau user ID yang dikirim client tanpa validasi. Jangan mencatat token bot/initData mentah ke log. Sesi lama harus kehilangan privilege setelah block/perubahan role; cek status akun dan session version pada akses sensitif/socket.

## 4. Entry flow dan navigasi

Bio Instagram → link bot dengan pengenal creator → Start bila diperlukan → tombol Buka Profil → Mini App login → profil creator yang dituju.

Pola link ilustratif: https://t.me/<bot_username>?start=c_<public_code>. Nilai asli belum ditentukan. Parameter hanya memilih tujuan, tidak memberi hak akses. Simpan tujuan melewati login. Link invalid menampilkan profil tidak tersedia dan arah ke Jelajahi.

Menu bot tanpa tujuan membuka Chat bagi USER dan Inbox bagi CREATOR. Creator membuka link creator lain tidak memperoleh role USER; tampilkan penjelasan singkat dan kembali ke workspace creator.

URL web Mini App tidak dipromosikan, tetapi tidak dapat dianggap rahasia. Keamanan berasal dari autentikasi dan pemeriksaan akses.

Navigasi pelanggan: Chat, Jelajahi, Langganan, Profil.
Navigasi creator: Inbox, Galeri, Broadcast, Pengaturan.
Tidak ada onboarding/carousel: rancangan onboarding sebelumnya dibatalkan dan diganti halaman login serta edit profil.

## 5. Profil dan permintaan menjadi creator

User dapat mengedit foto aplikasi, nama tampil, dan bio opsional. Username Telegram read-only. Tidak meminta email, password, telepon, tanggal lahir, atau alamat.

Profil USER mempunyai Ajukan Jadi Creator. Form pengajuan:
- Nama creator, nilai awal dari nama tampil.
- Link Instagram yang divalidasi.
- Jenis HUMAN/AI_CHARACTER, label Creator Asli/Karakter AI.
- Deskripsi konten singkat.
- Pernyataan berhak mengelola identitas dan konten yang diajukan.

Status: belum mengajukan, pending, approved, rejected. Satu permintaan pending per user. Selama pending/rejected, role tetap USER. Penolakan menyimpan alasan dan memungkinkan pengajuan ulang tanpa menghapus history.

Aturan operasional yang telah dimasukkan ke brief desain: pengajuan diblokir selama masih memiliki langganan pelanggan aktif. Jelaskan alasannya; jangan mencabut akses otomatis. Pada approval, periksa ulang secara transaksional tidak ada subscription aktif. Setelah approved, role menjadi CREATOR dan bot mengirim hasil. Akses pelanggan berikutnya harus ditolak untuk role CREATOR.

Jika ada akses pelanggan dijadwalkan di masa depan, jangan membiarkannya aktif setelah promosi: minta admin menyelesaikannya sebelum approval. Simpan history lama tanpa membuka kembali mode pelanggan.

## 6. Akses langganan tanpa pembayaran

Admin dapat memberikan, memperpanjang, atau mencabut akses USER ke CREATOR. Simpan tanggal mulai/berakhir dan event history dengan alasan.

Akses aktif jika starts_at <= waktu server < ends_at, tidak direvoke, dan akun/creator aktif. UI bukan otoritas masa aktif. Pemeriksaan juga diterapkan saat mengirim pesan, menghasilkan AI, mengakses media galeri, dan dispatch broadcast.

CTA pelanggan non-subscriber adalah Minta Akses Uji Coba; form sederhana membuat access request pending untuk admin. Ini berbeda dari permintaan role creator. Saat expiry, CTA Minta Perpanjangan Akses membuat permintaan yang sesuai. Jangan membuat checkout palsu.

| Kemampuan | Aktif | Belum aktif / berakhir |
|---|---|---|
| Profil creator | Terlihat | Terlihat |
| Galeri | Media penuh | Tidak ada media/thumbnail, panel khusus subscriber |
| Mengirim chat | Ya | Tidak |
| Membaca pesan yang sudah diterima | Ya | Ya, selama akun tidak diblokir |
| Membuka lampiran chat yang sudah diterima | Ya | Ya, kecuali dihapus/ditarik secara sah |
| Menerima broadcast baru | Ya | Tidak |

Block akun menghalangi sesi dan operasi akun, berbeda dari expiry subscription. Block creator menghentikan aktivitas/AI/broadcast baru dan menyembunyikannya dari penemuan; history yang sudah diterima user lain tidak otomatis dihapus.

## 7. Chat manual dan AI

Satu conversation unik per USER–CREATOR. Pelanggan mengirim teks pada MVP. Creator mengirim teks, foto, video. History tersimpan, cursor pagination, unread, timestamp, status sending/failed dan retry.

Mode conversation AI atau MANUAL. Creator Ambil Alih menghentikan AI; mengirim pesan manual otomatis mengambil alih. Aktifkan AI adalah tindakan eksplisit; tidak ada aktivasi ulang otomatis berdasarkan waktu.

AI mengikuti gaya bahasa, contoh percakapan, fakta yang diizinkan, serta batas topik creator. Konteks mencakup pesan terbaru, ringkasan lama, dan memori khusus pasangan. Tidak boleh berbagi memori antarcreator atau mengarang kegiatan nyata/janji pertemuan.

Sisi pelanggan tidak menampilkan badge AI/manual tiap pesan. Deskripsi layanan menjelaskan kemungkinan bantuan AI. Sisi creator boleh menampilkan sumber pesan AI/Manual/Broadcast sebagai metadata internal.

### Race condition dan persistensi

Simpan pesan sebelum acknowledgement/realtime. Gunakan client_message_id unik untuk retry. Job AI serial per conversation dan idempoten. Mode change menaikkan response_version. Sebelum commit AI, transaksi mengunci conversation dan memeriksa mode, version, status akun, serta subscription. Job kedaluwarsa tidak boleh mengirim respons setelah creator mengambil alih.

Takeover dan send manual harus atomik; pesan baru yang tiba selama proses AI memperbarui konteks/version sesuai strategi yang konsisten agar balasan tidak memakai snapshot usang. Jangan mengandalkan pembatalan queue saja.

Provider/model AI belum dipilih; gunakan adapter. Tidak perlu vector database pada MVP. Simpan persona berversi, ringkasan dan memori di PostgreSQL. Catat token, model, biaya estimasi, latency, dan outcome tanpa mencatat isi chat pada log operasional.

Kegagalan AI muncul di inbox creator dengan retry/balas manual. Jangan membuat balasan palsu. Riwayat tidak hilang saat socket disconnect; reconnect mengambil pesan melalui HTTP.

## 8. Media — aturan final, menggantikan seluruh aturan lama

### A. Galeri creator

Creator upload foto/video langsung ke satu galeri. Media galeri hanya terlihat subscriber aktif. **Tidak ada galeri blur atau thumbnail media bagi non-subscriber.** Tampilkan panel Galeri tersedia untuk subscriber aktif tanpa daftar media tersembunyi.

### B. Media chat

Attachment: Pilih dari Galeri atau Upload Baru.
- Pilih galeri: referensi file yang sama, tanpa duplikasi.
- Upload baru: hanya tersimpan sebagai lampiran dalam history percakapan itu; tidak masuk galeri dan tidak tersedia bagi pelanggan lain.
- Memori chat di konteks ini berarti penyimpanan lampiran/history, bukan RAM dan bukan memori persona AI.
- Preview dan caption opsional sebelum Kirim.

### C. Media broadcast

Pilih dari Galeri atau Upload Baru.
- Pilih galeri: file yang sama; tidak tampilkan checkbox simpan galeri.
- Upload baru: checkbox Simpan juga ke galeri, default tidak dicentang.
- Dicentang: satu file digunakan broadcast dan galeri.
- Tidak dicentang: hanya muncul pada pesan broadcast masing-masing penerima; tidak ada item galeri.
- Preview, caption opsional, konfirmasi kirim ke seluruh subscriber aktif, lalu feedback hasil singkat.

### D. Batas kesederhanaan

Tidak ada pustaka terpisah, publikasi, draft produk, arsip, scheduling, kalender, pilihan target publikasi, segmentasi broadcast, atau analytics media terperinci. Technical upload/processing state boleh ada agar aplikasi andal, bukan fitur editorial baru.

Tidak menambahkan hapus permanen/media moderation UI tanpa kebutuhan yang disepakati atau tampak pada desain; internal lifecycle tetap harus menghindari file yatim dan file yang terhapus saat masih direferensikan.

### E. Storage dan deduplikasi

Cloudflare R2 private bucket. PostgreSQL menyimpan satu MediaAsset untuk setiap upload dan referensi penggunaan. Menggunakan ulang dari galeri menambah relasi, bukan copy object. Broadcast memakai satu object untuk banyak message penerima. Tidak perlu global content-hash dedup antar-upload atau antarcreator pada MVP.

Tidak ada satu boolean public pada file untuk menggantikan hak akses. Media asli boleh dibaca jika pemilik creator, subscriber aktif yang mengakses gallery membership, atau penerima pesan yang sah. Setelah gallery access habis, message attachment yang sudah diterima tetap memberi hak baca pada file itu.

Signed URL berumur pendek baru diterbitkan setelah pemeriksaan akses; jangan simpan URL sementara sebagai identitas file. Validasi kepemilikan asset sebelum attach. Private chat upload tidak dapat ditebak lalu ditempel pengguna lain. Tidak mengekspos object key/URL asli melalui endpoint non-subscriber.

Validasi MIME nyata, ukuran, dan tipe file; jangan mengandalkan ekstensi client. Upload pending difinalisasi setelah verifikasi dan dibersihkan jika terbengkalai. Gunakan poster video/thumbnail teknis; bukan preview blur. Batas ukuran/durasi perlu mengikuti konfigurasi admin dan konfirmasi saat implementasi, bukan asumsi yang disembunyikan.

R2 bukan layanan transcoding. Sharp/FFmpeg dapat dipakai server-side untuk thumbnail/poster dan pemeriksaan format jika diperlukan. HLS/transcoding adaptif belum scope.

## 9. Broadcast dan notifikasi Telegram

Broadcast hanya ke seluruh subscriber aktif creator. Tidak ada jadwal. Konfirmasi sebelum dispatch. Snapshot penerima saat dispatch dimulai; periksa ulang akses sebelum delivery. Buat satu message per conversation, ditautkan ke broadcast. Balasan pelanggan privat. Broadcast tidak otomatis memicu respons AI sampai pelanggan membalas.

Tidak ada UI campaign kompleks. Namun backend tetap mencatat recipient states untuk retry aman dan mencegah message ganda. Progress/hasil cukup ringkas mengikuti desain.

Bot memberi notifikasi pesan baru, broadcast, aktivasi akses, pengingat expiry, expiry, dan hasil pengajuan creator. Deep link mengarah ke target dan diperiksa setelah login.

Gabungkan pesan beruntun, mute per creator, opsi sembunyikan preview (default tersembunyi), dan hindari notifikasi bila chat sedang aktif terlihat menurut presence yang masih fresh. Hormati Telegram retry_after/backoff dan tandai bot blocked tanpa infinite retry.

Pisahkan keberhasilan message tersimpan di aplikasi dari notifikasi bot. Notifikasi gagal tidak menghapus message. Idempotency menjamin satu message database per recipient, tetapi jangan mengklaim exactly-once eksternal jika timeout Telegram ambigu.

## 10. UI pelanggan dan creator

### Pelanggan

Login; Chat list; Jelajahi creator; Profil creator; Galeri subscriber; Private chat; Langganan; Profil; Edit profil; Request creator; Status request; pengaturan notifikasi; media viewer. Tidak ada onboarding lama, pembayaran, blur gallery, atau role switcher.

### Creator

Inbox dan filter sesuai desain; Conversation dengan kontrol AI/manual; detail pelanggan/ringkasan/memori; Galeri sederhana; media picker/upload; composer broadcast sederhana; profil dan persona AI; link bot untuk bio. Semua perubahan media mengikuti bab 8.

### Sumber visual

Palet historis: 60% #FFF9FB, 30% #F5DCE5, 10% #A83F67, teks #30252C/#75636D. Nilai ini konteks, bukan izin menimpa hasil final Claude Design. Gunakan tokens/font/components aktual dari export. Pertahankan safe area Telegram, keyboard, Back, scroll, viewer dan mobile responsiveness. Jangan memaksa library UI menggantikan komponen desain.

## 11. Dashboard web admin

### Login

Username/password, show/hide, validation/loading/error, tidak ada registrasi publik.

### Dashboard

Ringkasan user aktif, creator aktif, request pending, subscription aktif, pesan periode, estimasi biaya AI. Grafik pertumbuhan akun, pesan manual vs AI, token/biaya, subscriber aktif. Periode hari ini/7/30/custom; unit dan legend jelas. Tidak ada revenue/payment charts.

### Creator list

Label REQUEST, ACTIVE, BLOCKED. Request adalah aplikasi pending milik USER, bukan role CREATOR sebelum approval. Implementasikan list sebagai projection creator applications + creator accounts tanpa mengubah role lebih awal.

Kolom identitas, Telegram, Instagram, jenis, status, subscriber aktif, tanggal, View. Filter status/jenis/tanggal/search, sort, pagination. Request: approve/reject; Active: block; Blocked: unblock. Rejected tidak dipalsukan menjadi blocked, melainkan history pengajuan yang terlihat dari user/log.

### User list

Akun role USER saja, status ACTIVE/BLOCKED, Telegram, langganan aktif, status creator application, tanggal, View. Filter, sort, pagination. Creator approved berpindah daftar.

### Creator detail

Identitas, status, aplikasi, action kontekstual; ringkasan; subscriber table dengan grant/extend/revoke dan View user; gallery table dengan View media; persona AI; history table dengan View log. Default tidak menampilkan seluruh private chat/lampiran privat admin.

### User detail

Identitas, status, block/unblock; ringkasan; subscriptions table dan View subscription; grant/extend/revoke; creator applications dan View application; history dan View log. Tidak ada chat surveillance default.

### Log & History

Audit admin, aktivitas sistem, notifikasi, perubahan akses. Detail memuat aktor, target, waktu/zona, alasan, before/after aman, request ID. Audit append-only, tidak bisa diedit/dihapus lewat UI. Retry hanya tugas gagal yang aman. Rahasiakan credentials dan isi chat.

### AI

Overview: requests, tokens, estimasi biaya, failures, latency dan grafik. Usage table per creator/provider/model/status/periode, View detail request metadata. Konfigurasi provider/model, masked key tanpa reveal, output token cap, timeout/retry, budget/limits, test connection, save. Configuration history table dan View detail. Global config tidak mengaktifkan ulang conversation manual. Biaya selalu ditandai estimasi dengan sumber tarif dan waktu; jangan mengarang tarif provider.

### Pengaturan

Umum (nama/logo/zona admin), Telegram (bot username/token masked/status/test), Media (R2 bucket/koneksi/secret masked/upload limits/test), template notifikasi/access reminders, akun admin (password dan active sessions table + View/revoke). Tidak ada media scheduling/payments/payout.

Rahasia yang disimpan dari UI admin dienkripsi dengan master key environment, tidak sekadar masked di frontend. Form edit secret kosong berarti pertahankan nilai lama, bukan menimpa dengan string bintang. Gunakan credential storage abstraction; platform tidak membocorkan nilai lewat read API.

### Semua tabel

Search relevan, filters, column sort, pagination 10/25/50, total/rentang hasil, Reset Filter, View pada setiap row menuju detail page nyata, loading/empty/no-results/error/retry. Pertahankan filter/sort ketika kembali dari detail; reset page ketika filter berubah. Gunakan server-side query dan sort allowlist, bukan memuat semua data lalu filter client.

Semua halaman detail turunan yang dibutuhkan View harus tersedia. Form bukan alasan membuat tabel dekoratif pada setiap halaman; aturan tabel berlaku untuk daftar data yang memang bertabel. Pada mobile gunakan scroll yang wajar dan aksi mudah ditemukan.

### Dialog/confirmation

Semua mutasi data/akses/config, retry/test operasional, revoke session, logout memakai confirmation/alert: target jelas, konsekuensi, Batal, confirm verb spesifik, in-flight disable dan feedback. Reject/block/revoke akses dan perubahan sensitif mencatat alasan. View/search/filter/sort/page/tab bukan mutasi dan tidak perlu dialog. Validasi/login gagal memakai inline error/alert, bukan konfirmasi sebelum setiap keystroke atau login.

## 12. Stack dan struktur implementasi

Stack yang disepakati:
- TypeScript end-to-end.
- Mini App: React + Vite.
- Admin: React + Vite aplikasi terpisah.
- UI: pertahankan export Claude Design; Tailwind/shadcn hanya bila cocok dengan source, bukan rewrite wajib.
- API: NestJS + Fastify.
- PostgreSQL + Prisma.
- Socket.IO untuk realtime.
- BullMQ + Redis untuk background jobs.
- grammY untuk bot Telegram.
- Cloudflare R2 untuk media.
- pnpm workspaces, Docker Compose.

Jangan memilih versi dari ingatan; cek dokumentasi resmi dan compatibility pada saat scaffold, pin versi dan lockfile. Hindari install latest tanpa verifikasi API lintas package.

Repo rancangan (adaptasikan dengan source yang ada, jangan buang export):
```
apps/miniapp
apps/admin
apps/api
apps/worker
packages/db
packages/contracts
packages/ui
packages/backend-core
infra
```

Modular monolith; API dan worker proses terpisah dengan shared service yang eksplisit, bukan microservices. Worker memproses AI, thumbnail/poster, broadcast, notifikasi, dan pengingat/expiry akses. Pengingat akses bukan fitur scheduling media.

Development: Node apps via pnpm; hanya PostgreSQL/Redis melalui Docker Compose. Pengguna familiar konsep Docker tetapi belum menggunakannya; README harus memberikan langkah konkret. Production Compose dapat menjalankan semua komponen nanti, tanpa deployment otomatis.

## 13. Model data yang disarankan

Nama dapat disesuaikan, aturan wajib dipertahankan. UUID internal, timestamps UTC/timestamptz, timezone IANA untuk tampilan. Gunakan enum/status yang eksplisit.

| Entity | Tujuan dan constraint |
|---|---|
| User | telegram_id UNIQUE, role USER/CREATOR, status ACTIVE/BLOCKED, profile, session_version |
| AdminAccount | username UNIQUE, password_hash, status |
| Session | owner user/admin eksklusif, hashed refresh token, expiry/revoke |
| CreatorApplication | user, Instagram/type/name/description, PENDING/APPROVED/REJECTED, review reason/admin/time; satu pending per user |
| Creator | user_id UNIQUE, slug/public_code UNIQUE, bio/type/status, current persona |
| AccessRequest | customer/creator, TRIAL/RENEWAL, PENDING/APPROVED/REJECTED, review details |
| Subscription | customer/creator UNIQUE, starts/ends/revoked; current entitlement |
| SubscriptionEvent | append-only grant/extend/revoke with dates/admin/reason |
| Conversation | customer/creator UNIQUE, mode, response_version, last message |
| ConversationRead | participant/conversation UNIQUE, read cursor |
| Message | conversation, sender/origin, body, client_message_id, ai_job_key, broadcast ref, reply ref |
| MediaAsset | creator owner, R2 key UNIQUE, metadata, technical upload state, thumbnail/poster refs |
| GalleryItem | creator + asset UNIQUE, added_at; only explicitly gallery uploads or broadcast opt-in |
| MessageAttachment | message + asset, order; persists read entitlement for receiver |
| Broadcast | creator, text, media refs, immediate dispatch status, timestamps; NO scheduled_at |
| BroadcastRecipient | broadcast/customer UNIQUE, delivery status, message ref, retries |
| CreatorPersonaVersion | creator/version UNIQUE, style/facts/boundaries/examples |
| ConversationMemory | conversation/key UNIQUE, value/source/correction |
| ConversationSummary | conversation UNIQUE, through_message cursor, content/version |
| NotificationPreference | global/user-per-creator mute and preview options |
| NotificationDelivery | dedupe key UNIQUE, type/user/ref/status/attempts/Telegram ID |
| OutboxEvent | durable handoff of committed business events to jobs |
| AIUsage | unique job key, provider/model/token/estimate/latency/outcome |
| AIConfigurationVersion | config/history, encrypted credential refs, limits |
| AppSettings | typed nonsecret settings and encrypted secret references |
| AuditLog | append-only actor/action/target/reason/sanitized changes/request ID |

Schema must enforce unique idempotency keys for user message sends, AI results, and broadcast recipient delivery. FK ownership checked on all media/creator operations. Validate role relationships transactionally; do not assume cross-table role checks happen via TypeScript type alone.

Index message history by (conversation_id, created_at, id); lists by creator/status/time; subscriptions by creator/ends_at; notification/outbox pending by status/time. Add indexes based on actual query paths. Avoid speculative tables for cancelled features.

Gallery membership and message attachment references are separate from MediaAsset. Removing a membership must not delete a still-referenced file. Never use upload location alone as authorization.

## 14. Backend contracts and reliability

HTTP /v1 with runtime request validation, consistent errors code/message/request_id, safe pagination limits and stable cursors. Separate /admin scope with independent auth guards.

Areas: Telegram auth/me/profile; creators/explore; creator applications; access requests/subscriptions; conversations/messages/read; media upload/complete/access; gallery; immediate broadcasts; persona/memory; notification preferences; admin accounts/creators/users/access/audit/AI/config/settings.

Messages written via HTTP; Socket.IO sends committed events message.created, conversation.updated, read.updated, typing.changed, broadcast progress if required by design. Room membership server-derived. Revalidate account status and ownership on join/operations. Presence ephemeral, not a message table.

Use database outbox to bridge commit and queue enqueue. Reconciler/retry recovers pending outbox events. Worker idempotency protects against duplicate execution. Broadcast/message writes are transactional per recipient. Do not rely on Redis as durable chat store or assume queue success equals business success.

Validate Telegram webhook secret and keep webhook handler quick. Never let an untrusted user cause requests to arbitrary URLs through test connection/media fetching; configs/providers/endpoints need allowed shapes and admin permissions.

## 15. Security and data handling

Check user/creator status, role, tenant ownership and active entitlement on every applicable operation, including signed URL issuance and socket subscriptions. Test IDOR with changed identifiers. No public R2 bucket. Do not put bot/provider/storage credentials in frontend VITE variables.

Rate-limit login, message sends, uploads, AI enqueue and admin auth attempts. Apply payload limits and parameterized database queries. Sanitize log fields; no raw passwords/keys/chat/initData. Content text rendered as text, not untrusted HTML.

Give request/audit correlation IDs. Report aggregate metrics without storing extra intimate profiling. Users can ask for memory correction/deletion through a supported flow; final retention/account deletion policies need owner confirmation before public launch. Do not promise permanent media access against deletion/moderation requirements.

Back up PostgreSQL off-host, define R2 retention separately, test restore. Database/Redis are not exposed publicly. TLS and explicit allowed origins required for Telegram access. Admin endpoints do not become public simply because the URL is hard to discover.

## 16. Development workflow for Claude Code

1. Inspect repo, instructions, package manager, existing lockfile and Claude Design export. Do not overwrite user work.
2. Inventory screens and components; map them to roles and API needs. List specific mismatches with latest media/auth rules.
3. Preserve visual implementation, extract only necessary reusable pieces. Replace mock data progressively with typed API clients.
4. Create env examples and local Compose for PostgreSQL/Redis with persistent volumes. Add healthchecks and setup instructions.
5. Implement migrations and explicit seed fixtures. Development admin seed requires supplied secret or generated local password handled safely.
6. Build auth/role/access foundations before connecting sensitive screens.
7. Implement vertical slices (UI → API → database → verification), not many disconnected placeholder endpoints.
8. Commit migrations and lockfile. Keep secrets and generated local data outside git. Do not run destructive migrations/reset on an unknown database.
9. After each slice, run relevant checks and report changed behavior, verification, and remaining blockers. Do not claim production-ready just because build passes.
10. Stop short of live deployment until instructed; provide concrete local run steps and integration needs.

### Phases

A. Foundation: workspace, export integration, database, Telegram auth/bot entry, admin login, roles.
B. Profiles and applications: edit profile, creator request/review, list/detail admin, block/unblock.
C. Access/manual chat: trial/renew requests, admin grant/expiry, persisted chat/realtime/unread.
D. Media: R2, gallery entitlement, private chat upload, reuse without duplicates, broadcast save toggle.
E. Broadcast/notifications: immediate fan-out, retries/idempotency, deep links/mute.
F. AI: persona, memory/summary, usage, safe manual takeover.
G. Admin completion: relevant charts, server-side tables, detail routes, audit/config/settings.
H. Pilot hardening: Telegram device QA, failure recovery, backup restore, access-isolation tests.

## 17. Verification and acceptance

Run typecheck/lint/build and targeted tests suitable for changed behavior. Prioritize meaningful integration/concurrency checks, not tests that merely mirror a getter.

Required behavior checks:
- Forged/stale Telegram auth rejected; admin password auth independent.
- All new accounts USER; pending creator request does not elevate role.
- Approval converts same account, prevents active/future customer entitlement conflicts, invalidates stale role access.
- USER cannot access other users' messages, creator endpoints, admin endpoints, or private media by changing IDs.
- One user can access A and B while histories/memories stay separated.
- Expiry locks sending/gallery while preserving received attachments.
- Non-subscriber receives no gallery thumbnails/original URLs, not CSS blur.
- Chat upload never enters gallery; broadcast opt-in controls one gallery reference; gallery reuse does not duplicate object.
- AI result cannot commit after manual takeover or revoked access.
- Message/broadcast retries create one persisted message per intended delivery.
- Bot notification failure does not hide message; blocked bot handled.
- Admin list filters/sort/pagination actually affect backend results; View routes render real detail.
- Mutations require designed confirmations; errors preserve entered data.
- Settings never return stored secret plaintext; masked placeholders never overwrite secrets.
- Reconnect retrieves missed messages; media upload errors recover without orphan leaks.
- Database backup restores successfully before pilot.

Visual QA against supplied Claude Design on customer/creator mobile widths and admin desktop/tablet. Check exact layout/assets, keyboard/safe area, loading/empty/error, overflow and navigation. Screenshot comparison may be used locally; don't claim pixel fidelity without reviewing rendered pages.

No default test may call paid AI, send to real subscriber audiences, or write/delete production R2 data. Use adapters/fakes and isolated test data; use actual integration only when configured explicitly.

## 18. Environment and operations guide requirements

Provide README and .env.example with placeholders, explanations and scope (server vs client). Needed categories:
- Database and Redis URLs.
- Bot token, webhook secret, bot username, Mini App URL.
- API/admin/miniapp allowed origins.
- Separate token signing/session secrets.
- R2 account endpoint, bucket, access key, secret key.
- AI provider/model/key only when selected.
- Master encryption key for secrets saved via dashboard.
- Log level and development mode.

Do not expose secret values through diagnostics. Explain development HTTPS/tunnel is needed to exercise actual Telegram webhooks/Mini App, but do not pick/publish a tunnel automatically. Deterministic local fixtures can support UI development; no auth bypass in production.

Basic workflow should be documented using repo scripts, for example:
```
pnpm install
docker compose up -d postgres redis
pnpm db:migrate
pnpm dev
```
These are target commands to implement, not commands guaranteed to exist before inspecting/scaffolding repo. Do not use docker compose down -v in routine stop instructions; volumes contain user data.

## 19. Open inputs, not invented decisions

- Actual Claude Design export/source location and final screen set.
- Product name, domain, bot username/token and deployment URLs.
- VPS and TLS setup.
- R2 bucket/credentials.
- AI provider/model, verified tariffs and budget.
- Exact upload size/format limits, reminder defaults, retention/privacy policies.
- Production credentials and initial admin identity.

Missing secrets do not block schema/UI/adapter work. Report what can run using local fixtures and what requires actual configuration.

## 20. Superseded decisions — do not implement

- Automatic creator role without application/review.
- Multi-role accounts or user/creator switcher.
- Creator onboarding carousel/setup flow replacing login.
- Automatic gallery insertion for chat uploads.
- Automatic gallery insertion for every broadcast upload.
- Blurred gallery visible to non-subscribers.
- Separate media library/publication/draft/archive workflow.
- Media scheduling/calendar.
- Broadcast recipient segmentation or detailed creator media analytics.
- Payment, payout, coins/tips or financial dashboards on MVP.

Earlier files named Telegram_Creator_MVP_Spec_v1.md, Claude_Design_Brief_Pastel_Pink_v1.md and Claude_Design_Brief_Creator_v1.md may contain these obsolete rules. This consolidated document supersedes their conflicting product requirements. Final Claude Design remains the visual reference subject to the latest product rules.

## 21. Suggested first response/action in a new Claude Code session

Read this brief and inspect the provided repo/export. Summarize the actual files and screen coverage found, identify only material gaps, and begin the foundation plus design integration. Ask for the Claude Design export only if it is unavailable. Preserve the design; do not redesign. Do not claim mock interactions are real integrations. Keep progress and remaining inputs explicit.
