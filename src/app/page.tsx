'use client';

import * as React from 'react';
import Link from 'next/link';
import { Surface, Badge, Button } from '@cloudflare/kumo';
import { api } from '@/lib/api-client';
import { timeAgo, truncate } from '@/lib/utils';
import {
  Broadcast,
  Users,
  PaperPlaneTilt,
  Plug,
  ArrowUpRight,
  Pulse,
  CircleNotch,
} from '@phosphor-icons/react';

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
        <h1 className="text-3xl font-bold tracking-tight text-kumo-strong">仪表盘</h1>
        <p className="text-sm text-kumo-subtle">路由运行总览 · 自动每 5 秒刷新</p>
      </div>

      {err && (
        <Surface className="rounded-lg border border-kumo-danger/30 bg-kumo-danger-tint p-3">
          <p className="text-sm text-kumo-danger">加载失败: {err}</p>
        </Surface>
      )}

      {/* 统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Broadcast weight="duotone" className="h-5 w-5" />}
          label="路由状态"
          value={
            <Badge
              variant={
                router?.status === 'ready'
                  ? 'success'
                  : router?.status === 'starting'
                    ? 'warning'
                    : router?.status === 'error'
                      ? 'error'
                      : 'neutral'
              }
            >
              {router?.status || 'offline'}
            </Badge>
          }
          sub={router?.loginStatus === 'logged_in' ? `已登录: ${router.selfWxName}` : '未登录'}
        />
        <StatCard
          icon={<Plug weight="duotone" className="h-5 w-5" />}
          label="已启用渠道"
          value={<span className="text-2xl font-bold text-kumo-strong">{stats?.channels.enabled ?? '-'}</span>}
          sub={`共 ${stats?.channels.total ?? '-'} 个`}
        />
        <StatCard
          icon={<Users weight="duotone" className="h-5 w-5" />}
          label="活跃会话 (24h)"
          value={<span className="text-2xl font-bold text-kumo-strong">{stats?.sessions.activeToday ?? '-'}</span>}
          sub={`总会话 ${stats?.sessions.total ?? '-'}`}
        />
        <StatCard
          icon={<PaperPlaneTilt weight="duotone" className="h-5 w-5" />}
          label="今日消息"
          value={<span className="text-2xl font-bold text-kumo-strong">{stats?.messages.today ?? '-'}</span>}
          sub={`总计 ${stats?.messages.total ?? '-'}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 路由控制 */}
        <Surface className="rounded-xl border border-kumo-line p-5 lg:col-span-1">
          <div className="mb-4 flex items-center gap-2">
            <CircleNotch
              weight="duotone"
              className={`h-4 w-4 ${isOnline ? 'text-kumo-success animate-spin' : 'text-kumo-subtle'}`}
            />
            <h3 className="text-lg font-semibold text-kumo-strong">{isOnline ? '运行中' : '未启动'}</h3>
          </div>
          <p className="mb-4 text-sm text-kumo-subtle">
            {router?.loginStatus === 'logged_in'
              ? '当前已绑定微信账号'
              : '前往路由控制扫码绑定'}
          </p>
          <div className="space-y-2 text-sm">
            <Row label="账号" value={router?.selfWxName || '-'} />
            <Row label="运行" value={formatUptime(router?.uptimeSeconds || 0)} />
          </div>
          <Link href="/router">
            <Button variant={isOnline ? 'secondary' : 'primary'} className="mt-4 w-full">
              打开路由控制
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        </Surface>

        {/* 渠道活跃度 */}
        <Surface className="rounded-xl border border-kumo-line p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Pulse weight="duotone" className="h-4 w-4 text-kumo-brand" />
            <h3 className="text-lg font-semibold text-kumo-strong">渠道活跃度 (近 7 天)</h3>
          </div>
          {stats && stats.channelStats.length > 0 ? (
            <div className="space-y-3">
              {stats.channelStats.map((c) => {
                const max = stats.channelStats[0]?.count || 1;
                const pct = Math.round((c.count / max) * 100);
                return (
                  <div key={c.channelId || c.alias} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{c.alias}</Badge>
                        <span className="text-kumo-subtle">{c.name}</span>
                      </div>
                      <span className="font-mono text-xs text-kumo-subtle">{c.count} 条</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-kumo-recessed">
                      <div
                        className="h-full rounded-full bg-kumo-brand transition-all"
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
        </Surface>
      </div>

      {/* 最近消息 */}
      <Surface className="rounded-xl border border-kumo-line p-5">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-kumo-strong">最近消息</h3>
          <p className="text-sm text-kumo-subtle">路由处理的最近 20 条消息</p>
        </div>
        {stats && stats.recentMessages.length > 0 ? (
          <div className="space-y-2">
            {stats.recentMessages.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-3 rounded-lg border border-kumo-line bg-kumo-recessed/50 p-3 text-sm"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    m.direction === 'IN'
                      ? 'bg-kumo-success-tint text-kumo-success'
                      : 'bg-kumo-brand-tint text-kumo-brand'
                  }`}
                >
                  {m.direction === 'IN' ? '↙' : '↗'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
                    <span className="font-medium text-kumo-strong">
                      {m.session?.wxName || m.session?.wxId || '未知用户'}
                    </span>
                    {m.channel && (
                      <Badge variant="outline" className="text-[10px]">{m.channel.alias}</Badge>
                    )}
                    <Badge
                      variant={
                        m.kind === 'command'
                          ? 'primary'
                          : m.kind === 'system'
                            ? 'warning'
                            : 'neutral'
                      }
                      className="text-[10px]"
                    >
                      {m.kind}
                    </Badge>
                    <span>{timeAgo(m.createdAt)}</span>
                  </div>
                  <div className="mt-1 break-all text-sm text-kumo-default">
                    {truncate(m.text || m.error || '(空消息)', 200)}
                  </div>
                  {m.error && (
                    <div className="mt-1 text-xs text-kumo-danger">错误: {m.error}</div>
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
      </Surface>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Surface className="rounded-xl border border-kumo-line p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-kumo-subtle">{label}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kumo-brand-tint text-kumo-brand">
          {icon}
        </div>
      </div>
      <div className="mt-3">{value}</div>
      {sub && <div className="mt-1 text-xs text-kumo-subtle">{sub}</div>}
    </Surface>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-kumo-subtle">{label}</span>
      <span className="font-mono text-xs text-kumo-default">{value}</span>
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
      <div className="text-base font-medium text-kumo-strong">{title}</div>
      <div className="max-w-sm text-xs text-kumo-subtle">{description}</div>
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
