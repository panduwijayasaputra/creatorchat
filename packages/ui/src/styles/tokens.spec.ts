import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(import.meta.dirname, 'tokens.css'), 'utf8');

function token(name: string): string | undefined {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  return m?.[1]?.trim().toLowerCase();
}

// Values from .agile/guidelines/design-integration.md
const expected: Record<string, string> = {
  bg: '#fff9fb',
  pink: '#f5dce5',
  'pink-soft': '#fbedf2',
  'pink-hover': '#ebc9d6',
  rose: '#a83f67',
  'rose-hover': '#8e3255',
  ink: '#30252c',
  'ink-2': '#75636d',
  'ink-2-pressed': '#66545e',
  line: '#e6d3db',
  field: '#d8c0ca',
  'ok-fg': '#24634a',
  'ok-bg': '#e1f0e7',
  'warn-fg': '#7a4f0d',
  'warn-bg': '#fbedd0',
  'err-fg': '#a3261d',
  'err-bg': '#fbe3e0',
  'exp-fg': '#5e4e57',
  'exp-bg': '#efe7eb',
  'radius-control': '12px',
  'radius-card': '16px',
  'radius-dialog': '20px',
  'radius-chip': '14px',
  'shadow-1': '0 1px 2px rgba(48, 37, 44, 0.06)',
  'shadow-2': '0 4px 16px rgba(48, 37, 44, 0.08)',
  backdrop: 'rgba(48, 37, 44, 0.5)',
  'h-button': '40px',
  'h-button-table': '36px',
  'h-input': '44px',
  'touch-min': '44px',
};

describe('design tokens', () => {
  it.each(Object.entries(expected))('--%s matches the design guide', (name, value) => {
    expect(token(name)).toBe(value);
  });

  it('defines the font stacks and a safe-area helper', () => {
    expect(token('font-sans')).toContain('inter');
    expect(token('font-mono')).toContain('ui-monospace');
    expect(token('safe-bottom')).toContain('safe-area-inset-bottom');
  });
});
