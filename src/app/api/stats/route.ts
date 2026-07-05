import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { router } from '@/lib/router';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/stats — dashboard summary. */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const routerStatus = await router.getStatus();

  const [
    totalChannels,
    enabledChannels,
    totalSessions,
    activeSessionsToday,
    messagesToday,
    messagesTotal,
    recentMessages,
  ] = await Promise.all([
    prisma.channel.count(),
    prisma.channel.count({ where: { enabled: true } }),
    prisma.session.count(),
    prisma.session.count({
      where: { lastActiveAt: { gte: new Date(Date.now() - 86400_000) } },
    }),
    prisma.message.count({
      where: { createdAt: { gte: new Date(Date.now() - 86400_000) } },
    }),
    prisma.message.count(),
    prisma.message.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { session: true, channel: true },
    }),
  ]);

  // Top channels by message count (last 7 days).
  const channelStats = await prisma.message.groupBy({
    by: ['channelId'],
    where: {
      createdAt: { gte: new Date(Date.now() - 7 * 86400_000) },
      channelId: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { id: 'desc' } },
    take: 10,
  });

  const channels = await prisma.channel.findMany({
    where: { id: { in: channelStats.map((c) => c.channelId).filter(Boolean) as string[] } },
  });
  const channelById = new Map(channels.map((c) => [c.id, c]));

  return NextResponse.json({
    router: routerStatus,
    channels: {
      total: totalChannels,
      enabled: enabledChannels,
    },
    sessions: {
      total: totalSessions,
      activeToday: activeSessionsToday,
    },
    messages: {
      today: messagesToday,
      total: messagesTotal,
    },
    channelStats: channelStats.map((c) => {
      const ch = c.channelId ? channelById.get(c.channelId) : null;
      return {
        channelId: c.channelId,
        alias: ch?.alias || '(deleted)',
        name: ch?.name || '(deleted)',
        count: c._count._all,
      };
    }),
    recentMessages,
  });
}
