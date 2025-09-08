import { beforeAll, expect } from 'vitest'

export let proxyVcrRunning = false

beforeAll(async () => {
  try {
    const response = await fetch('http://localhost:8005')
    expect(response.status, 'The Proxy VCR seems to be facing issues, please check the logs.').toBe(204)
    proxyVcrRunning = true
  } catch {
    console.warn('⚠️ Proxy VCR is not running, skipping tests. Run `make run-proxy-vcr` to enable tests.')
  }
})
