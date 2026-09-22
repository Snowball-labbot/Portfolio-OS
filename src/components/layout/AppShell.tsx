import { useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, Gem, LibraryBig, Menu, Newspaper, PieChart, Radar, Target, X } from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { formatCompactCny } from '@/lib/format';
import { cn } from '@/lib/utils';

export type WorkspaceView = 'networth' | 'assets' | 'research' | 'market' | 'macro' | 'industry' | 'quant' | 'library' | 'strategy' | 'detail';
export type NavigableView = Exclude<WorkspaceView, 'detail'>;

interface AppShellProps {
  activeView: WorkspaceView;
  title: string;
  subtitle?: string;
  totalValue: number;
  assetCount: number;
  onNavigate: (view: NavigableView) => void;
  actions?: ReactNode;
  mobileActions?: ReactNode;
  children: ReactNode;
}

const navItems = [
  { value: 'networth' as const, label: '净资产', helper: 'Net Worth', icon: PieChart },
  { value: 'assets' as const, label: '资产', helper: 'Assets', icon: Gem },
];

const researchNavItems = [
  { value: 'research' as const, label: '每日研究', helper: 'Research Desk', icon: Newspaper },
  { value: 'market' as const, label: '市场观察', helper: 'Market Watch', icon: Radar },
  { value: 'library' as const, label: '研究库', helper: 'Research Library', icon: LibraryBig },
];

export function AppShell({
  activeView,
  title,
  subtitle,
  totalValue,
  assetCount,
  onNavigate,
  actions,
  mobileActions,
  children,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, signOut } = useAuthStore();
  const navActive = activeView === 'detail' ? 'assets' : activeView;

  const navigate = (view: NavigableView) => {
    onNavigate(view);
    setMobileMenuOpen(false);
  };

  const sidebar = (
    <>
      <div className="flex h-[72px] items-center border-b border-ink-100 px-4">
        <button
          type="button"
          onClick={() => navigate('networth')}
          className="flex min-w-0 items-center gap-3 text-left"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-ink-950 text-sm font-bold text-white">
            A
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink-950">资产全景</span>
            <span className="block truncate text-[11px] uppercase text-ink-400">Portfolio OS</span>
          </span>
        </button>
      </div>

      <nav className="space-y-1 px-2.5 py-4" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = navActive === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => navigate(item.value)}
              className={cn(
                'group flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors',
                active ? 'bg-ink-950 text-white' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-950',
              )}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className={cn('block text-[11px]', active ? 'text-white/55' : 'text-ink-400')}>
                  {item.helper}
                </span>
              </span>
              {item.value === 'networth' && (
                <span className={cn('text-xs font-semibold', active ? 'text-white/80' : 'text-ink-500')}>
                  {formatCompactCny(totalValue)}
                </span>
              )}
              {item.value === 'assets' && (
                <span className={cn('text-xs', active ? 'text-white/60' : 'text-ink-400')}>{assetCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mx-2.5 border-t border-ink-100 pt-3">
        <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase text-ink-300">Research</div>
        <nav className="space-y-1" aria-label="投研导航">
          {researchNavItems.map((item) => {
            const Icon = item.icon;
            const active = navActive === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => navigate(item.value)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors',
                  active ? 'bg-ink-950 text-white' : 'text-ink-600 hover:bg-ink-50 hover:text-ink-950',
                )}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className={cn('block text-[11px]', active ? 'text-white/55' : 'text-ink-400')}>{item.helper}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {mobileActions && (
        <div className="mx-3 grid grid-cols-2 gap-2 border-t border-ink-100 pt-4 lg:hidden">
          {mobileActions}
        </div>
      )}

      <div className="mx-2.5 mt-3 border-t border-ink-100 pt-3">
        <button
          type="button"
          onClick={() => navigate('strategy')}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left transition-colors',
            navActive === 'strategy'
              ? 'bg-brand-50 text-brand-700'
              : 'text-ink-600 hover:bg-ink-50 hover:text-ink-950',
          )}
        >
          <Target size={18} strokeWidth={1.8} />
          <span>
            <span className="block text-sm font-semibold">配置策略</span>
            <span className="block text-[11px] text-ink-400">Strategy Lab</span>
          </span>
        </button>
      </div>

      <div className="mt-auto border-t border-ink-100 p-3">
        <div className="mb-3 rounded-md bg-ink-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-700">
            <Bot size={14} />
            AI 策略助手
          </div>
          <p className="mt-1 text-[11px] leading-5 text-ink-400">在配置策略页生成建议、报告或识别持仓截图。</p>
        </div>
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white">
            {user?.email?.slice(0, 1).toUpperCase() || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink-800">{user?.email}</div>
            <button
              type="button"
              onClick={() => signOut()}
              className="mt-0.5 text-[11px] text-ink-400 hover:text-red-600"
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[230px] flex-col border-r border-ink-100 bg-white lg:flex">
        {sidebar}
      </aside>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="关闭导航"
            className="absolute inset-0 bg-ink-950/35 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative flex h-full w-[286px] flex-col bg-white shadow-2xl">
            <button
              type="button"
              aria-label="关闭导航"
              onClick={() => setMobileMenuOpen(false)}
              className="absolute right-3 top-6 z-10 rounded-md p-2 text-ink-400 hover:bg-ink-50"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-[230px]">
        <header className="sticky top-0 z-20 flex min-h-[72px] items-center gap-4 border-b border-ink-100 bg-white/95 px-4 backdrop-blur md:px-5">
          <button
            type="button"
            aria-label="打开导航"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-md border border-ink-100 p-2 text-ink-600 hover:bg-ink-50 lg:hidden"
          >
            <Menu size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-ink-950 md:text-xl">{title}</h1>
            {subtitle && <p className="mt-0.5 truncate text-xs text-ink-400 md:text-sm">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </header>

        <main className="min-h-[calc(100vh-72px)]">{children}</main>
      </div>
    </div>
  );
}
