import { config } from './config';
import { prisma } from './db';
import type { Channel } from '@prisma/client';
import type { ForwardPayload, ForwardResponse } from './types';
import { safeJsonParse } from './utils';

/**
 * Forward a user message to the channel's upstream webhook.
 *
 * Protocol (synchronous):
 *   POST <channel.webhookUrl>
 *   Content-Type: application/json
 *   X-ILink-Key:  <channel.apiKey || config.upstream.webhookSecret>
 *   X-ILink-Channel: <channel.alias>
 *
 *   Body (ForwardPayload):
 *     {
 *       sessionId, userId, userName, message, receivedAt,
 *       channelAlias, history: [{role, text, ts}]
 *     }
 *
 *   Expected response (ForwardResponse):
 *     { reply: "..." }   // reply is sent back to the user as text
 *
 * @returns the reply text or throws on error/timeout.
 */
export async function forwardToChannel(
  channel: Channel,
  payload: ForwardPayload,
  history: { role: 'user' | 'assistant'; text: string; ts: string }[] = [],
): Promise<{ reply: string; latencyMs: number }> {
  if (!channel.webhookUrl) {
    throw new Error(`渠道 ${channel.alias} 未配置 webhookUrl`);
  }

  // Merge channel.config (extra headers / model hints) if provided.
  const extra = safeJsonParse<Record<string, unknown>>(channel.config || '{}', {});
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-ILink-Channel': channel.alias,
    ...(channel.apiKey ? { 'X-ILink-Key': channel.apiKey } : {}),
    ...(config.upstream.webhookSecret
      ? { 'X-ILink-Router-Secret': config.upstream.webhookSecret }
      : {}),
    ...(extra.headers as Record<string, string> | undefined),
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
  const timer = setTimeout(
    () => controller.abort(),
    config.router.forwardTimeoutMs,
  );
  const started = Date.now();

  try {
    const res = await fetch(channel.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - started;
    const raw = await res.text();

    if (!res.ok) {
      throw new Error(
        `upstream ${channel.alias} returned ${res.status}: ${raw.slice(0, 500)}`,
      );
    }

    // Parse JSON; tolerate plain-text responses.
    let parsed: ForwardResponse;
    try {
      parsed = JSON.parse(raw) as ForwardResponse;
    } catch {
      parsed = { reply: raw };
    }

    if (typeof parsed.reply !== 'string' || parsed.reply.length === 0) {
      throw new Error(
        `upstream ${channel.alias} returned empty reply`,
      );
    }

    return { reply: parsed.reply, latencyMs };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(
        `upstream ${channel.alias} timed out after ${config.router.forwardTimeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight "ping" probe for a channel — used by the !status command and
 * channel test button. Does a HEAD request to the webhook URL.
 */
export async function probeChannel(channel: Channel): Promise<{
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}> {
  if (!channel.webhookUrl) {
    return { ok: false, latencyMs: 0, error: 'no webhook url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const started = Date.now();
  try {
    const res = await fetch(channel.webhookUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: channel.apiKey ? { 'X-ILink-Key': channel.apiKey } : {},
    });
    return {
      ok: res.ok || res.status === 405, // 405 = method not allowed but URL reachable
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
