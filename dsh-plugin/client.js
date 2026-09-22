// DSH client plugin bundle for dsh-portfolio-os.
// Portfolio OS is mounted as a top-level application surface, not as a
// conversation tab. The DSH shell remains underneath and is restored on exit.
window.__ModuleLoader__.load({
  id: 'dsh-portfolio-os',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;
    var CHANNEL = '/dsh-portfolio-os';
    var DEFAULT_URL = 'http://127.0.0.1:41731';

    function unwrap(response) {
      if (response && response.ok === false) {
        throw new Error((response.error && response.error.message) || 'Portfolio OS Host request failed');
      }
      if (response && response.ok === true) return response.value;
      return response;
    }

    function createButton(label, title) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title || label;
      button.style.cssText = [
        'height:30px', 'padding:0 11px', 'border:1px solid #d7dde5',
        'border-radius:5px', 'background:#fff', 'color:#334155',
        'font:600 13px/1 system-ui,sans-serif', 'cursor:pointer',
      ].join(';');
      return button;
    }

    function PortfolioShell(rpc) {
      this.rpc = rpc;
      this.status = null;
      this.poller = null;
      this.previousOverflow = '';
      this.lastTrigger = null;
      this.root = null;
      this.iframe = null;
      this.statusText = null;
      this.statusDot = null;
      this.loading = null;
      this.retryButton = null;
      this.restartButton = null;
      this.reloadButton = null;
      this.iframeLoaded = false;
      this.frameBaseUrl = null;
      this.iframeLoadTimer = null;
      this.frameOrigin = null;
      this.iframeAppReady = false;
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onIframeLoad = this.onIframeLoad.bind(this);
      this.onIframeError = this.onIframeError.bind(this);
      this.onFrameMessage = this.onFrameMessage.bind(this);
      this.mount();
    }

    PortfolioShell.prototype.mount = function () {
      if (this.root) return;
      var root = document.createElement('section');
      root.setAttribute('data-dsh-portfolio-app', '');
      root.setAttribute('aria-hidden', 'true');
      root.style.cssText = [
        'display:none', 'position:fixed', 'inset:0', 'z-index:2147483000',
        'width:100vw', 'height:100vh', 'min-width:980px', 'background:#f4f6f8',
        'color:#111827', 'box-sizing:border-box', 'overflow:hidden',
        'flex-direction:column', 'font:13px/1.4 system-ui,sans-serif',
      ].join(';');

      var toolbar = document.createElement('header');
      toolbar.setAttribute('data-dsh-portfolio-toolbar', '');
      toolbar.style.cssText = [
        'display:flex', 'align-items:center', 'gap:10px', 'height:42px',
        'min-height:42px', 'padding:0 12px', 'box-sizing:border-box',
        'border-bottom:1px solid #e5e7eb', 'background:#fff',
      ].join(';');

      var back = createButton('← 返回 DSH', '关闭资产投研并返回 DSH');
      back.addEventListener('click', this.close.bind(this));
      var divider = document.createElement('span');
      divider.style.cssText = 'width:1px;height:20px;background:#e5e7eb;flex:none';
      var title = document.createElement('strong');
      title.textContent = '资产投研';
      title.style.cssText = 'font-size:14px;letter-spacing:0;white-space:nowrap';
      var dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#94a3b8;flex:none';
      this.statusDot = dot;
      var statusText = document.createElement('span');
      statusText.textContent = '正在读取服务状态';
      statusText.style.cssText = 'color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      this.statusText = statusText;

      var actions = document.createElement('span');
      actions.style.cssText = 'display:flex;gap:7px;margin-left:auto;flex:none';
      var retry = createButton('重试启动');
      var restart = createButton('重启服务');
      var reload = createButton('刷新页面', '重新加载资产投研网页');
      retry.addEventListener('click', this.action.bind(this, 'start'));
      restart.addEventListener('click', this.action.bind(this, 'restart'));
      reload.addEventListener('click', this.reloadFrame.bind(this));
      actions.append(retry, restart, reload);
      this.retryButton = retry;
      this.restartButton = restart;
      this.reloadButton = reload;
      toolbar.append(back, divider, title, dot, statusText, actions);

      var stage = document.createElement('div');
      stage.style.cssText = 'position:relative;display:flex;flex:1;min-height:0;background:#fff';
      var loading = document.createElement('div');
      loading.style.cssText = [
        'position:absolute', 'inset:0', 'display:flex', 'align-items:center',
        'justify-content:center', 'padding:32px', 'box-sizing:border-box',
        'text-align:center', 'color:#64748b', 'background:#f4f6f8', 'z-index:1',
      ].join(';');
      loading.textContent = '正在启动本地资产投研服务...';
      this.loading = loading;
      var iframe = document.createElement('iframe');
      iframe.title = 'Portfolio OS 资产投研平台';
      iframe.allow = 'clipboard-read; clipboard-write';
      iframe.style.cssText = 'display:none;width:100%;height:100%;min-height:0;border:0;background:#fff';
      iframe.addEventListener('load', this.onIframeLoad);
      iframe.addEventListener('error', this.onIframeError);
      window.addEventListener('message', this.onFrameMessage);
      this.iframe = iframe;
      stage.append(loading, iframe);
      root.append(toolbar, stage);
      document.body.append(root);
      this.root = root;
    };

    PortfolioShell.prototype.setStatus = function (status) {
      this.status = status || {};
      var phase = this.status.phase || 'checking';
      var ready = phase === 'ready';
      var failed = phase === 'error';
      this.root.setAttribute('data-phase', phase);
      this.statusDot.style.background = ready ? '#10b981' : failed ? '#ef4444' : '#94a3b8';
      this.statusText.textContent = this.status.message || (ready ? '资产投研已就绪' : '正在启动服务');
      this.retryButton.style.display = failed ? '' : 'none';
      this.restartButton.style.display = ready || failed ? '' : 'none';
      this.reloadButton.style.display = ready || failed ? '' : 'none';
      if (ready || (this.iframeAppReady && !failed)) {
        var nextUrl = this.status.frontendUrl || DEFAULT_URL;
        if (ready && (this.frameBaseUrl !== nextUrl || this.iframe.getAttribute('src') === 'about:blank')) {
          this.loadFrame(nextUrl);
        }
        this.iframe.style.display = 'block';
        this.loading.style.display = this.iframeAppReady ? 'none' : 'flex';
      } else {
        this.iframe.style.display = 'none';
        this.loading.style.display = 'flex';
        this.loading.textContent = failed
          ? (this.status.message || 'Portfolio OS 启动失败')
          : '正在启动本地资产投研 Runtime...';
      }
    };

    PortfolioShell.prototype.loadFrame = function (baseUrl) {
      if (!this.iframe) return;
      if (this.iframeLoadTimer) clearTimeout(this.iframeLoadTimer);
      this.iframeLoadTimer = null;
      this.frameBaseUrl = baseUrl || DEFAULT_URL;
      try {
        this.frameOrigin = new URL(this.frameBaseUrl).origin;
      } catch {
        this.frameOrigin = null;
      }
      this.iframeLoaded = false;
      this.iframeAppReady = false;
      // DSH can keep the old Vite entry document in its webview cache. A
      // short-lived query value ensures a rebuilt lazy chunk graph is used.
      var separator = this.frameBaseUrl.indexOf('?') === -1 ? '?' : '&';
      var frameUrl = this.frameBaseUrl + separator + 'dsh_reload=' + Date.now();
      this.iframe.style.display = 'block';
      this.loading.style.display = 'flex';
      this.loading.textContent = '正在加载资产投研页面...';
      this.iframe.setAttribute('src', frameUrl);
      this.iframeLoadTimer = setTimeout(() => {
        this.iframeLoadTimer = null;
        if (!this.iframeAppReady && this.root && this.root.style.display !== 'none') {
          this.loading.style.display = 'flex';
          this.loading.textContent = this.iframeLoaded
            ? '资产投研页面未完成初始化，请点击“刷新页面”重试。'
            : '资产投研页面加载超时，请点击“刷新页面”重试。';
        }
      }, 15_000);
    };

    PortfolioShell.prototype.onIframeLoad = function () {
      if (!this.frameBaseUrl || this.iframe.getAttribute('src') === 'about:blank') return;
      this.iframeLoaded = true;
      this.root.setAttribute('data-frame-phase', 'loaded');
      this.root.setAttribute('data-frame-phase', this.iframeAppReady ? 'ready' : 'document-loaded');
      if (!this.iframeAppReady) {
        this.loading.style.display = 'flex';
        this.loading.textContent = '页面资源已加载，正在初始化资产投研...';
      }
    };

    PortfolioShell.prototype.onIframeError = function () {
      this.iframeLoaded = false;
      this.root.setAttribute('data-frame-phase', 'error');
      this.loading.style.display = 'flex';
      this.loading.textContent = '资产投研页面加载失败，请点击“刷新页面”重试。';
    };

    PortfolioShell.prototype.onFrameMessage = function (event) {
      if (!this.iframe || event.source !== this.iframe.contentWindow) return;
      if (this.frameOrigin && event.origin !== this.frameOrigin) return;
      var data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'portfolio-os-ready') {
        this.iframeAppReady = true;
        this.root.setAttribute('data-frame-phase', 'ready');
        this.loading.style.display = 'none';
        if (this.iframeLoadTimer) clearTimeout(this.iframeLoadTimer);
        this.iframeLoadTimer = null;
        return;
      }
      if (data.type === 'portfolio-os-error') {
        this.iframeAppReady = false;
        this.root.setAttribute('data-frame-phase', 'error');
        this.loading.style.display = 'flex';
        var detail = typeof data.message === 'string' ? data.message.trim() : '';
        this.loading.textContent = detail
          ? '资产投研页面初始化失败：' + detail + '。请点击“刷新页面”重试。'
          : '资产投研页面初始化失败，请点击“刷新页面”重试。';
        if (this.iframeLoadTimer) clearTimeout(this.iframeLoadTimer);
        this.iframeLoadTimer = null;
      }
    };

    PortfolioShell.prototype.reloadFrame = function () {
      if (!this.status || this.status.phase !== 'ready') {
        this.action('start');
        return;
      }
      this.loadFrame(this.status.frontendUrl || DEFAULT_URL);
    };

    PortfolioShell.prototype.resetFrame = function () {
      if (this.iframeLoadTimer) clearTimeout(this.iframeLoadTimer);
      this.iframeLoadTimer = null;
      this.iframeLoaded = false;
      this.iframeAppReady = false;
      this.frameBaseUrl = null;
      this.frameOrigin = null;
      if (this.iframe) this.iframe.setAttribute('src', 'about:blank');
    };

    PortfolioShell.prototype.request = function (endpoint) {
      if (!this.rpc) return Promise.reject(new Error('DSH Host connection is unavailable'));
      return this.rpc.call(CHANNEL, endpoint, {}).then(unwrap);
    };
    PortfolioShell.prototype.refresh = function () {
      var self = this;
      return this.request('status').then(function (status) {
        self.setStatus(status);
        return status;
      }).catch(function (error) {
        if (self.iframeAppReady) {
          self.statusDot.style.background = '#f59e0b';
          self.statusText.textContent = '状态检查暂时失败，已打开的页面仍可使用';
          return;
        }
        self.setStatus({ phase: 'error', message: error && error.message ? error.message : String(error) });
      });
    };
    PortfolioShell.prototype.action = function (endpoint) {
      var self = this;
      this.resetFrame();
      this.setStatus({ phase: 'starting_services', message: endpoint === 'restart' ? '正在重启服务' : '正在启动服务' });
      return this.request(endpoint).then(function (status) {
        self.setStatus(status);
      }).catch(function (error) {
        self.setStatus({ phase: 'error', message: error && error.message ? error.message : String(error) });
      });
    };
    PortfolioShell.prototype.open = function (trigger) {
      if (this.root.style.display === 'flex') return;
      this.lastTrigger = trigger || document.activeElement;
      this.previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      if (!this.iframeAppReady) {
        this.resetFrame();
        this.loading.style.display = 'flex';
        this.loading.textContent = '正在启动本地资产投研服务...';
      }
      this.root.style.display = 'flex';
      this.root.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', this.onKeyDown);
      this.refresh();
      if (!this.poller) this.poller = setInterval(this.refresh.bind(this), 15000);
    };
    PortfolioShell.prototype.close = function () {
      this.root.style.display = 'none';
      this.root.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = this.previousOverflow;
      document.removeEventListener('keydown', this.onKeyDown);
      if (this.poller) clearInterval(this.poller);
      this.poller = null;
      if (this.lastTrigger && this.lastTrigger.focus) this.lastTrigger.focus();
    };
    PortfolioShell.prototype.onKeyDown = function (event) {
      if (event.key === 'Escape') this.close();
    };
    PortfolioShell.prototype.dispose = function () {
      this.close();
      this.resetFrame();
      window.removeEventListener('message', this.onFrameMessage);
      if (this.root) this.root.remove();
      this.root = null;
    };

    function Sidebar(props) {
      var wide = Boolean(props && props.wide);
      var open = function (event) {
        if (props && props.openPortfolio) props.openPortfolio(event.currentTarget);
      };
      return h('div', { className: 'dsh-portfolio-sidebar-row', 'data-wide': wide || undefined },
        h('button', { type: 'button', onClick: open, title: '打开资产投研', 'aria-label': '资产投研' },
          h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'M3 3v18h18' }),
            h('path', { d: 'm7 15 4-4 3 3 5-7' })
          ),
          wide ? h('span', null, '资产投研') : null
        )
      );
    }

    function ensureStyles() {
      if (document.querySelector('style[data-dsh-portfolio-style]')) return;
      var style = document.createElement('style');
      style.setAttribute('data-dsh-portfolio-style', '');
      style.textContent = [
        '.dsh-portfolio-sidebar-row{display:block;box-sizing:border-box}',
        '.dsh-portfolio-sidebar-row>button{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;background:transparent;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left}',
        '.dsh-portfolio-sidebar-row>button:hover{background:rgba(127,127,127,.13)}',
        '.dsh-portfolio-sidebar-row>button svg{width:18px;height:18px;flex:none}',
        '.dsh-portfolio-sidebar-row>button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      ].join('\n');
      document.head.append(style);
    }

    var inject = ['connection', 'slots'];
    function apply(ctx) {
      var rpc = (ctx.connection && ctx.connection.rpc) || null;
      var shell = new PortfolioShell(rpc);
      ctx.effect(function () {
        ensureStyles();
        return function () {
          var style = document.querySelector('style[data-dsh-portfolio-style]');
          if (style) style.remove();
          shell.dispose();
        };
      }, 'portfolio-os: application surface');

      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'portfolio-os',
            order: 50,
            inject: function () {
              return { openPortfolio: function (trigger) { shell.open(trigger); } };
            },
          },
          Sidebar
        );
      });
    }

    exports.name = 'dsh-portfolio-os-client';
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
