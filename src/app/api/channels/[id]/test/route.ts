import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { forwardToChannel, probeChannel } from '@/lib/forwarder';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/channels/[id]/test — probe or send a test message through a channel.
 *
 * Body:
 *   { mode: "probe" }                                  -> HEAD the webhook
 *   { mode: "forward", message: "ping test" }         -> forward a test message
 */
const TestBody = z.object({
  mode: z.enum(['probe', 'forward']).default('probe'),
  message: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const parsed = TestBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const channel = await prisma.channel.findUnique({
    where: { id },
  });
  if (!channel) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (parsed.data.mode === 'probe') {
    const result = await probeChannel(channel);
    return NextResponse.json(result);
  }

  // forward mode
  const message = parsed.data.message || 'iLink-Switch connectivity test';
  try {
    const { reply, latencyMs } = await forwardToChannel(
      channel,
      {
        sessionId: 'test-session',
        userId: 'test-user',
        userName: 'iLink Admin',
        message,
        receivedAt: new Date().toISOString(),
        channelAlias: channel.alias,
        history: [],
      },
      [],
    );
    return NextResponse.json({
      ok: true,
      reply,
      latencyMs,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 },
    );
  }
}
