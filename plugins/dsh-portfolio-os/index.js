import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))
const CHANNEL = '/dsh-portfolio-os'
const MAX_MESSAGE = 1_200
const DEFAULT_PORT = 41731

export const name = 'dsh-portfolio-os'
export const inject = ['connection']

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export function isLoopbackUrl(value) {
  try {
    const url = new URL(value)
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function redact(value) {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE)
}

function normalizeConfig(raw = {}) {
  const port = Math.min(49_999, Math.max(10_240, Number(raw.port) || DEFAULT_PORT))
  const frontendUrl = String(raw.frontendUrl || `http://127.0.0.1:${port}`).trim()
  const healthUrl = String(raw.healthUrl || `${frontendUrl}/api/health`).trim()
  if (!isLoopbackUrl(frontendUrl) || !isLoopbackUrl(healthUrl)) {
    throw new Error('资产投研仅允许使用本机 loopback 地址。')
  }
  return {
    port,
    frontendUrl,
    healthUrl,
    runtimeExecutable: String(raw.runtimeExecutable || '').trim(),
    sourceDir: String(raw.sourceDir || '').trim(),
    pythonExecutable: String(raw.pythonExecutable || 'python').trim(),
    dataDir: String(raw.dataDir || path.join(process.env.LOCALAPPDATA || os.homedir(), 'PortfolioOS')).trim(),
    autoStart: raw.autoStart !== false,
    keepRunningOnExit: raw.keepRunningOnExit !== false,
    startupTimeoutSeconds: Math.min(300, Math.max(20, Number(raw.startupTimeoutSeconds) || 90)),
  }
}

async function firstAccessible(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue to the next packaged runtime layout.
    }
  }
  return undefined
}

export async function resolvePackagedRuntime() {
  if (process.platform !== 'win32') return undefined
  const bundled = await firstAccessible([
    path.join(PLUGIN_ROOT, 'vendor', 'portfolio-os-runtime.exe'),
    path.join(PLUGIN_ROOT, 'vendor', 'portfolio-os-runtime', 'portfolio-os-runtime.exe'),
  ])
  if (bundled) return bundled
  try {
    const packageJson = require.resolve('@snowball-labbot/portfolio-os-win32-x64/package.json')
    const packageRoot = path.dirname(packageJson)
    return firstAccessible([
      path.join(packageRoot, 'bin', 'portfolio-os-runtime.exe'),
      path.join(packageRoot, 'bin', 'portfolio-os-runtime', 'portfolio-os-runtime.exe'),
    ])
  } catch {
    return undefined
  }
}

function safeError(error) {
  return redact(error instanceof Error ? error.message : error) || '未知错误'
}

export class NativeRuntimeService {
  constructor(rawConfig = {}, adapters = {}) {
    this.config = normalizeConfig(rawConfig)
    this.fetch = adapters.fetch ?? globalThis.fetch
    this.spawn = adapters.spawn ?? spawn
    this.resolveRuntime = adapters.resolveRuntime ?? resolvePackagedRuntime
    this.now = adapters.now ?? (() => new Date())
    this.child = undefined
    this.startPromise = undefined
    this.phase = 'not_started'
    this.message = '尚未启动'
    this.updatedAt = this.now().toISOString()
  }

  _set(phase, message) {
    this.phase = phase
    this.message = safeError(message)
    this.updatedAt = this.now().toISOString()
  }

  snapshot() {
    return {
      phase: this.phase,
      message: this.message,
      frontendUrl: this.config.frontendUrl,
      healthUrl: this.config.healthUrl,
      runtime: 'native-sqlite',
      updatedAt: this.updatedAt,
    }
  }

  async _applicationReady() {
    try {
      const response = await this.fetch(this.config.healthUrl, { signal: AbortSignal.timeout(3_000) })
      if (!response.ok) return false
      const payload = await response.json()
      return payload?.ok === true
    } catch {
      return false
    }
  }

  async checkStatus() {
    if (await this._applicationReady()) {
      this._set('ready', '资产投研已就绪')
    } else if (this.phase === 'ready') {
      this._set('error', '本地 Runtime 已停止；资产数据仍保存在本机。')
    }
    return this.snapshot()
  }

