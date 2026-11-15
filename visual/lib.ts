import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Browser, Locator, Page } from '@playwright/test';

export const ROOT = resolve(import.meta.dirname, '..');
export const DESIGN = resolve(ROOT, 'designs/creator-chat-design-handoff/design');
export const OUTPUT = resolve(import.meta.dirname, 'output');

// Own dev-server ports so the harness never depends on (or disturbs) `pnpm dev`.
export const MINIAPP_URL = 'http://localhost:5273';
export const ADMIN_URL = 'http://localhost:5274';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Comparison {
  name: string;
  /** Pixel scale of both images (PNG pixels per CSS pixel). */
  scale: number;
  actualSize: { width: number; height: number };
  referenceSize: { width: number; height: number };
  sizeMatches: boolean;
  /** Share of pixels (0-100) that differ noticeably, over the overlapping area. Informational only. */
  diffPercent: number;
  sheet: string;
}

export function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const dataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;

/** Position of an element in a design board's HTML, in CSS pixels of the board. */
export async function boardRect(
  browser: Browser,
  board: string,
  pick: (page: Page) => Locator,
): Promise<{ rect: Rect; boardWidth: number }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`file:///${DESIGN.replace(/\\/g, '/')}/html/${board}.html`);
    const boardWidth = await page.evaluate(
      () => document.body.firstElementChild?.getBoundingClientRect().width ?? 0,
    );
    await page.setViewportSize({ width: Math.round(boardWidth), height: 900 });
    const target = pick(page).first();
    await target.waitFor({ state: 'attached', timeout: 10_000 });
    const rect = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height };
    });
    return { rect, boardWidth };
  } finally {
    await context.close();
  }
}

/**
 * Builds a side-by-side sheet (reference crop | actual) and computes an informational diff.
 * A diff number never decides pass or fail: every sheet is meant to be looked at.
 */
export async function compare(
  browser: Browser,
  name: string,
  reference: { png: string; rect: Rect; boardWidth: number },
  actual: Buffer,
): Promise<Comparison> {
  const refPath = resolve(DESIGN, 'png', reference.png);
  const refSize = pngSize(refPath);
  const scale = refSize.width / reference.boardWidth;
  const refCrop = {
    x: Math.round(reference.rect.x * scale),
    y: Math.round(reference.rect.y * scale),
    width: Math.round(reference.rect.width * scale),
    height: Math.round(reference.rect.height * scale),
  };

  mkdirSync(resolve(OUTPUT, 'actual'), { recursive: true });
  mkdirSync(resolve(OUTPUT, 'sheets'), { recursive: true });
  writeFileSync(resolve(OUTPUT, 'actual', `${name}.png`), actual);

  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  try {
    const result = await page.evaluate(
      async ({ refUrl, actualUrl, crop }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = () => rej(new Error('image failed to load'));
            img.src = src;
          });
        const [ref, act] = await Promise.all([load(refUrl), load(actualUrl)]);
        const w = Math.min(crop.width, act.naturalWidth);
        const h = Math.min(crop.height, act.naturalHeight);
        const a = document.createElement('canvas');
        const b = document.createElement('canvas');
        a.width = b.width = Math.max(1, w);
        a.height = b.height = Math.max(1, h);
        const ca = a.getContext('2d', { willReadFrequently: true });
        const cb = b.getContext('2d', { willReadFrequently: true });
        if (!ca || !cb) throw new Error('no 2d context');
        ca.drawImage(ref, crop.x, crop.y, w, h, 0, 0, w, h);
        cb.drawImage(act, 0, 0, w, h, 0, 0, w, h);
        const da = ca.getImageData(0, 0, a.width, a.height).data;
        const db = cb.getImageData(0, 0, b.width, b.height).data;
        let differing = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d =
            Math.abs((da[i] ?? 0) - (db[i] ?? 0)) +
            Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)) +
            Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0));
          if (d > 48) differing += 1;
        }
        return {
          diffPercent: (differing / (da.length / 4)) * 100,
          actual: { width: act.naturalWidth, height: act.naturalHeight },
        };
      },
      {
        refUrl: dataUrl(readFileSync(refPath)),
        actualUrl: dataUrl(actual),
        crop: refCrop,
      },
    );

    const maxW = Math.max(refCrop.width, result.actual.width);
    await page.setViewportSize({ width: maxW * 2 + 72, height: 400 });
    await page.setContent(`<!doctype html><body style="margin:0;padding:16px;background:#888;font:12px sans-serif;color:#fff">
      <div style="display:flex;gap:24px;align-items:flex-start">
        <div><div>REFERENCE ${name} (${refCrop.width}x${refCrop.height})</div>
          <div style="width:${refCrop.width}px;height:${refCrop.height}px;background:url(${dataUrl(readFileSync(refPath))}) -${refCrop.x}px -${refCrop.y}px no-repeat"></div></div>
        <div><div>ACTUAL (${result.actual.width}x${result.actual.height})</div>
          <img src="${dataUrl(actual)}" style="display:block"></div>
      </div></body>`);
    const sheetFile = resolve(OUTPUT, 'sheets', `${name}.png`);
    await page.screenshot({ path: sheetFile, fullPage: true });

    return {
      name,
      scale,
      actualSize: result.actual,
      referenceSize: { width: refCrop.width, height: refCrop.height },
      sizeMatches:
        Math.abs(result.actual.width - refCrop.width) <= 2 &&
        Math.abs(result.actual.height - refCrop.height) <= 2,
      diffPercent: Math.round(result.diffPercent * 100) / 100,
      sheet: sheetFile,
    };
  } finally {
    await context.close();
  }
}

export function writeReport(rows: Comparison[]): void {
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(resolve(OUTPUT, 'report.json'), JSON.stringify(rows, null, 2));
  const lines = rows.map(
    (r) =>
      `${r.name.padEnd(34)} ref ${r.referenceSize.width}x${r.referenceSize.height}  actual ${r.actualSize.width}x${r.actualSize.height}  size ${r.sizeMatches ? 'match' : 'DIFFERS'}  diff ${r.diffPercent}%`,
  );
  writeFileSync(resolve(OUTPUT, 'report.txt'), `${lines.join('\n')}\n`);
  console.log(`\n${lines.join('\n')}\n\nSheets: ${dirname(resolve(OUTPUT, 'sheets', 'x'))}`);
}
