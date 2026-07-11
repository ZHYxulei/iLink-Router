import { config } from './config';
import { prisma } from './db';
import type { Channel } from '@prisma/client';
import type { ForwardPayload, ForwardResponse } from './types';
import { safeJsonParse } from './utils';
import { sendToWsServer } from './ws-transport';

// ---------------------------------------------------------------------------
// 类型分发：根据 channel.type 调用对应的转发器
// ---------------------------------------------------------------------------

// 旧类型兼容映射
const LEGACY_TYPE_MAP: Record<string, string> = {
  HTTP: 'WEBHOOK',
  WECHATY: 'WEBHOOK',
  CUSTOM: 'WEBHOOK',
};

function normalizeType(type: string): string {
  return LEGACY_TYPE_MAP[type] || type;
}

/**
 * 转发消息到上游渠道。根据 channel.type 分发到对应的协议实现。
 */
export async function forwardToChannel(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[] = [],
): Promise<{ reply: string; latencyMs: number }> {
  const type = normalizeType(channel.type);
  switch (type) {
    case 'WEBHOOK':
      return forwardWebhook(channel, payload, history);
    case 'HTTP_CLIENT':
      return forwardHttpClient(channel, payload, history);
    case 'HTTP_SERVER':
    case 'HTTP_SSE_SERVER':
      return forwardHttpServer(channel, payload, history);
    case 'ONEBOT_V11':
      return forwardOneBotV11(channel, payload, history);
    case 'ONEBOT_V12':
      return forwardOneBotV12(channel, payload, history);
    case 'SATORI':
      return forwardSatori(channel, payload, history);
    case 'WS':
      return forwardWs(channel, payload, history);
    case 'WS_SERVER':
    case 'ONEBOT_V11_WS_SERVER':
    case 'ONEBOT_V12_WS_SERVER':
      return forwardWsServer(channel, payload, history);
    default:
      // 兜底：按 webhook 处理
      return forwardWebhook(channel, payload, history);
  }
}

// ---------------------------------------------------------------------------
// WEBHOOK — 可选 outbound（主动 POST 到上游）+ inbound（客户端推送回复）
// ---------------------------------------------------------------------------

