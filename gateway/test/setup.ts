import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { gatewayFetch } from '@pydantic/ai-gateway'
import { test as baseTest, beforeAll, beforeEach, expect, vi } from 'vitest'
import SQL from '../limits-schema.sql?raw'
import { buildGatewayEnv, type DisableEvent } from './worker'

declare module 'vitest' {
  export interface TestContext {
    gateway: TestGateway
  }
}

vi.mock('../src/refreshGenaiPrices', () => ({ refreshGenaiPrices: vi.fn(() => Promise.resolve()) }))

beforeAll(async () => {
  try {
    const response = await fetch('http://localhost:8005')
    expect(response.status, 'The Proxy VCR seems to be facing issues, please check the logs.').toBe(204)
  } catch {
    throw new Error('Proxy VCR is not running. Run `make run-proxy-vcr` to enable tests.')
  }
})

const RESET_SQL = `\
DROP TABLE IF EXISTS spend;
DROP TABLE IF EXISTS keyStatus;

${SQL}`

beforeEach(async () => {
  await env.limitsDB.prepare(RESET_SQL).run()
})

interface TestGateway {
  fetch: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  subFetch: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  ctx: ExecutionContext
  otelBatch: string[]
  disableEvents: DisableEvent[]
}

function testGateway(): TestGateway {
  const ctx = createExecutionContext()
  const otelBatch: string[] = []
  const disableEvents: DisableEvent[] = []

  async function subFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let hostname: string
    if (url instanceof Request) {
      hostname = new URL(url.url).hostname
    } else {
      hostname = new URL(url).hostname
    }
    if (hostname === 'logfire.pydantic.dev') {
      const bodyArray = init?.body as Uint8Array
      otelBatch.push(new TextDecoder().decode(bodyArray))
      return new Response('OK', { status: 200 })
      // NOTE: Uncomment to create VCR cassettes for Google API calls locally!
    } else if (hostname === 'oauth2.googleapis.com') {
      // Mock GCP token response for tests
      return new Response(JSON.stringify({ access_token: 'mock-gcp-token' }), { status: 200 })
    } else {
      return await fetch(url, init)
    }
  }

  async function mockFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request<unknown, IncomingRequestCfProperties>(
      url,
      init as RequestInit<IncomingRequestCfProperties>,
    )
    const url_ = new URL(url instanceof Request ? url.url : url)
    const response = await gatewayFetch(request, url_, ctx, buildGatewayEnv(env, disableEvents, subFetch))
    await waitOnExecutionContext(ctx)
    return response
  }
  return { fetch: mockFetch, subFetch, ctx, otelBatch, disableEvents }
}

export const test = baseTest.extend<{ gateway: TestGateway }>({
  // biome-ignore lint/correctness/noEmptyPattern: required
  gateway: async ({}, use) => {
    await use(testGateway())
  },
})
