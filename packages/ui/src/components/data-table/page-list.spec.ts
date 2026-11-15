import { describe, expect, it } from 'vitest';
import { buildPageList, type PageItem } from './page-list';

const show = (items: PageItem[]) => items.map((i) => (i === 'gap' ? '…' : String(i))).join(' ');

describe('buildPageList', () => {
  it('shows a single page', () => {
    expect(show(buildPageList(1, 1))).toBe('1');
  });

  it('shows every page when there are few', () => {
    expect(show(buildPageList(3, 5))).toBe('1 2 3 4 5');
  });

  it('matches the board near the start: 1 2 3 … 13', () => {
    expect(show(buildPageList(1, 13))).toBe('1 2 3 … 13');
    expect(show(buildPageList(2, 13))).toBe('1 2 3 … 13');
  });

  it('shows neighbours in the middle', () => {
    expect(show(buildPageList(7, 13))).toBe('1 … 6 7 8 … 13');
  });

  it('shows the end window', () => {
    expect(show(buildPageList(13, 13))).toBe('1 … 11 12 13');
    expect(show(buildPageList(12, 13))).toBe('1 … 11 12 13');
  });

  it('does not hide a single page behind an ellipsis', () => {
    expect(show(buildPageList(4, 13))).toBe('1 2 3 4 5 … 13');
    expect(show(buildPageList(5, 8))).toBe('1 … 4 5 6 7 8');
  });

  it.each([
    [1, 1],
    [1, 2],
    [4, 9],
    [9, 9],
    [50, 100],
    [100, 100],
  ])(
    'always includes first, last and current and never duplicates (page %i of %i)',
    (page, count) => {
      const list = buildPageList(page, count);
      const numbers = list.filter((i): i is number => i !== 'gap');
      expect(numbers[0]).toBe(1);
      expect(numbers.at(-1)).toBe(count);
      expect(numbers).toContain(page);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
      expect(list[0]).not.toBe('gap');
      expect(list.at(-1)).not.toBe('gap');
    },
  );

  it('clamps an out-of-range page', () => {
    expect(show(buildPageList(99, 3))).toBe('1 2 3');
    expect(show(buildPageList(0, 3))).toBe('1 2 3');
  });
});
