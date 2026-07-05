import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/sessions — list recent sessions.
 *
 * Query:
 *   limit  (default 50, max 200)
 *   search (filter by wxName or wxId)
 */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
  const search = url.searchParams.get('search') || '';

  const where = search
    ? {
        OR: [
          { wxName: { contains: search } },
          { wxId: { contains: search } },
        ],
      }
    : undefined;

  const sessions = await prisma.session.findMany({
    where,
    orderBy: { lastActiveAt: 'desc' },
    take: limit,
    include: { channel: true },
  });

  const total = await prisma.session.count();
  const activeToday = await prisma.session.count({
    where: { lastActiveAt: { gte: new Date(Date.now() - 86400_000) } },
  });

  return NextResponse.json({
    sessions,
    total,
    activeToday,
  });
}
