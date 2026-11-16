import { Role, type PrismaClient } from '../src/index.js';
import { generatePassword, hashPassword, normalizeAdminUsername } from './admin.js';
import { SUBSCRIPTION_FIXTURES, USER_FIXTURES } from './fixtures.js';

export interface SeedOptions {
  adminUsername?: string;
  /** If omitted and the admin does not exist yet, a random password is generated. */
  adminPassword?: string;
}

export interface SeedResult {
  adminUsername: string;
  adminCreated: boolean;
  /** Set only when the password was generated here; the caller must show it exactly once. */
  generatedPassword?: string;
  usersCreated: number;
  usersExisting: number;
  creatorsCreated: number;
  subscriptionsCreated: number;
}

/** Idempotent: re-running never duplicates rows, never changes an existing admin's password. */
export async function runSeed(
  prisma: PrismaClient,
  options: SeedOptions = {},
): Promise<SeedResult> {
  const adminUsername = normalizeAdminUsername(options.adminUsername || 'admin');

  const existing = await prisma.adminAccount.findUnique({ where: { username: adminUsername } });
  let adminCreated = false;
  let generatedPassword: string | undefined;
  if (!existing) {
    const password = options.adminPassword || (generatedPassword = generatePassword());
    await prisma.adminAccount.create({
      data: { username: adminUsername, passwordHash: await hashPassword(password) },
    });
    adminCreated = true;
  }

  let usersCreated = 0;
  let creatorsCreated = 0;
  for (const fixture of USER_FIXTURES) {
    let user = await prisma.user.findUnique({ where: { telegramId: fixture.telegramId } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: fixture.telegramId,
          displayName: fixture.displayName,
          role: fixture.role,
          telegramUsername: fixture.telegramUsername,
        },
      });
      usersCreated += 1;
    }
    if (fixture.publicCode && fixture.role === Role.CREATOR) {
      const creator = await prisma.creator.findUnique({ where: { userId: user.id } });
      if (!creator) {
        await prisma.creator.create({ data: { userId: user.id, publicCode: fixture.publicCode } });
        creatorsCreated += 1;
      }
    }
  }

  let subscriptionsCreated = 0;
  for (const fixture of SUBSCRIPTION_FIXTURES) {
    const customer = await prisma.user.findUnique({
      where: { telegramId: fixture.customerTelegramId },
    });
    const creator = await prisma.creator.findUnique({
      where: { publicCode: fixture.creatorPublicCode },
    });
    if (!customer || !creator) continue;
    const key = { customerId_creatorId: { customerId: customer.id, creatorId: creator.id } };
    if (await prisma.subscription.findUnique({ where: key })) continue;
    await prisma.subscription.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        startsAt: fixture.startsAt,
        endsAt: fixture.endsAt,
      },
    });
    subscriptionsCreated += 1;
  }

  return {
    adminUsername,
    adminCreated,
    ...(generatedPassword ? { generatedPassword } : {}),
    usersCreated,
    usersExisting: USER_FIXTURES.length - usersCreated,
    creatorsCreated,
    subscriptionsCreated,
  };
}
