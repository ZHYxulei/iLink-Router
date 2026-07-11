'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { formatTime, timeAgo } from '@/lib/utils';
import { Power, RefreshCw, Square, QrCode, CheckCircle2, AlertCircle, Loader2, Radio, Info } from 'lucide-react';

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

  React.useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

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
      setTimeout(refresh, 500);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">路由控制</h1>
        <p className="text-sm text-muted-foreground">
          启动路由并使用手机微信扫码绑定。扫码后路由将自动登录微信账号，作为消息路由入口。
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* QR Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-primary" />
                  扫码绑定
                </CardTitle>
                <CardDescription className="mt-1">
                  使用手机微信扫描下方二维码登录路由账号
                </CardDescription>
              </div>
              {isLoggedIn ? (
                <Badge variant="success">已登录</Badge>
              ) : status?.loginStatus === 'scanning' ? (
                <Badge variant="warning">等待扫码</Badge>
              ) : (
                <Badge variant="secondary">未登录</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center gap-4 py-6">
              {isLoggedIn ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex h-32 w-32 items-center justify-center rounded-full bg-emerald-100">
                    <CheckCircle2 className="h-16 w-16 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{status?.selfWxName || '已登录'}</div>
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
                  <div className="flex h-32 w-32 items-center justify-center rounded-full bg-amber-50">
                    <Info className="h-14 w-14 text-amber-500" />
                  </div>
                  <p className="text-sm font-medium text-amber-600">
                    路由未启动，无法显示二维码
                  </p>
                  <p className="text-xs text-muted-foreground">
                    请先点击下方「启动路由」按钮
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <div className="flex h-32 w-32 items-center justify-center rounded-full bg-muted">
                    <Loader2 className="h-12 w-12 animate-spin" />
                  </div>
                  <p className="text-sm">
                    正在生成二维码...
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-primary" />
              路由状态
            </CardTitle>
            <CardDescription>当前路由运行状态</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatItem label="运行状态">
                <Badge
                  variant={
                    status?.status === 'ready'
                      ? 'success'
                      : status?.status === 'starting'
                        ? 'warning'
                        : status?.status === 'error'
                          ? 'destructive'
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
                <span className="font-mono text-sm">{formatUptime(status?.uptimeSeconds || 0)}</span>
              </StatItem>
              <StatItem label="启动时间">
                <span className="font-mono text-xs">
                  {status?.startedAt ? formatTime(status.startedAt) : '-'}
                </span>
              </StatItem>
            </div>

            {status?.lastError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
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
                variant="warning"
              >
                <RefreshCw className="h-4 w-4" />
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
                <RefreshCw className="h-4 w-4" />
                重启路由
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Commands reference */}
      <Card>
        <CardHeader>
          <CardTitle>支持的命令</CardTitle>
          <CardDescription>用户向路由发送这些命令即可触发对应功能</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
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
                className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <code className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                  {c.cmd}
                </code>
                <span className="text-sm text-muted-foreground">{c.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
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
  return parts.join('');
}
