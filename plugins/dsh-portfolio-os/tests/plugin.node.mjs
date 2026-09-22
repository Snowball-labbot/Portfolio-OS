import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { isLoopbackUrl, NativeRuntimeService, redact } from '../index.js'

class FakeChild extends EventEmitter {
  kill() {
    this.emit('exit', 0)
    return true
  }
}

function harness({ ready = false } = {}) {
  let healthy = ready
  const launches = []
  const service = new NativeRuntimeService({
    sourceDir: 'C:\\portfolio-os',
    pythonExecutable: 'python',
    startupTimeoutSeconds: 20,
  }, {
    fetch: async () => ({ ok: healthy, json: async () => ({ ok: healthy }) }),
    spawn: (command, args, options) => {
      launches.push({ command, args, options })
      healthy = true
      return new FakeChild()
    },
  })
  return { service, launches }
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

test('warm start reuses an already running runtime', async () => {
  const { service, launches } = harness({ ready: true })
  const status = await service.start()
  assert.equal(status.phase, 'ready')
  assert.equal(launches.length, 0)
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

test('snapshot exposes no environment values', () => {
  const { service } = harness()
  const snapshot = service.snapshot()
  assert.equal(snapshot.runtime, 'native-sqlite')
  assert.equal(Object.hasOwn(snapshot, 'environment'), false)
  assert.equal(Object.hasOwn(snapshot, 'apiKey'), false)
})