  async _command() {
    if (this.config.runtimeExecutable) {
      const executable = await firstAccessible([path.resolve(this.config.runtimeExecutable)])
      if (!executable) throw new Error(`找不到配置的 Runtime：${this.config.runtimeExecutable}`)
      return { executable, args: ['--port', String(this.config.port), '--data-dir', this.config.dataDir], cwd: path.dirname(executable) }
    }

    const packaged = await this.resolveRuntime()
    if (packaged) {
      return { executable: packaged, args: ['--port', String(this.config.port), '--data-dir', this.config.dataDir], cwd: path.dirname(packaged) }
    }

    if (this.config.sourceDir) {
      return {
        executable: this.config.pythonExecutable,
        args: ['-m', 'marketplace_runtime.launcher', '--port', String(this.config.port), '--data-dir', this.config.dataDir],
        cwd: path.resolve(this.config.sourceDir),
      }
    }

    throw new Error('插件包中未找到 Windows Runtime。请重新安装插件，或在开发模式配置 sourceDir。')
  }

  async _launch() {
    const command = await this._command()
    const child = this.spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: { ...process.env },
      detached: false,
      windowsHide: true,
      shell: false,
      stdio: 'ignore',
    })
    this.child = child
    child.once('error', (error) => {
      if (this.child === child) {
        this.child = undefined
        this._set('error', `Runtime 启动失败：${safeError(error)}`)
      }
    })
    child.once('exit', (code) => {
      if (this.child === child) {
        this.child = undefined
        if (this.phase !== 'stopping') this._set('error', `Runtime 已退出（代码 ${code ?? 'unknown'}）`)
      }
    })
  }

  async start() {
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start().finally(() => { this.startPromise = undefined })
    return this.startPromise
  }

  async _start() {
    try {
      if (await this._applicationReady()) {
        this._set('ready', '资产投研已就绪')
        return this.snapshot()
      }
      this._set('starting_services', '正在启动本地资产投研 Runtime')
      await this._launch()
      const deadline = Date.now() + this.config.startupTimeoutSeconds * 1_000
      while (Date.now() < deadline) {
        if (await this._applicationReady()) {
          this._set('ready', '资产投研已就绪')
          return this.snapshot()
        }
        if (!this.child && this.phase === 'error') return this.snapshot()
        await delay(500)
      }
      throw new Error('本地 Runtime 启动超时，请查看 PortfolioOS 日志。')
    } catch (error) {
      this._set('error', safeError(error))
      return this.snapshot()
    }
  }

  async restart() {
    if (this.child) {
      this._set('stopping', '正在重启本地 Runtime')
      this.child.kill()
      this.child = undefined
      await delay(800)
    } else if (await this._applicationReady()) {
      this._set('ready', 'Runtime 已在后台运行；页面已重新连接')
      return this.snapshot()
    }
    return this.start()
  }

  dispose() {
    if (!this.config.keepRunningOnExit && this.child) {
      this._set('stopping', '正在停止本地 Runtime')
      this.child.kill()
      this.child = undefined
    }
  }
}

function ok(value) {
  return { ok: true, value }
}

function fail(error) {
  return { ok: false, error: { code: 'internal', message: safeError(error) } }
}

export function apply(ctx, rawConfig = {}) {
  let service
  try {
    service = new NativeRuntimeService(rawConfig)
  } catch (error) {
    const fallback = {
      phase: 'error',
      message: safeError(error),
      frontendUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
      healthUrl: `http://127.0.0.1:${DEFAULT_PORT}/api/health`,
      runtime: 'native-sqlite',
      updatedAt: new Date().toISOString(),
    }
    service = { snapshot: () => fallback, checkStatus: async () => fallback, start: async () => fallback, restart: async () => fallback, dispose: () => {} }
  }

  const disposeRpc = ctx.connection.rpc.handle(CHANNEL, async (endpoint) => {
    try {
      if (endpoint === 'status') return ok(await service.checkStatus())
      if (endpoint === 'start') return ok(await service.start())
      if (endpoint === 'restart') return ok(await service.restart())
      throw new Error(`未知的资产投研操作：${endpoint}`)
    } catch (error) {
      return fail(error)
    }
  })

  const timer = rawConfig.autoStart === false ? undefined : setTimeout(() => { void service.start() }, 150)
  return () => {
    if (timer) clearTimeout(timer)
    disposeRpc()
    service.dispose()
  }
}
