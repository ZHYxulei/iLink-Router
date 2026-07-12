'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@cloudflare/kumo';
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
  List,
} from '@phosphor-icons/react';

const navGroups = [
  {
    label: '概览',
    items: [
      { href: '/', label: '仪表盘', icon: SquaresFour },
      { href: '/channels', label: '渠道', icon: Plug },
      { href: '/sessions', label: '会话', icon: Users },
    ],
  },
  {
    label: '工具',
    items: [
      { href: '/chat', label: '聊天', icon: ChatCircle },
      { href: '/messages', label: '消息日志', icon: BookOpenText },
      { href: '/debug', label: 'API 调试', icon: TerminalWindow },
    ],
  },
  {
    label: '系统',
    items: [
      { href: '/router', label: '路由控制', icon: Broadcast },
      { href: '/settings', label: '设置', icon: Gear },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-kumo-line bg-kumo-elevated md:flex">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-screen w-64 border-r border-kumo-line bg-kumo-elevated">
            <SidebarContent
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      <main className="flex-1 overflow-x-auto scrollbar-thin">
        <div className="mx-auto max-w-7xl p-6 md:p-8">{children}</div>
      </main>

      {/* Mobile nav trigger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-kumo-brand text-white shadow-lg md:hidden"
        aria-label="打开导航"
      >
        <List className="h-5 w-5" />
      </button>
    </div>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-16 items-center gap-2.5 border-b border-kumo-line px-5">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-brand text-white shadow-sm">
            <Broadcast weight="bold" className="h-4.5 w-4.5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-tight text-kumo-strong">
              iLink-Router
            </span>
            <span className="text-[10px] uppercase tracking-wider text-kumo-subtle">
              WeChat Router
            </span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-kumo-brand-tint text-kumo-brand'
                        : 'text-kumo-subtle hover:bg-kumo-recessed hover:text-kumo-default'
                    }`}
                  >
                    <Icon weight={active ? 'fill' : 'regular'} className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-kumo-line p-3">
        <a
          href="https://github.com/ZHYxulei/iLink-Router"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-kumo-subtle transition-colors hover:bg-kumo-recessed hover:text-kumo-default"
        >
          <GithubLogo className="h-3.5 w-3.5" />
          GitHub
        </a>
      </div>
    </>
  );
}
