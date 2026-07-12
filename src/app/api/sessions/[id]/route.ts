import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/sessions/[id] — fetch one session with its recent messages.
 *
 * Query:
 *   limit  (default 100, max 500)
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { id } = await ctx.params;

  const url = req.nextUrl;
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);

  const session = await prisma.session.findUnique({
    where: { id },
    include: { channel: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const messages = await prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({
    session,
    messages: messages.reverse(),
  });
}

/** DELETE /api/sessions/[id] — delete a session and all its messages. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { id } = await ctx.params;
  try {
    await prisma.session.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
