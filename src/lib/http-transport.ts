/**
 * HTTP / SSE 服务端管理器。
 *
 * 为 HTTP_SERVER / HTTP_SSE_SERVER 类型的渠道启动独立的 HTTP 服务端。
 *
 * - HTTP_SERVER: 客户端 POST /send 推送消息，GET /messages 拉取消息
 * - HTTP_SSE_SERVER: 客户端通过 SSE (GET /stream) 实时接收消息流，POST /send 发送消息
 *
 * 生命周期由 RouterService 管理：start() 时启动所有已启用的 HTTP 服务端渠道，
 * stop() 时关闭全部。
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { safeJsonParse } from './utils';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface HttpServerEntry {
  channelId: string;
  alias: string;
  server: ReturnType<typeof createServer>;
  port: number;
  token: string;
  pathPrefix: string;
  sse: boolean;
  /** SSE 客户端连接列表。 */
  sseClients: Set<ServerResponse>;
  /** 消息缓冲（最近 100 条），供 GET /messages 拉取。 */
  messageBuffer: BufferedMessage[];
}

interface BufferedMessage {
  id: string;
  timestamp: string;
  userId: string;
  message: string;
  reply?: string;
  channelId: string;
  alias: string;
}

/** 入站消息回调 — HTTP 客户端 POST /send 时触发。 */
export type HttpInboundHandler = (msg: {
  channelId: string;
  alias: string;
  userId: string;
  message: string;
  raw: unknown;
}) => void;

// ---------------------------------------------------------------------------
// 全局状态
// ---------------------------------------------------------------------------

/** channelId → 服务端实例。 */
const servers = new Map<string, HttpServerEntry>();

let inboundHandler: HttpInboundHandler | null = null;

/** 设置入站消息处理器。 */
export function setHttpInboundHandler(handler: HttpInboundHandler | null) {
  inboundHandler = handler;
}

// ---------------------------------------------------------------------------
// 启动 / 停止
// ---------------------------------------------------------------------------

/**
 * 为指定渠道启动 HTTP 服务端。
 * @returns 实际监听的端口
 */
export function startHttpServer(opts: {
  channelId: string;
  alias: string;
  port: number;
  token: string;
  pathPrefix: string;
  sse: boolean;
}): Promise<number> {
  // 如果已存在，先停止
  if (servers.has(opts.channelId)) {
    stopHttpServer(opts.channelId);
  }

  return new Promise<number>((resolve, reject) => {
    const entry: HttpServerEntry = {
      channelId: opts.channelId,
      alias: opts.alias,
      server: null as unknown as HttpServerEntry['server'],
      port: opts.port,
      token: opts.token,
      pathPrefix: opts.pathPrefix || '/',
      sse: opts.sse,
      sseClients: new Set(),
      messageBuffer: [],
    };

    const server = createServer((req, res) => {
      handleRequest(req, res, entry);
    });

    entry.server = server;

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${opts.port} 已被占用（渠道 ${opts.alias}）`));
      } else {
        reject(err);
      }
    });

    server.on('listening', () => {
      servers.set(opts.channelId, entry);
      // eslint-disable-next-line no-console
      console.log(
        `[HTTP] 服务端已启动: ${opts.alias} → http://0.0.0.0:${opts.port}${opts.pathPrefix} (${opts.sse ? 'SSE' : 'HTTP'})`,
      );
      resolve(opts.port);
    });

    server.listen(opts.port);
  });
}

/** 停止指定渠道的 HTTP 服务端。 */
export function stopHttpServer(channelId: string) {
  const entry = servers.get(channelId);
  if (!entry) return;
  // 关闭所有 SSE 连接
  for (const client of entry.sseClients) {
    try { client.end(); } catch { /* noop */ }
  }
  entry.sseClients.clear();
  entry.server.close();
  servers.delete(channelId);
  // eslint-disable-next-line no-console
  console.log(`[HTTP] 服务端已停止: ${entry.alias} (port ${entry.port})`);
}

/** 停止所有 HTTP 服务端。 */
export function stopAllHttpServers() {
  for (const channelId of [...servers.keys()]) {
    stopHttpServer(channelId);
  }
}

