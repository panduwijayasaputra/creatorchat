import {
  Button,
  Card,
  CardTitle,
  ConfirmDialog,
  DataTable,
  EyeIcon,
  Field,
  KvList,
  PasswordInput,
  SearchInput,
  Select,
  StatusChip,
  Tabs,
  TableToolbar,
  TextInput,
  ToastProvider,
  UserSlashIcon,
  XIcon,
  useToast,
  type Column,
  type SortState,
} from '@creatorchat/ui';
import { useState, type ReactNode } from 'react';
import {
  PREVIEW_PALETTE,
  PREVIEW_ROWS,
  PREVIEW_STATUSES,
  type PreviewCreatorRow,
} from './fixtures';
import styles from './preview.module.css';
import { ReviewDialogsPreview } from './ReviewDialogsPreview';

/** Development-only page: every shared component in its designed states (not a product screen). */
export function Preview() {
  return (
    <ToastProvider>
      <div className={styles.page}>
        <h1 className={styles.heading}>Pratinjau komponen</h1>
        <p className={styles.lead}>
          Halaman pengembangan untuk membandingkan komponen dengan board desain. Bukan bagian dari
          produk.
        </p>
        <div className={styles.grid2}>
          <Section id="palette" title="Palet dan tipografi">
            <PaletteCard />
          </Section>
          <Section id="status-buttons" title="Status dan tombol">
            <StatusAndButtons />
          </Section>
        </div>
        <div className={styles.stack}>
          <Section id="inputs" title="Input">
            <Inputs />
          </Section>
          <Section id="tabs-kv" title="Tab dan daftar detail">
            <TabsAndKv />
          </Section>
          <Section id="toast-dialog" title="Toast dan dialog">
            <ToastAndDialogs />
          </Section>
          <Section id="creator-review" title="Dialog tinjau permintaan creator">
            <ReviewDialogsPreview />
          </Section>
          <TableSections />
        </div>
      </div>
    </ToastProvider>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card large data-preview-section={id}>
      <CardTitle>{title}</CardTitle>
      <div className={styles.sectionBody}>{children}</div>
    </Card>
  );
}

function Labeled({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div data-preview-section={id}>
      <div className={styles.label}>{title}</div>
      {children}
    </div>
  );
}

function PaletteCard() {
  return (
    <>
      <div className={styles.palette}>
        {PREVIEW_PALETTE.map((c) => (
          <div key={c.hex} className={styles.swatchRow}>
            <span className={styles.swatch} style={{ background: c.hex }} />
            <div>
              <div className={styles.swatchName}>{c.name}</div>
              <div className={styles.swatchNote}>
                {c.hex} · {c.note}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.muted}>Font Inter. Ikon outline. Radius 12 dan 16.</p>
    </>
  );
}

function StatusAndButtons() {
  return (
    <>
      <div className={styles.chips}>
        {PREVIEW_STATUSES.map((s) => (
          <StatusChip key={s} status={s} />
        ))}
      </div>
      <p className={styles.muted}>Status selalu memakai ikon dan label, tidak hanya warna.</p>
      <div className={styles.buttons}>
        <Button>Primer</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="danger">Bahaya</Button>
        <Button disabled>Nonaktif</Button>
        <Button variant="outline" icon={<EyeIcon size={16} strokeWidth={2} />}>
          View
        </Button>
      </div>
    </>
  );
}

function Inputs() {
  const [filter, setFilter] = useState('');
  return (
    <div className={styles.inputs}>
      <Field label="Username" hint="Gunakan username admin.">
        <TextInput placeholder="nadia.admin" autoComplete="username" />
      </Field>
      <Field label="Password">
        <PasswordInput defaultValue="rahasia123" autoComplete="current-password" />
      </Field>
      <Field label="Username" error="Username wajib diisi.">
        <TextInput />
      </Field>
      <div className={styles.row}>
        <SearchInput
          aria-label="Cari nama atau Telegram ID"
          placeholder="Cari nama atau Telegram ID"
        />
        <Select
          label="Status"
          value={filter}
          options={[
            { value: '', label: 'Semua' },
            { value: 'active', label: 'Active' },
            { value: 'blocked', label: 'Blocked' },
          ]}
          onChange={setFilter}
        />
      </div>
    </div>
  );
}

const TAB_ITEMS = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'subscriber', label: 'Subscriber' },
  { id: 'galeri', label: 'Galeri' },
  { id: 'persona', label: 'Persona AI' },
  { id: 'history', label: 'History' },
];

function TabsAndKv() {
  const [tab, setTab] = useState('ringkasan');
  return (
    <>
      <Tabs label="Detail creator" items={TAB_ITEMS} value={tab} onChange={setTab} />
      <KvList
        items={[
          { label: 'Status', value: <StatusChip status="active" /> },
          { label: 'Mulai', value: '28 Okt 2026' },
          { label: 'Berakhir', value: '27 Nov 2026, 23.59 WIB' },
          { label: 'Sumber', value: 'Diberikan admin' },
        ]}
      />
    </>
  );
}

type DialogKind = 'logout' | 'block' | 'fail' | 'slow' | null;

