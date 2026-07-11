import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { parseQrContent, type ParsedQr } from '@/lib/qr-parse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/channels/parse-qr
 *
 * Body: { text: string }
 *   - 二维码解码后的文本（完整 liteapp URL 或裸 token）
 *
 * 返回: ParsedQr
 *   { raw, recognized, url?, qrcode?, botType?, pathSegment?, params?, error? }
 *
 * 用于脚本/自动化调用：调用方先用任意 QR 解码库把图片转成文本，
 * 再 POST 到本接口拿到结构化的 token / bot_type。
 *
 * 图片解码不在服务端做（避免引入图片解码依赖），由浏览器端 QrDropzone
 * 组件负责。
 */
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.text !== 'string') {
    return NextResponse.json(
      { error: 'body must be { text: string }' },
      { status: 400 },
    );
  }

  const parsed: ParsedQr = parseQrContent(body.text);
  return NextResponse.json(parsed);
}
