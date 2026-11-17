import { randomUUID } from 'node:crypto';
import { Role, type PrismaClient } from '../src/index.js';
import { generatePassword, hashPassword, normalizeAdminUsername } from './admin.js';
import {
  ACCESS_REQUEST_FIXTURES,
  CHAT_FIXTURES,
  APPLICATION_FIXTURES,
  SUBSCRIPTION_FIXTURES,
  USER_FIXTURES,
} from './fixtures.js';

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
  applicationsCreated: number;
  accessRequestsCreated: number;
  chatMessagesCreated: number;
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
        await prisma.creator.create({
          data: {
            userId: user.id,
            publicCode: fixture.publicCode,
            ...(fixture.creatorType ? { creatorType: fixture.creatorType } : {}),
            ...(fixture.instagramUrl ? { instagramUrl: fixture.instagramUrl } : {}),
          },
        });
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

  // Only when the user has no request with that status yet; an existing row is never touched.
  let applicationsCreated = 0;
  for (const fixture of APPLICATION_FIXTURES) {
    const user = await prisma.user.findUnique({ where: { telegramId: fixture.userTelegramId } });
    if (!user) continue;
    const found = await prisma.creatorApplication.findFirst({
      where: { userId: user.id, status: fixture.status },
      select: { id: true },
    });
    if (found) continue;
    await prisma.creatorApplication.create({
      data: {
        userId: user.id,
        status: fixture.status,
        creatorName: fixture.creatorName,
        instagramUrl: fixture.instagramUrl,
        creatorType: fixture.creatorType,
        description: fixture.description,
        reviewReason: fixture.reviewReason ?? null,
        reviewedAt: fixture.reviewedAt ?? null,
      },
    });
    applicationsCreated += 1;
  }

  // Only when the pair has no pending request yet; an existing row is never touched.
  let accessRequestsCreated = 0;
  for (const fixture of ACCESS_REQUEST_FIXTURES) {
    const customer = await prisma.user.findUnique({
      where: { telegramId: fixture.customerTelegramId },
    });
    const creator = await prisma.creator.findUnique({
      where: { publicCode: fixture.creatorPublicCode },
    });
    if (!customer || !creator) continue;
    const found = await prisma.accessRequest.findFirst({
      where: { customerId: customer.id, creatorId: creator.id, status: 'PENDING' },
      select: { id: true },
    });
    if (found) continue;
    await prisma.accessRequest.create({
      data: {
        customerId: customer.id,
        creatorId: creator.id,
        type: fixture.type,
        createdAt: fixture.createdAt,
      },
    });
    accessRequestsCreated += 1;
  }

  // Only for a pair whose conversation has no message yet; existing chats are never touched.
  let chatMessagesCreated = 0;
  for (const fixture of CHAT_FIXTURES) {
    const customer = await prisma.user.findUnique({
      where: { telegramId: fixture.customerTelegramId },
    });
    const creator = await prisma.creator.findUnique({
      where: { publicCode: fixture.creatorPublicCode },
    });
    if (!customer || !creator) continue;
    const conversation = await prisma.conversation.upsert({
      where: { customerId_creatorId: { customerId: customer.id, creatorId: creator.id } },
      create: { customerId: customer.id, creatorId: creator.id },
      update: {},
    });
    if (fixture.customerLastReadSeq !== undefined) {
      // Never moves an existing cursor: reading is US-030's job.
      await prisma.conversationRead.upsert({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId: customer.id },
        },
        create: {
          conversationId: conversation.id,
          userId: customer.id,
          lastReadSeq: fixture.customerLastReadSeq,
        },
        update: {},
      });
    }
    if ((await prisma.message.count({ where: { conversationId: conversation.id } })) > 0) continue;
    await prisma.$transaction(async (tx) => {
      let seq = 0;
      for (const m of fixture.messages) {
        seq += 1;
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderUserId: m.from === 'customer' ? customer.id : creator.userId,
            body: m.body,
            clientMessageId: randomUUID(),
            seq,
            createdAt: m.at,
          },
        });
      }
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageSeq: seq,
          lastMessageAt: fixture.messages[fixture.messages.length - 1]!.at,
        },
      });
    });
    chatMessagesCreated += fixture.messages.length;
  }

  return {
    adminUsername,
    adminCreated,
    ...(generatedPassword ? { generatedPassword } : {}),
    usersCreated,
    usersExisting: USER_FIXTURES.length - usersCreated,
    creatorsCreated,
    subscriptionsCreated,
    applicationsCreated,
    accessRequestsCreated,
    chatMessagesCreated,
  };
}
