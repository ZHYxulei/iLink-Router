import { config } from './config';
import { prisma } from './db';
import { probeChannel } from './forwarder';
import { switchChannel, getOrCreateSession } from './sessions';
import { router } from './router';
import type { DispatchResult } from './types';

/**
 * Command dispatcher — called by the router when a message starts with the
 * configured command prefix (default "!").
 *
 * Each handler returns the text to send back to the user.
 */

export async function dispatchCommand(
  sessionId: string,
  wxId: string,
  wxName: string,
  raw: string,
): Promise<DispatchResult | null> {
  const prefix = config.router.commandPrefix;
  if (!raw.startsWith(prefix)) return null;

  // Strip prefix and split into <name> <args...>
  const trimmed = raw.slice(prefix.length).trim();
  if (!trimmed) return null;

  const [name, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ').trim();
  const lower = name.toLowerCase();

  switch (lower) {
    case 'ping':
      return cmdPing();
    case 'switch':
      return cmdSwitch(sessionId, args);
    case 'info':
      return cmdInfo(sessionId, wxId, wxName);
    case 'status':
      return cmdStatus();
    case 'help':
      return cmdHelp();
    case 'channels':
      return cmdListChannels();
    default:
      return {
        handled: true,
        kind: 'command',
        reply: `未知命令: ${name}\n发送 ${prefix}help 查看可用命令`,
      };
  }
}

// --- Handlers ----------------------------------------------------------------

function cmdPing(): DispatchResult {
  // Router replies "pong!" directly (per requirement, lowercase pong).
  return { handled: true, kind: 'command', reply: 'pong!' };
}

async function cmdSwitch(
  sessionId: string,
  alias: string,
): Promise<DispatchResult> {
  if (!alias) {
    return {
      handled: true,
      kind: 'command',
      reply:
        `用法: ${config.router.commandPrefix}switch <别名>\n` +
        `例: ${config.router.commandPrefix}switch gpt4`,
    };
  }
  const result = await switchChannel(sessionId, alias);
  if (!result.ok) {
    return {
      handled: true,
      kind: 'command',
      reply: `❌ 切换失败: ${result.error}`,
    };
  }
  return {
    handled: true,
    kind: 'command',
    reply: `✅ 已切换到渠道「${result.channel!.name}」(${result.channel!.alias})`,
  };
}

async function cmdInfo(
  sessionId: string,
  wxId: string,
  wxName: string,
): Promise<DispatchResult> {
  // Refresh the session in case the channel was renamed.
  const session = await getOrCreateSession(wxId, wxName);
  const count = await prisma.message.count({ where: { sessionId } });
  const channelAlias = session.currentChannel || '(无)';
  const channelName = session.channel?.name || '(未绑定)';

  const recentIn = await prisma.message.count({
    where: { sessionId, direction: 'IN' },
  });
  const recentOut = await prisma.message.count({
    where: { sessionId, direction: 'OUT' },
  });

  return {
    handled: true,
    kind: 'command',
    reply:
      `📊 会话信息\n` +
      `─────────\n` +
      `用户: ${wxName || wxId}\n` +
      `当前渠道: ${channelName} (${channelAlias})\n` +
      `消息总数: ${count} (收 ${recentIn} / 发 ${recentOut})\n` +
      `首次会话: ${session.createdAt.toISOString().replace('T', ' ').slice(0, 19)}\n` +
      `最近活跃: ${session.lastActiveAt.toISOString().replace('T', ' ').slice(0, 19)}`,
  };
}

async function cmdStatus(): Promise<DispatchResult> {
  const snap = await router.getStatus();
  const channels = await prisma.channel.findMany({
    where: { enabled: true },
  });

  // Probe each enabled channel concurrently (best-effort).
  const probes = await Promise.all(
    channels.map(async (c) => {
      const r = await probeChannel(c);
      return { ...c, ...r };
    }),
  );

  const lines: string[] = [];
  lines.push('🛰 路由状态');
  lines.push('─────────');
  lines.push(`状态: ${snap.status}  登录: ${snap.loginStatus}`);
  lines.push(`账号: ${snap.selfWxName || snap.selfWxId || '(未登录)'}`);
  lines.push(`运行时间: ${formatUptime(snap.uptimeSeconds)}`);
  if (snap.lastError) lines.push(`最近错误: ${snap.lastError}`);
  lines.push('');
  lines.push(`已启用渠道: ${channels.length} 个`);
  for (const p of probes) {
    const tag = p.ok ? '✅' : '❌';
    const ms = p.latencyMs ? `${p.latencyMs}ms` : '-';
    lines.push(`  ${tag} ${p.alias} (${p.name}) — ${ms}`);
  }

  return {
    handled: true,
    kind: 'command',
    reply: lines.join('\n'),
  };
}

function cmdHelp(): DispatchResult {
  const p = config.router.commandPrefix;
  return {
    handled: true,
    kind: 'command',
    reply:
      `📖 iLink-Switch 命令列表\n` +
      `────────────────────\n` +
      `${p}ping        — 检查路由是否在线\n` +
      `${p}info        — 显示当前渠道、对话数等信息\n` +
      `${p}status      — 查询路由系统状态\n` +
      `${p}switch <别名> — 切换当前会话到指定上游渠道\n` +
      `${p}channels    — 列出所有可用渠道\n` +
      `${p}help        — 显示此帮助信息`,
  };
}

async function cmdListChannels(): Promise<DispatchResult> {
  const channels = await prisma.channel.findMany({
    where: { enabled: true },
    orderBy: { alias: 'asc' },
  });
  if (channels.length === 0) {
    return {
      handled: true,
      kind: 'command',
      reply: '⚠ 暂无已启用的渠道，请在管理面板绑定上游后重试',
    };
  }
  const lines = channels.map(
    (c, i) => `${i + 1}. ${c.alias} — ${c.name}${c.isDefault ? ' (默认)' : ''}`,
  );
  return {
    handled: true,
    kind: 'command',
    reply: `📡 可用渠道\n─────────\n${lines.join('\n')}`,
  };
}

function formatUptime(sec: number): string {
  if (!sec || sec <= 0) return '-';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}时`);
  if (m) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join('');
}
