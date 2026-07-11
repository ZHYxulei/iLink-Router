import { NextRequest, NextResponse } from 'next/server';
import { router } from '@/lib/router';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/router/status — current router + login status. */
export async function GET(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const status = await router.getStatus();
  return NextResponse.json(status);
}

/** POST /api/router/status — control the bot. Body: { action: "start"|"stop"|"reset"|"restart" } */
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'start') {
      await router.start();
    } else if (action === 'stop') {
      await router.stop();
    } else if (action === 'reset') {
      await router.reset();
    } else if (action === 'restart') {
      await router.restart();
    } else {
      return NextResponse.json(
        { error: 'unknown action', action },
        { status: 400 },
      );
    }
    const status = await router.getStatus();
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
