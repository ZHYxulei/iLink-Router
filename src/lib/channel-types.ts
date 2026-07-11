/**
 * 渠道类型定义 — 前后端共享。
 *
 * 每种渠道类型有自己的配置字段 schema，前端据此动态渲染表单，
 * 后端 forwarder 据此解析 config JSON 并按协议转发消息。
 */

import type { ChannelType } from './types';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// 字段定义
// ---------------------------------------------------------------------------

export type FieldType = 'string' | 'password' | 'number' | 'select' | 'boolean' | 'textarea';

export interface ConfigField {
  /** config JSON 中的 key。 */
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  default?: string | number | boolean;
  help?: string;
}

export interface ChannelTypeDef {
  type: ChannelType;
  label: string;
  description: string;
  /** 前端图标 emoji。 */
  icon: string;
  /** 传输方式，用于 probe 逻辑。 */
  transport: 'http' | 'ws';
  /** 该类型的配置字段（存入 channel.config JSON）。 */
  fields: ConfigField[];
  /** 是否支持扫码绑定（微信上游二维码）。 */
  qrBindable?: boolean;
}

// ---------------------------------------------------------------------------
// 各渠道类型定义
// ---------------------------------------------------------------------------

const WEBHOOK_DEF: ChannelTypeDef = {
  type: 'WEBHOOK',
  label: 'Webhook',
  description: '生成专属 Webhook URL，客户端向此 URL 发送请求来推送消息/回复给微信用户',
  icon: '🔗',
  transport: 'http',
  qrBindable: true,
  fields: [
    {
      key: 'outbound_url',
      label: '上游 URL（可选）',
      type: 'string',
      placeholder: 'https://upstream.example.com/ilink',
      help: '如填写，路由器收到微信消息时会主动 POST 到此 URL（同步模式）。留空则只接收客户端向 Webhook URL 的推送',
    },
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      placeholder: '可选，客户端请求时需在 X-Webhook-Key 头中携带此密钥',
    },
  ],
};

const ONEBOT_V11_DEF: ChannelTypeDef = {
  type: 'ONEBOT_V11',
  label: 'OneBot v11',
  description: 'OneBot v11 协议（go-cqhttp / Lagrange 等），通过 HTTP API 转发消息',
  icon: '🤖',
  transport: 'http',
  fields: [
    {
      key: 'endpoint',
      label: 'HTTP API 地址',
      type: 'string',
      required: true,
      placeholder: 'http://127.0.0.1:5700',
      help: 'OneBot v11 实现的 HTTP API 地址',
    },
    {
      key: 'access_token',
      label: 'Access Token',
      type: 'password',
      placeholder: '可选，发送在 Authorization 头',
    },
    {
      key: 'self_id',
      label: '机器人 QQ 号',
      type: 'string',
      required: true,
      placeholder: '123456789',
      help: 'OneBot 实现的机器人账号 ID',
    },
    {
      key: 'message_type',
      label: '消息类型',
      type: 'select',
      default: 'private',
      options: [
        { label: '私聊 (private)', value: 'private' },
        { label: '群聊 (group)', value: 'group' },
      ],
    },
    {
      key: 'target_id',
      label: '目标 ID',
      type: 'string',
      required: true,
      placeholder: '私聊填用户QQ / 群聊填群号',
    },
  ],
};

const ONEBOT_V12_DEF: ChannelTypeDef = {
  type: 'ONEBOT_V12',
  label: 'OneBot v12',
  description: 'OneBot v12 协议，通过 HTTP API 转发消息',
  icon: '🎯',
  transport: 'http',
  fields: [
    {
      key: 'endpoint',
      label: 'HTTP API 地址',
      type: 'string',
      required: true,
      placeholder: 'http://127.0.0.1:8080',
      help: 'OneBot v12 实现的 HTTP API 地址',
    },
    {
      key: 'access_token',
      label: 'Access Token',
      type: 'password',
      placeholder: '可选',
    },
    {
      key: 'platform',
      label: '平台标识',
      type: 'string',
      required: true,
      default: 'qq',
      placeholder: 'qq / discord / ...',
    },
    {
      key: 'self_id',
      label: '机器人 ID',
      type: 'string',
      required: true,
      placeholder: '机器人账号 ID',
    },
    {
      key: 'detail_type',
      label: '消息详情类型',
      type: 'select',
      default: 'private',
      options: [
        { label: '私聊 (private)', value: 'private' },
        { label: '群聊 (group)', value: 'group' },
        { label: '频道 (channel)', value: 'channel' },
      ],
    },
    {
      key: 'target_id',
      label: '目标 ID',
      type: 'string',
      required: true,
      placeholder: '用户 ID / 群 ID / 频道 ID',
    },
  ],
};

