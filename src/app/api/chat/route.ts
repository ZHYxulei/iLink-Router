import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { router } from '@/lib/router';
import { logMessage } from '@/lib/forwarder';
import { getOrCreateSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * /api/chat — 支持聊天调试界面。
 *
 * GET  /api/chat?sessionId=xxx       获取指定会话的消息记录（最近 limit 条）
 * GET  /api/chat?list=1              列出所有会话（供聊天界面切换）
 * POST /api/chat { action: 'send' | 'reply' | 'create-session', ... }
 *   - send:          模拟微信用户发送消息（不真发微信，回复返回给前端）
 *   - reply:         双向模式 — 模拟渠道回复（真发到微信）
 *   - create-session: 创建独立测试会话
 */
const ChatBody = z.object({
  action: z.enum(['send', 'reply', 'create-session']),
  // send
  wxId: z.string().optional(),
  message: z.string().optional(),
  // reply
  sessionId: z.string().optional(),
  reply: z.string().optional(),
  // create-session
  wxName: z.string().optional(),
});

/** GET — 拉取会话消息 / 列出会话 */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const url = req.nextUrl;

  // 列出所有会话
  if (url.searchParams.get('list') === '1') {
    const sessions = await prisma.session.findMany({
      orderBy: { lastActiveAt: 'desc' },
      take: 100,
      include: { channel: true },
    });
    return NextResponse.json({ sessions });
  }

  // 拉取指定会话的消息
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 500);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { channel: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'session not found' }, { status: 404 });
  }
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { channel: true },
  });
  return NextResponse.json({ session, messages });
}

/** POST — 模拟发送 / 回复 / 创建会话 */
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const body = await req.json().catch(() => null);
  const parsed = ChatBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;

  try {
    if (d.action === 'send') {
      // 模拟微信用户发送消息
      if (!d.wxId || !d.message) {
        return NextResponse.json(
          { error: 'wxId and message are required for send' },
          { status: 400 },
        );
      }
      const result = await router.simulateInbound(d.wxId, d.message);
      return NextResponse.json({ ok: true, ...result });
    }

    if (d.action === 'reply') {
      // 双向模式 — 模拟渠道回复，真正发送到微信用户
      if (!d.sessionId || !d.reply) {
        return NextResponse.json(
          { error: 'sessionId and reply are required for reply' },
          { status: 400 },
        );
      }
      const session = await prisma.session.findUnique({
        where: { id: d.sessionId },
        include: { channel: true },
      });
      if (!session) {
        return NextResponse.json({ error: 'session not found' }, { status: 404 });
      }
      const sent = await router.sendToUser(session.wxId, d.reply);
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: d.reply,
        kind: 'reply',
        channelId: session.channel?.id,
      });
      return NextResponse.json({ ok: true, delivered: sent });
    }

    if (d.action === 'create-session') {
      // 创建独立测试会话
      const wxId = d.wxId || `test_${Date.now()}`;
      const wxName = d.wxName || `测试会话 ${new Date().toLocaleString('zh-CN')}`;
      const session = await getOrCreateSession(wxId, wxName);
      return NextResponse.json({ ok: true, session }, { status: 201 });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
