import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  actionKind,
  actionLabel,
  actionStatus,
  projectChanges,
  summaryOf,
} from './audit-labels.js';

describe('audit labels', () => {
  it.each(Object.entries(AUDIT_ACTIONS))('%s has a label, kind and summary', (action, spec) => {
    expect(actionLabel(action)).toBe(spec.label);
    expect(['account', 'application', 'access']).toContain(actionKind(action));
    expect(summaryOf(action, null).length).toBeGreaterThan(0);
    expect(actionStatus(action)).toBe(spec.failed ? 'failed' : 'success');
  });
  it('only a blocked login is a failure', () => {
    expect(Object.keys(AUDIT_ACTIONS).filter((a) => actionStatus(a) === 'failed')).toEqual([
      'user.login.blocked',
    ]);
  });
  it('falls back safely for an unknown action', () => {
    expect(actionLabel('x.y')).toBe('x.y');
    expect(actionKind('x.y')).toBe('account');
    expect(summaryOf('x.y', { a: 1 })).toBe('');
  });
  it('builds the role summary only from a clean pair', () => {
    expect(summaryOf('user.role.changed', { role: ['USER', 'CREATOR'] })).toBe(
      'Role USER → CREATOR',
    );
    expect(summaryOf('user.role.changed', { role: ['<b>', 'x'] })).toBe('Role berubah');
  });
});

describe('projectChanges', () => {
  it('keeps only allowlisted lines and drops secrets and nesting', () => {
    const out = projectChanges({
      password: 'x',
      token: 'y',
      nested: { a: 1 },
      user_id: 'u',
      role: ['USER', 'CREATOR'],
      status: 'ACTIVE',
      display_name: ['Maya L', 'Maya Lestari'],
      active_subscribers: 12,
    });
    expect(out.before).toEqual([
      { label: 'Role', value: 'USER' },
      { label: 'Nama tampil', value: 'Maya L' },
      { label: 'Subscriber aktif', value: '12' },
    ]);
    expect(out.after.map((l) => l.label)).toEqual(['Role', 'Nama tampil', 'Subscriber aktif']);
    expect(JSON.stringify(out)).not.toMatch(/password|token|nested/);
  });
  it('truncates long names and handles null / arrays', () => {
    expect(projectChanges({ display_name: ['a'.repeat(200), 'b'] }).before[0]?.value).toHaveLength(
      60,
    );
    expect(projectChanges(null)).toEqual({ before: [], after: [] });
    expect(projectChanges([1, 2])).toEqual({ before: [], after: [] });
  });
  it('drops malformed pairs', () => {
    expect(projectChanges({ role: ['USER'], status: [1, 2] })).toEqual({ before: [], after: [] });
  });
});
