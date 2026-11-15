import { ChevronLeftIcon, ChevronRightIcon } from '../../icons';
import { Select } from '../select/Select';
import { buildPageList } from './page-list';
import styles from './DataTable.module.css';

export const PAGE_SIZES = [10, 25, 50] as const;

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Shows "Memuat data…" instead of the range. */
  loading?: boolean;
}

export function rangeText(page: number, pageSize: number, total: number): string {
  if (total <= 0) return 'Menampilkan 0 hasil';
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return `Menampilkan ${from}–${to} dari ${total} hasil`;
}

/** Footer of the data table: range, "Baris per halaman" 10/25/50, and page buttons. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  loading = false,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), pageCount);
    if (clamped !== current) onPageChange(clamped);
  };

  return (
    <div className={styles.footer}>
      <span className={styles.nowrap}>
        {loading ? 'Memuat data…' : rangeText(current, pageSize, total)}
      </span>
      <span className={styles.sizeGroup}>
        <span className={styles.nowrap}>Baris per halaman</span>
        <Select
          label="Baris per halaman"
          hideLabel
          compact
          value={String(pageSize)}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(v) => onPageSizeChange(Number(v))}
        />
      </span>
      <nav className={styles.pages} aria-label="Halaman">
        <button
          type="button"
          className={styles.pageButton}
          aria-label="Halaman sebelumnya"
          disabled={current <= 1}
          onClick={() => go(current - 1)}
        >
          <ChevronLeftIcon size={16} strokeWidth={2} />
        </button>
        {buildPageList(current, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={`${styles.pageButton} ${item === current ? styles.currentPage : ''}`}
              aria-label={`Halaman ${item}`}
              aria-current={item === current ? 'page' : undefined}
              onClick={() => go(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={styles.pageButton}
          aria-label="Halaman berikutnya"
          disabled={current >= pageCount}
          onClick={() => go(current + 1)}
        >
          <ChevronRightIcon size={16} strokeWidth={2} />
        </button>
      </nav>
    </div>
  );
}
