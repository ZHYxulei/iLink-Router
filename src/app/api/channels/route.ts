import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { generateWebhookToken } from '@/lib/channel-types';
import { router } from '@/lib/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CHANNEL_TYPE_ENUM = z.enum([
  'WEBHOOK',
  'HTTP_CLIENT', 'HTTP_SERVER', 'HTTP_SSE_SERVER',
  'ONEBOT_V11', 'ONEBOT_V12', 'SATORI', 'WS',
  'WS_SERVER', 'ONEBOT_V11_WS_SERVER', 'ONEBOT_V12_WS_SERVER',
  'HTTP', 'WECHATY', 'CUSTOM', // 旧类型兼容
]);

const ChannelInput = z.object({
  alias: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'alias must be alphanumeric/underscore/dash'),
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional().default(''),
  type: CHANNEL_TYPE_ENUM.optional().default('WEBHOOK'),
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

    // WEBHOOK 类型：自动生成 webhook_token 存入 config
    let finalConfig = d.config || '{}';
    if (d.type === 'WEBHOOK') {
      try {
        const cfg = JSON.parse(finalConfig);
        if (!cfg.webhook_token) {
          cfg.webhook_token = generateWebhookToken();
        }
        finalConfig = JSON.stringify(cfg);
      } catch {
        finalConfig = JSON.stringify({ webhook_token: generateWebhookToken() });
      }
    }

    const channel = await prisma.channel.create({
      data: {
        alias: d.alias,
        name: d.name,
        description: d.description,
        type: d.type,
        webhookUrl: d.webhookUrl,
        apiKey: d.apiKey,
        config: finalConfig,
        enabled: d.enabled,
        isDefault: d.isDefault,
      },
    });

    // 如果是 WS 服务端类型，尝试启动
    await router.reloadWsServer(channel).catch(() => {});
    // 如果是 HTTP 服务端类型，尝试启动
    await router.reloadHttpServer(channel).catch(() => {});

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
