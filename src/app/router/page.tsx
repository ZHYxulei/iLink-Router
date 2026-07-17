'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { formatTime, timeAgo } from '@/lib/utils';
import { Power, ArrowsClockwise, Square, QrCode, CheckCircle, WarningCircle, CircleNotch, Broadcast, Info } from '@phosphor-icons/react';

interface RouterStatus {
  status: string;
  loginStatus: string;
  selfWxId: string;
  selfWxName: string;
  lastQrCode: string;
  lastQrAt: string | null;
  lastError: string;
  startedAt: string | null;
  updatedAt: string;
  uptimeSeconds: number;
}

interface QrPayload {
  qr: string | null;
  text?: string;
  loginStatus?: string;
  lastQrAt?: string | null;
}

export default function RouterPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<RouterStatus | null>(null);
  const [qr, setQr] = React.useState<QrPayload | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  // 客户端 tick，每秒递增以动态刷新运行时间
  const [, setTick] = React.useState(0);

  const refresh = React.useCallback(async () => {
    try {
      const s = await api<RouterStatus>('/api/router/status');
      setStatus(s);
      const q = await api<QrPayload>('/api/qr?format=dataurl', { method: 'POST' });
      setQr(q);
    } catch (err) {
      toast({
        title: '加载失败',
        description: (err as Error).message,
        variant: 'error',
      });
    }
  }, [toast]);

  // 只在首次挂载时加载一次，不再 3 秒轮询
  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // 客户端每秒 tick，仅用于动态计算运行时间（不发请求）
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const doAction = async (action: 'start' | 'stop' | 'reset' | 'restart') => {
    setBusy(action);
    try {
      await api('/api/router/status', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const labels: Record<string, string> = {
        start: '已启动',
        stop: '已停止',
        reset: '已重置',
        restart: '已重启',
      };
      toast({ title: labels[action] || '操作完成', variant: 'success' });
      // 操作完成后刷新一次状态
      await refresh();
    } catch (err) {
      toast({
        title: '操作失败',
        description: (err as Error).message,
        variant: 'error',
      });
    } finally {
      setBusy(null);
    }
  };

  const isRunning = status?.status === 'ready' || status?.status === 'starting';
  const isLoggedIn = status?.loginStatus === 'logged_in';

  // 动态计算运行时间：基于 uptimeSeconds + 从 status.updatedAt 到现在的增量
  const liveUptime = React.useMemo(() => {
    if (!status?.startedAt || !status.uptimeSeconds) return 0;
    const updatedMs = new Date(status.updatedAt).getTime();
    const nowMs = Date.now();
    const delta = Math.max(0, Math.floor((nowMs - updatedMs) / 1000));
    return status.uptimeSeconds + delta;
  }, [status, /* tick 触发重算 */ Date.now()]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">路由控制</h1>
          <p className="text-sm text-muted-foreground">
            启动路由并使用手机微信扫码绑定。扫码后路由将自动登录微信账号，作为消息路由入口。
          </p>
        </div>
        <Button variant="ghost" onClick={refresh} disabled={!!busy} className="shrink-0">
          <ArrowsClockwise className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* QR Card */}
        <Card className="rounded-xl border border-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <QrCode weight="duotone" className="h-5 w-5 text-primary" />
                扫码绑定
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                使用手机微信扫描下方二维码登录路由账号
              </p>
            </div>
            {isLoggedIn ? (
              <Badge variant="success">已登录</Badge>
            ) : status?.loginStatus === 'scanning' ? (
              <Badge variant="warning">等待扫码</Badge>
            ) : (
              <Badge variant="secondary">未登录</Badge>
            )}
          </div>
          <div className="mt-4 flex flex-col items-center justify-center gap-4 py-6">
            {isLoggedIn ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-success/10">
                  <CheckCircle weight="duotone" className="h-16 w-16 text-success" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-foreground">{status?.selfWxName || '已登录'}</div>
                  <div className="text-xs text-muted-foreground">
                    {status?.selfWxId}
                  </div>
                </div>
              </div>
            ) : qr?.qr ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr.qr}
                  alt="WeChat login QR"
                  className="h-72 w-72 rounded-lg border border-border bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">
                  二维码更新于 {timeAgo(qr.lastQrAt)}
                </p>
              </div>
            ) : !isRunning ? (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-warning/10">
                  <Info weight="duotone" className="h-14 w-14 text-warning" />
                </div>
                <p className="text-sm font-medium text-warning">
                  路由未启动，无法显示二维码
                </p>
                <p className="text-xs text-muted-foreground">
                  请先点击下方「启动路由」按钮
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-muted">
                  <CircleNotch weight="duotone" className="h-12 w-12 animate-spin" />
                </div>
                <p className="text-sm">
                  正在生成二维码...
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Status Card */}
        <Card className="rounded-xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Broadcast weight="duotone" className="h-5 w-5 text-primary" />
            路由状态
          </h3>
          <p className="text-sm text-muted-foreground">当前路由运行状态</p>
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatItem label="运行状态">
                <Badge
                  variant={
                    status?.status === 'ready'
                      ? 'success'
                      : status?.status === 'starting'
                        ? 'warning'
                        : status?.status === 'error'
                          ? 'error'
                          : 'secondary'
                  }
                >
                  {status?.status || 'offline'}
                </Badge>
              </StatItem>
              <StatItem label="登录状态">
                <Badge
                  variant={
                    isLoggedIn
                      ? 'success'
                      : status?.loginStatus === 'scanning'
                        ? 'warning'
                        : 'secondary'
                  }
                >
                  {status?.loginStatus || 'logged_out'}
                </Badge>
              </StatItem>
              <StatItem label="运行时间">
                <span className="font-mono text-sm text-foreground tabular-nums">
                  {formatUptime(liveUptime)}
                </span>
              </StatItem>
              <StatItem label="启动时间">
                <span className="font-mono text-xs text-foreground">
                  {status?.startedAt ? formatTime(status.startedAt) : '-'}
                </span>
              </StatItem>
            </div>

            {status?.lastError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                <WarningCircle weight="duotone" className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold">最近错误</div>
                  <div className="break-all text-xs">{status.lastError}</div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={() => doAction('start')}
                disabled={isRunning && !status?.lastError}
                loading={busy === 'start'}
                variant={isRunning && !status?.lastError ? 'secondary' : 'default'}
              >
                <Power className="h-4 w-4" />
                启动路由
              </Button>
              <Button
                onClick={() => doAction('reset')}
                disabled={!isRunning && !status?.lastError}
                loading={busy === 'reset'}
                variant="secondary"
                className="text-warning"
              >
                <ArrowsClockwise className="h-4 w-4" />
                重置登录
              </Button>
              <Button
                onClick={() => doAction('stop')}
                disabled={!isRunning}
                loading={busy === 'stop'}
                variant="destructive"
              >
                <Square className="h-4 w-4" />
                停止
              </Button>
              <Button
                onClick={() => doAction('restart')}
                disabled={!isRunning}
                loading={busy === 'restart'}
                variant="outline"
                title="停掉当前 bot 并用新代码重建，无需重新扫码（开发热重载用）"
              >
                <ArrowsClockwise className="h-4 w-4" />
                重启路由
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Commands reference */}
      <Card className="rounded-xl border border-border p-5">
        <h3 className="text-lg font-semibold text-foreground">支持的命令</h3>
        <p className="text-sm text-muted-foreground">用户向路由发送这些命令即可触发对应功能</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {[
            { cmd: '!ping', desc: '检查路由是否在线，路由回复「pong!」' },
            { cmd: '!switch <别名>', desc: '将当前会话切换到指定上游渠道' },
            { cmd: '!info', desc: '显示当前渠道、对话数等会话信息' },
            { cmd: '!status', desc: '查询路由系统状态和各渠道健康' },
            { cmd: '!channels', desc: '列出所有可用上游渠道' },
            { cmd: '!help', desc: '显示命令帮助' },
          ].map((c) => (
            <div
              key={c.cmd}
              className="flex items-start gap-3 rounded-lg border border-border bg-muted p-3"
            >
              <code className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {c.cmd}
              </code>
              <span className="text-sm text-muted-foreground">{c.desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StatItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
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
  return parts.join(' ');
}
