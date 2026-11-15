/**
 * Fixture data for the dev-only component preview. The names and numbers come from the design
 * boards (fictional) and are never imported by the shell or any real screen.
 */
import type { ChipStatus } from '@creatorchat/ui';

export interface PreviewCreatorRow {
  id: string;
  name: string;
  telegram: string;
  instagram: string;
  kind: string;
  status: ChipStatus;
  subscribers: number;
  date: string;
}

export const PREVIEW_ROWS: PreviewCreatorRow[] = [
  {
    id: '1',
    name: 'Salsa Maheswari',
    telegram: '@salsa.maheswari',
    instagram: '@salsa.m',
    kind: 'Creator Asli',
    status: 'active',
    subscribers: 58,
    date: '21 Sep 2026',
  },
  {
    id: '2',
    name: 'Kirana Putri',
    telegram: '@kirana.p',
    instagram: '@kiranap',
    kind: 'Creator Asli',
    status: 'active',
    subscribers: 46,
    date: '02 Okt 2026',
  },
  {
    id: '3',
    name: 'Dinda Ayu',
    telegram: '@dinda.ayu',
    instagram: '@dindaayu',
    kind: 'Karakter AI',
    status: 'active',
    subscribers: 41,
    date: '14 Okt 2026',
  },
  {
    id: '4',
    name: 'Maya Lestari',
    telegram: '@maya.l',
    instagram: '@mayalestari',
    kind: 'Creator Asli',
    status: 'request',
    subscribers: 0,
    date: '12 Nov 2026',
  },
];

export const PREVIEW_PALETTE = [
  { name: 'Warm white', hex: '#FFF9FB', note: '60%', border: true },
  { name: 'Pastel pink', hex: '#F5DCE5', note: '30%', border: true },
  { name: 'Deep rose', hex: '#A83F67', note: '10%', border: true },
  { name: 'Teks', hex: '#30252C', note: 'utama', border: true },
  { name: 'Teks sekunder', hex: '#75636D', note: 'pendukung', border: true },
] as const;

export const PREVIEW_STATUSES: readonly ChipStatus[] = [
  'request',
  'active',
  'blocked',
  'success',
  'failed',
  'expired',
  'rejected',
  'pending',
  'none',
];
