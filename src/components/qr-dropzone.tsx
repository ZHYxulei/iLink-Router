'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { parseQrContent, decodeImageToQrText, type ParsedQr } from '@/lib/qr-parse';
import { Upload, ScanLine, ClipboardPaste, Loader2, CheckCircle2, XCircle } from 'lucide-react';

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
    <div className={cn('space-y-3', className)}>
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
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/40',
        )}
      >
        {busy ? (
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        ) : lastResult?.recognized ? (
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        ) : error ? (
          <XCircle className="h-8 w-8 text-destructive" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground" />
        )}
        <div className="text-sm font-medium">
          {busy
            ? '识别中...'
            : lastResult?.recognized
              ? '已识别，可继续扫码或编辑下方信息'
              : '拖拽二维码图片到此处，或点击选择文件'}
        </div>
        <div className="text-[10px] text-muted-foreground">
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
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1">
          <ScanLine className="h-3 w-3" />
          或粘贴解码后的文本
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* 粘贴文本 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ClipboardPaste className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handlePaste();
            }}
            placeholder="https://liteapp.weixin.qq.com/q/...?qrcode=...&bot_type=3"
            className="flex h-10 w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={handlePaste}
          disabled={busy || !pasteText.trim()}
          className="flex h-10 items-center rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          解析
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* 解析结果预览 */}
      {lastResult?.recognized && (
        <div className="space-y-1 rounded-md border border-green-600/30 bg-green-600/5 px-3 py-2 text-xs">
          <div className="flex items-center gap-1 font-medium text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已识别为上游绑定二维码
          </div>
          {lastResult.qrcode && (
            <div className="truncate text-muted-foreground">
              token: <code className="font-mono">{lastResult.qrcode}</code>
            </div>
          )}
          <div className="text-muted-foreground">
            bot_type: <code className="font-mono">{lastResult.botType ?? '?'}</code>
          </div>
          {lastResult.url && (
            <div className="truncate text-muted-foreground">
              URL: <code className="font-mono">{lastResult.url}</code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
