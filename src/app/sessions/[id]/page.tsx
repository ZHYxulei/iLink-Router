'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

  if (loading) return <div className="text-sm text-muted-foreground">加载中...</div>;
  if (!data) return <div className="text-sm text-muted-foreground">未找到会话</div>;

  const s = data.session;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" aria-label="返回" onClick={() => router.push('/sessions')}>
            <ArrowLeft weight="duotone" className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{s.wxName || '(未命名)'}</h1>
            <p className="text-xs text-muted-foreground">{s.wxId}</p>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash className="h-4 w-4" />
          删除会话
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="当前渠道">
          {s.channel ? (
            <Badge variant="default">{s.channel.alias}</Badge>
          ) : (
            <Badge variant="secondary">未绑定</Badge>
          )}
        </Stat>
        <Stat label="消息总数">
          <span className="font-mono text-lg font-bold text-foreground">{s.messageCount}</span>
        </Stat>
        <Stat label="首次会话">
          <span className="text-xs text-foreground">{formatTime(s.createdAt)}</span>
        </Stat>
        <Stat label="最近活跃">
          <span className="text-xs text-foreground">{formatTime(s.lastActiveAt)}</span>
        </Stat>
      </div>

      <Card className="rounded-xl border border-border p-5">
        <h3 className="text-lg font-semibold text-foreground">消息记录</h3>
        <p className="text-sm text-muted-foreground">最近的对话历史（自动每 5 秒刷新）</p>
        <div className="mt-4 space-y-3">
          {data.messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">暂无消息记录</p>
          ) : (
            data.messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.direction === 'IN' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                    m.direction === 'IN'
                      ? 'bg-muted text-foreground'
                      : m.kind === 'system'
                        ? 'bg-warning/10 text-warning'
                        : m.kind === 'command'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-primary text-white'
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
      </Card>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-xl border border-border p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2">{children}</div>
    </Card>
  );
}
