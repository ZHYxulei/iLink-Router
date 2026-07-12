'use client';

import * as React from 'react';
import { Surface, Badge } from '@cloudflare/kumo';
import { api } from '@/lib/api-client';
import { formatTime, truncate } from '@/lib/utils';
import { Funnel, BookOpenText } from '@phosphor-icons/react';

interface Msg {
  id: string;
  direction: string;
  text: string;
  kind: string;
  error: string;
  latencyMs: number | null;
  createdAt: string;
  session: { wxName: string; wxId: string };
  channel: { alias: string; name: string } | null;
}

const KINDS = ['', 'command', 'forwarded', 'reply', 'system'];
const DIRS = ['', 'IN', 'OUT'];

export default function MessagesPage() {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [kind, setKind] = React.useState('');
  const [dir, setDir] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '200' });
    if (kind) params.set('kind', kind);
    if (dir) params.set('direction', dir);
    try {
      const r = await api<{ messages: Msg[]; total: number }>(`/api/messages?${params}`);
      setMessages(r.messages);
      setTotal(r.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [kind, dir]);

  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-kumo-strong">消息日志</h1>
        <p className="mt-1 text-sm text-kumo-subtle">
          路由处理的所有消息记录（最近 200 条，共 {total} 条）
        </p>
      </div>

      <Surface className="rounded-xl border border-kumo-line p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-kumo-subtle">
            <Funnel className="h-4 w-4" />
            筛选:
          </div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="h-9 rounded-md border border-kumo-line bg-kumo-base px-3 text-sm text-kumo-default"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k || '全部类型'}
              </option>
            ))}
          </select>
          <select
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            className="h-9 rounded-md border border-kumo-line bg-kumo-base px-3 text-sm text-kumo-default"
          >
            {DIRS.map((d) => (
              <option key={d} value={d}>
                {d || '全部方向'}
              </option>
            ))}
          </select>
        </div>
      </Surface>

      <Surface className="rounded-xl border border-kumo-line">
        {loading ? (
          <div className="p-6 text-sm text-kumo-subtle">加载中...</div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-kumo-recessed">
              <BookOpenText className="h-8 w-8 text-kumo-subtle" />
            </div>
            <div className="text-base font-medium text-kumo-strong">暂无消息</div>
          </div>
        ) : (
          <div className="divide-y divide-kumo-line">
            {messages.map((m) => (
              <div key={m.id} className="flex items-start gap-3 p-4">
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    m.direction === 'IN'
                      ? 'bg-kumo-success-tint text-kumo-success'
                      : 'bg-kumo-brand-tint text-kumo-brand'
                  }`}
                >
                  {m.direction === 'IN' ? '↙' : '↗'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-kumo-strong">{m.session?.wxName || m.session?.wxId}</span>
                    {m.channel && (
                      <Badge variant="outline" className="text-[10px]">
                        {m.channel.alias}
                      </Badge>
                    )}
                    <Badge
                      variant={
                        m.kind === 'command'
                          ? 'primary'
                          : m.kind === 'system'
                            ? 'warning'
                            : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {m.kind}
                    </Badge>
                    {m.latencyMs && (
                      <span className="text-kumo-subtle">{m.latencyMs}ms</span>
                    )}
                    <span className="text-kumo-subtle">{formatTime(m.createdAt)}</span>
                  </div>
                  <div className="mt-1 break-all text-sm text-kumo-default">
                    {truncate(m.text || m.error || '(空)', 300)}
                  </div>
                  {m.error && (
                    <div className="mt-1 text-xs text-kumo-danger">⚠ {m.error}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Surface>
    </div>
  );
}
