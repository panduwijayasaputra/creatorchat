import {
  Avatar,
  Button,
  HourglassIcon,
  RefreshIcon,
  SearchInput,
  StatusChip,
  Switch,
} from '@creatorchat/ui';
import type { ReactNode } from 'react';
import { CREATOR_NAV, CUSTOMER_NAV } from '../app/nav-config';
import { BottomNav } from '../components/BottomNav';
import { PREVIEW_PALETTE, PREVIEW_UNREAD } from './fixtures';
import styles from './preview.module.css';

/** Development-only page: shared components and both bottom navs (not a product screen). */
export function Preview() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Pratinjau komponen</h1>
      <p className={styles.lead}>
        Halaman pengembangan untuk membandingkan komponen dengan board desain. Bukan bagian dari
        produk.
      </p>
      <div className={styles.grid}>
        <Card id="colors" title="Warna dan status">
          <div className={styles.palette}>
            {PREVIEW_PALETTE.map((c) => (
              <div key={c.hex} className={styles.swatchRow}>
                <span className={styles.swatch} style={{ background: c.hex }} />
                <div>
                  <div className={styles.swatchName}>{c.name}</div>
                  <div className={styles.swatchHex}>{c.hex}</div>
                </div>
              </div>
            ))}
          </div>
          <div className={styles.chips}>
            <StatusChip status="active" label="Aktif" />
            <StatusChip status="pending" />
            <StatusChip status="expired" label="Berakhir" />
            <StatusChip status="failed" />
          </div>
        </Card>
        <Card id="buttons" title="Tombol">
          <div className={styles.buttons}>
            <Button size="lg" fullWidth>
              Minta Akses Uji Coba
            </Button>
            <Button size="mobile" variant="secondary" fullWidth>
              Profil
            </Button>
            <Button size="mobile" variant="outline" fullWidth>
              Lihat Riwayat Chat
            </Button>
            <Button
              size="mobile"
              variant="secondary"
              fullWidth
              disabled
              icon={<HourglassIcon size={18} strokeWidth={2} />}
            >
              Menunggu Persetujuan
            </Button>
            <div className={styles.linkRow}>
              <Button variant="link" icon={<RefreshIcon size={18} strokeWidth={2} />}>
                Kirim Ulang
              </Button>
            </div>
          </div>
        </Card>
        <Card id="avatar-switch" title="Avatar dan switch">
          <div className={styles.buttons}>
            <Avatar size={72} />
            <Avatar size={96} />
            <Switch checked label="Notifikasi pesan" disabled />
            <Switch checked={false} label="Tampilkan isi pesan di notifikasi" disabled />
          </div>
        </Card>
        <Card id="inputs" title="Input">
          <SearchInput large aria-label="Cari nama creator" placeholder="Cari nama creator" />
        </Card>
        <Card id="bottom-nav" title="Bottom navigation">
          <div className={styles.navFrame} data-preview-section="bottom-nav-customer">
            <BottomNav
              label="Navigasi utama"
              items={CUSTOMER_NAV}
              unreadCount={PREVIEW_UNREAD}
              current="/chats"
            />
          </div>
          <div className={styles.navFrame} data-preview-section="bottom-nav-customer-explore">
            <BottomNav label="Navigasi utama (Jelajahi)" items={CUSTOMER_NAV} current="/explore" />
          </div>
          <div className={styles.navFrame} data-preview-section="bottom-nav-creator">
            <BottomNav
              label="Navigasi creator"
              items={CREATOR_NAV}
              unreadCount={PREVIEW_UNREAD}
              current="/inbox"
            />
          </div>
          <div className={styles.navFrame} data-preview-section="bottom-nav-creator-gallery">
            <BottomNav label="Navigasi creator (Galeri)" items={CREATOR_NAV} current="/gallery" />
          </div>
          <p className={styles.note}>
            Aktif: garis rose di atas item, ikon lebih tebal, label tebal. Tidak hanya warna.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={styles.card} data-preview-section={id}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {children}
    </section>
  );
}
