/**
 * Centralized environment configuration for iLink-Router.
 * Loaded once at import time; safe to use from both server and API routes.
 */
export const config = {
  database: {
    // Note: the actual DB provider is configured in prisma/schema.prisma
    // (Prisma requires a literal there). This field is informational only.
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  ilink: {
    // iLink API base URL. Default is the official production endpoint.
    baseUrl: process.env.ILINK_BASE_URL || 'https://ilinkai.weixin.qq.com',
    // Where the @wechatbot/wechatbot SDK persists credentials & cursors.
    storageDir: process.env.ILINK_STORAGE_DIR || '~/.wechatbot',
    // SDK log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
    logLevel: process.env.ILINK_LOG_LEVEL || 'info',
  },
  router: {
    commandPrefix: process.env.COMMAND_PREFIX || '!',
    defaultChannelAlias: process.env.DEFAULT_CHANNEL_ALIAS || '',
    forwardTimeoutMs: Number(process.env.FORWARD_TIMEOUT_MS || 30000),
  },
  redis: {
    url: process.env.REDIS_URL || '',
  },
  server: {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    adminToken: process.env.ADMIN_TOKEN || '',
  },
  upstream: {
    webhookSecret: process.env.UPSTREAM_WEBHOOK_SECRET || '',
  },
} as const;

export type Config = typeof config;
