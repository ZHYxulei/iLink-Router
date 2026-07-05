import { NextRequest, NextResponse } from 'next/server';
import { config } from './config';

/**
 * Optional admin token auth. When ADMIN_TOKEN is set, all /api routes
 * (except /api/qr which is intentionally public for scan-to-bind) require
 * `Authorization: Bearer <token>` header.
 *
 * In dev with ADMIN_TOKEN="" auth is disabled.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  if (!config.server.adminToken) return null;
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== config.server.adminToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
