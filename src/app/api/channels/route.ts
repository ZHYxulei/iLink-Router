import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ChannelInput = z.object({
  alias: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'alias must be alphanumeric/underscore/dash'),
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional().default(''),
  type: z.enum(['HTTP', 'WECHATY', 'CUSTOM']).optional().default('HTTP'),
  webhookUrl: z.string().url().or(z.literal('')).optional().default(''),
  apiKey: z.string().max(256).optional().default(''),
  config: z.string().optional().default('{}'),
  enabled: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

/** GET /api/channels — list all channels. */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const channels = await prisma.channel.findMany({
    orderBy: [{ isDefault: 'desc' }, { alias: 'asc' }],
  });
  return NextResponse.json({ channels });
}

/** POST /api/channels — create a channel. */
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const body = await req.json().catch(() => null);
  const parsed = ChannelInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;

  try {
    // If isDefault, clear other defaults.
    if (d.isDefault) {
      await prisma.channel.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    const channel = await prisma.channel.create({
      data: {
        alias: d.alias,
        name: d.name,
        description: d.description,
        type: d.type,
        webhookUrl: d.webhookUrl,
        apiKey: d.apiKey,
        config: d.config || '{}',
        enabled: d.enabled,
        isDefault: d.isDefault,
      },
    });
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Unique constraint')) {
      return NextResponse.json(
        { error: `alias "${d.alias}" already exists` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
