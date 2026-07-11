/**
 * WebSocket 服务端管理器。
 *
 * 为 WS_SERVER / ONEBOT_V11_WS_SERVER / ONEBOT_V12_WS_SERVER 类型的渠道
 * 启动独立的 WS 服务端，接受外部客户端连接（如 OneBot 实现的反向 WS）。
 *
 * 生命周期由 RouterService 管理：start() 时启动所有已启用的 WS 服务端渠道，
 * stop() 时关闭全部。
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { safeJsonParse } from './utils';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type WsProtocol = 'generic' | 'onebot_v11' | 'onebot_v12';

interface WsServerEntry {
  channelId: string;
  alias: string;
  server: WebSocketServer;
  port: number;
  token: string;
  protocol: WsProtocol;
  /** 当前活跃连接（反向 WS 通常只有一个客户端连接）。 */
  connections: Set<WebSocket>;
}

/** 入站消息回调 — WS 客户端发来消息时触发。 */
export type InboundHandler = (msg: {
  channelId: string;
  alias: string;
  protocol: WsProtocol;
  userId: string;
  message: string;
  raw: unknown;
  ws: WebSocket;
}) => void;

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

/** channelId → 服务端实例。 */
const servers = new Map<string, WsServerEntry>();

let inboundHandler: InboundHandler | null = null;

/** 设置入站消息处理器。 */
export function setInboundHandler(handler: InboundHandler | null) {
  inboundHandler = handler;
}

// ---------------------------------------------------------------------------
// 启动 / 停止
// ---------------------------------------------------------------------------

/**
 * 为指定渠道启动 WS 服务端。
 * @returns 实际监听的端口
 */
export function startWsServer(opts: {
  channelId: string;
  alias: string;
  port: number;
  token: string;
  protocol: WsProtocol;
}): Promise<number> {
  // 如果已存在，先停止
  if (servers.has(opts.channelId)) {
    stopWsServer(opts.channelId);
  }

  return new Promise<number>((resolve, reject) => {
    const wss = new WebSocketServer({ port: opts.port, path: '/' });

    const entry: WsServerEntry = {
      channelId: opts.channelId,
      alias: opts.alias,
      server: wss,
      port: opts.port,
      token: opts.token,
      protocol: opts.protocol,
      connections: new Set(),
    };

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      handleConnection(ws, req, entry);
    });

    wss.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${opts.port} 已被占用（渠道 ${opts.alias}）`));
      } else {
        reject(err);
      }
    });

    wss.on('listening', () => {
      servers.set(opts.channelId, entry);
      // eslint-disable-next-line no-console
      console.log(
        `[WS] 服务端已启动: ${opts.alias} → ws://0.0.0.0:${opts.port} (${opts.protocol})`,
      );
      resolve(opts.port);
    });
  });
}

/** 停止指定渠道的 WS 服务端。 */
export function stopWsServer(channelId: string) {
  const entry = servers.get(channelId);
  if (!entry) return;
  for (const ws of entry.connections) {
    try { ws.close(1001, 'server shutting down'); } catch { /* noop */ }
  }
  entry.connections.clear();
  entry.server.close();
  servers.delete(channelId);
  // eslint-disable-next-line no-console
  console.log(`[WS] 服务端已停止: ${entry.alias} (port ${entry.port})`);
}

/** 停止所有 WS 服务端。 */
export function stopAllWsServers() {
  for (const channelId of [...servers.keys()]) {
    stopWsServer(channelId);
  }
}

/** 获取所有运行中的 WS 服务端信息。 */
export function getWsServerStatus(): { alias: string; port: number; connections: number; protocol: string }[] {
  return [...servers.values()].map((e) => ({
    alias: e.alias,
    port: e.port,
    connections: e.connections.size,
    protocol: e.protocol,
  }));
}

// ---------------------------------------------------------------------------
// 连接处理
// ---------------------------------------------------------------------------

