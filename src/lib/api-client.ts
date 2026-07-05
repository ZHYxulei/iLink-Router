/**
 * Tiny fetch wrapper for the admin UI.
 * - auto-prefixes with the same origin
 * - auto-attaches admin token if configured client-side via localStorage
 * - returns parsed JSON or throws
 */
export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('ilink_admin_token') || ''
      : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}