/** 获取所有运行中的 HTTP 服务端信息。 */
export function getHttpServerStatus(): { alias: string; port: number; sse: boolean; clients: number; buffered: number }[] {
  return [...servers.values()].map((e) => ({
    alias: e.alias,
    port: e.port,
    sse: e.sse,
    clients: e.sseClients.size,
    buffered: e.messageBuffer.length,
  }));
}

// ---------------------------------------------------------------------------
// 请求处理
// ---------------------------------------------------------------------------

function handleRequest(req: IncomingMessage, res: ServerResponse, entry: HttpServerEntry) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;

  // CORS 支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 验证 token
  if (entry.token) {
    const authHeader = req.headers['authorization'] || '';
    const headerToken = authHeader.replace(/^Bearer\s+/i, '');
    const queryToken = url.searchParams.get('token') || '';
    if (headerToken !== entry.token && queryToken !== entry.token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid token' }));
      return;
    }
  }

  // 路由匹配（去掉 pathPrefix）
  const prefix = entry.pathPrefix.replace(/\/$/, '');
  const route = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;

  // GET /stream — SSE 订阅（仅 SSE 模式）
  if (req.method === 'GET' && route === '/stream' && entry.sse) {
    handleSse(req, res, entry);
    return;
  }

  // GET /messages — 拉取消息列表
  if (req.method === 'GET' && route === '/messages') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const messages = entry.messageBuffer.slice(-limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages, total: entry.messageBuffer.length }));
    return;
  }

  // GET /status — 健康检查
  if (req.method === 'GET' && (route === '/status' || route === '/' || route === '')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      alias: entry.alias,
      sse: entry.sse,
      clients: entry.sseClients.size,
      buffered: entry.messageBuffer.length,
    }));
    return;
  }

  // POST /send — 推送消息
  if (req.method === 'POST' && route === '/send') {
    handleSend(req, res, entry);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', route }));
}

/** 处理 POST /send */
function handleSend(req: IncomingMessage, res: ServerResponse, entry: HttpServerEntry) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const raw = safeJsonParse<Record<string, unknown> | null>(body, null);
    if (!raw) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'body must be JSON object' }));
      return;
    }

    const userId = String(raw.userId || raw.user_id || '');
    const message = String(raw.message || raw.text || raw.reply || '');

    if (!userId || !message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'userId and message are required' }));
      return;
    }

    // 触发入站处理器
    if (inboundHandler) {
      inboundHandler({
        channelId: entry.channelId,
        alias: entry.alias,
        userId,
        message,
        raw,
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, received: true }));
  });
}

/** 处理 SSE 连接 */
function handleSse(req: IncomingMessage, res: ServerResponse, entry: HttpServerEntry) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  entry.sseClients.add(res);

  // 发送已有消息（最近 20 条）
  const recent = entry.messageBuffer.slice(-20);
  for (const msg of recent) {
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  }

  req.on('close', () => {
    entry.sseClients.delete(res);
  });
}

// ---------------------------------------------------------------------------
// 出站：向 HTTP 服务端的客户端推送消息（SSE / 消息缓冲）
// ---------------------------------------------------------------------------

/**
 * 向指定渠道的所有 SSE 客户端推送消息，并存入缓冲区。
 * 用于微信用户发来消息时，推送给 SSE 客户端。
 */
export function pushToHttpServer(
  channelId: string,
  msg: {
    userId: string;
    message: string;
    reply?: string;
  },
): void {
  const entry = servers.get(channelId);
  if (!entry) return;

  const buffered: BufferedMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    userId: msg.userId,
    message: msg.message,
    reply: msg.reply,
    channelId: entry.channelId,
    alias: entry.alias,
  };

  // 存入缓冲（保留最近 100 条）
  entry.messageBuffer.push(buffered);
  if (entry.messageBuffer.length > 100) {
    entry.messageBuffer.shift();
  }

  // 推送给所有 SSE 客户端
  const data = JSON.stringify(buffered);
  for (const client of entry.sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      entry.sseClients.delete(client);
    }
  }
}
