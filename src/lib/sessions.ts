import { prisma } from './db';
import { config } from './config';

/**
 * Get-or-create a WeChat user session.
 * `wxId` is the wechaty Contact.id; `wxName` is the display name.
 */
export async function getOrCreateSession(wxId: string, wxName: string) {
  const existing = await prisma.session.findUnique({
    where: { wxId },
    include: { channel: true },
  });
  if (existing) {
    // Update display name + lastActiveAt in-place.
    return prisma.session.update({
      where: { id: existing.id },
      data: {
        wxName: wxName || existing.wxName,
        lastActiveAt: new Date(),
      },
      include: { channel: true },
    });
  }

  // Pick a default channel (isDefault=true or DEFAULT_CHANNEL_ALIAS).
  let defaultChannelAlias: string | null = null;
  if (config.router.defaultChannelAlias) {
    const c = await prisma.channel.findUnique({
      where: { alias: config.router.defaultChannelAlias },
    });
    if (c?.enabled) defaultChannelAlias = c.alias;
  }
  if (!defaultChannelAlias) {
    const c = await prisma.channel.findFirst({
      where: { enabled: true, isDefault: true },
    });
    if (c) defaultChannelAlias = c.alias;
  }
  if (!defaultChannelAlias) {
    const c = await prisma.channel.findFirst({ where: { enabled: true } });
    if (c) defaultChannelAlias = c.alias;
  }

  return prisma.session.create({
    data: {
      wxId,
      wxName,
      currentChannel: defaultChannelAlias,
    },
    include: { channel: true },
  });
}

/** Increment message count + touch lastActiveAt. */
export async function touchSession(sessionId: string) {
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      messageCount: { increment: 1 },
      lastActiveAt: new Date(),
    },
  });
}

/** Switch the active channel for a session by alias. */
export async function switchChannel(
  sessionId: string,
  alias: string,
): Promise<{ ok: boolean; error?: string; channel?: { alias: string; name: string } }> {
  const channel = await prisma.channel.findUnique({
    where: { alias },
  });
  if (!channel) return { ok: false, error: `渠道 ${alias} 不存在` };
  if (!channel.enabled) return { ok: false, error: `渠道 ${alias} 已禁用` };
  await prisma.session.update({
    where: { id: sessionId },
    data: { currentChannel: alias, lastActiveAt: new Date() },
  });
  return { ok: true, channel: { alias: channel.alias, name: channel.name } };
}

/** Build a short conversation history for upstream forwarding. */
export async function getRecentHistory(
  sessionId: string,
  limit = 8,
): Promise<{ role: 'user' | 'assistant'; text: string; ts: string }[]> {
  const rows = await prisma.message.findMany({
    where: {
      sessionId,
      kind: { in: ['forwarded', 'reply'] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows
    .reverse()
    .map((r) => ({
      role: r.direction === 'IN' ? ('user' as const) : ('assistant' as const),
      text: r.text,
      ts: r.createdAt.toISOString(),
    }));
}
