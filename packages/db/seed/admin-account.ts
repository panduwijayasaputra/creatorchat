import type { PrismaClient } from '../src/index.js';
import { generatePassword, hashPassword, normalizeAdminUsername } from '../src/admin-password.js';

export const MIN_SUPPLIED_PASSWORD_LENGTH = 12;

export interface AdminAccountOptions {
  username: string;
  /** Supplied password. If omitted, one is generated and returned once for the caller to show. */
  password?: string | undefined;
  /** Replace the password of an existing admin and revoke all of that admin's sessions. */
  resetPassword?: boolean;
}

export interface AdminAccountResult {
  username: string;
  action: 'created' | 'reset';
  /** Set only when generated here; the caller must show it exactly once and never log it. */
  generatedPassword?: string;
}

export class AdminAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminAccountError';
  }
}

/** Creates the first/another admin, or resets an existing admin's password. Never touches others. */
export async function createOrResetAdmin(
  prisma: PrismaClient,
  options: AdminAccountOptions,
): Promise<AdminAccountResult> {
  const username = normalizeAdminUsername(options.username);
  if (options.password !== undefined && options.password.length < MIN_SUPPLIED_PASSWORD_LENGTH) {
    throw new AdminAccountError(
      `The supplied password must be at least ${MIN_SUPPLIED_PASSWORD_LENGTH} characters.`,
    );
  }
  const generated = options.password === undefined ? generatePassword() : undefined;
  const passwordHash = await hashPassword((options.password ?? generated) as string);

  const existing = await prisma.adminAccount.findUnique({ where: { username } });
  if (existing && !options.resetPassword) {
    throw new AdminAccountError(
      `Admin "${username}" already exists. Use --reset-password to replace its password.`,
    );
  }
  if (!existing && options.resetPassword) {
    throw new AdminAccountError(
      `Admin "${username}" does not exist, so there is nothing to reset.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.adminAccount.update({ where: { id: existing.id }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { adminId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'admin.password.reset',
          targetType: 'admin_account',
          targetId: existing.id,
        },
      });
    } else {
      const created = await tx.adminAccount.create({ data: { username, passwordHash } });
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'admin.account.created',
          targetType: 'admin_account',
          targetId: created.id,
        },
      });
    }
  });

  return {
    username,
    action: existing ? 'reset' : 'created',
    ...(generated ? { generatedPassword: generated } : {}),
  };
}