function handleConnection(ws: WebSocket, req: IncomingMessage, entry: WsServerEntry) {
  // 验证 token（通过 query 参数 ?token=xxx 或 Authorization 头）
  const url = new URL(req.url || '/', 'http://localhost');
  const queryToken = url.searchParams.get('token') || url.searchParams.get('access_token') || '';
  const authHeader = req.headers['authorization'] || '';
  const headerToken = authHeader.replace(/^Bearer\s+/i, '');

  if (entry.token && queryToken !== entry.token && headerToken !== entry.token) {
    ws.close(4001, 'invalid token');
    // eslint-disable-next-line no-console
    console.warn(`[WS] 连接被拒绝（token 无效）: ${entry.alias}`);
    return;
  }

  entry.connections.add(ws);
  // eslint-disable-next-line no-console
  console.log(`[WS] 客户端已连接: ${entry.alias} (共 ${entry.connections.size} 个连接)`);

  ws.on('message', (data: Buffer) => {
    handleInboundMessage(ws, data, entry);
  });

  ws.on('close', () => {
    entry.connections.delete(ws);
    // eslint-disable-next-line no-console
    console.log(`[WS] 客户端断开: ${entry.alias} (剩余 ${entry.connections.size} 个连接)`);
  });

  ws.on('error', () => {
    entry.connections.delete(ws);
  });
}

/** 处理来自 WS 客户端的消息。 */
function handleInboundMessage(ws: WebSocket, data: Buffer, entry: WsServerEntry) {
  const text = data.toString();
  const raw = safeJsonParse<Record<string, unknown> | null>(text, null);
  if (!raw) return;

  let userId = '';
  let message = '';

  if (entry.protocol === 'onebot_v11') {
    // OneBot v11 事件
    if (raw.post_type === 'message') {
      userId = String(raw.user_id || '');
      // message 可能是字符串或数组
      const msg = raw.message;
      if (typeof msg === 'string') {
        message = msg;
      } else if (Array.isArray(msg)) {
        message = msg
          .filter((s: { type: string }) => s.type === 'text')
          .map((s: { data?: { text?: string } }) => s.data?.text || '')
          .join('');
      }
    }
  } else if (entry.protocol === 'onebot_v12') {
    // OneBot v12 事件
    if (raw.type === 'message') {
      userId = String(raw.user_id || '');
      const msg = raw.message;
      if (Array.isArray(msg)) {
        message = msg
          .filter((s: { type: string }) => s.type === 'text')
          .map((s: { data?: { text?: string } }) => s.data?.text || '')
          .join('');
      } else if (typeof msg === 'string') {
        message = msg;
      }
      message = message || (raw.alt_message as string) || '';
    }
  } else {
    // generic — 直接取 message 字段
    userId = String(raw.userId || raw.user_id || '');
    message = String(raw.message || raw.text || raw.reply || '');
  }

  if (!message || !userId) return;

  // 触发入站处理器（转发给微信用户）
  if (inboundHandler) {
    inboundHandler({
      channelId: entry.channelId,
      alias: entry.alias,
      protocol: entry.protocol,
      userId,
      message,
      raw,
      ws,
    });
  }
}

// ---------------------------------------------------------------------------
// 出站：向 WS 客户端发送消息并等待回复
// ---------------------------------------------------------------------------

/**
 * 向指定渠道的 WS 客户端发送消息，并等待回复。
 *
 * - generic 协议：直接发送 JSON 帧，等待下一条消息作为回复
 * - onebot_v11：发送 send_private_msg/send_group_msg action，通过 echo 匹配回复
 * - onebot_v12：发送 send_message action，通过 echo 匹配回复
 *
 * @param timeoutMs 超时毫秒
 */
