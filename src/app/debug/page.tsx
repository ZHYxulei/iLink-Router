'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toaster';
import { Send, Plus, Trash2, History, Copy, Clock } from 'lucide-react';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

interface HistoryItem {
  id: string;
  method: Method;
  url: string;
  status: number;
  durationMs: number;
  at: string;
}

interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

const PRESETS: { label: string; method: Method; url: string; body?: string }[] = [
  { label: '路由状态', method: 'GET', url: '/api/router/status' },
  { label: '渠道列表', method: 'GET', url: '/api/channels' },
  { label: '会话列表', method: 'GET', url: '/api/sessions' },
  { label: '消息日志', method: 'GET', url: '/api/messages?limit=20' },
  { label: '统计数据', method: 'GET', url: '/api/stats' },
  { label: '聊天会话列表', method: 'GET', url: '/api/chat?list=1' },
  {
    label: '启动路由',
    method: 'POST',
    url: '/api/router/status',
    body: '{"action":"start"}',
  },
  {
    label: '创建渠道',
    method: 'POST',
    url: '/api/channels',
    body: '{"alias":"test","name":"测试渠道","type":"WEBHOOK"}',
  },
  {
    label: '模拟发送消息',
    method: 'POST',
    url: '/api/chat',
    body: '{"action":"send","wxId":"test_user","message":"你好"}',
  },
];

let headerIdCounter = 0;
function newHeaderId() {
  headerIdCounter += 1;
  return `h-${Date.now()}-${headerIdCounter}`;
}

