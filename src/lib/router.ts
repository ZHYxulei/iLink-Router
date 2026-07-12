import { config } from './config';
import { prisma } from './db';
import { logMessage, forwardToChannel } from './forwarder';
import { getOrCreateSession, touchSession, getRecentHistory } from './sessions';
import { dispatchCommand } from './commands';
import type { RouterStatusSnapshot, RouterStatus, LoginStatus } from './types';
import type { Channel } from '@prisma/client';
import {
  startWsServer,
  stopWsServer,
  stopAllWsServers,
  setInboundHandler,
  type WsProtocol,
} from './ws-transport';
import {
  startHttpServer,
  stopHttpServer,
  stopAllHttpServers,
  setHttpInboundHandler,
} from './http-transport';

// We import the iLink SDK lazily so the admin UI doesn't pull the whole bot
// into the client bundle. The WeChatBot class is server-only.
type WeChatBotLike = {
  login(options?: {
    force?: boolean;
    callbacks?: {
      onQrUrl?: (url: string) => void;
      onScanned?: () => void;
      onExpired?: () => void;
    };
  }): Promise<unknown>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  isRunning: boolean;
  onMessage(handler: (msg: IncomingMessageLike) => void | Promise<void>): unknown;
  reply(msg: IncomingMessageLike, content: string): Promise<unknown>;
  send(userId: string, content: string): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  // --- 内部组件，用于 loginLoop 手动轮询 QR 状态 ---
  /** SDK 的 HTTP 客户端，用于扩展重试策略。 */
  http?: {
    retryPolicy: {
      maxRetries: number;
      baseDelayMs: number;
      maxDelayMs: number;
      isRetryable: (error: Error) => boolean;
    };
  };
  /** SDK 的 API 层，用于手动调用 pollQrStatus。 */
  api?: {
    pollQrStatus(baseUrl: string, qrcode: string, verifyCode?: string): Promise<QrStatusLike>;
  };
  /** SDK 的 Authenticator，用于访问 storage。 */
  auth?: {
    storage: {
      get(key: string): Promise<unknown>;
      set(key: string, value: unknown): Promise<void>;
    };
  };
  /** 设置 credentials 并更新内部状态。 */
  setCredentials?(creds: unknown): void;
  /** 触发事件（继承自 TypedEmitter）。 */
  emit?(event: string, ...args: unknown[]): void;
};

