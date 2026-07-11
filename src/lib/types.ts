/**
 * Shared domain types for the router.
 */

export type ChannelType = 'WEBHOOK' | 'HTTP_CLIENT' | 'HTTP_SERVER' | 'HTTP_SSE_SERVER' | 'ONEBOT_V11' | 'ONEBOT_V12' | 'SATORI' | 'WS' | 'WS_SERVER' | 'ONEBOT_V11_WS_SERVER' | 'ONEBOT_V12_WS_SERVER';

export type RouterStatus = 'offline' | 'starting' | 'ready' | 'error';
export type LoginStatus = 'logged_out' | 'scanning' | 'logged_in' | 'error';

export type MessageDirection = 'IN' | 'OUT';
export type MessageKind = 'command' | 'forwarded' | 'reply' | 'system';

export interface RouterStatusSnapshot {
  status: RouterStatus;
  loginStatus: LoginStatus;
  selfWxId: string;
  selfWxName: string;
  lastQrCode: string;
  lastQrAt: string | null;
  lastError: string;
  startedAt: string | null;
  updatedAt: string;
  // In-memory only — uptime in seconds
  uptimeSeconds: number;
}

/** Payload sent to upstream channel webhook. */
export interface ForwardPayload {
  /** Router-internal session id. */
  sessionId: string;
  /** WeChat user id from wechaty. */
  userId: string;
  /** WeChat user display name. */
  userName: string;
  /** The text message the user sent. */
  message: string;
  /** ISO timestamp of when the router received the message. */
  receivedAt: string;
  /** Channel alias the message was routed to. */
  channelAlias: string;
  /** Optional: recent message history for context (oldest first). */
  history: { role: 'user' | 'assistant'; text: string; ts: string }[];
}

/** Expected response from an upstream channel. */
export interface ForwardResponse {
  /** Text reply to send back to the user. */
  reply: string;
  /** Optional metadata (latency tracked separately). */
  meta?: Record<string, unknown>;
}

/** Result of dispatching an incoming WeChat message. */
export interface DispatchResult {
  handled: boolean;
  kind: MessageKind;
  reply: string;
  channelId?: string;
  error?: string;
  latencyMs?: number;
}
