'use client';

import * as React from 'react';
import { Surface, Button, Input, Switch } from '@cloudflare/kumo';
import { useToast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { Gear, Key, FloppyDisk, Shield, CircleNotch } from '@phosphor-icons/react';

interface SettingItem {
  key: string;
  value: boolean | string;
  type: 'boolean' | 'string';
  label: string;
  description: string;
  default: boolean | string;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [token, setToken] = React.useState('');
  const [settings, setSettings] = React.useState<SettingItem[]>([]);
  const [settingsLoading, setSettingsLoading] = React.useState(true);
  const [settingsSaving, setSettingsSaving] = React.useState<string | null>(null);
  // 本地编辑态：key -> value
  const [editValues, setEditValues] = React.useState<Record<string, boolean | string>>({});

  // 加载 admin token
  React.useEffect(() => {
    const t = typeof window !== 'undefined'
      ? window.localStorage.getItem('ilink_admin_token') || ''
      : '';
    setToken(t);
  }, []);

  // 加载 API 设置
  const loadSettings = React.useCallback(async () => {
    try {
      const data = await api<{ items: SettingItem[] }>('/api/settings');
      setSettings(data.items);
      const edits: Record<string, boolean | string> = {};
      for (const item of data.items) edits[item.key] = item.value;
      setEditValues(edits);
    } catch (err) {
      toast({
        title: '加载设置失败',
        description: (err as Error).message,
        variant: 'error',
      });
    } finally {
      setSettingsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onSaveToken = () => {
    if (typeof window !== 'undefined') {
      if (token) {
        window.localStorage.setItem('ilink_admin_token', token);
      } else {
        window.localStorage.removeItem('ilink_admin_token');
      }
      toast({ title: '已保存', variant: 'success' });
    }
  };

  const onSaveSetting = async (key: string) => {
    const value = editValues[key];
    if (value === undefined) return;
    setSettingsSaving(key);
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      });
      setSettings((prev) =>
        prev.map((s) => (s.key === key ? { ...s, value } : s)),
      );
      toast({ title: '已保存', variant: 'success' });
    } catch (err) {
      toast({
        title: '保存失败',
        description: (err as Error).message,
        variant: 'error',
      });
    } finally {
      setSettingsSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-kumo-strong">设置</h1>
        <p className="mt-1 text-sm text-kumo-subtle">管理员认证与运行配置</p>
      </div>

      {/* Admin Token */}
      <Surface className="rounded-xl border border-kumo-line p-5">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-kumo-strong">
            <Key className="h-4 w-4 text-kumo-brand" />
            Admin Token
          </h3>
          <p className="mt-1 text-sm text-kumo-subtle">
            当后端环境变量 <code>ADMIN_TOKEN</code> 设置后，所有 API 请求需携带此令牌。
            保存后，前端会在所有请求中自动加上 <code>Authorization: Bearer</code>。
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="留空则禁用管理员认证"
          />
          <Button variant="primary" icon={FloppyDisk} onClick={onSaveToken}>
            保存
          </Button>
        </div>
      </Surface>

      {/* API 访问控制 */}
      <Surface className="rounded-xl border border-kumo-line p-5">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-kumo-strong">
            <Shield className="h-4 w-4 text-kumo-brand" />
            API 访问控制
          </h3>
          <p className="mt-1 text-sm text-kumo-subtle">
            二维码 API (<code>/api/qr</code>) 的请求方式与密钥校验
          </p>
        </div>
        <div className="space-y-4">
          {settingsLoading ? (
            <div className="flex items-center gap-2 text-sm text-kumo-subtle">
              <CircleNotch className="h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : (
            settings.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border border-kumo-line bg-kumo-recessed p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <label className="text-sm font-medium text-kumo-strong">{item.label}</label>
                    <p className="mt-1 text-xs text-kumo-subtle">
                      {item.description}
                    </p>
                    <p className="mt-1 text-[10px] text-kumo-subtle">
                      键: <code className="font-mono">{item.key}</code>
                      {' · '}
                      默认: <code className="font-mono">{String(item.default)}</code>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.type === 'boolean' ? (
                      <Switch
                        checked={Boolean(editValues[item.key])}
                        onCheckedChange={(checked) =>
                          setEditValues((prev) => ({
                            ...prev,
                            [item.key]: checked,
                          }))
                        }
                      />
                    ) : (
                      <Input
                        type="text"
                        value={String(editValues[item.key] ?? '')}
                        onChange={(e) =>
                          setEditValues((prev) => ({
                            ...prev,
                            [item.key]: e.target.value,
                          }))
                        }
                        placeholder="留空则不校验"
                        className="w-56"
                      />
                    )}
                    {item.type === 'boolean' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        shape="square"
                        aria-label="保存"
                        icon={<FloppyDisk className="h-3.5 w-3.5" />}
                        loading={settingsSaving === item.key}
                        onClick={() => onSaveSetting(item.key)}
                      />
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={FloppyDisk}
                        loading={settingsSaving === item.key}
                        onClick={() => onSaveSetting(item.key)}
                      >
                        保存
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Surface>

      {/* 运行配置 */}
      <Surface className="rounded-xl border border-kumo-line p-5">
        <div className="mb-4">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-kumo-strong">
            <Gear className="h-4 w-4 text-kumo-brand" />
            运行配置
          </h3>
          <p className="mt-1 text-sm text-kumo-subtle">
            以下配置通过 <code>.env</code> 文件设置，重启服务后生效
          </p>
        </div>
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
      </Surface>

      <Surface className="rounded-xl border border-kumo-line p-5">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-kumo-strong">上游 HTTP 协议</h3>
          <p className="mt-1 text-sm text-kumo-subtle">
            路由向渠道 webhook 发送的请求格式
          </p>
        </div>
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
      </Surface>
    </div>
  );
}

function ConfigItem({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="rounded-lg border border-kumo-line bg-kumo-recessed p-3">
      <div className="font-mono text-xs font-bold text-kumo-brand">{name}</div>
      <div className="mt-1 text-xs text-kumo-subtle">{desc}</div>
    </div>
  );
}
