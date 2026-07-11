import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAllSettings, setSetting, SETTING_KEYS, SETTING_META, type SettingKey } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/settings — 返回所有设置项（含元信息）。 */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const values = await getAllSettings();
  const items = (Object.keys(SETTING_KEYS) as (keyof typeof SETTING_KEYS)[]).map((k) => {
    const key = SETTING_KEYS[k] as SettingKey;
    const meta = SETTING_META[key];
    return {
      key,
      value: values[key],
      type: meta.type,
      label: meta.label,
      description: meta.description,
      default: meta.default,
    };
  });
  return NextResponse.json({ items });
}

/** POST /api/settings — 更新设置项。Body: { key: string, value: any } */
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.key !== 'string') {
    return NextResponse.json({ error: 'body must be { key, value }' }, { status: 400 });
  }

  // 校验 key 是否合法
  const validKeys = Object.values(SETTING_KEYS) as string[];
  if (!validKeys.includes(body.key)) {
    return NextResponse.json({ error: `unknown setting key: ${body.key}` }, { status: 400 });
  }

  const key = body.key as SettingKey;
  const meta = SETTING_META[key];

  // 类型校验
  let value = body.value;
  if (meta.type === 'boolean') {
    value = Boolean(value);
  } else if (meta.type === 'string') {
    value = String(value ?? '');
  }

  await setSetting(key, value);
  return NextResponse.json({ ok: true, key, value });
}
