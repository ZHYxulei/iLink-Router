'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toaster';
import { Settings as SettingsIcon, KeyRound, Save } from 'lucide-react';

export default function SettingsPage() {
  const { toast } = useToast();
  const [token, setToken] = React.useState('');

  React.useEffect(() => {
    const t = typeof window !== 'undefined'
      ? window.localStorage.getItem('ilink_admin_token') || ''
      : '';
    setToken(t);
  }, []);

  const onSave = () => {
    if (typeof window !== 'undefined') {
      if (token) {
        window.localStorage.setItem('ilink_admin_token', token);
      } else {
        window.localStorage.removeItem('ilink_admin_token');
      }
      toast({ title: '已保存', variant: 'success' });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理员认证与运行配置</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            Admin Token
          </CardTitle>
          <CardDescription>
            当后端环境变量 <code>ADMIN_TOKEN</code> 设置后，所有 API 请求需携带此令牌。
            保存后，前端会在所有请求中自动加上 <code>Authorization: Bearer</code>。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="留空则禁用管理员认证"
            />
            <Button onClick={onSave}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            运行配置
          </CardTitle>
          <CardDescription>
            以下配置通过 <code>.env</code> 文件设置，重启服务后生效
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            <ConfigItem name="DATABASE_URL" desc="数据库连接字符串 (切换数据库需同时改 prisma/schema.prisma)" />
            <ConfigItem name="ILINK_BASE_URL" desc="iLink 协议 API 地址，默认 https://ilinkai.weixin.qq.com" />
            <ConfigItem name="ILINK_STORAGE_DIR" desc="iLink 凭据存储目录，默认 ~/.wechatbot" />
            <ConfigItem name="ILINK_LOG_LEVEL" desc="SDK 日志级别: debug / info / warn / error / silent" />
            <ConfigItem name="COMMAND_PREFIX" desc="命令前缀，默认 !" />
            <ConfigItem name="DEFAULT_CHANNEL_ALIAS" desc="新会话默认绑定的渠道别名" />
            <ConfigItem name="FORWARD_TIMEOUT_MS" desc="上游转发超时 (毫秒)" />
            <ConfigItem name="REDIS_URL" desc="可选 Redis 连接，用于多实例缓存" />
            <ConfigItem name="ADMIN_TOKEN" desc="管理员令牌，留空则禁用认证" />
            <ConfigItem name="UPSTREAM_WEBHOOK_SECRET" desc="转发到上游时携带的共享密钥" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>上游 HTTP 协议</CardTitle>
          <CardDescription>
            路由向渠道 webhook 发送的请求格式
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100 scrollbar-thin">
{`POST <channel.webhookUrl>
Content-Type: application/json
X-ILink-Channel: <channel.alias>
X-ILink-Key: <channel.apiKey>          # 可选，渠道级密钥
X-ILink-Router-Secret: <UPSTREAM_WEBHOOK_SECRET>  # 可选，全局共享密钥

{
  "sessionId": "cuid...",
  "userId": "wxid_xxx",          // 用户的 WeChat ID
  "userName": "张三",
  "message": "你好",              // 用户发送的文本
  "receivedAt": "2026-07-05T...",
  "channelAlias": "gpt4",
  "history": [                    // 最近对话历史 (oldest first)
    { "role": "user", "text": "...", "ts": "..." },
    { "role": "assistant", "text": "...", "ts": "..." }
  ]
}

# 期望响应 (同步):
{
  "reply": "..."                  // 路由将回复给用户的文本
}

# 异步回复: 上游稍后 POST 到 /api/inbound:
# { "sessionId": "...", "reply": "..." }`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfigItem({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="font-mono text-xs font-bold text-primary">{name}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}
