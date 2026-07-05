import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { config } from '@/lib/config';
import { logMessage } from '@/lib/forwarder';
import { router } from '@/lib/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/inbound — async callback endpoint for upstream channels.
 *
 * Upstreams that can't reply synchronously (e.g. another WeChat bot)
 * can POST the reply back here. The router forwards it to the user.
 *
 * Body:
 *   {
 *     sessionId: "...",       // required
 *     reply: "...",           // required
 *     channelId: "..."        // optional, for verification
 *   }
 *
 * Auth: if UPSTREAM_WEBHOOK_SECRET is set, the caller must send
 *       `X-ILink-Router-Secret: <secret>` header (same secret the router
 *       sends when forwarding).
 */
const InboundBody = z.object({
  sessionId: z.string().min(1),
  reply: z.string().min(1),
  channelId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // Verify the shared secret if configured.
  if (config.upstream.webhookSecret) {
    const got = req.headers.get('x-ilink-router-secret') || '';
    if (got !== config.upstream.webhookSecret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  const parsed = InboundBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { sessionId, reply, channelId } = parsed.data;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { channel: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }

  // Send the reply to the user via WeChat.
  const sent = await router.sendToUser(session.wxId, reply);
  if (!sent) {
    return NextResponse.json(
      { error: 'failed to send (router offline or user not contactable)' },
      { status: 503 },
    );
  }

  await logMessage({
    sessionId,
    direction: 'OUT',
    text: reply,
    kind: 'reply',
    channelId: channelId || session.channel?.id,
  });

  return NextResponse.json({ ok: true });
}