/** pollQrStatus 返回的状态。 */
interface QrStatusLike {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect' | 'binded_redirect' | 'need_verifycode' | 'verify_code_blocked';
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

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
  /** 后台登录循环的 promise，stop() 时用于取消。 */
  loginLoop: Promise<void> | null;
  /** 登录循环是否已被主动取消（stop/reset 触发）。 */
  loginLoopCancelled: boolean;
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
  loginLoop: null,
  loginLoopCancelled: false,
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
    }) as unknown as WeChatBotLike;

    // 扩展 SDK HttpClient 的重试策略。
    // SDK 默认只重试 AbortError / TimeoutError，不覆盖 ConnectTimeoutError /
    // fetch failed 等网络错误。ilinkai.weixin.qq.com 的 DNS 返回多个 IP，
    // 部分 IP 间歇性连接超时，导致 pollQrStatus 单次失败就抛异常，
    // 让整个 qrLogin() 退出、login() 失败。
    if (bot.http?.retryPolicy) {
      bot.http.retryPolicy.maxRetries = 5;
      bot.http.retryPolicy.baseDelayMs = 500;
      bot.http.retryPolicy.isRetryable = (error: Error) => {
        // SDK 原始逻辑：重试 AbortError / TimeoutError
        if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
        // 扩展：重试网络连接错误（ConnectTimeoutError / fetch failed 等）
        const msg = error.message || '';
        if (/fetch failed|Network error|Connect Timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up/i.test(msg)) {
          return true;
        }
        return false;
      };
    }

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

  /** SDK login() 回调——必须传给 login()，构造函数不认。 */
  private loginCallbacks = {
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
  };

  /**
   * 后台登录循环：持续调用 bot.login() 直到登录成功或被取消。
   *
   * SDK 的 login() 包含「获取QR → 轮询扫码状态 → 确认登录」整个流程。
   * 轮询可能在网络抖动时超时（TimeoutError / ConnectTimeoutError），
   * 但这不代表登录失败——QR 已经生成了，用户可能正在扫码。
   *
   * 关键：login() 失败后如果已有 QR，不能直接重试 login()——SDK 会获取
   * 新 QR，导致用户之前扫的码作废。此时改为手动调用 pollQrStatus 继续
   * 轮询当前 QR，直到确认 / 过期。
   */
  private startLoginLoop(bot: WeChatBotLike, force: boolean): Promise<void> {
    state.loginLoopCancelled = false;
    state.loginLoop = (async () => {
      const maxAttempts = 10;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (state.loginLoopCancelled) return;
        try {
          // login() 成功 = 用户已扫码确认；失败 = 轮询超时等。
          // force=true 仅在第一次尝试时使用，后续重试不再强制清除凭据。
          // callbacks 必须传给 login()，不能传给构造函数（SDK 不认）。
          await bot.login(
            attempt === 0 && force
              ? { force: true, callbacks: this.loginCallbacks }
              : { callbacks: this.loginCallbacks },
          );
          // login() 成功返回后，SDK 事件 'login' 会把 status 设为 'ready'。
          // 再启动消息轮询。
          if (!state.loginLoopCancelled) {
            await bot.start();
          }
          return;
        } catch (err) {
          if (state.loginLoopCancelled) return;
          const msg = (err as Error)?.message || '';
          // 已经登录成功了（可能 SDK 内部已恢复会话）
          if (state.loginStatus === 'logged_in') return;

          // *** 关键修复 ***
          // 如果已有 QR（用户可能已扫码），不要重新调用 login() 获取新 QR，
          // 而是手动调用 pollQrStatus 继续轮询当前 QR。
          if (state.lastQrCode && bot.api) {
            // eslint-disable-next-line no-console
            console.warn(
              `[iLink] login() failed but QR exists — continuing to poll current QR: ${msg}`,
            );
            const polled = await this.continuePollingQr(bot);
            if (polled === 'confirmed') {
              // 用户扫码确认，credentials 已保存，SDK login 事件已触发。
              if (!state.loginLoopCancelled) {
                await bot.start();
              }
              return;
            }
            if (polled === 'expired') {
              // QR 过期，继续外层循环重新 login() 获取新 QR。
              state.lastQrCode = '';
              state.loginStatus = 'logged_out';
              await persistState({ lastQrCode: '', loginStatus: 'logged_out' });
              continue; // 外层 for 循环的下一次迭代会调用 login()
            }
            // polled === 'cancelled' 或 'error'
            if (state.loginLoopCancelled) return;
            continue;
          }

          // 没有 QR，说明 login() 在获取 QR 阶段就失败了，正常重试。
          const transient =
            /fetch failed|Network error|Connect Timeout|aborted due to timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|QR code expired/i.test(
              msg,
            );
          if (!transient || attempt === maxAttempts - 1) {
            state.status = 'error';
            state.lastError = msg;
            await persistState({ status: 'error', lastError: msg });
            // eslint-disable-next-line no-console
            console.error(`[iLink] login loop gave up after ${attempt + 1} attempts:`, err);
            return;
          }
          const delay = Math.min(2000 * 2 ** Math.min(attempt, 4), 10000);
          // eslint-disable-next-line no-console
          console.warn(
            `[iLink] login attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delay}ms: ${msg}`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    })();
    return state.loginLoop;
  }

  /**
   * 手动轮询当前 QR 的扫码状态，不获取新 QR。
   *
   * 当 login() 因网络超时失败但 QR 已生成时调用。直接调用 SDK 的
   * pollQrStatus API 继续轮询，直到用户确认、QR 过期或被取消。
   *
   * 返回:
   *   'confirmed' — 用户已扫码确认，credentials 已保存，login 事件已触发
   *   'expired'   — QR 已过期，调用方应重新 login() 获取新 QR
   *   'cancelled' — 被 stop()/reset() 取消
   *   'error'     — 轮询持续失败
   */
  private async continuePollingQr(
    bot: WeChatBotLike,
  ): Promise<'confirmed' | 'expired' | 'cancelled' | 'error'> {
    if (!bot.api) return 'error';

    // 从 lastQrCode URL 中解析 qrcode token
    // URL 格式: https://liteapp.weixin.qq.com/q/xxx?qrcode=<token>&bot_type=3
    let qrcode: string | null = null;
    try {
      const url = new URL(state.lastQrCode);
      qrcode = url.searchParams.get('qrcode');
    } catch {
      // 不是 URL，可能是裸 token
      if (/^[a-f0-9]{16,64}$/i.test(state.lastQrCode)) {
        qrcode = state.lastQrCode;
      }
    }
    if (!qrcode) return 'error';

    const baseUrl = 'https://ilinkai.weixin.qq.com';
    const pollIntervalMs = 2_000;
    const maxPolls = 90; // 最多轮询 90 次 × 2 秒 = 3 分钟
    let consecutiveErrors = 0;

    for (let i = 0; i < maxPolls; i++) {
      if (state.loginLoopCancelled) return 'cancelled';
      if (state.loginStatus === 'logged_in') return 'confirmed';

      try {
        const status = await bot.api.pollQrStatus(baseUrl, qrcode);
        consecutiveErrors = 0;

        if (status.status === 'confirmed') {
          // 用户已确认，构造 credentials 并保存
          if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
            // eslint-disable-next-line no-console
            console.error('[iLink] poll confirmed but missing credentials:', status);
            return 'error';
          }
          const credentials = {
            token: status.bot_token,
            baseUrl: status.baseurl ?? baseUrl,
            accountId: status.ilink_bot_id,
            userId: status.ilink_user_id,
            savedAt: new Date().toISOString(),
          };
          // 保存到 SDK storage（和 Authenticator.qrLogin 一致）
          if (bot.auth?.storage) {
            await bot.auth.storage.set('credentials', credentials);
          }
          // 更新 bot 内部状态并触发 login 事件
          bot.setCredentials?.(credentials);
          bot.emit?.('login', credentials);
          return 'confirmed';
        }

        if (status.status === 'expired') {
          // eslint-disable-next-line no-console
          console.warn('[iLink] QR expired during manual poll');
          return 'expired';
        }

        if (status.status === 'scaned') {
          // 用户已扫码，等待确认
          // eslint-disable-next-line no-console
          console.log('[iLink] QR scanned (manual poll) — waiting for confirmation...');
        }

        // wait / scaned / scaned_but_redirect 等，继续轮询
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      } catch (err) {
        consecutiveErrors++;
        const msg = (err as Error)?.message || '';
        // eslint-disable-next-line no-console
        console.warn(`[iLink] manual poll error (${consecutiveErrors}): ${msg}`);
        if (consecutiveErrors >= 10) {
          // 连续 10 次轮询失败，放弃
          // eslint-disable-next-line no-console
          console.error('[iLink] manual poll gave up after 10 consecutive errors');
          return 'error';
        }
        // 短暂等待后重试
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    }

    // 超时
    // eslint-disable-next-line no-console
    console.warn('[iLink] manual poll timed out after 3 minutes');
    return 'expired';
  }

  async stop(): Promise<void> {
    // 取消后台登录循环标志
    state.loginLoopCancelled = true;

    if (state.stopping) return state.stopping;

    const botToStop = state.bot;

    // 停止所有 WS / HTTP 服务端（不依赖 bot）
    stopAllWsServers();
    setInboundHandler(null);
    stopAllHttpServers();
    setHttpInboundHandler(null);

    if (!botToStop) {
      // 没有 bot，仍需等待可能存在的 loginLoop 退出（短超时）
      if (state.loginLoop) {
        try {
          await Promise.race([
            state.loginLoop,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('loginLoop timeout')), 2000),
            ),
          ]);
        } catch { /* ignore */ }
        state.loginLoop = null;
      }
      state.status = 'offline';
      state.loginStatus = 'logged_out';
      await persistState({ status: 'offline', loginStatus: 'logged_out' });
      return;
    }

    // 关键：先调用 bot.stop()，这会让 loginLoop 内的 bot.start() 返回，
    // 否则 await loginLoop 会死锁（loginLoop 在 bot.start() 里永远不返回）。
    state.stopping = (async () => {
      try {
        await Promise.race([
          botToStop.stop(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('bot.stop() timeout after 8s')), 8000),
          ),
        ]);
      } catch (err) {
        console.error('[iLink] bot.stop() error (ignored):', (err as Error).message);
      }

      // bot.stop() 返回后，loginLoop 应该很快退出；给它一个短超时兜底
      if (state.loginLoop) {
        try {
          await Promise.race([
            state.loginLoop,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('loginLoop cleanup timeout')), 3000),
            ),
          ]);
        } catch { /* ignore */ }
        state.loginLoop = null;
      }

      state.bot = null;
      state.status = 'offline';
      state.loginStatus = 'logged_out';
      state.stopping = null;
      await persistState({ status: 'offline', loginStatus: 'logged_out' });
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

  /**
   * 重启路由：停掉当前 bot 实例并用新代码重建。
   *
   * 用于开发时修改了 router.ts / 消息处理逻辑等核心代码后，
   * 无需重启整个 dev server 即可让新代码生效。
   *
   * 与 reset() 的区别：restart() 不清除 credentials，
   * SDK 从 file storage 恢复登录，无需重新扫码。
   */
  async restart(): Promise<void> {
    if (state.bot) {
      await this.stop();
    }
    // 不清除 lastQrCode / loginStatus，让 start() 从存储恢复凭据。
    state.lastError = '';
    state.status = 'offline';
    await persistState({ status: 'offline', lastError: '' });
    // start(forceLogin=false) → SDK 尝试从存储加载 credentials
    return this.start(false);
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
        state.lastQrCode = '';
        await persistState({ status: 'starting', lastError: '', lastQrCode: '' });

        // 启动 WS 服务端渠道（不阻塞登录流程）
        this.startWsServers().catch((e) => {
          console.error('[iLink] WS 服务端启动出错:', e);
        });

        // 启动 HTTP 服务端渠道（不阻塞登录流程）
        this.startHttpServers().catch((e) => {
          console.error('[iLink] HTTP 服务端启动出错:', e);
        });

        const bot = await this.buildBot();
        state.bot = bot;
        state.startedAt = new Date();
        await persistState({ startedAt: state.startedAt });

        // 在后台启动登录循环。onQrUrl 回调会把 QR 写入 state.lastQrCode。
        this.startLoginLoop(bot, forceLogin);

        // 等待 QR 生成（最多 10 秒）。onQrUrl 通常在 200ms 内触发。
        const qrDeadline = Date.now() + 10_000;
        while (Date.now() < qrDeadline) {
          if (state.loginStatus === 'logged_in') {
            // SDK 从存储恢复了凭据，无需扫码。
            return;
          }
          if (state.lastQrCode) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (state.lastQrCode) {
          // QR 已生成，后台循环继续等待扫码。start() 成功返回。
          state.status = 'starting';
          await persistState({ status: 'starting' });
          // eslint-disable-next-line no-console
          console.log('[iLink] QR ready — waiting for scan in background');
          return;
        }

        // QR 没生成，检查后台循环是否已经报错。
        // 后台 loginLoop 可能已把 status 改为 'error'，TS 不知道，需断言。
        if ((state.status as string) === 'error') {
          throw new Error(state.lastError || 'login failed');
        }
        throw new Error('login did not produce a QR code within 10s');
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
   * 启动所有已启用的 WS 服务端渠道。
   * 在 start() 中调用。
   */
  private async startWsServers(): Promise<void> {
    // 设置入站消息处理器
    setInboundHandler((msg) => {
      this.handleWsInbound(msg).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[iLink] WS inbound handler error:', e);
      });
    });

    // 查询所有 WS 服务端类型的已启用渠道
    const wsTypes = ['WS_SERVER', 'ONEBOT_V11_WS_SERVER', 'ONEBOT_V12_WS_SERVER'];
    const channels = await prisma.channel.findMany({
      where: { type: { in: wsTypes }, enabled: true },
    });

    for (const ch of channels) {
      try {
        await this.startOneWsServer(ch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[iLink] WS 服务端启动失败 (${ch.alias}):`, err);
      }
    }
  }

  /** 启动单个 WS 服务端渠道。 */
  private async startOneWsServer(ch: Channel): Promise<void> {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(ch.config || '{}');
    } catch { /* noop */ }

    const port = Number(cfg.port);
    if (!port || port < 1 || port > 65535) {
      // eslint-disable-next-line no-console
      console.warn(`[iLink] WS 服务端 ${ch.alias} 端口无效: ${cfg.port}`);
      return;
    }

    const token = (cfg.ws_token as string) || '';
    const type = ch.type;
    let protocol: WsProtocol = 'generic';
    if (type === 'ONEBOT_V11_WS_SERVER') protocol = 'onebot_v11';
    else if (type === 'ONEBOT_V12_WS_SERVER') protocol = 'onebot_v12';

    await startWsServer({
      channelId: ch.id,
      alias: ch.alias,
      port,
      token,
      protocol,
    });
  }

  /** 处理 WS 客户端发来的入站消息，转发给微信用户。 */
  private async handleWsInbound(msg: {
    channelId: string;
    alias: string;
    protocol: WsProtocol;
    userId: string;
    message: string;
    raw: unknown;
  }): Promise<void> {
    // 查找渠道
    const channel = await prisma.channel.findUnique({
      where: { alias: msg.alias },
    });
    if (!channel) return;

    // 构造来源信息
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const sourceHeader =
      `📨 来自渠道推送\n` +
      `━━━━━━━━━━━━━━\n` +
      `渠道：${channel.name}（${channel.alias}）\n` +
      `类型：${channel.type}\n` +
      `时间：${timeStr}\n` +
      `━━━━━━━━━━━━━━`;

    // 先发来源信息，再转发原始消息
    await this.sendToUser(msg.userId, sourceHeader);
    await this.sendToUser(msg.userId, msg.message);

    // 记录消息
    const session = await getOrCreateSession(msg.userId, msg.userId);
    await logMessage({
      sessionId: session.id,
      direction: 'OUT',
      text: `[${sourceHeader}]\n${msg.message}`,
      kind: 'reply',
      channelId: channel.id,
    }).catch(() => {});
  }

  /**
   * 重新加载单个 WS 服务端渠道（创建/编辑/删除时调用）。
   * 如果渠道不需要 WS 服务端，则不做任何操作。
   */
  async reloadWsServer(channel: Channel): Promise<void> {
    const wsTypes = ['WS_SERVER', 'ONEBOT_V11_WS_SERVER', 'ONEBOT_V12_WS_SERVER'];
    if (!wsTypes.includes(channel.type)) return;

    // 先停止已有的
    stopWsServer(channel.id);

    // 如果渠道已启用且路由在线，重新启动
    if (channel.enabled && state.bot) {
      try {
        await this.startOneWsServer(channel);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[iLink] WS 服务端重载失败 (${channel.alias}):`, err);
      }
    }
  }

  /** 停止单个 WS 服务端渠道（删除时调用）。 */
  async unloadWsServer(channelId: string): Promise<void> {
    stopWsServer(channelId);
  }

  // --- HTTP 服务端生命周期 -------------------------------------------------

  /**
   * 启动所有已启用的 HTTP 服务端渠道。
   * 在 start() 中调用。
   */
  private async startHttpServers(): Promise<void> {
    // 设置入站消息处理器
    setHttpInboundHandler((msg) => {
      this.handleHttpInbound(msg).catch((e) => {
        // eslint-disable-next-line no-console
        console.error('[iLink] HTTP inbound handler error:', e);
      });
    });

    // 查询所有 HTTP 服务端类型的已启用渠道
    const httpTypes = ['HTTP_SERVER', 'HTTP_SSE_SERVER'];
    const channels = await prisma.channel.findMany({
      where: { type: { in: httpTypes }, enabled: true },
    });

    for (const ch of channels) {
      try {
        await this.startOneHttpServer(ch);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[iLink] HTTP 服务端启动失败 (${ch.alias}):`, err);
      }
    }
  }

  /** 启动单个 HTTP 服务端渠道。 */
  private async startOneHttpServer(ch: Channel): Promise<void> {
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(ch.config || '{}');
    } catch { /* noop */ }

    const port = Number(cfg.port);
    if (!port || port < 1 || port > 65535) {
      // eslint-disable-next-line no-console
      console.warn(`[iLink] HTTP 服务端 ${ch.alias} 端口无效: ${cfg.port}`);
      return;
    }

    const token = (cfg.server_token as string) || '';
    const pathPrefix = (cfg.path_prefix as string) || '/';
    const sse = ch.type === 'HTTP_SSE_SERVER';

    await startHttpServer({
      channelId: ch.id,
      alias: ch.alias,
      port,
      token,
      pathPrefix,
      sse,
    });
  }

  /** 处理 HTTP 客户端 POST /send 发来的入站消息，转发给微信用户。 */
  private async handleHttpInbound(msg: {
    channelId: string;
    alias: string;
    userId: string;
    message: string;
    raw: unknown;
  }): Promise<void> {
    // 查找渠道
    const channel = await prisma.channel.findUnique({
      where: { alias: msg.alias },
    });
    if (!channel) return;

    // 构造来源信息
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const sourceHeader =
      `📨 来自渠道推送\n` +
      `━━━━━━━━━━━━━━\n` +
      `渠道：${channel.name}（${channel.alias}）\n` +
      `类型：${channel.type}\n` +
      `时间：${timeStr}\n` +
      `━━━━━━━━━━━━━━`;

    // 先发来源信息，再转发原始消息
    await this.sendToUser(msg.userId, sourceHeader);
    await this.sendToUser(msg.userId, msg.message);

    // 记录消息
    const session = await getOrCreateSession(msg.userId, msg.userId);
    await logMessage({
      sessionId: session.id,
      direction: 'OUT',
      text: `[${sourceHeader}]\n${msg.message}`,
      kind: 'reply',
      channelId: channel.id,
    }).catch(() => {});
  }

  /**
   * 重新加载单个 HTTP 服务端渠道（创建/编辑时调用）。
   * 如果渠道不需要 HTTP 服务端，则不做任何操作。
   */
  async reloadHttpServer(channel: Channel): Promise<void> {
    const httpTypes = ['HTTP_SERVER', 'HTTP_SSE_SERVER'];
    if (!httpTypes.includes(channel.type)) return;

    // 先停止已有的
    stopHttpServer(channel.id);

    // 如果渠道已启用且路由在线，重新启动
    if (channel.enabled && state.bot) {
      try {
        await this.startOneHttpServer(channel);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[iLink] HTTP 服务端重载失败 (${channel.alias}):`, err);
      }
    }
  }

  /** 停止单个 HTTP 服务端渠道（删除时调用）。 */
  async unloadHttpServer(channelId: string): Promise<void> {
    stopHttpServer(channelId);
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

  /**
   * 模拟微信用户发送消息（用于 /chat 调试界面）。
   *
   * 与 handleMessage 的区别：不调用 bot.reply 真发微信，
   * 而是把回复返回给调用方（前端显示在聊天界面）。
   * 消息记录照常写入数据库，与微信聊天记录保持同步。
   *
   * 返回值为路由给出的回复（命令回复 / 渠道转发回复 / 错误提示）。
   */
  async simulateInbound(
    wxId: string,
    text: string,
  ): Promise<{
    reply: string;
    kind: 'command' | 'reply' | 'system';
    channelId?: string;
    latencyMs?: number;
    error?: string;
  }> {
    const session = await getOrCreateSession(wxId, wxId);
    await touchSession(session.id);

    // 1) Try command first.
    const cmd = await dispatchCommand(session.id, wxId, wxId, text);
    if (cmd?.handled) {
      await logMessage({
        sessionId: session.id,
        direction: 'IN',
        text,
        kind: 'command',
      });
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: cmd.reply,
        kind: 'command',
        channelId: cmd.channelId,
      });
      return { reply: cmd.reply, kind: 'command', channelId: cmd.channelId };
    }

    // 2) Log inbound.
    await logMessage({
      sessionId: session.id,
      direction: 'IN',
      text,
      kind: 'forwarded',
      channelId: session.channel?.id,
    });

    // 3) No channel bound.
    if (!session.channel) {
      const reply =
        `⚠ 当前未绑定渠道\n` +
        `请发送 ${config.router.commandPrefix}channels 查看可用渠道，` +
        `然后用 ${config.router.commandPrefix}switch <别名> 切换`;
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: reply,
        kind: 'system',
      });
      return { reply, kind: 'system' };
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
          userName: wxId,
          message: text,
          receivedAt,
          channelAlias: channel.alias,
          history,
        },
        history,
      );
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: reply,
        kind: 'reply',
        channelId: channel.id,
        latencyMs,
      });
      return { reply, kind: 'reply', channelId: channel.id, latencyMs };
    } catch (err) {
      const errMsg = (err as Error).message;
      const reply = `❌ 转发失败: ${errMsg}`;
      await logMessage({
        sessionId: session.id,
        direction: 'OUT',
        text: reply,
        kind: 'system',
        channelId: channel.id,
        error: errMsg,
      });
      return { reply, kind: 'system', channelId: channel.id, error: errMsg };
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
