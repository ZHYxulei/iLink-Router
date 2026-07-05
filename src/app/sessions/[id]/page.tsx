'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { formatTime } from '@/lib/utils';
import { ArrowLeft, Trash2 } from 'lucide-react';

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
          <Button variant="outline" size="icon" onClick={() => router.push('/sessions')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{s.wxName || '(未命名)'}</h1>
            <p className="text-xs text-muted-foreground">{s.wxId}</p>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
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
          <span className="font-mono text-lg font-bold">{s.messageCount}</span>
        </Stat>
        <Stat label="首次会话">
          <span className="text-xs">{formatTime(s.createdAt)}</span>
        </Stat>
        <Stat label="最近活跃">
          <span className="text-xs">{formatTime(s.lastActiveAt)}</span>
        </Stat>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>消息记录</CardTitle>
          <CardDescription>最近的对话历史（自动每 5 秒刷新）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
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
                          ? 'bg-amber-100 text-amber-900'
                          : m.kind === 'command'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-primary text-primary-foreground'
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
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-2">{children}</div>
      </CardContent>
    </Card>
  );
}
