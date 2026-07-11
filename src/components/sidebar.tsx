'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Radio,
  Users,
  Plug,
  BookText,
  Settings,
  Github,
  Terminal,
  MessageSquare,
} from 'lucide-react';

const navItems = [
  { href: '/', label: '仪表盘', icon: LayoutDashboard },
  { href: '/channels', label: '渠道', icon: Plug },
  { href: '/sessions', label: '会话', icon: Users },
  { href: '/chat', label: '聊天', icon: MessageSquare },
  { href: '/messages', label: '消息日志', icon: BookText },
  { href: '/debug', label: 'API 调试', icon: Terminal },
  { href: '/router', label: '路由控制', icon: Radio },
  { href: '/settings', label: '设置', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/50 backdrop-blur-sm md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent shadow-md">
          <Radio className="h-5 w-5 text-white" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight">iLink-Switch</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Clawbot Router
          </span>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                active
                  ? 'bg-primary/10 text-primary shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <a
          href="https://github.com/wechaty/wechaty"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Github className="h-3.5 w-3.5" />
          Powered by Wechaty
        </a>
      </div>
    </aside>
  );
}