async function forwardWebhook(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const cfg = safeJsonParse<Record<string, unknown>>(channel.config || '{}', {});
  const outboundUrl = channel.webhookUrl || (cfg.outbound_url as string) || '';

  // 没有 outbound URL：纯 inbound 模式，等待客户端通过 webhook URL 推送回复
  if (!outboundUrl) {
    // 返回提示，告诉用户回复将通过 webhook 异步推送
    return {
      reply: '⏳ 消息已转发，上游将通过 Webhook 异步回复...',
      latencyMs: 0,
    };
  }

  // 有 outbound URL：同步模式，POST 到上游并等待回复
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ILink-Channel': channel.alias,
    ...(channel.apiKey ? { 'X-ILink-Key': channel.apiKey } : {}),
    ...(config.upstream.webhookSecret
      ? { 'X-ILink-Router-Secret': config.upstream.webhookSecret }
      : {}),
  };

  const body: ForwardPayload = {
    sessionId: payload.sessionId,
    userId: payload.userId,
    userName: payload.userName,
    message: payload.message,
    receivedAt: payload.receivedAt,
    channelAlias: channel.alias,
    history,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.router.forwardTimeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(outboundUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`upstream ${channel.alias} returned ${res.status}: ${raw.slice(0, 500)}`);
    }
    let parsed: ForwardResponse;
    try {
      parsed = JSON.parse(raw) as ForwardResponse;
    } catch {
      parsed = { reply: raw };
    }
    if (typeof parsed.reply !== 'string' || parsed.reply.length === 0) {
      throw new Error(`upstream ${channel.alias} returned empty reply`);
    }
    return { reply: parsed.reply, latencyMs };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`upstream ${channel.alias} timed out after ${config.router.forwardTimeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OneBot v11 — 向 OneBot 实现的 HTTP 上报端点发送消息事件
// ---------------------------------------------------------------------------

async function forwardOneBotV11(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const cfg = safeJsonParse<Record<string, string>>(channel.config || '{}', {});
  const endpoint = cfg.endpoint || channel.webhookUrl;
  if (!endpoint) {
    throw new Error(`渠道 ${channel.alias} 未配置 endpoint`);
  }
  const accessToken = cfg.access_token || channel.apiKey || '';
  const selfId = cfg.self_id || '';
  const messageType = cfg.message_type || 'private';
  const targetId = cfg.target_id || '';

  // 构造 OneBot v11 消息事件格式（模拟上报）
  const event = {
    post_type: 'message',
    message_type: messageType,
    sub_type: messageType === 'group' ? 'normal' : 'friend',
    user_id: Number(targetId) || targetId,
    group_id: messageType === 'group' ? Number(targetId) || targetId : undefined,
    message: payload.message,
    raw_message: payload.message,
    sender: { user_id: Number(targetId) || targetId, nickname: payload.userName },
    self_id: Number(selfId) || selfId,
    time: Math.floor(Date.now() / 1000),
    message_id: payload.sessionId,
    // 路由附加信息
    ilink_meta: {
      sessionId: payload.sessionId,
      userId: payload.userId,
      userName: payload.userName,
      receivedAt: payload.receivedAt,
      channelAlias: channel.alias,
      history,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ILink-Channel': channel.alias,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(config.upstream.webhookSecret ? { 'X-ILink-Router-Secret': config.upstream.webhookSecret } : {}),
  };

  return doHttpPost(endpoint, event, headers, channel.alias);
}

// ---------------------------------------------------------------------------
// OneBot v12 — 向 OneBot v12 实现的 HTTP 端点发送消息事件
// ---------------------------------------------------------------------------

async function forwardOneBotV12(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const cfg = safeJsonParse<Record<string, string>>(channel.config || '{}', {});
  const endpoint = cfg.endpoint || channel.webhookUrl;
  if (!endpoint) {
    throw new Error(`渠道 ${channel.alias} 未配置 endpoint`);
  }
  const accessToken = cfg.access_token || channel.apiKey || '';
  const platform = cfg.platform || 'qq';
  const selfId = cfg.self_id || '';
  const detailType = cfg.detail_type || 'private';
  const targetId = cfg.target_id || '';

  // 构造 OneBot v12 事件格式
  const event = {
    type: 'message',
    detail_type: detailType,
    sub_type: detailType === 'private' ? 'friend' : 'normal',
    platform,
    self: { platform, user_id: selfId },
    message: [{ type: 'text', data: { text: payload.message } }],
    alt_message: payload.message,
    user_id: targetId,
    group_id: detailType === 'group' ? targetId : undefined,
    channel_id: detailType === 'channel' ? targetId : undefined,
    time: Math.floor(Date.now() / 1000),
    message_id: payload.sessionId,
    // 路由附加信息
    ilink_meta: {
      sessionId: payload.sessionId,
      userId: payload.userId,
      userName: payload.userName,
      receivedAt: payload.receivedAt,
      channelAlias: channel.alias,
      history,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ILink-Channel': channel.alias,
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(config.upstream.webhookSecret ? { 'X-ILink-Router-Secret': config.upstream.webhookSecret } : {}),
  };

  return doHttpPost(endpoint, event, headers, channel.alias);
}

// ---------------------------------------------------------------------------
// Satori — 向 Satori 服务发送消息事件
// ---------------------------------------------------------------------------

async function forwardSatori(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const cfg = safeJsonParse<Record<string, string>>(channel.config || '{}', {});
  const apiUrl = cfg.api_url || channel.webhookUrl;
  if (!apiUrl) {
    throw new Error(`渠道 ${channel.alias} 未配置 api_url`);
  }
  const token = cfg.token || channel.apiKey || '';
  const platform = cfg.platform || 'qq';
  const selfId = cfg.self_id || '';
  const channelId = cfg.channel_id || '';

  // 构造 Satori 事件格式
  const event = {
    type: 'message-created',
    platform,
    self_id: selfId,
    data: {
      channel: { id: channelId, type: 'text' },
      user: { id: payload.userId, name: payload.userName },
      member: { user: { id: payload.userId, name: payload.userName } },
      content: payload.message,
      message: {
        id: payload.sessionId,
        channel: { id: channelId, type: 'text' },
        user: { id: payload.userId, name: payload.userName },
        content: payload.message,
        created_at: Math.floor(Date.now() / 1000),
      },
    },
    // 路由附加信息
    ilink_meta: {
      sessionId: payload.sessionId,
      userId: payload.userId,
      userName: payload.userName,
      receivedAt: payload.receivedAt,
      channelAlias: channel.alias,
      history,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ILink-Channel': channel.alias,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(config.upstream.webhookSecret ? { 'X-ILink-Router-Secret': config.upstream.webhookSecret } : {}),
  };

  return doHttpPost(apiUrl, event, headers, channel.alias);
}

// ---------------------------------------------------------------------------
// WS — WebSocket 连接，发送帧并等待回复
// ---------------------------------------------------------------------------

// 连接池：channelId → WebSocket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wsPool = new Map<string, { ws: any; createdAt: number }>();

async function getWsConnection(channel: Channel): Promise<WebSocket> {
  const existing = wsPool.get(channel.id);
  if (existing && existing.ws.readyState === 1 /* OPEN */) {
    return existing.ws;
  }
  // 清理旧连接
  if (existing) {
    try { existing.ws.close(); } catch { /* noop */ }
    wsPool.delete(channel.id);
  }

  const cfg = safeJsonParse<Record<string, string>>(channel.config || '{}', {});
  let wsUrl = cfg.ws_url || '';
  if (!wsUrl) throw new Error(`渠道 ${channel.alias} 未配置 ws_url`);
  const token = cfg.token || channel.apiKey || '';
  const protocol = cfg.protocol || '';

  // token 通过 query 参数传递
  if (token) {
    const sep = wsUrl.includes('?') ? '&' : '?';
    wsUrl += `${sep}token=${encodeURIComponent(token)}`;
  }

  const protocols = protocol ? [protocol] : undefined;
  // Node.js 18+ 内置 WebSocket
  const ws = new WebSocket(wsUrl, protocols);

  return new Promise<WebSocket>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`WS connect timeout for ${channel.alias}`));
      try { ws.close(); } catch { /* noop */ }
    }, 10000);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      wsPool.set(channel.id, { ws, createdAt: Date.now() });
      resolve(ws);
    });

    ws.addEventListener('error', () => {
      clearTimeout(timer);
      wsPool.delete(channel.id);
      reject(new Error(`WS connect failed for ${channel.alias}`));
    });
  });
}

async function forwardWs(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const ws = await getWsConnection(channel);
  const started = Date.now();

  const frame = {
    type: 'message',
    sessionId: payload.sessionId,
    userId: payload.userId,
    userName: payload.userName,
    message: payload.message,
    receivedAt: payload.receivedAt,
    channelAlias: channel.alias,
    history,
  };

  return new Promise<{ reply: string; latencyMs: number }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`WS reply timeout for ${channel.alias} after ${config.router.forwardTimeoutMs}ms`));
    }, config.router.forwardTimeoutMs);

    const onMessage = (event: MessageEvent) => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      const latencyMs = Date.now() - started;
      try {
        const data = JSON.parse(event.data as string);
        const reply = data.reply || data.message || data.text || '';
        if (!reply) {
          reject(new Error(`WS ${channel.alias} returned empty reply`));
          return;
        }
        resolve({ reply, latencyMs });
      } catch {
        // 非JSON，直接当文本
        const raw = String(event.data);
        if (raw) {
          resolve({ reply: raw, latencyMs });
        } else {
          reject(new Error(`WS ${channel.alias} returned empty reply`));
        }
      }
    };

    const onError = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      wsPool.delete(channel.id);
      reject(new Error(`WS error for ${channel.alias}`));
    };

    const onClose = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
      wsPool.delete(channel.id);
      reject(new Error(`WS closed for ${channel.alias}`));
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);

    ws.send(JSON.stringify(frame));
  });
}

// ---------------------------------------------------------------------------
// WS 服务端 — 通过 ws-transport 向已连接的 WS 客户端发送消息
// ---------------------------------------------------------------------------

async function forwardWsServer(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const cfg = safeJsonParse<Record<string, unknown>>(channel.config || '{}', {});
  return sendToWsServer(
    channel.id,
    {
      message: payload.message,
      userId: payload.userId,
      userName: payload.userName,
      sessionId: payload.sessionId,
      history,
    },
    cfg,
    config.router.forwardTimeoutMs,
  );
}

// ---------------------------------------------------------------------------
// HTTP_CLIENT — 路由作为 HTTP 客户端，可配置请求模板
// ---------------------------------------------------------------------------

async function forwardHttpClient(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  const cfg = safeJsonParse<Record<string, unknown>>(channel.config || '{}', {});
  const method = (cfg.method as string) || 'POST';
  const urlTemplate = (cfg.url_template as string) || '';
  const bodyTemplate = (cfg.body_template as string) || '';
  const replyPath = (cfg.reply_path as string) || 'reply';
  const extraHeaders = (cfg.headers as Record<string, string>) || {};
  const apiKey = (cfg.api_key as string) || channel.apiKey || '';

  if (!urlTemplate) {
    throw new Error(`渠道 ${channel.alias} 未配置 url_template`);
  }

  // 变量替换
  const vars: Record<string, string> = {
    userId: payload.userId,
    userName: payload.userName,
    sessionId: payload.sessionId,
    message: payload.message,
    receivedAt: payload.receivedAt,
    channelAlias: payload.channelAlias,
  };
  const url = urlTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] || '');
  const body = bodyTemplate
    ? bodyTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) => {
        const v = vars[k] || '';
        // JSON 字符串转义
        return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      })
    : '';

  const headers: Record<string, string> = {
    ...extraHeaders,
  };
  if (method !== 'GET' && body) {
    headers['Content-Type'] = 'application/json';
  }
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.router.forwardTimeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && body ? body : undefined,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`upstream ${channel.alias} returned ${res.status}: ${raw.slice(0, 500)}`);
    }

    // 提取回复
    let reply = '';
    try {
      const parsed = JSON.parse(raw);
      reply = extractByPath(parsed, replyPath);
    } catch {
      reply = raw;
    }
    if (!reply) {
      throw new Error(`upstream ${channel.alias} returned empty reply at path "${replyPath}"`);
    }
    return { reply, latencyMs };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`upstream ${channel.alias} timed out after ${config.router.forwardTimeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 按点号路径从对象中提取值。 */
function extractByPath(obj: unknown, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return '';
    if (Array.isArray(cur)) {
      const idx = parseInt(p, 10);
      cur = isNaN(idx) ? '' : cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return '';
    }
  }
  if (typeof cur === 'string') return cur;
  if (cur == null) return '';
  return JSON.stringify(cur);
}

