import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  apply,
  createRpcHandler,
  isLoopbackUrl,
  NativeRuntimeService,
  redact,
  resolveCookieEnvironment,
} from '../index.js'

const CONFIGURED_PORT = 41731
const COMPATIBLE_RUNTIME = Object.freeze({
  runtime: 'native-sqlite',
  api_version: 1,
  cookie_samesite: 'none',
  cookie_secure: true,
})

class FakeChild extends EventEmitter {
  kill() {
    this.emit('exit', 0)
    return true
  }
}

/** Fake host with per-port runtime state. */
function harness({ runtimes = {}, ...config } = {}) {
  const state = { ...runtimes }
  const launches = []
  const fetch = async (url) => {
    const target = new URL(url)
    const runtime = state[target.port] ?? {}
    if (target.pathname === '/api/health') {
      const ok = runtime.healthy === true
      return { ok, json: async () => ({ ok }) }
    }
    if (target.pathname === '/api/runtime/capabilities') {
      if (runtime.capabilities === undefined) return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => runtime.capabilities }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }
  const service = new NativeRuntimeService({
    sourceDir: 'C:\\portfolio-os',
    pythonExecutable: 'python',
    startupTimeoutSeconds: 20,
    ...config,
  }, {
    fetch,
    reservePort: async (preferred) => (state[preferred]?.healthy === true ? preferred + 1 : preferred),
    spawn: (command, args, options) => {
      launches.push({ command, args, options })
      state[Number(args[args.indexOf('--port') + 1])] = { healthy: true, capabilities: COMPATIBLE_RUNTIME }
      return new FakeChild()
    },
  })
  return { service, launches, state }
}

function fakeRequest({ method = 'POST', url = '/dsh-portfolio-os/status', headers = { 'content-type': 'application/json' }, body = '' } = {}) {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.headers = headers
  setImmediate(() => {
    if (body !== '') request.emit('data', Buffer.from(body))
    request.emit('end')
  })
  return request
}

function fakeResponse() {
  const response = { statusCode: undefined, body: '', ended: false }
  response.writeHead = (status) => {
    response.statusCode = status
    return response
  }
  response.end = (chunk) => {
    if (chunk !== undefined) response.body += String(chunk)
    response.ended = true
    return response
  }
  return response
}

function envelope(endpoint, payload = {}) {
  return JSON.stringify({ type: 'client-request', rpcId: 'rpc-test', method: endpoint, payload })
}

test('only loopback URLs are accepted', () => {
  assert.equal(isLoopbackUrl('http://localhost:41731'), true)
  assert.equal(isLoopbackUrl('http://127.0.0.1:41731/api/health'), true)
  assert.equal(isLoopbackUrl('https://example.com'), false)
})

test('status output redacts secrets', () => {
  assert.equal(redact('Authorization: Bearer abc123').includes('abc123'), false)
  assert.equal(redact('api_key=secret-value').includes('secret-value'), false)
})

test('embedded hosts resolve a cross-site session cookie policy', () => {
  assert.deepEqual(resolveCookieEnvironment({}), {
    SESSION_COOKIE_SAMESITE: 'none',
    SESSION_COOKIE_SECURE: 'true',
  })
  assert.equal(resolveCookieEnvironment({ SESSION_COOKIE_SAMESITE: 'strict' }).SESSION_COOKIE_SAMESITE, 'strict')
  assert.equal(resolveCookieEnvironment({ SESSION_COOKIE_SECURE: 'false' }).SESSION_COOKIE_SECURE, 'false')
})

test('warm start reuses an already running runtime', async () => {
  const { service, launches } = harness({ runtimes: { [CONFIGURED_PORT]: { healthy: true, capabilities: COMPATIBLE_RUNTIME } } })
  const status = await service.start()
  assert.equal(status.phase, 'ready')
  assert.equal(launches.length, 0)
  assert.equal(status.frontendUrl, `http://127.0.0.1:${CONFIGURED_PORT}`)
})

test('cold start launches source runtime without Docker', async () => {
  const { service, launches } = harness()
  const status = await service.start()
  assert.equal(status.phase, 'ready')
  assert.equal(launches.length, 1)
  assert.equal(launches[0].command, 'python')
  assert.deepEqual(launches[0].args.slice(0, 2), ['-m', 'marketplace_runtime.launcher'])
  const invocation = `${launches[0].command} ${launches[0].args.join(' ')}`.toLowerCase()
  assert.equal(invocation.includes('docker'), false)
})