const SATORI_DEF: ChannelTypeDef = {
  type: 'SATORI',
  label: 'Satori',
  description: 'Satori 协议，通过 HTTP API 转发消息到 Satori 服务',
  icon: '🌐',
  transport: 'http',
  fields: [
    {
      key: 'api_url',
      label: 'Satori API 地址',
      type: 'string',
      required: true,
      placeholder: 'http://127.0.0.1:5140',
      help: 'Satori 服务的 API 地址',
    },
    {
      key: 'token',
      label: 'Token',
      type: 'password',
      placeholder: '可选，API 认证令牌',
    },
    {
      key: 'platform',
      label: '平台',
      type: 'string',
      required: true,
      default: 'qq',
      placeholder: 'qq / discord / ...',
    },
    {
      key: 'self_id',
      label: '机器人 ID',
      type: 'string',
      required: true,
      placeholder: '机器人账号 ID',
    },
    {
      key: 'channel_id',
      label: '频道 ID',
      type: 'string',
      required: true,
      placeholder: '消息发送到的频道 ID',
    },
  ],
};

const WS_DEF: ChannelTypeDef = {
  type: 'WS',
  label: 'WebSocket',
  description: 'WebSocket 连接，通过 WS 帧收发消息',
  icon: '⚡',
  transport: 'ws',
  fields: [
    {
      key: 'ws_url',
      label: 'WebSocket URL',
      type: 'string',
      required: true,
      placeholder: 'ws://127.0.0.1:8080/chat',
      help: '路由会连接此地址，发送 JSON 消息帧并等待回复帧',
    },
    {
      key: 'token',
      label: 'Token',
      type: 'password',
      placeholder: '可选，通过 query 参数 ?token=xxx 传递',
    },
    {
      key: 'protocol',
      label: '子协议',
      type: 'string',
      placeholder: '可选，如 chat.v1',
    },
  ],
};

const WS_SERVER_DEF: ChannelTypeDef = {
  type: 'WS_SERVER',
  label: 'WebSocket 服务端',
  description: '路由启动 WS 服务端，外部客户端（如 OneBot 反向 WS）连接到此服务端',
  icon: '🔌',
  transport: 'ws',
  fields: [
    {
      key: 'port',
      label: '监听端口',
      type: 'number',
      required: true,
      placeholder: '8080',
      help: '路由器将在此端口启动 WS 服务端，客户端连接 ws://<host>:<port>?token=<token>',
    },
    {
      key: 'ws_token',
      label: '连接 Token',
      type: 'password',
      placeholder: '可选，客户端连接时需在 query 参数 ?token=xxx 中携带',
    },
  ],
};

const ONEBOT_V11_WS_SERVER_DEF: ChannelTypeDef = {
  type: 'ONEBOT_V11_WS_SERVER',
  label: 'OneBot v11 反向WS',
  description: '路由启动 WS 服务端，OneBot v11 实现作为客户端连接（go-cqhttp / Lagrange 等的反向 WS 模式）',
  icon: '🔄',
  transport: 'ws',
  fields: [
    {
      key: 'port',
      label: '监听端口',
      type: 'number',
      required: true,
      placeholder: '8080',
      help: '路由器在此端口启动 WS 服务端，OneBot 实现连接到 ws://<host>:<port>?access_token=<token>',
    },
    {
      key: 'ws_token',
      label: 'Access Token',
      type: 'password',
      placeholder: '可选，OneBot 端需配置相同的 access_token',
    },
    {
      key: 'self_id',
      label: '机器人 QQ 号',
      type: 'string',
      placeholder: '可选，用于过滤事件',
    },
    {
      key: 'message_type',
      label: '消息发送类型',
      type: 'select',
      default: 'private',
      options: [
        { label: '私聊 (private)', value: 'private' },
        { label: '群聊 (group)', value: 'group' },
      ],
    },
    {
      key: 'target_id',
      label: '目标 ID',
      type: 'string',
      required: true,
      placeholder: '私聊填用户QQ / 群聊填群号',
    },
  ],
};

