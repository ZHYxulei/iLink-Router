import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/messages — list recent messages.
 *
 * Query:
 *   limit       (default 100, max 500)
 *   sessionId   (filter by session)
 *   channelId   (filter by channel)
 *   direction   ("IN" | "OUT")
 *   kind        ("command" | "forwarded" | "reply" | "system")
 */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
  const sessionId = url.searchParams.get('sessionId') || undefined;
  const channelId = url.searchParams.get('channelId') || undefined;
  const direction = url.searchParams.get('direction') || undefined;
  const kind = url.searchParams.get('kind') || undefined;

  const where: Record<string, unknown> = {};
  if (sessionId) where.sessionId = sessionId;
  if (channelId) where.channelId = channelId;
  if (direction) where.direction = direction;
  if (kind) where.kind = kind;

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { session: true, channel: true },
  });

  const total = await prisma.message.count({ where });

  return NextResponse.json({
    messages,
    total,
  });
}
