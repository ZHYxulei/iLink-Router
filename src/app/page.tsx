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
  Clock,
  Database,
  HardDrives,
  Lightning,
  ChartBar,
  Gear,
  ChatCircle,
  WarningCircle,
  CheckCircle,
} from '@phosphor-icons/react';

interface Stats {
  router: {
    status: string;
    loginStatus: string;
    selfWxName: string;
    selfWxId: string;
    uptimeSeconds: number;
    lastError: string;
    startedAt: string | null;
    updatedAt: string;
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
  const [now, setNow] = React.useState(Date.now());

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
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  // 客户端每秒 tick 用于动态运行时间
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const router = stats?.router;
  const isOnline = router?.status === 'ready';

  // 计算每小时消息趋势（基于 recentMessages）
  const hourlyData = React.useMemo(() => {
    if (!stats?.recentMessages?.length) return [];
    const buckets: Record<string, number> = {};
    const nowMs = Date.now();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(nowMs - i * 3600_000);
      const key = `${d.getHours().toString().padStart(2, '0')}:00`;
      buckets[key] = 0;
    }
    for (const m of stats.recentMessages) {
      const d = new Date(m.createdAt);
      const key = `${d.getHours().toString().padStart(2, '0')}:00`;
      const age = nowMs - d.getTime();
      if (age < 24 * 3600_000 && buckets[key] !== undefined) {
        buckets[key]++;
      }
    }
    return Object.entries(buckets).map(([hour, count]) => ({ hour, count }));
  }, [stats, now]);

  const maxHourly = Math.max(1, ...hourlyData.map((h) => h.count));