const ONEBOT_V12_WS_SERVER_DEF: ChannelTypeDef = {
  type: 'ONEBOT_V12_WS_SERVER',
  label: 'OneBot v12 反向WS',
  description: '路由启动 WS 服务端，OneBot v12 实现作为客户端连接',
  icon: '🔁',
  transport: 'ws',
  fields: [
    {
      key: 'port',
      label: '监听端口',
      type: 'number',
      required: true,
      placeholder: '8080',
      help: '路由器在此端口启动 WS 服务端',
    },
    {
      key: 'ws_token',
      label: 'Access Token',
      type: 'password',
      placeholder: '可选',
    },
    {
      key: 'platform',
      label: '平台标识',
      type: 'string',
      default: 'qq',
      placeholder: 'qq / discord / ...',
    },
    {
      key: 'self_id',
      label: '机器人 ID',
      type: 'string',
      placeholder: '可选',
    },
    {
      key: 'detail_type',
      label: '消息详情类型',
      type: 'select',
      default: 'private',
      options: [
        { label: '私聊 (private)', value: 'private' },
        { label: '群聊 (group)', value: 'group' },
        { label: '频道 (channel)', value: 'channel' },
      ],
    },
    {
      key: 'target_id',
      label: '目标 ID',
      type: 'string',
      required: true,
      placeholder: '用户 ID / 群 ID / 频道 ID',
    },
  ],
};

const HTTP_CLIENT_DEF: ChannelTypeDef = {
  type: 'HTTP_CLIENT',
  label: 'HTTP 客户端',
  description: '路由作为 HTTP 客户端，支持 GET/POST/PUT 等方法，可配置请求模板发送到上游',
  icon: '📤',
  transport: 'http',
  fields: [
    {
      key: 'method',
      label: 'HTTP 方法',
      type: 'select',
      default: 'POST',
      options: [
        { label: 'POST', value: 'POST' },
        { label: 'GET', value: 'GET' },
        { label: 'PUT', value: 'PUT' },
        { label: 'PATCH', value: 'PATCH' },
      ],
    },
    {
      key: 'url_template',
      label: 'URL 模板',
      type: 'string',
      required: true,
      placeholder: 'https://api.example.com/chat?uid={{userId}}',
      help: '支持变量替换：{{userId}} {{userName}} {{sessionId}} {{message}}',
    },
    {
      key: 'body_template',
      label: '请求体模板 (JSON)',
      type: 'textarea',
      placeholder: '{"message":"{{message}}","session":"{{sessionId}}"}',
      help: '支持变量替换，GET 方法忽略此项',
    },
    {
      key: 'reply_path',
      label: '回复提取路径',
      type: 'string',
      default: 'reply',
      placeholder: 'data.text / reply / choices.0.message.content',
      help: '从响应 JSON 中提取回复文本的路径（点号分隔）',
    },
    {
      key: 'headers',
      label: '额外请求头 (JSON)',
      type: 'textarea',
      placeholder: '{"Authorization":"Bearer xxx"}',
      default: '{}',
    },
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      placeholder: '可选，发送在 X-Api-Key 头',
    },
  ],
};

const HTTP_SERVER_DEF: ChannelTypeDef = {
  type: 'HTTP_SERVER',
  label: 'HTTP 服务端',
  description: '路由启动 HTTP 服务端，客户端 POST /send 推送消息，GET /messages 拉取消息',
  icon: '🌐',
  transport: 'http',
  fields: [
    {
      key: 'port',
      label: '监听端口',
      type: 'number',
      required: true,
      placeholder: '9090',
      help: '路由器将在此端口启动 HTTP 服务端',
    },
    {
      key: 'server_token',
      label: '访问 Token',
      type: 'password',
      placeholder: '可选，客户端请求时需在 Authorization: Bearer xxx 中携带',
    },
    {
      key: 'path_prefix',
      label: '路径前缀',
      type: 'string',
      default: '/',
      placeholder: '/',
      help: 'API 路径前缀，如 /api/v1',
    },
  ],
};

const HTTP_SSE_SERVER_DEF: ChannelTypeDef = {
  type: 'HTTP_SSE_SERVER',
  label: 'HTTP SSE 服务端',
  description: '路由启动 HTTP + SSE 服务端，客户端通过 SSE 实时接收消息流，POST /send 发送消息',
  icon: '📡',
  transport: 'http',
  fields: [
    {
      key: 'port',
      label: '监听端口',
      type: 'number',
      required: true,
      placeholder: '9091',
      help: '路由器将在此端口启动 HTTP + SSE 服务端',
    },
    {
      key: 'server_token',
      label: '访问 Token',
      type: 'password',
      placeholder: '可选',
    },
    {
      key: 'path_prefix',
      label: '路径前缀',
      type: 'string',
      default: '/',
      placeholder: '/',
    },
  ],
};

