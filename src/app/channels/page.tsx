'use client';

import * as React from 'react';
import { Surface, Badge, Button, Text, Input, InputArea, Switch, Field, Dialog } from '@cloudflare/kumo';
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
          <Text variant="heading1" as="h1">渠道管理</Text>
          <Text size="sm" variant="secondary">
            绑定多个上游渠道（Webhook / OneBot / Satori / WebSocket），路由将按用户选择转发消息
          </Text>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          添加渠道
        </Button>
      </div>

      {loading ? (
        <Text size="sm" variant="secondary">加载中...</Text>
      ) : channels.length === 0 ? (
        <Surface className="rounded-xl border border-kumo-line p-5">
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-kumo-recessed">
              <Plus weight="duotone" className="h-8 w-8 text-kumo-subtle" />
            </div>
            <Text variant="heading3" as="h3">还没有添加任何渠道</Text>
            <div className="max-w-md">
              <Text size="sm" variant="secondary">
                渠道是上游服务，路由会把用户消息转发到当前会话选定的渠道并获取回复
              </Text>
            </div>
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              添加第一个渠道
            </Button>
          </div>
        </Surface>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((c) => (
            <Surface
              key={c.id}
              className={`rounded-xl border border-kumo-line p-5 ${c.enabled ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{typeIcon(c.type)}</span>
                    <Text variant="heading3" as="h3" truncate>{c.name}</Text>
                    {c.isDefault && (
                      <Badge variant="warning" className="shrink-0">
                        <Star weight="fill" className="h-3 w-3" />
                        默认
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="rounded bg-kumo-brand-tint px-1.5 py-0.5 text-xs font-bold text-kumo-brand">
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
                  <Text size="xs" variant="secondary">{c.description}</Text>
                )}
                {/* WEBHOOK 类型：显示生成的 webhook URL */}
                {displayType(c.type) === 'WEBHOOK' && getInboundWebhookUrl(c.alias, c.config) && (
                  <div className="rounded-md border border-kumo-brand/20 bg-kumo-brand-tint p-2">
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-kumo-brand">
                      <ArrowUpRight weight="duotone" className="h-3 w-3" />
                      Webhook URL
                    </div>
                    <div className="flex items-center gap-1">
                      <code className="flex-1 truncate text-[10px] text-kumo-subtle">
                        {getInboundWebhookUrl(c.alias, c.config)}
                      </code>
                      <Button
                        size="xs"
                        variant="ghost"
                        shape="square"
                        aria-label="复制 URL"
                        icon={<Copy weight="duotone" className="h-3 w-3 text-kumo-brand" />}
                        onClick={() => {
                          navigator.clipboard.writeText(getInboundWebhookUrl(c.alias, c.config) || '');
                          toast({ title: '已复制', description: 'Webhook URL 已复制到剪贴板', variant: 'success' });
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="truncate text-xs text-kumo-subtle">
                  {getEndpointPreview(c)}
                </div>
                <div className="text-[10px] text-kumo-subtle">
                  更新于 {timeAgo(c.updatedAt)}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" icon={Lightning} onClick={() => onTest(c)}>
                    测试
                  </Button>
                  <Button size="sm" variant="secondary" icon={PencilSimple} onClick={() => setEditing(c)}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    shape="square"
                    icon={Trash}
                    aria-label="删除"
                    onClick={() => onDelete(c)}
                  />
                </div>
              </div>
            </Surface>
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
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog size="xl" className="p-6">
        <Dialog.Title>{channel ? '编辑渠道' : '添加渠道'}</Dialog.Title>
        <Dialog.Description>
          {step === 'select'
            ? '选择渠道类型，不同类型对应不同的上游协议'
            : `${def?.icon || ''} ${def?.label || ''} — ${def?.description || ''}`}
        </Dialog.Description>

        {step === 'select' ? (
          /* ===== Step 1: 选择渠道类型 ===== */
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {CHANNEL_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => onSelectType(t.type)}
                className="group flex flex-col items-start gap-1 rounded-lg border border-kumo-line bg-kumo-elevated p-4 text-left transition-all hover:border-kumo-brand hover:bg-kumo-brand-tint hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{t.icon}</span>
                  <span className="font-semibold text-kumo-strong">{t.label}</span>
                </div>
                <Text size="xs" variant="secondary">{t.description}</Text>
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
                className="flex items-center gap-1 text-xs text-kumo-subtle transition-colors hover:text-kumo-default"
              >
                <ArrowLeft weight="duotone" className="h-3 w-3" />
                返回选择类型
              </button>
            )}

            {/* 扫码绑定（仅 WEBHOOK 类型 + 创建模式） */}
            {!channel && def?.qrBindable && (
              <div className="rounded-lg border border-kumo-brand/20 bg-kumo-brand-tint p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-kumo-strong">
                  <Star weight="duotone" className="h-4 w-4 text-kumo-brand" />
                  扫码绑定上游
                  <span className="text-[10px] font-normal text-kumo-subtle">
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
              <Input
                label="别名 *"
                description="用于 !switch 命令，仅允许字母/数字/下划线/连字符"
                value={alias}
                disabled={!!channel}
                placeholder="gpt4"
                onChange={(e) => setAlias(e.target.value)}
              />
              <Input
                label="名称 *"
                value={name}
                placeholder="GPT-4 Turbo"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <Input
              label="描述"
              value={description}
              placeholder="可选"
              onChange={(e) => setDescription(e.target.value)}
            />

            {/* 类型相关配置字段 */}
            <div className="rounded-lg border border-kumo-line bg-kumo-recessed p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-kumo-strong">
                <span className="text-lg">{def?.icon}</span>
                {def?.label} 配置
              </div>

              {/* WEBHOOK 类型：显示生成的 webhook URL（编辑模式 + 已有 token 时） */}
              {selectedType === 'WEBHOOK' && channel && getInboundWebhookUrl(channel.alias, channel.config) && (
                <div className="mb-4 rounded-md border border-kumo-brand/20 bg-kumo-brand-tint p-3">
                  <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-kumo-brand">
                    <ArrowUpRight weight="duotone" className="h-3.5 w-3.5" />
                    你的 Webhook URL
                  </div>
                  <Text size="xs" variant="secondary">
                    客户端向此 URL 发送 POST 请求来推送消息/回复给微信用户
                  </Text>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-kumo-base px-2 py-1.5 text-[10px] text-kumo-default">
                      {getInboundWebhookUrl(channel.alias, channel.config)}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      icon={Copy}
                      onClick={() => {
                        navigator.clipboard.writeText(getInboundWebhookUrl(channel.alias, channel.config) || '');
                        toast({ title: '已复制', description: 'Webhook URL 已复制', variant: 'success' });
                      }}
                    >
                      复制
                    </Button>
                  </div>
                  <div className="mt-2 rounded bg-kumo-base p-2 text-[10px] text-kumo-subtle">
                    <div className="mb-1 font-medium text-kumo-default">请求示例：</div>
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
                <div className="mb-4 rounded-md border border-kumo-brand/20 bg-kumo-brand-tint p-3 text-xs text-kumo-subtle">
                  <span className="font-medium text-kumo-brand">📌 创建后将自动生成专属 Webhook URL</span>
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
              <Switch
                label="启用"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Switch
                label="设为默认渠道"
                checked={isDefault}
                onCheckedChange={setIsDefault}
              />
            </div>

            {/* 操作按钮 */}
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                取消
              </Button>
              <Button variant="primary" onClick={onSubmit} loading={saving}>
                {channel ? '保存' : '创建'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Dialog.Root>
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
      {field.required && <span className="ml-1 text-kumo-danger">*</span>}
    </>
  );

  if (field.type === 'select') {
    return (
      <Field label={label} description={field.help}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex h-9 w-full rounded-lg border border-kumo-line bg-kumo-base px-3 text-base focus:outline-none focus:ring-2 focus:ring-kumo-focus/50"
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (field.type === 'textarea') {
    return (
      <InputArea
        label={label}
        description={field.help}
        value={value}
        placeholder={field.placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Input
      label={label}
      description={field.help}
      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
      value={value}
      placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
