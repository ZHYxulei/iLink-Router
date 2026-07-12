'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Surface, Badge, Button } from '@cloudflare/kumo';
import { api } from '@/lib/api-client';
import { formatTime } from '@/lib/utils';
import { ArrowLeft, Trash } from '@phosphor-icons/react';

interface SessionDetail {
  session: {
    id: string;
    wxId: string;
    wxName: string;
    currentChannel: string | null;
    messageCount: number;
    lastActiveAt: string;
    createdAt: string;
    channel: { alias: string; name: string } | null;
  };
  messages: {
    id: string;
    direction: string;
    text: string;
    kind: string;
    error: string;
    latencyMs: number | null;
    createdAt: string;
    channel: { alias: string; name: string } | null;
  }[];
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = React.useState<SessionDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const r = await api<SessionDetail>(`/api/sessions/${params.id}?limit=200`);
      setData(r);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const onDelete = async () => {
    if (!confirm('确定删除此会话及其所有消息记录？')) return;
    try {
      await api(`/api/sessions/${params.id}`, { method: 'DELETE' });
      router.push('/sessions');
    } catch {
      // ignore
    }
  };

  if (loading) return <div className="text-sm text-kumo-subtle">加载中...</div>;
  if (!data) return <div className="text-sm text-kumo-subtle">未找到会话</div>;

  const s = data.session;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" shape="square" aria-label="返回" icon={<ArrowLeft weight="duotone" className="h-4 w-4" />} onClick={() => router.push('/sessions')} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-kumo-strong">{s.wxName || '(未命名)'}</h1>
            <p className="text-xs text-kumo-subtle">{s.wxId}</p>
          </div>
        </div>
        <Button variant="destructive" size="sm" icon={Trash} onClick={onDelete}>
          删除会话
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="当前渠道">
          {s.channel ? (
            <Badge variant="primary">{s.channel.alias}</Badge>
          ) : (
            <Badge variant="secondary">未绑定</Badge>
          )}
        </Stat>
        <Stat label="消息总数">
          <span className="font-mono text-lg font-bold text-kumo-strong">{s.messageCount}</span>
        </Stat>
        <Stat label="首次会话">
          <span className="text-xs text-kumo-default">{formatTime(s.createdAt)}</span>
        </Stat>
        <Stat label="最近活跃">
          <span className="text-xs text-kumo-default">{formatTime(s.lastActiveAt)}</span>
        </Stat>
      </div>

      <Surface className="rounded-xl border border-kumo-line p-5">
        <h3 className="text-lg font-semibold text-kumo-strong">消息记录</h3>
        <p className="text-sm text-kumo-subtle">最近的对话历史（自动每 5 秒刷新）</p>
        <div className="mt-4 space-y-3">
          {data.messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-kumo-subtle">暂无消息记录</p>
          ) : (
            data.messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.direction === 'IN' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                    m.direction === 'IN'
                      ? 'bg-kumo-recessed text-kumo-default'
                      : m.kind === 'system'
                        ? 'bg-kumo-warning-tint text-kumo-warning'
                        : m.kind === 'command'
                          ? 'bg-kumo-brand-tint text-kumo-brand'
                          : 'bg-kumo-brand text-white'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-[10px] opacity-70">
                    <span>{formatTime(m.createdAt)}</span>
                    {m.channel && <span>· {m.channel.alias}</span>}
                    {m.latencyMs && <span>· {m.latencyMs}ms</span>}
                    <Badge variant="outline" className="text-[9px]">
                      {m.kind}
                    </Badge>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm">{m.text}</div>
                  {m.error && (
                    <div className="mt-1 text-xs text-red-300">⚠ {m.error}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Surface>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Surface className="rounded-xl border border-kumo-line p-4">
      <div className="text-xs uppercase tracking-wider text-kumo-subtle">{label}</div>
      <div className="mt-2">{children}</div>
    </Surface>
  );
}