/** 所有渠道类型定义，按展示顺序排列。 */
export const CHANNEL_TYPES: ChannelTypeDef[] = [
  WEBHOOK_DEF,
  HTTP_CLIENT_DEF,
  HTTP_SERVER_DEF,
  HTTP_SSE_SERVER_DEF,
  ONEBOT_V11_DEF,
  ONEBOT_V12_DEF,
  ONEBOT_V11_WS_SERVER_DEF,
  ONEBOT_V12_WS_SERVER_DEF,
  SATORI_DEF,
  WS_DEF,
  WS_SERVER_DEF,
];

/** 类型 → 定义 的映射。 */
export const CHANNEL_TYPE_MAP: Record<string, ChannelTypeDef> = Object.fromEntries(
  CHANNEL_TYPES.map((d) => [d.type, d]),
);

// ---------------------------------------------------------------------------
// 配置 JSON 读写工具
// ---------------------------------------------------------------------------

/**
 * 从 channel.config JSON 中提取指定字段。
 * 同时兼容旧数据：WEBHOOK 类型的 webhookUrl / apiKey 可能存在 channel 顶层字段。
 */
export function readConfig(
  configStr: string,
  fields: ConfigField[],
  legacy?: { webhookUrl?: string; apiKey?: string },
): Record<string, string> {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(configStr || '{}');
  } catch {
    cfg = {};
  }

  const result: Record<string, string> = {};
  for (const f of fields) {
    // 兼容旧数据：WEBHOOK 的 outbound_url 从 channel.webhookUrl 读取
    if (legacy && f.key === 'outbound_url' && legacy.webhookUrl) {
      result[f.key] = legacy.webhookUrl;
      continue;
    }
    // 兼容旧数据：api_key 从 channel.apiKey 读取
    if (legacy && f.key === 'api_key' && legacy.apiKey) {
      result[f.key] = legacy.apiKey;
      continue;
    }
    const v = cfg[f.key];
    if (v != null) {
      result[f.key] = String(v);
    } else if (f.default != null) {
      result[f.key] = String(f.default);
    } else {
      result[f.key] = '';
    }
  }
  return result;
}

/**
 * 将表单值序列化为 channel.config JSON 字符串。
 * WEBHOOK 类型：outbound_url → channel.webhookUrl, api_key → channel.apiKey
 */
export function writeConfig(
  type: string,
  values: Record<string, string>,
): { config: string; webhookUrl: string; apiKey: string } {
  const def = CHANNEL_TYPE_MAP[type];
  const cfg: Record<string, unknown> = {};

  for (const f of def?.fields ?? []) {
    const v = values[f.key];
    if (v != null && v !== '') {
      // textarea 字段尝试解析为对象
      if (f.type === 'textarea') {
        try {
          cfg[f.key] = JSON.parse(v);
        } catch {
          cfg[f.key] = v;
        }
      } else {
        cfg[f.key] = v;
      }
    }
  }

  // WEBHOOK 类型：outbound_url 映射到 channel.webhookUrl，api_key 映射到 channel.apiKey
  if (type === 'WEBHOOK') {
    const webhookUrl = values.outbound_url || '';
    const apiKey = values.api_key || '';
    // config 只存额外信息（目前无额外字段）
    return { config: JSON.stringify(cfg), webhookUrl, apiKey };
  }

  return { config: JSON.stringify(cfg), webhookUrl: '', apiKey: '' };
}

// ---------------------------------------------------------------------------
// Webhook URL 工具
// ---------------------------------------------------------------------------

/** 生成随机 webhook token（32 字符 hex）。 */
export function generateWebhookToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 构造渠道的 inbound webhook URL。
 * 格式：http://<host>/api/webhook/<alias>?key=<token>
 *
 * token 存在 channel.config.webhook_token 中。
 * 如果没有 token 则返回空字符串（表示尚未生成）。
 */
export function getInboundWebhookUrl(
  alias: string,
  configStr: string,
  baseUrl?: string,
): string {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(configStr || '{}');
  } catch {
    cfg = {};
  }
  const token = cfg.webhook_token as string | undefined;
  if (!token) return '';
  const base = baseUrl || `http://localhost:3000`;
  return `${base.replace(/\/$/, '')}/api/webhook/${encodeURIComponent(alias)}?key=${token}`;
}

/** 从 config JSON 中读取 webhook_token。 */
export function getWebhookToken(configStr: string): string {
  try {
    const cfg = JSON.parse(configStr || '{}');
    return (cfg.webhook_token as string) || '';
  } catch {
    return '';
  }
}
