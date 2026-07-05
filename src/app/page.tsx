'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { formatTime, timeAgo, truncate } from '@/lib/utils';
import {
  Radio,
  Users,
  Send,
  Plug,
  ArrowUpRight,
  Activity,
  CircleDot,
} from 'lucide-react';

interface Stats {
  router: {
    status: string;
    loginStatus: string;
    selfWxName: string;
    selfWxId: string;
    uptimeSeconds: number;
    lastError: string;
  };
  channels: { total: number; enabled: number };
  sessions: { total: number; activeToday: number };
  messages: { today: number; total: number };
  channelStats: { channelId: string; alias: string; name: string; count: number }[];
  recentMessages: {
    id: string;
    direction: string;
    text: string;
    kind: string;
    error: string;
    createdAt: string;
    session: { wxName: string; wxId: string };
    channel: { alias: string; name: string } | null;
  }[];
}

export default function DashboardPage() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [err, setErr] = React.useState<string>('');

  const refresh = React.useCallback(async () => {
    try {
      const s = await api<Stats>('/api/stats');
      setStats(s);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const router = stats?.router;
  const isOnline = router?.status === 'ready';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-sm text-muted-foreground">
          路由运行总览 · 自动每 5 秒刷新
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          加载失败: {err}
        </div>
      )}

      {/* Top stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Radio className="h-5 w-5" />}
          label="路由状态"
          value={
            <Badge
              variant={
                router?.status === 'ready'
                  ? 'success'
                  : router?.status === 'starting'
                    ? 'warning'
                    : router?.status === 'error'
                      ? 'destructive'
                      : 'secondary'
              }
            >
              {router?.status || 'offline'}
            </Badge>
          }
          sub={router?.loginStatus === 'logged_in' ? `已登录: ${router.selfWxName}` : '未登录'}
          accent="primary"
        />
        <StatCard
          icon={<Plug className="h-5 w-5" />}
          label="已启用渠道"
          value={<span className="text-2xl font-bold">{stats?.channels.enabled ?? '-'}</span>}
          sub={`共 ${stats?.channels.total ?? '-'} 个`}
          accent="accent"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="活跃会话 (24h)"
          value={<span className="text-2xl font-bold">{stats?.sessions.activeToday ?? '-'}</span>}
          sub={`总会话 ${stats?.sessions.total ?? '-'}`}
          accent="emerald"
        />
        <StatCard
          icon={<Send className="h-5 w-5" />}
          label="今日消息"
          value={<span className="text-2xl font-bold">{stats?.messages.today ?? '-'}</span>}
          sub={`总计 ${stats?.messages.total ?? '-'}`}
          accent="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Router control CTA */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleDot className={`h-4 w-4 ${isOnline ? 'text-emerald-500 animate-pulse-soft' : 'text-muted-foreground'}`} />
              {isOnline ? '运行中' : '未启动'}
            </CardTitle>
            <CardDescription>
              {router?.loginStatus === 'logged_in'
                ? '当前已绑定微信账号'
                : '前往路由控制扫码绑定'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1 text-sm">
              <Row label="账号" value={router?.selfWxName || '-'} />
              <Row label="运行" value={formatUptime(router?.uptimeSeconds || 0)} />
              <Row label="状态更新" value={formatTime(router ? undefined : undefined)} />
            </div>
            <Link href="/router">
              <Button className="w-full" variant={isOnline ? 'secondary' : 'default'}>
                打开路由控制
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Channel usage stats */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              渠道活跃度 (近 7 天)
            </CardTitle>
            <CardDescription>按消息数排序的上游渠道</CardDescription>
          </CardHeader>
          <CardContent>
            {stats && stats.channelStats.length > 0 ? (
              <div className="space-y-3">
                {stats.channelStats.map((c) => {
                  const max = stats.channelStats[0]?.count || 1;
                  const pct = Math.round((c.count / max) * 100);
                  return (
                    <div key={c.channelId || c.alias} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{c.alias}</Badge>
                          <span className="text-muted-foreground">{c.name}</span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {c.count} 条
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="暂无消息"
                description="绑定渠道并启动路由后，将显示渠道使用情况"
                href="/channels"
                cta="绑定渠道"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent messages */}
      <Card>
        <CardHeader>
          <CardTitle>最近消息</CardTitle>
          <CardDescription>路由处理的最近 20 条消息</CardDescription>
        </CardHeader>
        <CardContent>
          {stats && stats.recentMessages.length > 0 ? (
            <div className="space-y-2">
              {stats.recentMessages.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 text-sm"
                >
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        m.direction === 'IN'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-primary/10 text-primary'
                      }`}
                    >
                      {m.direction === 'IN' ? '↙' : '↗'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {m.session?.wxName || m.session?.wxId || '未知用户'}
                      </span>
                      {m.channel && (
                        <Badge variant="outline" className="text-[10px]">
                          {m.channel.alias}
                        </Badge>
                      )}
                      <Badge
                        variant={
                          m.kind === 'command'
                            ? 'default'
                            : m.kind === 'system'
                              ? 'warning'
                              : 'secondary'
                        }
                        className="text-[10px]"
                      >
                        {m.kind}
                      </Badge>
                      <span>{timeAgo(m.createdAt)}</span>
                    </div>
                    <div className="mt-1 break-all text-sm">
                      {truncate(m.text || m.error || '(空消息)', 200)}
                    </div>
                    {m.error && (
                      <div className="mt-1 text-xs text-red-600">错误: {m.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="暂无消息记录"
              description="启动路由并绑定渠道后，消息会显示在这里"
              href="/router"
              cta="去启动路由"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: 'primary' | 'accent' | 'emerald' | 'amber';
}) {
  const colors = {
    primary: 'bg-primary/10 text-primary',
    accent: 'bg-accent/10 text-accent',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[accent || 'primary']}`}>
            {icon}
          </div>
        </div>
        <div className="mt-3">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function EmptyState({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="text-base font-medium text-foreground">{title}</div>
      <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
      <Link href={href}>
        <Button size="sm" variant="outline">
          {cta}
          <ArrowUpRight className="h-3 w-3" />
        </Button>
      </Link>
    </div>
  );
}

function formatUptime(sec: number): string {
  if (!sec || sec <= 0) return '-';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}天`);
  if (h) parts.push(`${h}时`);
  if (m) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return parts.join('');
}
