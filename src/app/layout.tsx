import type { Metadata } from 'next';
import './globals.css';
import '@cloudflare/kumo/styles/standalone';
import { AppShell } from '@/components/app-shell';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'iLink-Router · WeChat Router',
  description:
    '微信扫码绑定路由，多渠道聚合转发，支持 Webhook / OneBot / Satori / WebSocket',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-kumo-base text-kumo-default font-sans antialiased">
        <AppShell>{children}</AppShell>
        <Toaster />
      </body>
    </html>
  );
}
