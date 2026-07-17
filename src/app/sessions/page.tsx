'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import { timeAgo } from '@/lib/utils';
import { MagnifyingGlass, ChatCircle, ArrowUpRight, Users } from '@phosphor-icons/react';

interface Session {
  id: string;
  wxId: string;
  wxName: string;
  currentChannel: string | null;
  messageCount: number;
  lastActiveAt: string;
  createdAt: string;
  channel: { alias: string; name: string } | null;
}

interface SessionsResp {
  sessions: Session[];
  total: number;
  activeToday: number;
}

export default function SessionsPage() {
  const [data, setData] = React.useState<SessionsResp | null>(null);
  const [search, setSearch] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const r = await api<SessionsResp>(`/api/sessions?limit=100${search ? `&search=${encodeURIComponent(search)}` : ''}`);
      setData(r);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">会话列表</h1>
        <p className="text-sm text-muted-foreground">
          所有联系过路由的微信用户。共 {data?.total ?? '-'} 个，今日活跃 {data?.activeToday ?? '-'} 个。
        </p>
      </div>

      <Card className="rounded-xl border border-border p-4">
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索微信名或 wxId..."
            className="pl-9"
            aria-label="搜索会话"
          />
        </div>
      </Card>

      <Card className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">加载中...</div>
        ) : !data || data.sessions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Users weight="duotone" className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-base font-medium text-foreground">还没有会话</div>
            <p className="max-w-sm text-xs text-muted-foreground">
              启动路由后，用户向路由发送任何消息都会创建会话
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.sessions.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-muted"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {(s.wxName || s.wxId || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{s.wxName || '(未命名)'}</span>
                    {s.channel && (
                      <Badge variant="outline" className="text-[10px]">
                        {s.channel.alias}
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{s.wxId}</div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <ChatCircle weight="duotone" className="h-3 w-3" />
                    {s.messageCount}
                  </div>
                  <span>{timeAgo(s.lastActiveAt)}</span>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
