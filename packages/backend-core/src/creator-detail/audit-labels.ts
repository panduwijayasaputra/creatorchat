export type AuditKind = 'account' | 'application' | 'access';

interface ActionSpec {
  label: string;
  kind: AuditKind;
  failed?: boolean;
  /** Fixed one-line summary; `summaryOf` refines it from allowlisted fields. */
  summary: string;
}

/** Indonesian labels of the audited actions (fixed map; an unknown action falls back to its raw name). */
export const AUDIT_ACTIONS: Readonly<Record<string, ActionSpec>> = {
  'user.account.created': {
    label: 'Bergabung',
    kind: 'account',
    summary: 'Akun USER dibuat via Telegram',
  },
  'creator.application.submitted': {
    label: 'Ajukan creator',
    kind: 'application',
    summary: 'Permintaan dikirim',
  },
  'creator.application.approved': {
    label: 'Setujui creator',
    kind: 'application',
    summary: 'Role USER → CREATOR',
  },
  'creator.application.rejected': {
    label: 'Tolak creator',
    kind: 'application',
    summary: 'Ditolak',
  },
  'user.role.changed': { label: 'Ubah role', kind: 'access', summary: 'Role berubah' },
  'creator.blocked': { label: 'Block creator', kind: 'access', summary: 'Active → Blocked' },
  'creator.unblocked': { label: 'Unblock creator', kind: 'access', summary: 'Blocked → Active' },
  'user.account.blocked': { label: 'Block user', kind: 'access', summary: 'Active → Blocked' },
  'user.account.unblocked': { label: 'Unblock user', kind: 'access', summary: 'Blocked → Active' },
  'access.request.created': {
    label: 'Minta akses',
    kind: 'access',
    summary: 'Permintaan akses dikirim',
  },
  'access.request.approved': {
    label: 'Setujui akses',
    kind: 'access',
    summary: 'Permintaan akses disetujui',
  },
  'access.request.rejected': {
    label: 'Tolak akses',
    kind: 'access',
    summary: 'Permintaan akses ditolak',
  },
  'user.login.blocked': {
    label: 'Login diblokir',
    kind: 'account',
    failed: true,
    summary: 'Login ditolak: akun diblokir',
  },
};

export function actionLabel(action: string): string {
  return AUDIT_ACTIONS[action]?.label ?? action;
}
export function actionKind(action: string): AuditKind {
  return AUDIT_ACTIONS[action]?.kind ?? 'account';
}
export function actionStatus(action: string): 'success' | 'failed' {
  return AUDIT_ACTIONS[action]?.failed ? 'failed' : 'success';
}

const WORD = /^[A-Za-z_ ]{1,30}$/;
const pair = (value: unknown): [string, string] | null =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'string' &&
  WORD.test(value[0]) &&
  WORD.test(value[1])
    ? [value[0], value[1]]
    : null;

/** The short text of a History row: from the fixed map, refined by an allowlisted role pair. */
export function summaryOf(action: string, changes: unknown): string {
  const base = AUDIT_ACTIONS[action]?.summary ?? '';
  const role = pair((changes as Record<string, unknown> | null)?.role);
  return action === 'user.role.changed' && role ? `Role ${role[0]} → ${role[1]}` : base;
}

export interface FieldLine {
  label: string;
  value: string;
}

/**
 * The before / after panels of an audit entry, built from an allowlist: `role`, `status` and
 * `display_name` pairs, and the `active_subscribers` count. Every other key (secrets, ids, nested
 * objects, long text) is dropped; `changes` never leaves the server raw.
 */
export function projectChanges(changes: unknown): { before: FieldLine[]; after: FieldLine[] } {
  const before: FieldLine[] = [];
  const after: FieldLine[] = [];
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) {
    return { before, after };
  }
  const c = changes as Record<string, unknown>;
  const text = (value: string) => value.slice(0, 60);
  for (const [key, label] of [
    ['role', 'Role'],
    ['status', 'Status'],
  ] as const) {
    const p = pair(c[key]);
    if (p) {
      before.push({ label, value: p[0] });
      after.push({ label, value: p[1] });
    }
  }
  const name = c.display_name;
  if (Array.isArray(name) && name.length === 2 && name.every((v) => typeof v === 'string')) {
    before.push({ label: 'Nama tampil', value: text(name[0] as string) });
    after.push({ label: 'Nama tampil', value: text(name[1] as string) });
  }
  const subs = c.active_subscribers;
  if (typeof subs === 'number' && Number.isInteger(subs) && subs >= 0) {
    before.push({ label: 'Subscriber aktif', value: String(subs) });
    after.push({ label: 'Subscriber aktif', value: String(subs) });
  }
  return { before, after };
}
