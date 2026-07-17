'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { timeAgo } from '@/lib/utils';
import { Plus, PencilSimple, Trash, Lightning, Star, ArrowLeft, Copy, ArrowUpRight } from '@phosphor-icons/react';
import { QrDropzone } from '@/components/qr-dropzone';
import type { ParsedQr } from '@/lib/qr-parse';
import {
  CHANNEL_TYPES,
  CHANNEL_TYPE_MAP,
  readConfig,
  writeConfig,
  getInboundWebhookUrl,
  type ConfigField,
} from '@/lib/channel-types';

// 旧类型 → 新类型的展示映射
const TYPE_DISPLAY_MAP: Record<string, string> = {
  HTTP: 'WEBHOOK',
  WECHATY: 'WEBHOOK',
  CUSTOM: 'WEBHOOK',
};

function displayType(type: string): string {
  return TYPE_DISPLAY_MAP[type] || type;
}

function typeLabel(type: string): string {
  const t = displayType(type);
  return CHANNEL_TYPE_MAP[t]?.label || t;
}

function typeIcon(type: string): string {
  const t = displayType(type);
  return CHANNEL_TYPE_MAP[t]?.icon || '📌';
}

interface Channel {
  id: string;
  alias: string;
  name: string;
  description: string;
  type: string;
  webhookUrl: string;
  apiKey: string;
  config: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function ChannelsPage() {
  const { toast } = useToast();
  const [channels, setChannels] = React.useState<Channel[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Channel | null>(null);
  const [creating, setCreating] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const r = await api<{ channels: Channel[] }>('/api/channels');
      setChannels(r.channels);
    } catch (err) {
      toast({ title: '加载失败', description: (err as Error).message, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const onDelete = async (c: Channel) => {
    if (!confirm(`确定删除渠道「${c.name}」(${c.alias})？相关会话将解绑。`)) return;
    try {
      await api(`/api/channels/${c.id}`, { method: 'DELETE' });
      toast({ title: '已删除', variant: 'success' });
      refresh();
    } catch (err) {
      toast({ title: '删除失败', description: (err as Error).message, variant: 'error' });
    }
  };

  const onTest = async (c: Channel) => {
    try {
      const r = await api<{ ok: boolean; latencyMs?: number; reply?: string; error?: string }>(
        `/api/channels/${c.id}/test`,
        { method: 'POST', body: JSON.stringify({ mode: 'probe' }) },
      );
      if (r.ok) {
        toast({ title: '渠道可达', description: `延迟 ${r.latencyMs}ms`, variant: 'success' });
      } else {
        toast({ title: '渠道不可达', description: r.error || '未知错误', variant: 'error' });
      }
    } catch (err) {
      toast({ title: '测试失败', description: (err as Error).message, variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">渠道管理</h1>
          <p className="text-sm text-muted-foreground">
            绑定多个上游渠道（Webhook / OneBot / Satori / WebSocket），路由将按用户选择转发消息
          </p>
        </div>
        <Button variant="default" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          添加渠道
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : channels.length === 0 ? (
        <Card className="rounded-xl border border-border p-5">
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Plus weight="duotone" className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">还没有添加任何渠道</h3>
            <div className="max-w-md">
              <p className="text-sm text-muted-foreground">
                渠道是上游服务，路由会把用户消息转发到当前会话选定的渠道并获取回复
              </p>
            </div>
            <Button variant="default" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              添加第一个渠道
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((c) => (
            <Card
              key={c.id}
              className={`rounded-xl border border-border p-5 ${c.enabled ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{typeIcon(c.type)}</span>
                    <h3 className="truncate text-lg font-semibold">{c.name}</h3>
                    {c.isDefault && (
                      <Badge variant="warning" className="shrink-0">
                        <Star weight="fill" className="h-3 w-3" />
                        默认
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                      {c.alias}
                    </code>
                    <Badge variant="outline" className="text-[10px]">
                      {typeLabel(c.type)}
                    </Badge>
                    <Badge variant={c.enabled ? 'success' : 'secondary'} className="text-[10px]">
                      {c.enabled ? '启用' : '禁用'}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {c.description && (
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                )}
                {/* WEBHOOK 类型：显示生成的 webhook URL */}
                {displayType(c.type) === 'WEBHOOK' && getInboundWebhookUrl(c.alias, c.config) && (
                  <div className="rounded-md border border-primary/20 bg-primary/10 p-2">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-primary">
                      <ArrowUpRight weight="duotone" className="h-3 w-3" />
                      Webhook URL
                    </div>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 truncate text-[10px] text-muted-foreground">
                        {getInboundWebhookUrl(c.alias, c.config)}
                      </code>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="复制 URL"
                        className="h-7 w-7"
                        onClick={() => {
                          navigator.clipboard.writeText(getInboundWebhookUrl(c.alias, c.config) || '');
                          toast({ title: '已复制', description: 'Webhook URL 已复制到剪贴板', variant: 'success' });
                        }}
                      >
                        <Copy weight="duotone" className="h-3 w-3 text-primary" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="truncate text-xs text-muted-foreground">
                  {getEndpointPreview(c)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  更新于 {timeAgo(c.updatedAt)}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => onTest(c)}>
                    <Lightning className="h-4 w-4" />
                    测试
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                    <PencilSimple className="h-4 w-4" />
                    编辑
                  </Button>
                  <Button
                    size="icon"
                    variant="destructive"
                    aria-label="删除"
                    onClick={() => onDelete(c)}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <ChannelDialog
        open={creating || editing !== null}
        channel={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          refresh();
        }}
      />
    </div>
  );
}

/** 获取渠道的连接地址预览。 */
function getEndpointPreview(c: Channel): string {
  const type = displayType(c.type);
  if (type === 'WEBHOOK') return c.webhookUrl || '(仅接收推送)';
  try {
    const cfg = JSON.parse(c.config || '{}');
    if (type === 'WS') return cfg.ws_url || '(未配置)';
    if (type === 'WS_SERVER') return `ws://0.0.0.0:${cfg.port || '?'}` + (cfg.ws_token ? '?token=***' : '');
    if (type === 'ONEBOT_V11_WS_SERVER') return `反向WS :${cfg.port || '?'} → ${cfg.message_type || 'private'}:${cfg.target_id || '?'}`;
    if (type === 'ONEBOT_V12_WS_SERVER') return `反向WS :${cfg.port || '?'} → ${cfg.detail_type || 'private'}:${cfg.target_id || '?'}`;
    if (type === 'HTTP_SERVER') return `http://0.0.0.0:${cfg.port || '?'}${cfg.path_prefix || '/'}`;
    if (type === 'HTTP_SSE_SERVER') return `SSE http://0.0.0.0:${cfg.port || '?'}${cfg.path_prefix || '/'} → /stream`;
    if (type === 'HTTP_CLIENT') return `${cfg.method || 'POST'} ${cfg.url_template || '(未配置)'}`;
    if (type === 'SATORI') return cfg.api_url || '(未配置)';
    return cfg.endpoint || c.webhookUrl || '(未配置)';
  } catch {
    return '(配置格式错误)';
  }
}

// ===========================================================================
// 渠道对话框 — 两步流程：1.选择类型 → 2.填写配置
// ===========================================================================

function ChannelDialog({
  open,
  channel,
  onClose,
  onSaved,
}: {
  open: boolean;
  channel: Channel | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  // step: 'select' = 选择类型, 'form' = 填写表单
  const [step, setStep] = React.useState<'select' | 'form'>('select');
  const [selectedType, setSelectedType] = React.useState<string>('WEBHOOK');

  // 通用字段
  const [alias, setAlias] = React.useState('');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [enabled, setEnabled] = React.useState(true);
  const [isDefault, setIsDefault] = React.useState(false);
  // 类型相关配置值
  const [configValues, setConfigValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  // 打开对话框时初始化状态
  React.useEffect(() => {
    if (!open) return;
    if (channel) {
      // 编辑模式：跳过类型选择
      const type = displayType(channel.type);
      setSelectedType(type);
      const def = CHANNEL_TYPE_MAP[type];
      const values = readConfig(
        channel.config,
        def?.fields ?? [],
        { webhookUrl: channel.webhookUrl, apiKey: channel.apiKey },
      );
      setConfigValues(values);
      setAlias(channel.alias);
      setName(channel.name);
      setDescription(channel.description);
      setEnabled(channel.enabled);
      setIsDefault(channel.isDefault);
      setStep('form');
    } else {
      // 创建模式：从类型选择开始
      setStep('select');
      setSelectedType('WEBHOOK');
      setAlias('');
      setName('');
      setDescription('');
      setEnabled(true);
      setIsDefault(false);
      setConfigValues({});
    }
  }, [open, channel]);

  // 选择类型后初始化该类型的默认值
  const onSelectType = (type: string) => {
    setSelectedType(type);
    const def = CHANNEL_TYPE_MAP[type];
    const defaults: Record<string, string> = {};
    for (const f of def?.fields ?? []) {
      if (f.default != null) defaults[f.key] = String(f.default);
      else defaults[f.key] = '';
    }
    setConfigValues(defaults);
    setStep('form');
  };

  const onSubmit = async () => {
    // 校验必填
    const def = CHANNEL_TYPE_MAP[selectedType];
    if (def) {
      for (const f of def.fields) {
        if (f.required && !configValues[f.key]) {
          toast({ title: '请填写必填字段', description: `${f.label} 不能为空`, variant: 'error' });
          return;
        }
      }
    }
    if (!alias || alias.length < 2) {
      toast({ title: '请填写别名', description: '别名至少 2 个字符', variant: 'error' });
      return;
    }
    if (!name) {
      toast({ title: '请填写名称', variant: 'error' });
      return;
    }

    setSaving(true);
    try {
      const { config, webhookUrl, apiKey } = writeConfig(selectedType, configValues);
      const body = {
        alias,
        name,
        description,
        type: selectedType,
        webhookUrl,
        apiKey,
        config,
        enabled,
        isDefault,
      };
      if (channel) {
        await api(`/api/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast({ title: '已更新', variant: 'success' });
      } else {
        await api('/api/channels', { method: 'POST', body: JSON.stringify(body) });
        toast({ title: '已创建', variant: 'success' });
      }
      onSaved();
    } catch (err) {
      toast({ title: '保存失败', description: (err as Error).message, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const def = CHANNEL_TYPE_MAP[selectedType];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="p-6 sm:max-w-2xl">
        <DialogTitle>{channel ? '编辑渠道' : '添加渠道'}</DialogTitle>
        <DialogDescription>
          {step === 'select'
            ? '选择渠道类型，不同类型对应不同的上游协议'
            : `${def?.icon || ''} ${def?.label || ''} — ${def?.description || ''}`}
        </DialogDescription>

        {step === 'select' ? (
          /* ===== Step 1: 选择渠道类型 ===== */
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {CHANNEL_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => onSelectType(t.type)}
                className="group flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary hover:bg-primary/10 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{t.icon}</span>
                  <span className="font-semibold text-foreground">{t.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t.description}</p>
                {t.qrBindable && (
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    支持扫码绑定
                  </Badge>
                )}
              </button>
            ))}
          </div>
        ) : (
          /* ===== Step 2: 填写表单 ===== */
          <div className="mt-4 grid gap-4">
            {/* 返回类型选择（仅创建模式） */}
            {!channel && (
              <button
                onClick={() => setStep('select')}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft weight="duotone" className="h-3 w-3" />
                返回选择类型
              </button>
            )}

            {/* 扫码绑定（仅 WEBHOOK 类型 + 创建模式） */}
            {!channel && def?.qrBindable && (
              <div className="rounded-lg border border-primary/20 bg-primary/10 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Star weight="duotone" className="h-4 w-4 text-primary" />
                  扫码绑定上游
                  <span className="text-[10px] font-normal text-muted-foreground">
                    （可选）扫上游二维码后自动填充
                  </span>
                </div>
                <QrDropzone
                  onParsed={(parsed: ParsedQr) => {
                    const token = parsed.qrcode || '';
                    setConfigValues((prev) => ({
                      ...prev,
                      api_key: token,
                    }));
                    setAlias((prev) =>
                      prev ||
                      (parsed.pathSegment || token.slice(0, 8)).replace(/[^a-zA-Z0-9_-]/g, ''),
                    );
                    setName((prev) => prev || `上游-${token.slice(0, 6)}`);
                    toast({
                      title: '已解析上游二维码',
                      description: `token: ${token.slice(0, 8)}…  bot_type=${parsed.botType ?? 3}`,
                      variant: 'success',
                    });
                  }}
                />
              </div>
            )}

            {/* 通用字段 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>别名 *</Label>
                <Input
                  value={alias}
                  disabled={!!channel}
                  placeholder="gpt4"
                  onChange={(e) => setAlias(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">用于 !switch 命令，仅允许字母/数字/下划线/连字符</p>
              </div>
              <div className="space-y-1.5">
                <Label>名称 *</Label>
                <Input
                  value={name}
                  placeholder="GPT-4 Turbo"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>描述</Label>
              <Input
                value={description}
                placeholder="可选"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* 类型相关配置字段 */}
            <div className="rounded-lg border border-border bg-muted p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <span className="text-lg">{def?.icon}</span>
                {def?.label} 配置
              </div>

              {/* WEBHOOK 类型：显示生成的 webhook URL（编辑模式 + 已有 token 时） */}
              {selectedType === 'WEBHOOK' && channel && getInboundWebhookUrl(channel.alias, channel.config) && (
                <div className="mb-4 rounded-md border border-primary/20 bg-primary/10 p-3">
                  <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-primary">
                    <ArrowUpRight weight="duotone" className="h-3.5 w-3.5" />
                    你的 Webhook URL
                  </div>
                  <p className="text-xs text-muted-foreground">
                    客户端向此 URL 发送 POST 请求来推送消息/回复给微信用户
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-background px-2 py-1.5 text-[10px] text-foreground">
                      {getInboundWebhookUrl(channel.alias, channel.config)}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(getInboundWebhookUrl(channel.alias, channel.config) || '');
                        toast({ title: '已复制', description: 'Webhook URL 已复制', variant: 'success' });
                      }}
                    >
                      <Copy className="h-4 w-4" />
                      复制
                    </Button>
                  </div>
                  <div className="mt-2 rounded bg-background p-2 text-[10px] text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">请求示例：</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all">{`POST ${getInboundWebhookUrl(channel.alias, channel.config)}
Content-Type: application/json

{
  "userId": "wxid_xxx",
  "message": "要发送给微信用户的消息"
}`}</pre>
                  </div>
                </div>
              )}

              {/* WEBHOOK 类型：创建模式提示 */}
              {selectedType === 'WEBHOOK' && !channel && (
                <div className="mb-4 rounded-md border border-primary/20 bg-primary/10 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-primary">📌 创建后将自动生成专属 Webhook URL</span>
                  <br />
                  客户端可通过该 URL 向微信用户推送消息/回复
                </div>
              )}

              <div className="grid gap-4">
                {(def?.fields ?? []).map((f) => (
                  <ConfigFieldInput
                    key={f.key}
                    field={f}
                    value={configValues[f.key] || ''}
                    onChange={(v) => setConfigValues((prev) => ({ ...prev, [f.key]: v }))}
                  />
                ))}
              </div>
            </div>

            {/* 开关 */}
            <div className="flex items-center gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>启用</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={isDefault} onCheckedChange={setIsDefault} />
                <Label>设为默认渠道</Label>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                取消
              </Button>
              <Button variant="default" onClick={onSubmit} loading={saving}>
                {channel ? '保存' : '创建'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// 单个配置字段渲染
// ===========================================================================

function ConfigFieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string;
  onChange: (v: string) => void;
}) {
  const label = (
    <>
      {field.label}
      {field.required && <span className="ml-1 text-destructive">*</span>}
    </>
  );

  if (field.type === 'select') {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-border bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Textarea
          value={value}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}
