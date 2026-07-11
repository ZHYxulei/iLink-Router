import { prisma } from './db';

/**
 * 应用设置服务 —— 从 AppSetting 表读写运行时可配置项。
 *
 * 设置项以 key/value 形式存储，value 是 JSON 编码的字符串。
 * 带内存缓存，避免每次读取都查库。
 */

/** 所有已知设置项的 key 及默认值。 */
export const SETTING_KEYS = {
  /** 是否允许 GET 请求访问 /api/qr（默认 false，仅 POST）。 */
  qrGetEnabled: 'qr.get_enabled',
  /** /api/qr 的访问密钥，为空则不校验。 */
  qrApiKey: 'qr.api_key',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const DEFAULTS: Record<SettingKey, unknown> = {
  [SETTING_KEYS.qrGetEnabled]: false,
  [SETTING_KEYS.qrApiKey]: '',
};

const TYPES: Record<SettingKey, 'boolean' | 'string'> = {
  [SETTING_KEYS.qrGetEnabled]: 'boolean',
  [SETTING_KEYS.qrApiKey]: 'string',
};

/** 内存缓存，启动后第一次读取填充。 */
const cache = new Map<SettingKey, unknown>();
let cacheLoaded = false;

async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const rows = await prisma.appSetting.findMany();
    for (const row of rows) {
      try {
        cache.set(row.key as SettingKey, JSON.parse(row.value));
      } catch {
        // 损坏的值忽略，用默认值
      }
    }
  } catch {
    // 表可能还没创建（首次运行），忽略
  }
}

/** 读取单个设置项，不存在则返回默认值。 */
export async function getSetting<T>(key: SettingKey): Promise<T> {
  await loadCache();
  if (cache.has(key)) return cache.get(key) as T;
  return DEFAULTS[key] as T;
}

/** 读取所有设置项。 */
export async function getAllSettings(): Promise<Record<SettingKey, unknown>> {
  await loadCache();
  const result = {} as Record<SettingKey, unknown>;
  for (const k of Object.keys(SETTING_KEYS) as (keyof typeof SETTING_KEYS)[]) {
    const key = SETTING_KEYS[k] as SettingKey;
    result[key] = cache.has(key) ? cache.get(key) : DEFAULTS[key];
  }
  return result;
}

/** 写入设置项，同时更新缓存。 */
export async function setSetting(key: SettingKey, value: unknown): Promise<void> {
  const type = TYPES[key];
  const encoded = JSON.stringify(value);
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: encoded, type, description: '' },
    update: { value: encoded, type },
  });
  cache.set(key, value);
}

/** 设置项的元信息（给 UI 渲染用）。 */
export const SETTING_META: Record<
  SettingKey,
  { type: 'boolean' | 'string'; label: string; description: string; default: unknown }
> = {
  [SETTING_KEYS.qrGetEnabled]: {
    type: 'boolean',
    label: '允许 GET 请求访问二维码 API',
    description:
      '开启后可通过 GET /api/qr 获取二维码（便于浏览器直接访问）。关闭后仅允许 POST 请求，更安全。',
    default: false,
  },
  [SETTING_KEYS.qrApiKey]: {
    type: 'string',
    label: '二维码 API 密钥',
    description:
      '设置后，访问 /api/qr 时需在 Authorization: Bearer <key> 或 X-Api-Key 头中携带此密钥。留空则不校验。',
    default: '',
  },
};