test('a runtime from an older build is not reused', async () => {
  const { service, launches } = harness({ runtimes: { [CONFIGURED_PORT]: { healthy: true } } })
  const status = await service.start()
  assert.equal(status.phase, 'ready')
  assert.equal(launches.length, 1)
  assert.equal(launches[0].args[launches[0].args.indexOf('--port') + 1], String(CONFIGURED_PORT + 1))
  assert.equal(status.frontendUrl, `http://127.0.0.1:${CONFIGURED_PORT + 1}`)
})

test('a runtime that reports a lax cookie is not reused', async () => {
  const lax = { ...COMPATIBLE_RUNTIME, cookie_samesite: 'lax', cookie_secure: false }
  const { service, launches } = harness({ runtimes: { [CONFIGURED_PORT]: { healthy: true, capabilities: lax } } })
  const status = await service.start()
  assert.equal(status.phase, 'ready')
  assert.equal(launches.length, 1)
})

test('embedded cookie requirements can be relaxed explicitly', async () => {
  const legacy = { healthy: true }
  const { service, launches } = harness({ embeddedCookies: false, runtimes: { [CONFIGURED_PORT]: legacy } })
  const status = await service.start()
  assert.equal(status.phase, 'ready')
  assert.equal(launches.length, 0)
})

test('launched runtimes inherit the embedded cookie policy', async () => {
  const { service, launches } = harness()
  await service.start()
  assert.equal(launches[0].options.env.SESSION_COOKIE_SAMESITE, 'none')
  assert.equal(launches[0].options.env.SESSION_COOKIE_SECURE, 'true')
})

test('an operator supplied cookie policy wins over the embedded default', async () => {
  const previous = process.env.SESSION_COOKIE_SAMESITE
  process.env.SESSION_COOKIE_SAMESITE = 'strict'
  try {
    const { service, launches } = harness()
    await service.start()
    assert.equal(launches[0].options.env.SESSION_COOKIE_SAMESITE, 'strict')
  } finally {
    if (previous === undefined) delete process.env.SESSION_COOKIE_SAMESITE
    else process.env.SESSION_COOKIE_SAMESITE = previous
  }
})

test('snapshot exposes no environment values', () => {
  const { service } = harness()
  const snapshot = service.snapshot()
  assert.equal(snapshot.runtime, 'native-sqlite')
  assert.equal(Object.hasOwn(snapshot, 'environment'), false)
  assert.equal(Object.hasOwn(snapshot, 'apiKey'), false)
})

test('the rpc channel answers with the Connection response envelope', async () => {
  const handler = createRpcHandler({ checkStatus: async () => ({ phase: 'ready' }) })
  const response = fakeResponse()
  await handler(fakeRequest({ body: envelope('status') }), response)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(JSON.parse(response.body), {
    type: 'server-response',
    rpcId: 'rpc-test',
    result: { ok: true, value: { phase: 'ready' } },
  })
})

test('the rpc channel rejects unknown transport shapes', async () => {
  const handler = createRpcHandler({ checkStatus: async () => ({ phase: 'ready' }) })
  const wrongMethod = fakeResponse()
  await handler(fakeRequest({ method: 'GET' }), wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)

  const wrongType = fakeResponse()
  await handler(fakeRequest({ headers: { 'content-type': 'text/plain' } }), wrongType)
  assert.equal(wrongType.statusCode, 415)
})

test('failures keep the error envelope the client validates', async () => {
  const handler = createRpcHandler({ checkStatus: async () => ({ phase: 'ready' }) })
  const response = fakeResponse()
  await handler(fakeRequest({ url: '/dsh-portfolio-os/unknown-op', body: envelope('unknown-op') }), response)
  const payload = JSON.parse(response.body)
  assert.equal(payload.result.ok, false)
  assert.equal(typeof payload.result.error.message, 'string')
  assert.deepEqual(payload.result.error.details, {})
})

test('apply publishes the channel on the web server', () => {
  const routes = []
  const ctx = {
    connection: { admit: () => ({ rejection: 401 }) },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  const dispose = apply(ctx, { autoStart: false })
  try {
    assert.equal(routes.length, 1)
    assert.equal(routes[0].kind, 'prefix')
    assert.equal(routes[0].path, '/dsh-portfolio-os')
  } finally {
    dispose()
  }
})

test('apply enforces the Connection admission fence', async () => {
  const routes = []
  const ctx = {
    connection: { admit: () => ({ rejection: 401 }) },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  const dispose = apply(ctx, { autoStart: false })
  try {
    const response = fakeResponse()
    await routes[0].handler(fakeRequest({ body: envelope('status') }), response)
    assert.equal(response.statusCode, 401)
  } finally {
    dispose()
  }
})

test('the full-screen surface reserves the Desktop caption area', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /top:var\(--dsh-desktop-content-top/)
  assert.match(source, /height:var\(--dsh-desktop-content-height/)
})
