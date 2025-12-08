import { describe, expect } from 'vitest'
import { test } from './setup'

const requestBody = {
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'What is the capital of France?' }],
  max_completion_tokens: 1200,
}
const requestHeaders = {
  Authorization: 'cache-enabled',
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Accept-Encoding': 'deflate',
}

describe('cache', () => {
  test('should return MISS on first request', async ({ gateway }) => {
    const { fetch } = gateway

    const firstResponse = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    })
    expect(firstResponse.status).toBe(200)
    expect(Object.fromEntries(firstResponse.headers.entries())).toMatchInlineSnapshot(`
      {
        "content-length": "564",
        "content-type": "application/json",
        "pydantic-ai-gateway-price-estimate": "0.0008USD",
        "server": "uvicorn",
        "x-cache-status": "MISS",
      }
    `)

    const cachedResponse = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    })

    expect(cachedResponse.status).toBe(200)
    expect(Object.fromEntries(cachedResponse.headers.entries())).toMatchInlineSnapshot(`
      {
        "age": "0",
        "content-length": "564",
        "content-type": "application/json",
        "pydantic-ai-gateway-price-estimate": "0.0008USD",
        "server": "uvicorn",
        "x-cache-status": "HIT",
      }
    `)

    // Sleep to get a different age.
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const cachedResponse2 = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    })
    expect(Number(cachedResponse2.headers.get('Age'))).toBeGreaterThan(0)
  })

  test('should return BYPASS with cache-control: no-cache', async ({ gateway }) => {
    const { fetch } = gateway

    const response = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: { ...requestHeaders, 'Cache-Control': 'no-cache' },
      body: JSON.stringify(requestBody),
    })

    expect(response.headers.get('X-Cache-Status')).toBe('BYPASS')
  })

  test('should return BYPASS with cache-control: no-store', async ({ gateway }) => {
    const { fetch } = gateway

    const response = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: { ...requestHeaders, 'Cache-Control': 'no-store' },
      body: JSON.stringify(requestBody),
    })

    expect(response.headers.get('X-Cache-Status')).toBe('BYPASS')
  })

  test('should not cache streaming responses', async ({ gateway }) => {
    const { fetch } = gateway

    const response = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ ...requestBody, stream: true }),
    })
    expect(response.headers.get('X-Cache-Status')).toBe('MISS')
  })

  test('different request bodies should have different cache keys', async ({ gateway }) => {
    const { fetch } = gateway

    const response1 = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ ...requestBody, messages: [{ role: 'user', content: 'Message A' }] }),
    })
    expect(response1.headers.get('X-Cache-Status')).toBe('MISS')

    const response2 = await fetch('https://example.com/openai/chat/completions', {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ ...requestBody, messages: [{ role: 'user', content: 'Message B' }] }),
    })
    expect(response2.headers.get('X-Cache-Status')).toBe('MISS')

    const body1 = await response1.json()
    const body2 = await response2.json()
    expect(body1).not.toBe(body2)
  })
})
