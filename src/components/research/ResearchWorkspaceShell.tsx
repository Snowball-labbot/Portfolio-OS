import type { ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  FlaskConical,
  LibraryBig,
  Newspaper,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ResearchWorkspaceView = 'research' | 'market' | 'macro' | 'industry' | 'quant' | 'library';

interface ResearchWorkspaceShellProps {
  activeView: ResearchWorkspaceView;
  onNavigate: (view: ResearchWorkspaceView) => void;
  onBack: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

const tabs = [
  { value: 'research' as const, label: '每日研究', icon: Newspaper },
  { value: 'market' as const, label: '市场观察', icon: BarChart3 },
  { value: 'macro' as const, label: '宏观研究', icon: Activity },
  { value: 'industry' as const, label: '行业研究', icon: BookOpen },
  { value: 'quant' as const, label: '量化研究', icon: FlaskConical },
  { value: 'library' as const, label: '研究库', icon: LibraryBig },
];

export function ResearchWorkspaceShell({ activeView, onNavigate, onBack, children, actions }: ResearchWorkspaceShellProps) {
  return (
    <div className="min-h-screen bg-canvas text-ink-950">
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1280px] items-center gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-ink-950 text-[11px] font-bold text-white">R</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-ink-950">个人投研中心</div>
            </div>
          </div>
          <div className="ml-auto hidden text-xs text-ink-400 lg:block">事实采集自动化，研究结论由你确认</div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        <div className="border-t border-ink-50">
          <div className="mx-auto flex max-w-[1280px] items-center px-3 md:px-6">
            <button type="button" onClick={onBack} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-ink-200 px-2.5 text-xs font-semibold text-ink-700 hover:bg-ink-50">
              <ArrowLeft size={14} />资产全景
            </button>
            <div className="mx-3 h-5 w-px shrink-0 bg-ink-100" />
            <nav aria-label="投研栏目" className="custom-scrollbar flex min-w-0 flex-1 justify-center gap-1 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.value === activeView;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => onNavigate(tab.value)}
                    className={cn(
                      'relative inline-flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-semibold transition-colors',
                      active ? 'text-ink-950' : 'text-ink-400 hover:text-ink-800',
                    )}
                  >
                    <Icon size={16} strokeWidth={1.8} />{tab.label}
                    {active && <span className="absolute inset-x-3 bottom-0 h-0.5 bg-ink-950" />}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <main className="min-h-[calc(100vh-93px)]">{children}</main>
    </div>
  );
}