function ToastAndDialogs() {
  const toast = useToast();
  const [open, setOpen] = useState<DialogKind>(null);
  const close = () => setOpen(null);
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  return (
    <>
      <div className={styles.buttons}>
        <Button
          variant="outline"
          onClick={() => toast.show({ message: 'Permintaan Luna Aurora ditolak dan dicatat' })}
        >
          Toast berhasil
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.show({ kind: 'error', message: 'Gagal menyimpan perubahan' })}
        >
          Toast gagal
        </Button>
        <Button variant="outline" onClick={() => setOpen('logout')}>
          Dialog logout
        </Button>
        <Button variant="outline" onClick={() => setOpen('block')}>
          Dialog dengan alasan
        </Button>
        <Button variant="outline" onClick={() => setOpen('fail')}>
          Dialog gagal
        </Button>
        <Button variant="outline" onClick={() => setOpen('slow')}>
          Dialog lambat
        </Button>
      </div>
      <ConfirmDialog
        open={open === 'logout'}
        width={480}
        title="Keluar dari dashboard?"
        icon={<XIcon size={22} strokeWidth={2} />}
        consequence="Sesi di perangkat ini berakhir dan kamu kembali ke halaman login. Perubahan yang belum disimpan hilang."
        confirmLabel="Logout"
        onConfirm={() => wait(300)}
        onClose={close}
      />
      <ConfirmDialog
        open={open === 'block'}
        destructive
        title="Block creator?"
        icon={<UserSlashIcon size={22} strokeWidth={2} />}
        target={
          <div>
            <strong>Salsa Maheswari</strong>
            <div className={styles.muted}>@salsa.maheswari · Creator Asli</div>
          </div>
        }
        consequence="Akses creator dinonaktifkan: percakapan baru dan balasan AI dihentikan. Riwayat dan data tetap tersimpan."
        reason={{
          label: 'Alasan block (wajib)',
          required: true,
          hint: 'Alasan dicatat di audit log.',
        }}
        confirmLabel="Block Creator"
        onConfirm={() => wait(300)}
        onClose={close}
      />
      <ConfirmDialog
        open={open === 'fail'}
        title="Simulasi gagal"
        consequence="Konfirmasi selalu gagal, dialog tetap terbuka dengan pesan di dalamnya."
        confirmLabel="Coba Proses"
        onConfirm={async () => {
          await wait(300);
          throw new Error('simulated');
        }}
        onClose={close}
      />
      <ConfirmDialog
        open={open === 'slow'}
        title="Simulasi lambat"
        consequence="Konfirmasi memakan waktu 3 detik. Klik ganda hanya memicu satu kali dan Batal diblokir."
        confirmLabel="Proses"
        onConfirm={() => wait(3000)}
        onClose={close}
      />
    </>
  );
}

const COLUMNS: Column<PreviewCreatorRow>[] = [
  { key: 'name', header: 'Creator', sortable: true, sticky: 'start', render: (r) => r.name },
  {
    key: 'telegram',
    header: 'Telegram',
    sortable: true,
    width: '156px',
    render: (r) => r.telegram,
  },
  { key: 'instagram', header: 'Instagram', width: '136px', render: (r) => r.instagram },
  { key: 'kind', header: 'Jenis', sortable: true, width: '112px', render: (r) => r.kind },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    width: '128px',
    render: (r) => <StatusChip status={r.status} />,
  },
  {
    key: 'subscribers',
    header: 'Subscriber',
    sortable: true,
    width: '120px',
    render: (r) => r.subscribers,
  },
  { key: 'date', header: 'Tanggal', sortable: true, width: '128px', render: (r) => r.date },
  {
    key: 'action',
    header: 'Aksi',
    width: '244px',
    sticky: 'end',
    render: () => (
      <Button size="table" variant="outline" icon={<EyeIcon size={16} strokeWidth={2} />}>
        View
      </Button>
    ),
  },
];

const FILTER_OPTIONS = [{ value: '', label: 'Semua' }];

function TableSections() {
  const [sort, setSort] = useState<SortState | null>({ key: 'date', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const toolbar = (search = '') => (
    <TableToolbar>
      <SearchInput
        aria-label="Cari nama atau Telegram ID"
        placeholder="Cari nama atau Telegram ID"
        defaultValue={search}
        readOnly
        className={styles.searchWidth}
      />
      <Select label="Status" value="" options={FILTER_OPTIONS} onChange={() => {}} />
    </TableToolbar>
  );

  const base = {
    columns: COLUMNS,
    rowKey: (r: PreviewCreatorRow) => r.id,
    sort,
    onSortChange: setSort,
    minWidth: 1100,
  };
  const emptyPagination = {
    page: 1,
    pageSize: 10,
    total: 0,
    onPageChange: () => {},
    onPageSizeChange: () => {},
  };

  return (
    <>
      <Labeled id="table-loading" title="Loading">
        <DataTable
          {...base}
          label="Creator (loading)"
          rows={[]}
          status="loading"
          toolbar={toolbar()}
          pagination={emptyPagination}
        />
      </Labeled>
      <Labeled id="table-empty" title="Kosong">
        <DataTable
          {...base}
          label="Creator (kosong)"
          rows={[]}
          status="ready"
          toolbar={toolbar()}
          pagination={emptyPagination}
        />
      </Labeled>
      <Labeled id="table-no-results" title="Tidak ada hasil pencarian atau filter">
        <DataTable
          {...base}
          label="Creator (tidak ada hasil)"
          rows={[]}
          status="ready"
          hasActiveFilters
          onResetFilters={() => {}}
          toolbar={toolbar('zzz')}
          pagination={emptyPagination}
        />
      </Labeled>
      <Labeled id="table-error" title="Error, dengan retry">
        <DataTable
          {...base}
          label="Creator (error)"
          rows={[]}
          status="error"
          onRetry={() => {}}
          toolbar={toolbar()}
          pagination={emptyPagination}
        />
      </Labeled>
      <Labeled id="table-ready" title="Dengan data">
        <DataTable
          {...base}
          label="Creator"
          rows={PREVIEW_ROWS}
          status="ready"
          toolbar={toolbar()}
          pagination={{
            page,
            pageSize,
            total: 126,
            onPageChange: setPage,
            onPageSizeChange: (n) => {
              setPageSize(n);
              setPage(1);
            },
          }}
        />
      </Labeled>
    </>
  );
}
