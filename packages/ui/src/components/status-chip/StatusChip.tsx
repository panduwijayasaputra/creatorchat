import type { ComponentType } from 'react';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  HourglassIcon,
  InfoCircleIcon,
  UserSlashIcon,
  XIcon,
  type IconProps,
} from '../../icons';
import styles from './StatusChip.module.css';

export type ChipStatus =
  | 'request'
  | 'active'
  | 'blocked'
  | 'success'
  | 'failed'
  | 'expired'
  | 'revoked'
  | 'rejected'
  | 'pending'
  | 'none';

interface ChipSpec {
  label: string;
  Icon: ComponentType<IconProps>;
  tone: 'warn' | 'ok' | 'err' | 'exp' | 'soft';
}

/** Labels, icons and tones from AdmMain ("Status dan tombol"). */
export const CHIP_SPECS: Record<ChipStatus, ChipSpec> = {
  request: { label: 'Request', Icon: HourglassIcon, tone: 'warn' },
  active: { label: 'Active', Icon: CheckCircleIcon, tone: 'ok' },
  blocked: { label: 'Blocked', Icon: UserSlashIcon, tone: 'err' },
  success: { label: 'Berhasil', Icon: CheckCircleIcon, tone: 'ok' },
  failed: { label: 'Gagal', Icon: AlertCircleIcon, tone: 'err' },
  expired: { label: 'Kedaluwarsa', Icon: ClockIcon, tone: 'exp' },
  // `AdmUserSubsRevoked`: the same neutral tone and clock as Kedaluwarsa, its own label.
  revoked: { label: 'Dicabut', Icon: ClockIcon, tone: 'exp' },
  rejected: { label: 'Ditolak', Icon: XIcon, tone: 'err' },
  pending: { label: 'Menunggu', Icon: HourglassIcon, tone: 'warn' },
  none: { label: 'Belum mengajukan', Icon: InfoCircleIcon, tone: 'soft' },
};

export interface StatusChipProps {
  status: ChipStatus;
  /** Replaces the label only (e.g. customer wording "Aktif"); the icon and tone stay. */
  label?: string;
}

/** Status is never color-only: every chip renders an icon **and** a label. */
export function StatusChip({ status, label }: StatusChipProps) {
  const { label: defaultLabel, Icon, tone } = CHIP_SPECS[status];
  return (
    <span className={`${styles.chip} ${styles[tone]}`}>
      <Icon size={16} strokeWidth={2} />
      {label ?? defaultLabel}
    </span>
  );
}
