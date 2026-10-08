import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))
const CHANNEL = '/dsh-portfolio-os'
const MAX_MESSAGE = 1_200
const DEFAULT_PORT = 41731
const CAPABILITIES_PATH = '/api/runtime/capabilities'

export const name = 'dsh-portfolio-os'
export const inject = ['connection', 'webServer']

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
    embeddedCookies: raw.embeddedCookies !== false,
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

export function reservePort(preferred) {
  const tryListen = (port) => new Promise((resolve) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () => {
      probe.close()
      resolve(undefined)
    })
    probe.listen(port, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : port))
    })
  })
  const wanted = Number.isInteger(preferred) && preferred > 0 && preferred < 65_536 ? preferred : 0
  return tryListen(wanted).then((port) => port ?? tryListen(0)).then((port) => {
    if (port === undefined) throw new Error('找不到可用的本机端口')
    return port
  })
}

/** Apply the cookie policy an embedded page needs, unless the operator already set one. */
export function resolveCookieEnvironment(environment) {
  const env = { ...environment }
  if (env.SESSION_COOKIE_SAMESITE === undefined) env.SESSION_COOKIE_SAMESITE = 'none'
  if (env.SESSION_COOKIE_SECURE === undefined) env.SESSION_COOKIE_SECURE = 'true'
  return env
}

function ok(value) {
  return { ok: true, value }
}

function fail(error) {
  return { ok: false, error: { code: 'internal', message: safeError(error), details: {} } }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function respondJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': String(body.length) })
  response.end(body)
}

/** Connection unary-RPC wire format for this channel. */
export function createRpcHandler(service) {
  return async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const endpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : undefined
    const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
    if (request.method !== 'POST') {
      response.writeHead(405)
      response.end()
      return
    }
    if (endpoint === undefined || !/^[A-Za-z0-9_$.-]+$/.test(endpoint)) {
      response.writeHead(404)
      response.end()
      return
    }
    if (contentType !== 'application/json') {
      response.writeHead(415)
      response.end()
      return
    }
    let rpcId = 'invalid-request'
    let result
    try {
      const body = JSON.parse(await readBody(request))
      if (body !== null && typeof body === 'object' && typeof body.rpcId === 'string') rpcId = body.rpcId
      if (body?.type !== 'client-request' || body.method !== endpoint) throw new Error(`资产投研收到非法请求：${endpoint}`)
      if (endpoint === 'status') result = ok(await service.checkStatus())
      else if (endpoint === 'start') result = ok(await service.start())
      else if (endpoint === 'restart') result = ok(await service.restart())
      else throw new Error(`未知的资产投研操作：${endpoint}`)
    } catch (error) {
      result = fail(error)
    }
    respondJson(response, 200, { type: 'server-response', rpcId, result })
  }
}