  // 渠道分布饼图数据
  const channelDist = React.useMemo(() => {
    if (!stats?.channelStats?.length) return [];
    const total = stats.channelStats.reduce((s, c) => s + c.count, 0) || 1;
    return stats.channelStats.slice(0, 5).map((c, i) => ({
      ...c,
      pct: Math.round((c.count / total) * 100),
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [stats]);

  const liveUptime = React.useMemo(() => {
    if (!router?.startedAt || !router.uptimeSeconds) return 0;
    const updatedMs = new Date(router.updatedAt).getTime();
    const delta = Math.max(0, Math.floor((now - updatedMs) / 1000));
    return router.uptimeSeconds + delta;
  }, [router, now]);

  const successRate = React.useMemo(() => {
    if (!stats?.recentMessages?.length) return null;
    const errors = stats.recentMessages.filter((m) => m.error).length;
    return Math.round(((stats.recentMessages.length - errors) / stats.recentMessages.length) * 100);
  }, [stats]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-kumo-strong">仪表盘</h1>
          <p className="text-sm text-kumo-subtle">路由运行总览 · 每 30 秒自动刷新</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-kumo-success animate-pulse' : 'bg-kumo-subtle'}`} />
          <span className="text-sm font-medium text-kumo-subtle">
            {isOnline ? '系统在线' : '系统离线'}
          </span>
        </div>
      </div>

      {err && (
        <Surface className="rounded-lg border border-kumo-danger/30 bg-kumo-danger-tint p-3">
          <div className="flex items-center gap-2 text-sm text-kumo-danger">
            <WarningCircle weight="duotone" className="h-4 w-4" />
            加载失败: {err}
          </div>
        </Surface>
      )}

      {/* 统计卡片 — 4 列 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Broadcast weight="duotone" className="h-5 w-5" />}
          label="路由状态"
          accent="brand"
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
          accent="info"
          value={<span className="text-3xl font-bold text-kumo-strong">{stats?.channels.enabled ?? '-'}</span>}
          sub={`共 ${stats?.channels.total ?? '-'} 个`}
        />
        <StatCard
          icon={<Users weight="duotone" className="h-5 w-5" />}
          label="活跃会话 (24h)"
          accent="success"
          value={<span className="text-3xl font-bold text-kumo-strong">{stats?.sessions.activeToday ?? '-'}</span>}
          sub={`总会话 ${stats?.sessions.total ?? '-'}`}
        />
        <StatCard
          icon={<PaperPlaneTilt weight="duotone" className="h-5 w-5" />}
          label="今日消息"
          accent="warning"
          value={<span className="text-3xl font-bold text-kumo-strong">{stats?.messages.today ?? '-'}</span>}
          sub={`总计 ${stats?.messages.total ?? '-'}`}
        />
      </div>

      {/* 第二行：趋势图 + 渠道分布 */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 24h 消息趋势 */}
        <Surface className="rounded-xl border border-kumo-line p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ChartBar weight="duotone" className="h-5 w-5 text-kumo-brand" />
              <h3 className="text-lg font-semibold text-kumo-strong">24 小时消息趋势</h3>
            </div>
            <span className="text-xs text-kumo-subtle">基于最近 20 条消息</span>
          </div>
          {hourlyData.length > 0 ? (
            <div className="flex h-40 items-end gap-1">
              {hourlyData.map((h) => (
                <div key={h.hour} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`w-full rounded-t transition-all duration-300 ${
                        h.count > 0
                          ? 'bg-gradient-to-t from-kumo-brand to-kumo-brand/60'
                          : 'bg-kumo-recessed'
                      }`}
                      style={{ height: `${Math.max(4, (h.count / maxHourly) * 100)}%` }}
                      title={`${h.hour}: ${h.count} 条`}
                    />
                  </div>
                  <span className="text-[9px] text-kumo-subtle">{h.hour}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-kumo-subtle">
              暂无趋势数据
            </div>
          )}
        </Surface>

        {/* 渠道分布饼图 */}
        <Surface className="rounded-xl border border-kumo-line p-5">
          <div className="mb-4 flex items-center gap-2">
            <Pulse weight="duotone" className="h-5 w-5 text-kumo-brand" />
            <h3 className="text-lg font-semibold text-kumo-strong">渠道分布</h3>
          </div>
          {channelDist.length > 0 ? (
            <div className="space-y-3">
              {/* 环形图 */}
              <div className="flex justify-center py-2">
                <DonutChart data={channelDist} />
              </div>
              {/* 图例 */}
              <div className="space-y-2">
                {channelDist.map((c) => (
                  <div key={c.channelId || c.alias} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} />
                      <span className="truncate text-kumo-default">{c.alias}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs text-kumo-subtle">{c.count}</span>
                      <span className="text-xs text-kumo-subtle">{c.pct}%</span>
                    </div>
                  </div>
                ))}
              </div>
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

      {/* 第三行：系统信息 + 快捷操作 */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 系统信息 */}
        <Surface className="rounded-xl border border-kumo-line p-5">
          <div className="mb-4 flex items-center gap-2">
            <HardDrives weight="duotone" className="h-5 w-5 text-kumo-brand" />
            <h3 className="text-lg font-semibold text-kumo-strong">系统信息</h3>
          </div>
          <div className="space-y-3">
            <InfoRow icon={<Clock className="h-4 w-4" />} label="运行时间" value={formatUptime(liveUptime)} mono />
            <InfoRow icon={<Database className="h-4 w-4" />} label="数据库" value="SQLite" />
            <InfoRow icon={<Lightning className="h-4 w-4" />} label="消息成功率" value={successRate !== null ? `${successRate}%` : '-'} accent={successRate !== null && successRate >= 95 ? 'success' : 'warning'} />
            <InfoRow icon={<Broadcast className="h-4 w-4" />} label="路由版本" value="v0.3.0" mono />
          </div>
        </Surface>

        {/* 快捷操作 */}
        <Surface className="rounded-xl border border-kumo-line p-5">
          <div className="mb-4 flex items-center gap-2">
            <Lightning weight="duotone" className="h-5 w-5 text-kumo-brand" />
            <h3 className="text-lg font-semibold text-kumo-strong">快捷操作</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction href="/router" icon={<Broadcast className="h-5 w-5" />} label="路由控制" />
            <QuickAction href="/channels" icon={<Plug className="h-5 w-5" />} label="管理渠道" />
            <QuickAction href="/chat" icon={<ChatCircle className="h-5 w-5" />} label="在线聊天" />
            <QuickAction href="/debug" icon={<TerminalWindowIcon />} label="API 调试" />
            <QuickAction href="/sessions" icon={<Users className="h-5 w-5" />} label="用户会话" />
            <QuickAction href="/settings" icon={<Gear className="h-5 w-5" />} label="系统设置" />
          </div>
        </Surface>

        {/* 路由状态详情 */}
        <Surface className="rounded-xl border border-kumo-line p-5">
          <div className="mb-4 flex items-center gap-2">
            <CircleNotch
              weight="duotone"
              className={`h-5 w-5 ${isOnline ? 'text-kumo-success animate-spin' : 'text-kumo-subtle'}`}
            />
            <h3 className="text-lg font-semibold text-kumo-strong">{isOnline ? '运行中' : '未启动'}</h3>
          </div>
          <div className="space-y-2 text-sm">
            <InfoRow label="登录状态" value={
              router?.loginStatus === 'logged_in' ? '✅ 已登录' :
              router?.loginStatus === 'scanning' ? '⏳ 等待扫码' :
              '❌ 未登录'
            } />
            <InfoRow label="当前账号" value={router?.selfWxName || '-'} />
            <InfoRow label="账号 ID" value={router?.selfWxId || '-'} mono />
          </div>
          {router?.lastError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-kumo-danger/30 bg-kumo-danger-tint p-2.5 text-xs text-kumo-danger">
              <WarningCircle weight="duotone" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-all">{router.lastError}</span>
            </div>
          )}
          <Link href="/router">
            <Button variant={isOnline ? 'secondary' : 'primary'} className="mt-4 w-full">
              打开路由控制
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        </Surface>
      </div>

      {/* 最近消息列表 */}
      <Surface className="rounded-xl border border-kumo-line p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-kumo-strong">最近消息</h3>
            <p className="text-sm text-kumo-subtle">路由处理的最近 20 条消息</p>
          </div>
          <Link href="/messages">
            <Button size="sm" variant="ghost">
              查看全部
              <ArrowUpRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
        {stats && stats.recentMessages.length > 0 ? (
          <div className="space-y-2">
            {stats.recentMessages.map((m) => (
              <div
                key={m.id}
                className="flex items-start gap-3 rounded-lg border border-kumo-line bg-kumo-recessed/50 p-3 text-sm transition-colors hover:bg-kumo-recessed"
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
                            : m.kind === 'reply'
                              ? 'success'
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
                    <div className="mt-1 flex items-center gap-1 text-xs text-kumo-danger">
                      <WarningCircle className="h-3 w-3" />
                      {m.error}
                    </div>
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

// --- 环形图组件 ---
function DonutChart({ data }: { data: { count: number; color: string; pct: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--color-kumo-recessed)" strokeWidth="14" />
      {data.map((d, i) => {
        const len = (d.count / total) * circumference;
        const seg = (
          <circle
            key={i}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={d.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${circumference - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
            strokeLinecap="butt"
          />
        );
        offset += len;
        return seg;
      })}
      <text x="70" y="66" textAnchor="middle" className="fill-kumo-strong text-lg font-bold">
        {total}
      </text>
      <text x="70" y="82" textAnchor="middle" className="fill-kumo-subtle text-[10px]">
        总消息
      </text>
    </svg>
  );
}

// --- 统计卡片 ---
const ACCENT_COLORS: Record<string, string> = {
  brand: 'bg-kumo-brand-tint text-kumo-brand',
  info: 'bg-kumo-info-tint text-kumo-info',
  success: 'bg-kumo-success-tint text-kumo-success',
  warning: 'bg-kumo-warning-tint text-kumo-warning',
};

function StatCard({
  icon,
  label,
  value,
  sub,
  accent = 'brand',
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: keyof typeof ACCENT_COLORS | string;
}) {
  return (
    <Surface className="rounded-xl border border-kumo-line p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-kumo-subtle">{label}</span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${ACCENT_COLORS[accent] || ACCENT_COLORS.brand}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">{value}</div>
      {sub && <div className="mt-1 text-xs text-kumo-subtle">{sub}</div>}
    </Surface>
  );
}

// --- 信息行 ---
function InfoRow({
  icon,
  label,
  value,
  mono,
  accent,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  accent?: 'success' | 'warning' | 'danger';
}) {
  const valueColor =
    accent === 'success' ? 'text-kumo-success' :
    accent === 'warning' ? 'text-kumo-warning' :
    accent === 'danger' ? 'text-kumo-danger' :
    'text-kumo-default';
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-kumo-subtle">
        {icon && <span className="text-kumo-subtle">{icon}</span>}
        {label}
      </span>
      <span className={`text-right ${mono ? 'font-mono text-xs' : 'text-xs'} ${valueColor}`}>
        {value}
      </span>
    </div>
  );
}

// --- 快捷操作 ---
function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-lg border border-kumo-line bg-kumo-recessed/50 p-4 text-center transition-all hover:border-kumo-brand/40 hover:bg-kumo-recessed"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-kumo-brand-tint text-kumo-brand">
        {icon}
      </div>
      <span className="text-xs font-medium text-kumo-default">{label}</span>
    </Link>
  );
}

function TerminalWindowIcon() {
  return <span className="text-base font-mono">{'>_'}</span>;
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
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-kumo-recessed">
        <CheckCircle weight="duotone" className="h-6 w-6 text-kumo-subtle" />
      </div>
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

const CHART_COLORS = [
  '#f6821f',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
];

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
  return parts.join(' ');
}
