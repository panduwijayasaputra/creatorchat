export type PageItem = number | 'gap';

/**
 * Page numbers for the pagination footer: always the first, last and current page with one
 * neighbour on each side; `1 2 3 … 13` near the start, `1 … 11 12 13` near the end. A gap that
 * would hide a single page shows that page instead of an ellipsis.
 */
export function buildPageList(page: number, pageCount: number): PageItem[] {
  const count = Math.max(1, Math.floor(pageCount));
  const current = Math.min(Math.max(1, Math.floor(page)), count);
  const keep = new Set<number>([1, count, current - 1, current, current + 1]);
  if (current <= 2) {
    keep.add(2);
    keep.add(3);
  }
  if (current >= count - 1) {
    keep.add(count - 1);
    keep.add(count - 2);
  }
  const sorted = [...keep].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);

  const items: PageItem[] = [];
  let previous = 0;
  for (const n of sorted) {
    if (n - previous === 2) items.push(previous + 1);
    else if (n - previous > 2) items.push('gap');
    items.push(n);
    previous = n;
  }
  return items;
}