export default function DebugPage() {
  const { toast } = useToast();
  const [method, setMethod] = React.useState<Method>('GET');
  const [url, setUrl] = React.useState('/api/router/status');
  const [headers, setHeaders] = React.useState<HeaderRow[]>([
    { id: newHeaderId(), key: 'Content-Type', value: 'application/json' },
  ]);
  const [body, setBody] = React.useState('');
  const [response, setResponse] = React.useState<ResponseData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryItem[]>([]);

  const addHeader = () => {
    setHeaders((prev) => [...prev, { id: newHeaderId(), key: '', value: '' }]);
  };

  const removeHeader = (id: string) => {
    setHeaders((prev) => prev.filter((h) => h.id !== id));
  };

  const updateHeader = (id: string, field: 'key' | 'value', val: string) => {
    setHeaders((prev) => prev.map((h) => (h.id === id ? { ...h, [field]: val } : h)));
  };

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setMethod(p.method);
    setUrl(p.url);
    setBody(p.body || '');
    setResponse(null);
  };

  const sendRequest = async () => {
    if (!url) {
      toast({ title: '请输入 URL', variant: 'error' });
      return;
    }
    setLoading(true);
    setResponse(null);
    const started = Date.now();

    try {
      // Build headers
      const headerObj: Record<string, string> = {};
      for (const h of headers) {
        if (h.key.trim()) headerObj[h.key.trim()] = h.value;
      }
      // Attach admin token if present
      const token =
        typeof window !== 'undefined'
          ? window.localStorage.getItem('ilink_admin_token') || ''
          : '';
      if (token) headerObj.Authorization = `Bearer ${token}`;

      const init: RequestInit = {
        method,
        headers: headerObj,
      };
      if (method !== 'GET' && method !== 'DELETE' && body.trim()) {
        init.body = body;
      }

      const res = await fetch(url, init);
      const text = await res.text();
      const durationMs = Date.now() - started;

      // Collect response headers
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        resHeaders[k] = v;
      });

      const data: ResponseData = {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: text,
        durationMs,
      };
      setResponse(data);

      // Add to history
      const item: HistoryItem = {
        id: `hist-${Date.now()}`,
        method,
        url,
        status: res.status,
        durationMs,
        at: new Date().toISOString(),
      };
      setHistory((prev) => [item, ...prev].slice(0, 20));
    } catch (err) {
      const durationMs = Date.now() - started;
      setResponse({
        status: 0,
        statusText: 'Error',
        headers: {},
        body: (err as Error).message,
        durationMs,
      });
      toast({ title: '请求失败', description: (err as Error).message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: '已复制', variant: 'success' });
  };

  const formatBody = (text: string): string => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  };

  const statusColor = (status: number) => {
    if (status === 0) return 'destructive';
    if (status < 300) return 'success';
    if (status < 400) return 'secondary';
    if (status < 500) return 'warning';
    return 'destructive';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">API 调试</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          调试路由器 API 接口，支持自定义请求方法、URL、请求头和请求体
        </p>
      </div>

      {/* 预设接口 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">常用接口</CardTitle>
          <CardDescription className="text-xs">点击快速填充请求参数</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
              >
                <Badge variant="outline" className="text-[9px]">
                  {p.method}
                </Badge>
                {p.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 请求构造 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">请求</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Method + URL */}
            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                className="h-10 w-28 rounded-md border border-input bg-background px-2 text-sm font-medium"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="/api/..."
                className="flex-1 font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendRequest();
                }}
              />
            </div>

            {/* Headers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">请求头</Label>
                <Button size="sm" variant="outline" onClick={addHeader} className="h-7 px-2">
                  <Plus className="h-3 w-3" />
                  添加
                </Button>
              </div>
              <div className="space-y-1.5">
                {headers.map((h) => (
                  <div key={h.id} className="flex gap-1.5">
                    <Input
                      value={h.key}
                      onChange={(e) => updateHeader(h.id, 'key', e.target.value)}
                      placeholder="Header 名"
                      className="h-8 flex-1 text-xs"
                    />
                    <Input
                      value={h.value}
                      onChange={(e) => updateHeader(h.id, 'value', e.target.value)}
                      placeholder="值"
                      className="h-8 flex-1 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeHeader(h.id)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Body */}
            {method !== 'GET' && method !== 'DELETE' && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold">请求体 (JSON)</Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder='{"key":"value"}'
                  className="min-h-[120px] font-mono text-xs"
                />
              </div>
            )}

            <Button onClick={sendRequest} disabled={loading} className="w-full">
              <Send className="h-4 w-4" />
              {loading ? '发送中...' : '发送请求'}
              <span className="ml-1 text-[10px] opacity-60">Ctrl+Enter</span>
            </Button>
          </CardContent>
        </Card>

        {/* 响应 */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">响应</CardTitle>
              {response && (
                <div className="flex items-center gap-2">
                  <Badge variant={statusColor(response.status) as never}>
                    {response.status} {response.statusText}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Clock className="mr-1 h-3 w-3" />
                    {response.durationMs}ms
                  </Badge>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!response ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                发送请求后在此查看响应
              </p>
            ) : (
              <>
                {/* Response headers */}
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    响应头
                  </div>
                  <div className="max-h-32 overflow-auto rounded-md bg-muted/50 p-2 text-[10px]">
                    {Object.entries(response.headers).map(([k, v]) => (
                      <div key={k} className="font-mono">
                        <span className="text-primary">{k}:</span>{' '}
                        <span className="text-muted-foreground">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Response body */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      响应体
                    </span>
                    <button
                      onClick={() => copyToClipboard(response.body)}
                      className="text-[10px] text-primary hover:underline"
                    >
                      <Copy className="mr-1 inline h-3 w-3" />
                      复制
                    </button>
                  </div>
                  <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed">
                    {formatBody(response.body)}
                  </pre>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 历史记录 */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              请求历史
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    setMethod(h.method);
                    setUrl(h.url);
                  }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                >
                  <Badge variant="outline" className="w-14 justify-center text-[9px]">
                    {h.method}
                  </Badge>
                  <code className="flex-1 truncate font-mono text-muted-foreground">
                    {h.url}
                  </code>
                  <Badge variant={statusColor(h.status) as never} className="text-[9px]">
                    {h.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{h.durationMs}ms</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
