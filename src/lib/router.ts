import { config } from './config';
import { prisma } from './db';
import { logMessage, forwardToChannel } from './forwarder';
import { getOrCreateSession, touchSession, getRecentHistory } from './sessions';
import { dispatchCommand } from './commands';
import type { RouterStatusSnapshot, RouterStatus, LoginStatus } from './types';
import type { Channel } from '@prisma/client';

// We import the iLink SDK lazily so the admin UI doesn't pull the whole bot
// into the client bundle. The WeChatBot class is server-only.
type WeChatBotLike = {
  login(options?: { force?: boolean }): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  isRunning: boolean;
  onMessage(handler: (msg: IncomingMessageLike) => void | Promise<void>): unknown;
  reply(msg: IncomingMessageLike, content: string): Promise<unknown>;
  send(userId: string, content: string): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

interface IncomingMessageLike {
  userId: string;
  text: string;
  type: 'text' | 'image' | 'voice' | 'file' | 'video';
  timestamp: Date;
  // Additional fields exist but only text/userId/type are used by the router.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// In-memory state — kept on globalThis to survive Next.js HMR in dev.
// ---------------------------------------------------------------------------
interface RuntimeState {
  bot: WeChatBotLike | null;
  status: RouterStatus;
  loginStatus: LoginStatus;
  selfWxId: string;
  selfWxName: string;
  lastQrCode: string;
  lastQrAt: Date | null;
  lastError: string;
  startedAt: Date | null;
  starting: Promise<void> | null;
  stopping: Promise<void> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __ilinkRouter: RuntimeState | undefined;
}

const state: RuntimeState = globalThis.__ilinkRouter ?? {
  bot: null,
  status: 'offline',
  loginStatus: 'logged_out',
  selfWxId: '',
  selfWxName: '',
  lastQrCode: '',
  lastQrAt: null,
  lastError: '',
  startedAt: null,
  starting: null,
  stopping: null,
};
globalThis.__ilinkRouter = state;

// ---------------------------------------------------------------------------
// Router service — singleton instance accessed via `router`.
// ---------------------------------------------------------------------------
class RouterService {
  /** Build the WeChatBot with the configured iLink options. */
  private async buildBot(): Promise<WeChatBotLike> {
    const { WeChatBot } = await import('@wechatbot/wechatbot');

    const bot = new WeChatBot({
      baseUrl: config.ilink.baseUrl,
      storage: 'file',
      storageDir: config.ilink.storageDir,
      logLevel: config.ilink.logLevel as 'debug' | 'info' | 'warn' | 'error' | 'silent',
      loginCallbacks: {
        onQrUrl: (url: string) => {
          state.lastQrCode = url;
          state.lastQrAt = new Date();
          state.loginStatus = 'scanning';
          persistState({
            lastQrCode: url,
            lastQrAt: state.lastQrAt,
            loginStatus: 'scanning',
          }).catch(() => {});
          // eslint-disable-next-line no-console
          console.log('[iLink] scan QR — view at /api/qr or /router');
        },
        onScanned: () => {
          // eslint-disable-next-line no-console
          console.log('[iLink] QR scanned, waiting for confirmation...');
        },
      },
    }) as unknown as WeChatBotLike;

    // Lifecycle events.
    bot.on('login', (creds: unknown) => {
      const c = creds as { bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string } | undefined;
      state.selfWxId = c?.ilink_bot_id || c?.ilink_user_id || '';
      state.selfWxName = 'iLink Bot'; // The SDK doesn't expose a friendly name yet.
      state.loginStatus = 'logged_in';
      state.status = 'ready';
      state.lastError = '';
      state.lastQrCode = '';
      persistState({
        selfWxId: state.selfWxId,
        selfWxName: state.selfWxName,
        loginStatus: 'logged_in',
        status: 'ready',
        lastQrCode: '',
        lastError: '',
      }).catch(() => {});
      // eslint-disable-next-line no-console
      console.log(`[iLink] logged in: bot_id=${state.selfWxId}`);
    });

    bot.on('session:expired', () => {
      // eslint-disable-next-line no-console
      console.warn('[iLink] session expired — SDK will auto-recover via re-login');
      state.loginStatus = 'logged_out';
      state.status = 'starting';
      persistState({
        loginStatus: 'logged_out',
        status: 'starting',
      }).catch(() => {});
    });

    bot.on('session:restored', (creds: unknown) => {
      const c = creds as { bot_token?: string } | undefined;
      state.loginStatus = 'logged_in';
      state.status = 'ready';
      state.lastError = '';
      void c;
      persistState({
        loginStatus: 'logged_in',
        status: 'ready',
        lastError: '',
      }).catch(() => {});
      // eslint-disable-next-line no-console
      console.log('[iLink] session restored');
    });

    bot.on('poll:start', () => {
      state.status = 'ready';
      persistState({ status: 'ready' }).catch(() => {});
    });

    bot.on('poll:stop', () => {
      // eslint-disable-next-line no-console
      console.log('[iLink] poll loop stopped');
    });

    bot.on('error', (err: unknown) => {
      const msg = (err as Error)?.message || String(err);
      state.lastError = msg;
      state.status = 'error';
      persistState({ lastError: msg, status: 'error' }).catch(() => {});
      // eslint-disable-next-line no-console
      console.error('[iLink] bot error:', err);
    });

    // Register the message handler — every incoming message flows through here.
    bot.onMessage((msg) => {
      // Handle async without blocking the SDK's poll loop.
      Promise.resolve(this.handleMessage(msg)).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[iLink] message handler error:', e);
      });
    });

    return bot;
  }

  private async handleMessage(msg: IncomingMessageLike) {
    // Only route text messages for now. Media is logged but not forwarded.
    if (msg.type !== 'text' || !msg.text) {
      return;
    }

    const text = msg.text;
    const wxId = msg.userId;
    const wxName = msg.userId; // The iLink protocol exposes userId, not display name.
    // The SDK exposes the underlying WireMessage at msg.raw — message_id lives there.
    const raw = (msg as { raw?: { message_id?: number | string } }).raw;
    const wxMsgId = raw?.message_id != null ? String(raw.message_id) : '';

    // Get-or-create the user session.
    const session = await getOrCreateSession(wxId, wxName);
    await touchSession(session.id);

    // 1) Try a command first.
    const cmd = await dispatchCommand(session.id, wxId, wxName, text);
    if (cmd?.handled) {
      await logMessage({
        sessionId: session.id,
        wxMsgId,
        direction: 'IN',
        text,
        kind: 'command',
      });
      await state.bot!.reply(msg, cmd.reply);
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: cmd.reply,
        kind: 'command',
        channelId: cmd.channelId,
      });
      return;
    }

    // 2) Log the inbound message.
    await logMessage({
      sessionId: session.id,
      wxMsgId,
      direction: 'IN',
      text,
      kind: 'forwarded',
      channelId: session.channel?.id,
    });

    // 3) Forward to current channel.
    if (!session.channel) {
      const reply =
        `⚠ 当前未绑定渠道\n` +
        `请发送 ${config.router.commandPrefix}channels 查看可用渠道，` +
        `然后用 ${config.router.commandPrefix}switch <别名> 切换`;
      await state.bot!.reply(msg, reply);
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: reply,
        kind: 'system',
      });
      return;
    }

    const channel: Channel = session.channel;
    const receivedAt = new Date().toISOString();

    try {
      const history = await getRecentHistory(session.id);
      const { reply, latencyMs } = await forwardToChannel(
        channel,
        {
          sessionId: session.id,
          userId: wxId,
          userName: wxName,
          message: text,
          receivedAt,
          channelAlias: channel.alias,
          history,
        },
        history,
      );

      await state.bot!.reply(msg, reply);
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: reply,
        kind: 'reply',
        channelId: channel.id,
        latencyMs,
      });
    } catch (err) {
      const errMsg = (err as Error).message;
      const reply = `❌ 转发失败: ${errMsg}`;
      await state.bot!.reply(msg, reply);
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: reply,
        kind: 'system',
        channelId: channel.id,
        error: errMsg,
      });
    }
  }

  // --- Public API -----------------------------------------------------------

  async stop(): Promise<void> {
    if (!state.bot) return;
    if (state.stopping) return state.stopping;
    state.stopping = (async () => {
      try {
        await state.bot!.stop();
      } finally {
        state.bot = null;
        state.status = 'offline';
        state.loginStatus = 'logged_out';
        state.stopping = null;
        await persistState({
          status: 'offline',
          loginStatus: 'logged_out',
        });
      }
    })();
    return state.stopping;
  }

  /** Force re-login: clears persisted credentials and restarts the QR flow. */
  async reset(): Promise<void> {
    if (state.bot) {
      await this.stop();
    }
    state.lastQrCode = '';
    state.lastQrAt = null;
    state.lastError = '';
    state.status = 'offline';
    state.loginStatus = 'logged_out';
    await persistState({
      lastQrCode: '',
      lastError: '',
      status: 'offline',
      loginStatus: 'logged_out',
      lastQrAt: null,
    });
    // Restart — login({ force: true }) will trigger a fresh QR.
    return this.start(true);
  }

  async start(forceLogin = false): Promise<void> {
    if (state.bot && (state.status === 'ready' || state.status === 'starting') && !forceLogin) {
      return;
    }
    if (state.starting) return state.starting;

    state.starting = (async () => {
      try {
        state.status = 'starting';
        state.lastError = '';
        await persistState({ status: 'starting', lastError: '' });
        const bot = await this.buildBot();
        state.bot = bot;
        state.startedAt = new Date();
        await persistState({ startedAt: state.startedAt });
        // login({ force: true }) clears stored credentials and starts fresh QR.
        await bot.login(forceLogin ? { force: true } : undefined);
        await bot.start();
        state.status = 'ready';
        await persistState({ status: 'ready' });
      } catch (err) {
        state.status = 'error';
        state.lastError = (err as Error).message;
        await persistState({
          status: 'error',
          lastError: state.lastError,
        });
        // eslint-disable-next-line no-console
        console.error('[iLink] start error:', err);
        throw err;
      } finally {
        state.starting = null;
      }
    })();
    return state.starting;
  }

  async getStatus(): Promise<RouterStatusSnapshot> {
    const startedAt = state.startedAt;
    const uptimeSeconds = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : 0;

    // Sync DB row with in-memory state on each call.
    await persistState({
      status: state.status,
      loginStatus: state.loginStatus,
      selfWxId: state.selfWxId,
      selfWxName: state.selfWxName,
      lastQrCode: state.lastQrCode,
      lastQrAt: state.lastQrAt ?? undefined,
      lastError: state.lastError,
    });

    return {
      status: state.status,
      loginStatus: state.loginStatus,
      selfWxId: state.selfWxId,
      selfWxName: state.selfWxName,
      lastQrCode: state.lastQrCode,
      lastQrAt: state.lastQrAt ? state.lastQrAt.toISOString() : null,
      lastError: state.lastError,
      startedAt: startedAt ? startedAt.toISOString() : null,
      updatedAt: new Date().toISOString(),
      uptimeSeconds,
    };
  }

  /**
   * Send a text message to a user by userId. Used by the inbound webhook
   * to deliver async replies from upstream channels back to the WeChat user.
   *
   * Returns false if the router is offline or the user has no context_token.
   */
  async sendToUser(wxId: string, text: string): Promise<boolean> {
    if (!state.bot || state.loginStatus !== 'logged_in') {
      return false;
    }
    try {
      await state.bot.send(wxId, text);
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[iLink] sendToUser failed:', err);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Update the singleton RouterState row in DB. Only writes the provided fields.
 * We never overwrite lastQrAt with null when persisting because SQLite/Prisma
 * doesn't accept undefined — caller passes `null` explicitly if needed.
 */
async function persistState(
  patch: Partial<{
    status: string;
    loginStatus: string;
    selfWxId: string;
    selfWxName: string;
    lastQrCode: string;
    lastQrAt: Date | null;
    lastError: string;
    startedAt: Date | null;
  }>,
) {
  // Build a clean object: omit undefined values; allow null.
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) data[k] = v;
  }
  if (Object.keys(data).length === 0) return;

  try {
    await prisma.routerState.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[iLink] persistState failed:', (err as Error).message);
  }
}

// Exported singleton.
export const router = new RouterService();