// ---------------------------------------------------------------------------
// HTTP_SERVER / HTTP_SSE_SERVER — 路由启动 HTTP 服务端，消息通过 SSE/缓冲推送
// ---------------------------------------------------------------------------

async function forwardHttpServer(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[],
): Promise<{ reply: string; latencyMs: number }> {
  // 推送消息到 HTTP 服务端的 SSE 客户端和缓冲区
  const { pushToHttpServer } = await import('./http-transport');
  pushToHttpServer(channel.id, {
    userId: payload.userId,
    message: payload.message,
  });

  // HTTP 服务端模式：异步等待客户端通过 /send 推送回复
  // 这里返回提示，实际回复通过 webhook 入站机制推送
  return {
    reply: '⏳ 消息已推送到 HTTP 服务端，等待客户端通过 /send 回复...',
    latencyMs: 0,
  };
}

// ---------------------------------------------------------------------------
// HTTP POST 公共工具
// ---------------------------------------------------------------------------

async function doHttpPost(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  alias: string,
): Promise<{ reply: string; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.router.forwardTimeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`upstream ${alias} returned ${res.status}: ${raw.slice(0, 500)}`);
    }
    let parsed: ForwardResponse;
    try {
      parsed = JSON.parse(raw) as ForwardResponse;
    } catch {
      parsed = { reply: raw };
    }
    if (typeof parsed.reply !== 'string' || parsed.reply.length === 0) {
      throw new Error(`upstream ${alias} returned empty reply`);
    }
    return { reply: parsed.reply, latencyMs };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`upstream ${alias} timed out after ${config.router.forwardTimeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 探活 & 日志
// ---------------------------------------------------------------------------

/**
 * 探活：根据渠道类型检查连通性。
 */
export async function probeChannel(channel: Channel): Promise<{
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}> {
  const type = normalizeType(channel.type);

  // WS 服务端类型探活：检查服务端是否在运行
  if (type === 'WS_SERVER' || type === 'ONEBOT_V11_WS_SERVER' || type === 'ONEBOT_V12_WS_SERVER') {
    const { getWsServerStatus } = await import('./ws-transport');
    const servers = getWsServerStatus();
    const found = servers.find((s) => s.alias === channel.alias);
    if (!found) {
      return { ok: false, latencyMs: 0, error: 'WS 服务端未启动（请先启动路由）' };
    }
    return {
      ok: true,
      latencyMs: 0,
      error: found.connections > 0 ? undefined : '服务端运行中，无客户端连接',
    };
  }

  // HTTP 服务端类型探活：检查服务端是否在运行
  if (type === 'HTTP_SERVER' || type === 'HTTP_SSE_SERVER') {
    const { getHttpServerStatus } = await import('./http-transport');
    const servers = getHttpServerStatus();
    const found = servers.find((s) => s.alias === channel.alias);
    if (!found) {
      return { ok: false, latencyMs: 0, error: 'HTTP 服务端未启动（请先启动路由）' };
    }
    return {
      ok: true,
      latencyMs: 0,
      error: found.clients > 0
        ? undefined
        : `服务端运行中 (${found.port})，无 SSE 客户端连接`,
    };
  }

  if (type === 'WS') {
    // WS 探活：尝试连接
    const cfg = safeJsonParse<Record<string, string>>(channel.config || '{}', {});
    const wsUrl = cfg.ws_url || '';
    if (!wsUrl) return { ok: false, latencyMs: 0, error: 'no ws_url' };
    const started = Date.now();
    try {
      const ws = await getWsConnection(channel);
      const latencyMs = Date.now() - started;
      // 连接成功即关闭（探活不持久占用）
      wsPool.delete(channel.id);
      try { ws.close(); } catch { /* noop */ }
      return { ok: true, latencyMs };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }

  // HTTP 类型探活
  const cfg = safeJsonParse<Record<string, string>>(channel.config || '{}', {});
  let url = channel.webhookUrl;
  if (type === 'ONEBOT_V11' || type === 'ONEBOT_V12') {
    url = cfg.endpoint || url;
  } else if (type === 'SATORI') {
    url = cfg.api_url || url;
  } else if (type === 'HTTP_CLIENT') {
    // HTTP_CLIENT 用 url_template，变量替换为占位值
    url = (cfg.url_template || '').replace(/\{\{(\w+)\}\}/g, 'probe');
  }

  if (!url) {
    return { ok: false, latencyMs: 0, error: 'no endpoint configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: channel.apiKey ? { 'X-ILink-Key': channel.apiKey } : {},
    });
    return {
      ok: res.ok || res.status === 405,
      latencyMs: Date.now() - started,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Helper: persist a Message row. */
export async function logMessage(input: {
  sessionId: string;
  wxMsgId?: string;
  direction: 'IN' | 'OUT';
  text: string;
  kind: 'command' | 'forwarded' | 'reply' | 'system';
  channelId?: string;
  latencyMs?: number | null;
  error?: string;
}) {
  return prisma.message.create({
    data: {
      sessionId: input.sessionId,
      wxMsgId: input.wxMsgId || '',
      direction: input.direction,
      text: input.text,
      kind: input.kind,
      channelId: input.channelId ?? null,
      latencyMs: input.latencyMs ?? null,
      error: input.error || '',
    },
  });
}