export class NativeRuntimeService {
  constructor(rawConfig = {}, adapters = {}) {
    this.config = normalizeConfig(rawConfig)
    this.fetch = adapters.fetch ?? globalThis.fetch
    this.spawn = adapters.spawn ?? spawn
    this.resolveRuntime = adapters.resolveRuntime ?? resolvePackagedRuntime
    this.reservePort = adapters.reservePort ?? reservePort
    this.now = adapters.now ?? (() => new Date())
    this.child = undefined
    this.port = undefined
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

  /** Resolved origin; may differ from the configured port. */
  baseUrl() {
    return `http://127.0.0.1:${this.port ?? this.config.port}`
  }

  snapshot() {
    const base = this.baseUrl()
    return {
      phase: this.phase,
      message: this.message,
      frontendUrl: base,
      healthUrl: `${base}/api/health`,
      runtime: 'native-sqlite',
      updatedAt: this.updatedAt,
    }
  }

  async _fetchJson(url) {
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(3_000) })
      if (!response.ok) return undefined
      return await response.json()
    } catch {
      return undefined
    }
  }

  /** Health plus capabilities; capabilities is undefined on older runtimes. */
  async _runtimeState(port) {
    const base = `http://127.0.0.1:${port}`
    const health = await this._fetchJson(`${base}/api/health`)
    if (health?.ok !== true) return { healthy: false, capabilities: undefined }
    return { healthy: true, capabilities: await this._fetchJson(`${base}${CAPABILITIES_PATH}`) }
  }

  /** Embedded pages need SameSite=None + Secure; treat unknown capabilities as unusable. */
  _cookiePolicyCompatible(capabilities) {
    if (!this.config.embeddedCookies) return true
    return capabilities?.cookie_samesite === 'none' && capabilities?.cookie_secure === true
  }

  async _readyForEmbedding() {
    const state = await this._runtimeState(this.port ?? this.config.port)
    return state.healthy && this._cookiePolicyCompatible(state.capabilities)
  }

  /** Reuse a compatible runtime on the configured port, otherwise take a port of our own. */
  async _resolvePort() {
    if (this.port !== undefined) return this.port
    const state = await this._runtimeState(this.config.port)
    this.port = state.healthy && this._cookiePolicyCompatible(state.capabilities)
      ? this.config.port
      : await this.reservePort(this.config.port)
    return this.port
  }

  async checkStatus() {
    const state = await this._runtimeState(this.port ?? this.config.port)
    if (state.healthy && this._cookiePolicyCompatible(state.capabilities)) {
      this._set('ready', '资产投研已就绪')
    } else if (state.healthy) {
      this._set('error', '检测到旧版本地运行时，嵌入页面无法维持登录；请点击「重启服务」。')
    } else if (this.phase === 'ready') {
      this._set('error', '本地 Runtime 已停止；资产数据仍保存在本机。')
    }
    return this.snapshot()
  }

  async _command() {
    if (this.config.runtimeExecutable) {
      const executable = await firstAccessible([path.resolve(this.config.runtimeExecutable)])
      if (!executable) throw new Error(`找不到配置的 Runtime：${this.config.runtimeExecutable}`)
      return { executable, args: ['--port', String(this.port ?? this.config.port), '--data-dir', this.config.dataDir], cwd: path.dirname(executable) }
    }

    const packaged = await this.resolveRuntime()
    if (packaged) {
      return { executable: packaged, args: ['--port', String(this.port ?? this.config.port), '--data-dir', this.config.dataDir], cwd: path.dirname(packaged) }
    }

    if (this.config.sourceDir) {
      return {
        executable: this.config.pythonExecutable,
        args: ['-m', 'marketplace_runtime.launcher', '--port', String(this.port ?? this.config.port), '--data-dir', this.config.dataDir],
        cwd: path.resolve(this.config.sourceDir),
      }
    }

    throw new Error('插件包中未找到 Windows Runtime。请重新安装插件，或在开发模式配置 sourceDir。')
  }

  async _launch() {
    const command = await this._command()
    const child = this.spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: this.config.embeddedCookies ? resolveCookieEnvironment(process.env) : { ...process.env },
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
      await this._resolvePort()
      if (await this._readyForEmbedding()) {
        this._set('ready', '资产投研已就绪')
        return this.snapshot()
      }
      this._set('starting_services', '正在启动本地资产投研 Runtime')
      await this._launch()
      const deadline = Date.now() + this.config.startupTimeoutSeconds * 1_000
      while (Date.now() < deadline) {
        if (await this._readyForEmbedding()) {
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
    } else if (this.port !== undefined) {
      // Do not reuse a port whose instance cannot serve the embedded page.
      const state = await this._runtimeState(this.port)
      if (!state.healthy || !this._cookiePolicyCompatible(state.capabilities)) this.port = undefined
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

  // connection.rpc.handle() resolves webServer from the Connection fiber, which does not inject
  // it on DSH 0.2 and throws "cannot get property ... without inject"; register the route here.
  const handler = createRpcHandler(service)
  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: CHANNEL,
    handler: (request, response) => {
      // Keep the Host/Origin + browser-auth fence the channel wrapper would have applied.
      if (typeof ctx.connection?.admit === 'function') {
        const admission = ctx.connection.admit(request)
        if (admission && admission.rejection !== undefined) {
          response.writeHead(admission.rejection)
          response.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
          return
        }
      }
      return handler(request, response)
    },
  })

  const timer = rawConfig.autoStart === false ? undefined : setTimeout(() => { void service.start() }, 150)
  return () => {
    if (timer) clearTimeout(timer)
    disposeRoute()
    service.dispose()
  }
}
