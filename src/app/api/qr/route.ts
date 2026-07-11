import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { router } from '@/lib/router';
import { getSetting, SETTING_KEYS } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 二维码 API —— POST 为主，GET 按设置开关控制。
 *
 * POST /api/qr?format=dataurl|text|png
 *   主请求方式，始终可用。如设置了 qr.api_key，需携带密钥。
 *
 * GET /api/qr?format=...
 *   仅当设置项 qr.get_enabled = true 时可用，否则返回 405。
 *   如设置了 qr.api_key，同样需携带密钥。
 *
 * 密钥校验（当 qr.api_key 非空时）：
 *   - Authorization: Bearer <key>
 *   - 或 X-Api-Key: <key>
 *   - 或 query ?api_key=<key>
 *
 * Query:
 *   format=dataurl  -> { qr: "data:image/png;base64,..." }  (默认)
 *   format=text     -> { qr: "https://login.weixin.qq.com/qrcode/..." }
 *   format=png      -> image/png (binary)
 */
async function checkQrAccess(req: NextRequest): Promise<NextResponse | null> {
  const apiKey = await getSetting<string>(SETTING_KEYS.qrApiKey);
  if (apiKey) {
    const authHeader = req.headers.get('authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const xApiKey = req.headers.get('x-api-key') || '';
    const queryKey = req.nextUrl.searchParams.get('api_key') || '';
    if (bearer !== apiKey && xApiKey !== apiKey && queryKey !== apiKey) {
      return NextResponse.json({ error: 'unauthorized: invalid or missing api key' }, { status: 401 });
    }
  }
  return null;
}

async function handleQr(req: NextRequest): Promise<NextResponse> {
  const accessErr = await checkQrAccess(req);
  if (accessErr) return accessErr;

  const status = await router.getStatus();
  const format = req.nextUrl.searchParams.get('format') || 'dataurl';

  if (!status.lastQrCode) {
    return NextResponse.json(
      {
        qr: null,
        loginStatus: status.loginStatus,
        message:
          status.loginStatus === 'logged_in'
            ? 'router already logged in'
            : 'no QR code yet — start the router first',
      },
      { status: 200 },
    );
  }

  if (format === 'text') {
    return NextResponse.json({
      qr: status.lastQrCode,
      loginStatus: status.loginStatus,
      lastQrAt: status.lastQrAt,
    });
  }

  // Render QR as PNG data URL.
  const dataUrl = await QRCode.toDataURL(status.lastQrCode, {
    margin: 2,
    width: 480,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  if (format === 'png') {
    const base64 = dataUrl.split(',')[1] || '';
    const bin = Buffer.from(base64, 'base64');
    return new NextResponse(bin, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({
    qr: dataUrl,
    text: status.lastQrCode,
    loginStatus: status.loginStatus,
    lastQrAt: status.lastQrAt,
  });
}

/** POST —— 主请求方式，始终可用。 */
export async function POST(req: NextRequest) {
  return handleQr(req);
}

/** GET —— 按设置开关控制，默认关闭。 */
export async function GET(req: NextRequest) {
  const getEnabled = await getSetting<boolean>(SETTING_KEYS.qrGetEnabled);
  if (!getEnabled) {
    return NextResponse.json(
      {
        error: 'GET method disabled. Use POST /api/qr instead, or enable GET in Settings.',
      },
      { status: 405 },
    );
  }
  return handleQr(req);
}
