import type { HistoryQuery, HistoryResponse } from '@creatorchat/contracts';
import type { PrismaClient } from '@creatorchat/db';
import { listHistory } from '../creator-detail/creator-history.service.js';
import { UUID } from './user-detail.service.js';

/** The audit rows about one USER (US-018): rows targeting the user, one of their applications or one of their access requests. */
export class UserHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /** `null` when the id is not a USER account. */
  async list(userId: string, query: HistoryQuery): Promise<HistoryResponse | null> {
    if (!UUID.test(userId)) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        creatorApplications: { select: { id: true } },
        accessRequests: { select: { id: true } },
      },
    });
    if (!user || user.role !== 'USER') return null;
    return listHistory(
      this.prisma,
      {
        userId,
        applicationIds: user.creatorApplications.map((a) => a.id),
        creatorId: null,
        accessRequestIds: user.accessRequests.map((r) => r.id),
      },
      query,
    );
  }
}
