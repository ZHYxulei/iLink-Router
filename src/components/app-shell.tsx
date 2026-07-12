'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  Plug,
  Users,
  ChatCircle,
  BookOpenText,
  TerminalWindow,
  Gear,
  Broadcast,
  GithubLogo,
} from '@phosphor-icons/react';

const navItems = [
  { href: '/', label: '仪表盘', icon: SquaresFour },
  { href: '/channels', label: '渠道', icon: Plug },
  { href: '/sessions', label: '会话', icon: Users },
  { href: '/chat', label: '聊天', icon: ChatCircle },
  { href: '/messages', label: '消息日志', icon: BookOpenText },
  { href: '/debug', label: 'API 调试', icon: TerminalWindow },
  { href: '/router', label: '路由控制', icon: Broadcast },
  { href: '/settings', label: '设置', icon: Gear },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-kumo-line bg-kumo-elevated">
        <div className="flex h-16 items-center gap-3 border-b border-kumo-line px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-kumo-brand shadow-md">
            <Broadcast weight="bold" className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-kumo-strong">
              iLink-Router
            </span>
            <span className="text-[10px] uppercase tracking-wider text-kumo-subtle">
              WeChat Router
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
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
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-kumo-brand-tint text-kumo-brand shadow-sm'
                    : 'text-kumo-subtle hover:bg-kumo-recessed hover:text-kumo-default'
                }`}
              >
                <Icon weight={active ? 'fill' : 'regular'} className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-kumo-line p-3">
          <a
            href="https://github.com/ZHYxulei/iLink-Router"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-kumo-subtle transition-colors hover:bg-kumo-recessed hover:text-kumo-default"
          >
            <GithubLogo className="h-3.5 w-3.5" />
            GitHub
          </a>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto scrollbar-thin">
        <div className="mx-auto max-w-7xl p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
