import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'iLink-Switch · WeChat Clawbot Router',
  description:
    '微信扫码绑定路由，多上游渠道聚合转发，支持 !switch / !info / !status / !ping 命令',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-x-hidden scrollbar-thin">
            <div className="mx-auto max-w-7xl p-6 md:p-10">{children}</div>
          </main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
