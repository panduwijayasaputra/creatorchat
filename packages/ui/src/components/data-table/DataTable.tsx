import type { ReactNode } from 'react';
import {
  AlertCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ImageIcon,
  RefreshIcon,
  SearchIcon,
} from '../../icons';
import { Button } from '../button/Button';
import { Pagination, type PaginationProps } from './Pagination';
import styles from './DataTable.module.css';

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface Column<Row> {
  key: string;
  header: string;
  sortable?: boolean;
  /** Keeps the identity (`start`) or action (`end`) column in view on horizontal scroll. */
  sticky?: 'start' | 'end';
  width?: string;
  render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  /** Accessible name of the table. */
  label: string;
  columns: readonly Column<Row>[];
  /** Rows exactly as the server returned them: the table never sorts, filters or slices. */
  rows: readonly Row[];
  status: 'loading' | 'ready' | 'error';
  rowKey: (row: Row) => string;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** Distinguishes "Tidak ada hasil" (filters/search active) from "Belum ada data". */
  hasActiveFilters?: boolean;
  onResetFilters?: () => void;
  onRetry?: () => void;
  toolbar?: ReactNode;
  pagination: PaginationProps;
  /** Narrower than this the frame scrolls horizontally. */
  minWidth?: number;
  skeletonRows?: number;
}

const SKELETON_WIDTHS = [60, 71, 82, 93, 69, 80, 91, 67];

export function DataTable<Row>({
  label,
  columns,
  rows,
  status,
  rowKey,
  sort = null,
  onSortChange,
  hasActiveFilters = false,
  onResetFilters,
  onRetry,
  toolbar,
  pagination,
  minWidth = 960,
  skeletonRows = 6,
}: DataTableProps<Row>) {
  const empty = status === 'ready' && rows.length === 0;

  const stickyClass = (column: Column<Row>) =>
    column.sticky === 'start'
      ? styles.stickyStart
      : column.sticky === 'end'
        ? styles.stickyEnd
        : '';

  const nextSort = (column: Column<Row>): SortState => ({
    key: column.key,
    direction: sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc',
  });

  return (
    <section className={styles.section}>
      {toolbar}
      <div className={styles.frame}>
        <div className={styles.scroller}>
          <div style={{ minWidth }}>
            <table
              className={styles.table}
              aria-label={label}
              aria-busy={status === 'loading' || undefined}
            >
              <thead>
                <tr>
                  {columns.map((column) => {
                    const active = sort?.key === column.key;
                    const ariaSort = column.sortable
                      ? active
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={ariaSort}
                        className={`${styles.th} ${stickyClass(column)}`}
                        style={column.width ? { width: column.width } : undefined}
                      >
                        {column.sortable ? (
                          <button
                            type="button"
                            className={`${styles.sortButton} ${active ? styles.sortActive : ''}`}
                            onClick={() => onSortChange?.(nextSort(column))}
                          >
                            {column.header}
                            {active && sort.direction === 'desc' ? (
                              <ChevronDownIcon size={14} strokeWidth={2.4} />
                            ) : (
                              <ChevronUpIcon size={14} strokeWidth={2.4} />
                            )}
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {status === 'loading'
                  ? Array.from({ length: skeletonRows }, (_, r) => (
                      <tr key={`sk-${r}`} aria-hidden="true">
                        {columns.map((column, c) => (
                          <td
                            key={column.key}
                            className={`${styles.td} ${styles.skeletonCell} ${stickyClass(column)}`}
                          >
                            <div
                              className={styles.skeleton}
                              style={{
                                width: `${SKELETON_WIDTHS[(r + c) % SKELETON_WIDTHS.length]}%`,
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
                {status === 'ready'
                  ? rows.map((row) => (
                      <tr key={rowKey(row)} className={styles.row}>
                        {columns.map((column) => (
                          <td key={column.key} className={`${styles.td} ${stickyClass(column)}`}>
                            {column.render(row)}
                          </td>
                        ))}
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>

            {status === 'error' ? (
              <StateBlock
                tone="err"
                icon={<AlertCircleIcon size={28} />}
                title="Data gagal dimuat"
                message="Terjadi gangguan saat mengambil data. Coba lagi sebentar."
                action={
                  <Button icon={<RefreshIcon size={16} strokeWidth={2} />} onClick={onRetry}>
                    Coba Lagi
                  </Button>
                }
              />
            ) : null}
            {empty && !hasActiveFilters ? (
              <StateBlock
                icon={<ImageIcon size={28} />}
                title="Belum ada data"
                message="Data akan muncul di sini setelah ada aktivitas."
              />
            ) : null}
            {empty && hasActiveFilters ? (
              <StateBlock
                icon={<SearchIcon size={28} />}
                title="Tidak ada hasil"
                message="Tidak ada data yang cocok dengan pencarian atau filter. Ubah kata kunci atau reset filter."
                action={
                  <Button
                    variant="outline"
                    icon={<RefreshIcon size={16} strokeWidth={2} />}
                    onClick={onResetFilters}
                  >
                    Reset Filter
                  </Button>
                }
              />
            ) : null}
          </div>
        </div>
        <Pagination
          {...pagination}
          loading={status === 'loading'}
          total={status === 'ready' ? pagination.total : 0}
        />
      </div>
    </section>
  );
}

function StateBlock({
  icon,
  tone,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  tone?: 'err';
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.state} role={tone === 'err' ? 'alert' : undefined}>
      <span className={`${styles.stateIcon} ${tone === 'err' ? styles.stateIconErr : ''}`}>
        {icon}
      </span>
      <div className={styles.stateTitle}>{title}</div>
      <div className={styles.stateMessage}>{message}</div>
      {action ? <div className={styles.stateAction}>{action}</div> : null}
    </div>
  );
}

/** Toolbar layout (search, filters, Reset Filter) used above the frame. */
export function TableToolbar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className={styles.toolbar}>
      {children}
      <button type="button" className={styles.reset} onClick={onReset}>
        <RefreshIcon size={16} strokeWidth={2} />
        Reset Filter
      </button>
    </div>
  );
}
