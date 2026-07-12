import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { router } from '@/lib/router';
import { getWebhookToken } from '@/lib/channel-types';
import { logMessage } from '@/lib/forwarder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/webhook/[alias]?key=<token>
 *
 * 客户端通过此端点向微信用户推送消息/回复。
 *
 * 请求体（JSON）:
 *   { "userId": "wxid_xxx", "message": "回复内容" }
 *   或 { "sessionId": "cmr...", "reply": "回复内容" }
 *
 * 认证：query 参数 key 必须匹配渠道的 webhook_token。
 * 如果渠道配置了 api_key，还需在 X-Webhook-Key 头中携带。
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ alias: string }> },
) {
  const { alias } = await ctx.params;
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';

  // 查找渠道
  const channel = await prisma.channel.findUnique({
    where: { alias },
  });
  if (!channel) {
    return NextResponse.json({ error: 'channel not found' }, { status: 404 });
  }
  if (!channel.enabled) {
    return NextResponse.json({ error: 'channel disabled' }, { status: 403 });
  }

  // 验证 token
  const token = getWebhookToken(channel.config);
  if (!token || key !== token) {
    return NextResponse.json({ error: 'invalid webhook token' }, { status: 401 });
  }

  // 如果配置了 api_key，验证 X-Webhook-Key 头
  const cfg = JSON.parse(channel.config || '{}');
  const expectedApiKey = cfg.api_key || channel.apiKey;
  if (expectedApiKey) {
    const providedKey =
      req.headers.get('x-webhook-key') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';
    if (providedKey !== expectedApiKey) {
      return NextResponse.json({ error: 'invalid api key' }, { status: 401 });
    }
  }

  // 解析请求体
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body must be JSON object' }, { status: 400 });
  }

  const message = String(body.message || body.reply || body.text || '').trim();
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  // 确定 userId
  let userId = String(body.userId || '');
  let sessionId = String(body.sessionId || '');

  if (!userId && sessionId) {
    // 通过 sessionId 查找 userId
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      return NextResponse.json({ error: 'session not found' }, { status: 404 });
    }
    userId = session.wxId;
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'userId or sessionId is required' },
      { status: 400 },
    );
  }

  // 构造来源信息前缀，让用户知道消息来自哪个渠道
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const sourceHeader =
    `📨 来自渠道推送\n` +
    `━━━━━━━━━━━━━━\n` +
    `渠道：${channel.name}（${channel.alias}）\n` +
    `类型：${channel.type}\n` +
    `时间：${timeStr}\n` +
    `━━━━━━━━━━━━━━`;

  // 先发送来源信息，再转发原始消息内容
  const headerOk = await router.sendToUser(userId, sourceHeader);
  if (!headerOk) {
    return NextResponse.json(
      { error: 'router offline or send failed' },
      { status: 503 },
    );
  }

  // 转发原始消息（不修改内容）
  const ok = await router.sendToUser(userId, message);

  // 记录消息
  if (sessionId) {
    await logMessage({
      sessionId,
      direction: 'OUT',
      text: `[${sourceHeader}]\n${message}`,
      kind: 'reply',
      channelId: channel.id,
      error: ok ? '' : 'send failed',
    }).catch(() => {});
  }

  if (!ok) {
    return NextResponse.json(
      { error: 'router offline or send failed' },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, sent: true });
}

/**
 * GET /api/webhook/[alias]?key=<token>
 * 健康检查，客户端可用于验证 webhook URL 是否有效。
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ alias: string }> },
) {
  const { alias } = await ctx.params;
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';

  const channel = await prisma.channel.findUnique({
    where: { alias },
  });
  if (!channel) {
    return NextResponse.json({ error: 'channel not found' }, { status: 404 });
  }

  const token = getWebhookToken(channel.config);
  if (!token || key !== token) {
    return NextResponse.json({ error: 'invalid webhook token' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    channel: alias,
    type: channel.type,
    enabled: channel.enabled,
  });
}