export function sendToWsServer(
  channelId: string,
  payload: {
    message: string;
    userId: string;
    userName: string;
    sessionId: string;
    history: { role: string; text: string; ts: string }[];
  },
  config: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ reply: string; latencyMs: number }> {
  const entry = servers.get(channelId);
  if (!entry) {
    return Promise.reject(new Error(`WS 服务端未启动（渠道 ${channelId}）`));
  }
  // 取第一个活跃连接
  const ws = [...entry.connections][0];
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`无 WS 客户端连接（渠道 ${entry.alias}）`));
  }

  const started = Date.now();
  const echo = randomUUID();

  if (entry.protocol === 'onebot_v11') {
    // OneBot v11: 发送 send_private_msg / send_group_msg
    const messageType = (config.message_type as string) || 'private';
    const targetId = Number(config.target_id) || config.target_id;
    const action = messageType === 'group' ? 'send_group_msg' : 'send_private_msg';
    const frame = {
      action,
      params: {
        [messageType === 'group' ? 'group_id' : 'user_id']: targetId,
        message: payload.message,
      },
      echo,
    };
    return sendAndWait(ws, frame, echo, timeoutMs, started, entry.alias, 'onebot_v11');
  } else if (entry.protocol === 'onebot_v12') {
    // OneBot v12: 发送 send_message
    const detailType = (config.detail_type as string) || 'private';
    const targetId = config.target_id;
    const frame = {
      action: 'send_message',
      params: {
        detail_type: detailType,
        [detailType === 'group' ? 'group_id' : 'user_id']: targetId,
        message: [{ type: 'text', data: { text: payload.message } }],
      },
      echo,
    };
    return sendAndWait(ws, frame, echo, timeoutMs, started, entry.alias, 'onebot_v12');
  } else {
    // generic: 发送消息帧，等待下一条消息
    const frame = {
      type: 'message',
      sessionId: payload.sessionId,
      userId: payload.userId,
      userName: payload.userName,
      message: payload.message,
      history: payload.history,
    };
    return sendAndWait(ws, frame, null, timeoutMs, started, entry.alias, 'generic');
  }
}

function sendAndWait(
  ws: WebSocket,
  frame: unknown,
  echo: string | null,
  timeoutMs: number,
  started: number,
  alias: string,
  protocol: WsProtocol,
): Promise<{ reply: string; latencyMs: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`WS ${alias} 回复超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    const onMessage = (data: Buffer) => {
      const latencyMs = Date.now() - started;
      const raw = safeJsonParse<Record<string, unknown> | null>(data.toString(), null);
      if (!raw) return;

      // OneBot: 通过 echo 字段匹配
      if (echo && protocol !== 'generic') {
        if (raw.echo !== echo) return; // 不是我们的回复，跳过
        clearTimeout(timer);
        ws.off('message', onMessage);
        const reply = extractReply(raw, protocol);
        if (reply) {
          resolve({ reply, latencyMs });
        } else {
          reject(new Error(`WS ${alias} 返回空回复`));
        }
        return;
      }

      // generic: 取第一条消息作为回复
      clearTimeout(timer);
      ws.off('message', onMessage);
      const reply = String(raw.reply || raw.message || raw.text || '');
      if (reply) {
        resolve({ reply, latencyMs });
      } else {
        reject(new Error(`WS ${alias} 返回空回复`));
      }
    };

    ws.on('message', onMessage);
    ws.send(JSON.stringify(frame));
  });
}

/** 从 OneBot 响应中提取回复文本。 */
function extractReply(raw: Record<string, unknown>, protocol: WsProtocol): string {
  if (protocol === 'onebot_v11') {
    // OneBot v11 action 响应：{ status: "ok", data: { message_id: xxx } }
    // 没有文本回复，返回成功提示
    if (raw.status === 'ok') return '✅ 已发送';
    return `❌ ${(raw.msg as string) || '发送失败'}`;
  }
  if (protocol === 'onebot_v12') {
    if (raw.status === 'ok') return '✅ 已发送';
    return `❌ ${(raw.msg as string) || '发送失败'}`;
  }
  return String(raw.reply || raw.message || raw.text || '');
}
