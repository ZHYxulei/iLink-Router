import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { router } from '@/lib/router';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/qr — returns the current scan QR code.
 *
 * Query:
 *   format=dataurl  -> { qr: "data:image/png;base64,..." }  (default)
 *   format=text     -> { qr: "https://login.weixin.qq.com/qrcode/..." }
 *   format=png      -> image/png (binary)
 *
 * This route is intentionally public (no admin token) so a phone can scan
 * without auth — the QR itself is the auth.
 */
export async function GET(req: NextRequest) {
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
