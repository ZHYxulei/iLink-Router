import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ChannelUpdate = z.object({
  alias: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(256).optional(),
  type: z.enum(['HTTP', 'WECHATY', 'CUSTOM']).optional(),
  webhookUrl: z.string().url().or(z.literal('')).optional(),
  apiKey: z.string().max(256).optional(),
  config: z.string().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

type Ctx = { params: { id: string } };

/** GET /api/channels/[id] — fetch one channel. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const channel = await prisma.channel.findUnique({
    where: { id: ctx.params.id },
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
    where: { id: ctx.params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (d.isDefault) {
    await prisma.channel.updateMany({
      where: { isDefault: true, NOT: { id: ctx.params.id } },
      data: { isDefault: false },
    });
  }

  try {
    const channel = await prisma.channel.update({
      where: { id: ctx.params.id },
      data: d,
    });
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
  try {
    await prisma.channel.delete({ where: { id: ctx.params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not found') || msg.includes('does not exist')) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
