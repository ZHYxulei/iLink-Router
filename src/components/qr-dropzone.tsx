'use client';

import * as React from 'react';
import { Surface, Button, Input, Text } from '@cloudflare/kumo';
import { parseQrContent, decodeImageToQrText, type ParsedQr } from '@/lib/qr-parse';
import {
  UploadSimple,
  Scan,
  Clipboard,
  CircleNotch,
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';

/**
 * 上游绑定二维码输入组件。
 *
 * 支持三种输入方式：
 *   1. 拖拽二维码图片到虚线框
 *   2. 点击虚线框选择图片文件
 *   3. 在输入框粘贴二维码解码后的文本（URL 或裸 token）
 *
 * 解析成功后调用 onParsed，由父组件决定如何填充表单。
 */
export function QrDropzone({
  onParsed,
  className,
}: {
  onParsed: (parsed: ParsedQr) => void;
  className?: string;
}) {
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastResult, setLastResult] = React.useState<ParsedQr | null>(null);
  const [pasteText, setPasteText] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('只支持图片文件');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const text = await decodeImageToQrText(bitmap);
      if (!text) {
        setError('未在图片中识别到二维码');
        return;
      }
      const parsed = parseQrContent(text);
      setLastResult(parsed);
      if (parsed.recognized) {
        onParsed(parsed);
      } else {
        setError(parsed.error || '不是有效的上游绑定二维码');
      }
    } catch (e) {
      setError((e as Error).message || '图片解码失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handlePaste = () => {
    const text = pasteText.trim();
    if (!text) {
      setError('请输入二维码内容');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parsed = parseQrContent(text);
      setLastResult(parsed);
      if (parsed.recognized) {
        onParsed(parsed);
      } else {
        setError(parsed.error || '不是有效的上游绑定二维码');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-3 ${className || ''}`}>
      {/* 拖拽 / 上传区 */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragging
            ? 'border-kumo-brand bg-kumo-brand-tint'
            : 'border-kumo-line hover:border-kumo-brand/50 hover:bg-kumo-recessed'
        }`}
      >
        {busy ? (
          <CircleNotch weight="duotone" className="h-8 w-8 animate-spin text-kumo-brand" />
        ) : lastResult?.recognized ? (
          <CheckCircle weight="duotone" className="h-8 w-8 text-kumo-success" />
        ) : error ? (
          <XCircle weight="duotone" className="h-8 w-8 text-kumo-danger" />
        ) : (
          <UploadSimple weight="duotone" className="h-8 w-8 text-kumo-subtle" />
        )}
        <div className="text-sm font-medium text-kumo-strong">
          {busy
            ? '识别中...'
            : lastResult?.recognized
              ? '已识别，可继续扫码或编辑下方信息'
              : '拖拽二维码图片到此处，或点击选择文件'}
        </div>
        <div className="text-[10px] text-kumo-subtle">
          支持 PNG / JPG / BMP，浏览器本地解码，不上传图片
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* 分隔 */}
      <div className="flex items-center gap-2 text-[10px] text-kumo-subtle">
        <div className="h-px flex-1 bg-kumo-line" />
        <span className="flex items-center gap-1">
          <Scan weight="duotone" className="h-3 w-3" />
          或粘贴解码后的文本
        </span>
        <div className="h-px flex-1 bg-kumo-line" />
      </div>

      {/* 粘贴文本 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Clipboard
            weight="duotone"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kumo-subtle"
          />
          <input
            type="text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePaste();
            }}
            placeholder="https://liteapp.weixin.qq.com/q/...?qrcode=...&bot_type=3"
            aria-label="粘贴二维码解码文本"
            className="flex h-10 w-full rounded-md border border-kumo-line bg-kumo-base py-2 pl-9 pr-3 text-xs text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
          />
        </div>
        <Button variant="secondary" onClick={handlePaste} disabled={busy || !pasteText.trim()}>
          解析
        </Button>
      </div>

      {/* 错误提示 */}
      {error && (
        <Surface className="rounded-md border border-kumo-danger/30 bg-kumo-danger-tint px-3 py-2">
          <Text variant="error" size="xs">
            {error}
          </Text>
        </Surface>
      )}

      {/* 解析结果预览 */}
      {lastResult?.recognized && (
        <Surface className="space-y-1 rounded-md border border-kumo-success/30 bg-kumo-success-tint px-3 py-2">
          <div className="flex items-center gap-1 text-xs font-medium text-kumo-success">
            <CheckCircle weight="duotone" className="h-3.5 w-3.5" />
            已识别为上游绑定二维码
          </div>
          {lastResult.qrcode && (
            <div className="truncate text-xs text-kumo-subtle">
              token: <code className="font-mono">{lastResult.qrcode}</code>
            </div>
          )}
          <div className="text-xs text-kumo-subtle">
            bot_type: <code className="font-mono">{lastResult.botType ?? '?'}</code>
          </div>
          {lastResult.url && (
            <div className="truncate text-xs text-kumo-subtle">
              URL: <code className="font-mono">{lastResult.url}</code>
            </div>
          )}
        </Surface>
      )}
    </div>
  );
}
