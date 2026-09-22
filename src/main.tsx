import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './index.css'

const isEmbedded = window.parent !== window

const notifyParent = (message: Record<string, unknown>) => {
  if (isEmbedded) window.parent.postMessage(message, '*')
}

window.addEventListener('error', (event) => {
  if (!event.error && !event.message) return
  notifyParent({
    type: 'portfolio-os-error',
    message: event.message || '前端资源加载异常',
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || '')
  notifyParent({
    type: 'portfolio-os-error',
    message: reason || '异步任务执行异常',
  })
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  notifyParent({ type: 'portfolio-os-error', message: '找不到前端根节点' })
  throw new Error('Portfolio OS root element is missing')
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  )
  requestAnimationFrame(() => notifyParent({ type: 'portfolio-os-ready' }))
} catch (error) {
  notifyParent({
    type: 'portfolio-os-error',
    message: error instanceof Error ? error.message : '前端启动失败',
  })
  throw error
}
