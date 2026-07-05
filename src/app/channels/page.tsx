'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { timeAgo } from '@/lib/utils';
import { Plus, Pencil, Trash2, Zap, Star } from 'lucide-react';

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
        toast({
          title: '渠道可达',
          description: `延迟 ${r.latencyMs}ms`,
          variant: 'success',
        });
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
          <h1 className="text-3xl font-bold tracking-tight">渠道管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            绑定多个上游微信机器人 / HTTP 服务，路由将按用户选择转发消息
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          绑定新渠道
        </Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">加载中...</div>
      ) : channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Plus className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="text-lg font-semibold">还没有绑定任何渠道</div>
            <p className="max-w-md text-sm text-muted-foreground">
              渠道是上游微信机器人或 HTTP 服务，路由会把用户消息转发到当前会话选定的渠道
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              绑定第一个渠道
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((c) => (
            <Card key={c.id} className={c.enabled ? '' : 'opacity-60'}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="truncate text-base">{c.name}</CardTitle>
                      {c.isDefault && (
                        <Badge variant="warning" className="shrink-0">
                          <Star className="h-3 w-3" />
                          默认
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                        {c.alias}
                      </code>
                      <Badge variant="outline" className="text-[10px]">
                        {c.type}
                      </Badge>
                      <Badge variant={c.enabled ? 'success' : 'secondary'} className="text-[10px]">
                        {c.enabled ? '启用' : '禁用'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.description && (
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                )}
                <div className="truncate text-xs text-muted-foreground">
                  {c.webhookUrl || '(无 webhook)'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  更新于 {timeAgo(c.updatedAt)}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => onTest(c)}>
                    <Zap className="h-3 w-3" />
                    测试
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                    <Pencil className="h-3 w-3" />
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => onDelete(c)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
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
  const [form, setForm] = React.useState({
    alias: '',
    name: '',
    description: '',
    type: 'HTTP',
    webhookUrl: '',
    apiKey: '',
    config: '{}',
    enabled: true,
    isDefault: false,
  });
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (channel) {
      setForm({
        alias: channel.alias,
        name: channel.name,
        description: channel.description,
        type: channel.type,
        webhookUrl: channel.webhookUrl,
        apiKey: channel.apiKey,
        config: channel.config,
        enabled: channel.enabled,
        isDefault: channel.isDefault,
      });
    } else {
      setForm({
        alias: '',
        name: '',
        description: '',
        type: 'HTTP',
        webhookUrl: '',
        apiKey: '',
        config: '{}',
        enabled: true,
        isDefault: false,
      });
    }
  }, [channel]);

  const onSubmit = async () => {
    setSaving(true);
    try {
      if (channel) {
        await api(`/api/channels/${channel.id}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
        toast({ title: '已更新', variant: 'success' });
      } else {
        await api('/api/channels', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        toast({ title: '已创建', variant: 'success' });
      }
      onSaved();
    } catch (err) {
      toast({
        title: '保存失败',
        description: (err as Error).message,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={channel ? '编辑渠道' : '绑定新渠道'}
      description="上游渠道可以是任意支持 HTTP webhook 的微信机器人 / 服务"
      className="max-w-2xl"
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="alias">别名 *</Label>
            <Input
              id="alias"
              value={form.alias}
              disabled={!!channel}
              placeholder="gpt4"
              onChange={(e) => setForm({ ...form, alias: e.target.value })}
            />
            <p className="text-[10px] text-muted-foreground">
              用于 !switch 命令，仅允许字母/数字/下划线/连字符
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">名称 *</Label>
            <Input
              id="name"
              value={form.name}
              placeholder="GPT-4 Turbo"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="desc">描述</Label>
          <Input
            id="desc"
            value={form.description}
            placeholder="OpenAI GPT-4 Turbo 上游"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webhook">Webhook URL</Label>
          <Input
            id="webhook"
            value={form.webhookUrl}
            placeholder="https://upstream.example.com/ilink"
            onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
          />
          <p className="text-[10px] text-muted-foreground">
            路由会 POST 消息到此 URL，期望返回 JSON <code>{'{ reply: "..." }'}</code>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="type">类型</Label>
            <select
              id="type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="HTTP">HTTP</option>
              <option value="WECHATY">WECHATY</option>
              <option value="CUSTOM">CUSTOM</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="key">API Key</Label>
            <Input
              id="key"
              value={form.apiKey}
              placeholder="可选"
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="config">扩展配置 (JSON)</Label>
          <Textarea
            id="config"
            value={form.config}
            placeholder='{"headers": {}}'
            rows={3}
            onChange={(e) => setForm({ ...form, config: e.target.value })}
          />
        </div>

        <div className="flex items-center gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            启用
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.isDefault}
              onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            />
            设为默认渠道
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            {channel ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
