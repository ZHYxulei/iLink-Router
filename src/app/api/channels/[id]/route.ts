import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { router } from '@/lib/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CHANNEL_TYPE_ENUM = z.enum([
  'WEBHOOK',
  'HTTP_CLIENT', 'HTTP_SERVER', 'HTTP_SSE_SERVER',
  'ONEBOT_V11', 'ONEBOT_V12', 'SATORI', 'WS',
  'WS_SERVER', 'ONEBOT_V11_WS_SERVER', 'ONEBOT_V12_WS_SERVER',
  'HTTP', 'WECHATY', 'CUSTOM',
]);

const ChannelUpdate = z.object({
  alias: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(256).optional(),
  type: CHANNEL_TYPE_ENUM.optional(),
  webhookUrl: z.string().url().or(z.literal('')).optional(),
  apiKey: z.string().max(256).optional(),
  config: z.string().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/channels/[id] — fetch one channel. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { id } = await ctx.params;
  const channel = await prisma.channel.findUnique({
    where: { id },
  });
  if (!channel) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ channel });
}

/** PATCH /api/channels/[id] — update a channel. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = ChannelUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const existing = await prisma.channel.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (d.isDefault) {
    await prisma.channel.updateMany({
      where: { isDefault: true, NOT: { id } },
      data: { isDefault: false },
    });
  }

  try {
    const channel = await prisma.channel.update({
      where: { id },
      data: d,
    });
    // 如果是 WS 服务端类型，重载
    await router.reloadWsServer(channel).catch(() => {});
    // 如果是 HTTP 服务端类型，重载
    await router.reloadHttpServer(channel).catch(() => {});
    return NextResponse.json({ channel });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Unique constraint')) {
      return NextResponse.json({ error: 'alias already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/channels/[id] — delete a channel. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const { id } = await ctx.params;
  try {
    // 停止可能存在的 WS 服务端
    await router.unloadWsServer(id).catch(() => {});
    // 停止可能存在的 HTTP 服务端
    await router.unloadHttpServer(id).catch(() => {});
    await prisma.channel.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found') || msg.includes('does not exist')) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
