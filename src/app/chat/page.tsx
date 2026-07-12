'use client';

import * as React from 'react';
import { Surface, Badge, Button, Input, InputArea, Switch } from '@cloudflare/kumo';
import { useToast } from '@/components/ui/toaster';
import { api } from '@/lib/api-client';
import { formatTime } from '@/lib/utils';
import { Plus, PaperPlaneTilt, ArrowsClockwise, ChatCircle, Broadcast, Users } from '@phosphor-icons/react';

interface SessionItem {
  id: string;
  wxId: string;
  wxName: string;
  currentChannel: string | null;
  messageCount: number;
  lastActiveAt: string;
  channel: { alias: string; name: string } | null;
}

interface MessageItem {
  id: string;
  direction: string;
  text: string;
  kind: string;
  error: string;
  latencyMs: number | null;
  createdAt: string;
  channel: { alias: string; name: string } | null;
}

interface ChatData {
  session: SessionItem;
  messages: MessageItem[];
}

export default function ChatPage() {
  const { toast } = useToast();
  const [sessions, setSessions] = React.useState<SessionItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [chatData, setChatData] = React.useState<ChatData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  // 双向模式开关：开启后可模拟渠道回复（真发到微信）
  const [bidirectional, setBidirectional] = React.useState(false);
  const [replyInput, setReplyInput] = React.useState('');

  const refreshSessions = React.useCallback(async () => {
    try {
      const r = await api<{ sessions: SessionItem[] }>('/api/chat?list=1');
      setSessions(r.sessions);
    } catch (err) {
      toast({ title: '加载会话失败', description: (err as Error).message, variant: 'error' });
    }
  }, [toast]);

  const refreshChat = React.useCallback(async () => {
    if (!selectedId) return;
    try {
      const r = await api<ChatData>(`/api/chat?sessionId=${selectedId}&limit=500`);
      setChatData(r);
    } catch {
      // ignore
    }
  }, [selectedId]);

  React.useEffect(() => {
    refreshSessions().finally(() => setLoading(false));
  }, [refreshSessions]);

  React.useEffect(() => {
    refreshChat();
    const t = setInterval(refreshChat, 3000);
    return () => clearInterval(t);
  }, [refreshChat]);

  // 滚动到底部
  const bottomRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatData?.messages.length]);

  const createTestSession = async () => {
    try {
      const r = await api<{ ok: boolean; session: SessionItem }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ action: 'create-session' }),
      });
      toast({ title: '已创建测试会话', variant: 'success' });
      await refreshSessions();
      setSelectedId(r.session.id);
    } catch (err) {
      toast({ title: '创建失败', description: (err as Error).message, variant: 'error' });
    }
  };

  const sendAsUser = async () => {
    if (!input.trim() || !chatData) return;
    const msg = input.trim();
    setInput('');
    setSending(true);
    try {
      const r = await api<{
        ok: boolean;
        reply: string;
        kind: string;
        error?: string;
      }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          action: 'send',
          wxId: chatData.session.wxId,
          message: msg,
        }),
      });
      if (r.error) {
        toast({ title: '回复包含错误', description: r.error, variant: 'error' });
      }
      // 立即刷新聊天记录
      await refreshChat();
    } catch (err) {
      toast({ title: '发送失败', description: (err as Error).message, variant: 'error' });
      setInput(msg);
    } finally {
      setSending(false);
    }
  };

  const sendAsChannelReply = async () => {
    if (!replyInput.trim() || !chatData) return;
    const msg = replyInput.trim();
    setReplyInput('');
    setSending(true);
    try {
      const r = await api<{ ok: boolean; delivered: boolean }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reply',
          sessionId: chatData.session.id,
          reply: msg,
        }),
      });
      toast({
        title: r.delivered ? '已发送到微信' : '发送失败（路由离线）',
        variant: r.delivered ? 'success' : 'error',
      });
      await refreshChat();
    } catch (err) {
      toast({ title: '回复失败', description: (err as Error).message, variant: 'error' });
      setReplyInput(msg);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="text-sm text-kumo-subtle">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-kumo-strong">聊天</h1>
          <p className="mt-1 text-sm text-kumo-subtle">
            模拟微信消息发送，与微信聊天记录保持同步。开启双向模式可模拟渠道回复
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Switch
            checked={bidirectional}
            onCheckedChange={setBidirectional}
            label="双向模式"
          />
          <Button
            variant="outline"
            size="sm"
            icon={<ArrowsClockwise weight="duotone" className="h-3 w-3" />}
            onClick={refreshSessions}
          >
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        {/* 会话列表 */}
        <Surface className="h-[calc(100vh-220px)] overflow-hidden rounded-xl border border-kumo-line">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-kumo-line p-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-kumo-default">
                <Users weight="duotone" className="h-3.5 w-3.5" />
                会话列表
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={createTestSession}
                className="h-7 px-2"
                icon={<Plus weight="duotone" className="h-3 w-3" />}
              >
                新建测试
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              {sessions.length === 0 ? (
                <p className="p-4 text-center text-xs text-kumo-subtle">暂无会话</p>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`flex w-full flex-col gap-1 border-b border-kumo-line/50 px-3 py-2.5 text-left transition-colors ${
                      selectedId === s.id ? 'bg-kumo-brand-tint' : 'hover:bg-kumo-tint'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-kumo-strong">
                        {s.wxName || '(未命名)'}
                      </span>
                      {s.channel && (
                        <Badge variant="outline" className="shrink-0 text-[9px]">
                          {s.channel.alias}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-kumo-subtle">
                      <code className="truncate">{s.wxId}</code>
                      <span>{formatTime(s.lastActiveAt)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </Surface>

        {/* 聊天视图 */}
        <Surface className="h-[calc(100vh-220px)] overflow-hidden rounded-xl border border-kumo-line">
          <div className="flex h-full flex-col">
            {!chatData ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <ChatCircle weight="duotone" className="h-12 w-12 text-kumo-subtle/40" />
                <div className="text-sm text-kumo-subtle">
                  {selectedId ? '加载中...' : '从左侧选择一个会话开始聊天'}
                </div>
                {!selectedId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={createTestSession}
                    icon={<Plus weight="duotone" className="h-3 w-3" />}
                  >
                    新建测试会话
                  </Button>
                )}
              </div>
            ) : (
              <>
                {/* 会话头部 */}
                <div className="flex items-center justify-between border-b border-kumo-line px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-kumo-strong">
                        {chatData.session.wxName || '(未命名)'}
                      </span>
                      {chatData.session.channel && (
                        <Badge variant="primary" className="text-[9px]">
                          {chatData.session.channel.name}
                        </Badge>
                      )}
                    </div>
                    <code className="text-[10px] text-kumo-subtle">
                      {chatData.session.wxId}
                    </code>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {chatData.session.messageCount} 条消息
                  </Badge>
                </div>

                {/* 消息列表 */}
                <div className="flex-1 space-y-3 overflow-auto p-4">
                  {chatData.messages.length === 0 ? (
                    <p className="py-12 text-center text-sm text-kumo-subtle">
                      暂无消息记录，在下方输入消息开始对话
                    </p>
                  ) : (
                    chatData.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.direction === 'IN' ? 'justify-start' : 'justify-end'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                            m.direction === 'IN'
                              ? 'bg-kumo-recessed text-kumo-default'
                              : m.kind === 'system'
                                ? 'bg-kumo-warning-tint text-kumo-warning'
                                : m.kind === 'command'
                                  ? 'bg-kumo-brand-tint text-kumo-brand'
                                  : 'bg-kumo-brand text-white'
                          }`}
                        >
                          <div className="mb-1 flex items-center gap-2 text-[10px] opacity-70">
                            <span>{formatTime(m.createdAt)}</span>
                            {m.channel && <span>· {m.channel.alias}</span>}
                            {m.latencyMs != null && <span>· {m.latencyMs}ms</span>}
                            <Badge variant="outline" className="text-[9px]">
                              {m.kind}
                            </Badge>
                          </div>
                          <div className="whitespace-pre-wrap break-words text-sm">
                            {m.text}
                          </div>
                          {m.error && (
                            <div className="mt-1 text-xs text-kumo-danger">⚠ {m.error}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* 输入区 */}
                <div className="space-y-2 border-t border-kumo-line p-3">
                  {/* 模拟渠道回复（双向模式） */}
                  {bidirectional && (
                    <div className="flex items-center gap-2 rounded-md border border-kumo-warning/30 bg-kumo-warning-tint p-2">
                      <Broadcast weight="duotone" className="h-4 w-4 shrink-0 text-kumo-warning" />
                      <InputArea
                        value={replyInput}
                        onChange={(e) => setReplyInput(e.target.value)}
                        placeholder="模拟渠道回复（将真实发送到微信用户）"
                        className="min-h-[40px] flex-1 border-0 bg-transparent text-sm focus-visible:ring-0"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendAsChannelReply();
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={sendAsChannelReply}
                        disabled={sending || !replyInput.trim()}
                        icon={<PaperPlaneTilt weight="duotone" className="h-3 w-3" />}
                      >
                        回复
                      </Button>
                    </div>
                  )}
                  {/* 模拟微信用户发送 */}
                  <div className="flex items-center gap-2">
                    <Input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="模拟微信用户发送消息..."
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendAsUser();
                        }
                      }}
                    />
                    <Button
                      variant="primary"
                      onClick={sendAsUser}
                      disabled={sending || !input.trim()}
                      loading={sending}
                      icon={PaperPlaneTilt}
                    >
                      发送
                    </Button>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-kumo-subtle">
                    <span>
                      {bidirectional
                        ? '双向模式：可模拟用户发送 + 渠道回复（渠道回复会真实发送到微信）'
                        : '模拟模式：用户消息经路由转发到渠道，回复显示在此处（不真实发送到微信）'}
                    </span>
                    <span>每 3 秒自动同步</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Surface>
      </div>
    </div>
  );
}
