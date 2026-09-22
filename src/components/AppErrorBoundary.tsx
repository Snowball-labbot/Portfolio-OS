import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message?: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Portfolio OS page failed to render:', error, errorInfo);
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'portfolio-os-error',
        message: error.message || '页面组件渲染失败',
      }, '*');
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <section className="w-full max-w-md rounded-lg border border-ink-100 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-ink-950">页面加载失败</h1>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            研究页面的前端模块没有成功加载。请刷新资产投研页面后重试，已有资产数据不会受影响。
          </p>
          {this.state.message && (
            <p className="mt-3 break-words text-xs leading-5 text-red-600">{this.state.message}</p>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-ink-950 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
          >
            重新加载页面
          </button>
        </section>
      </main>
    );
  }
}
