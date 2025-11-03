import { describe, expect } from 'vitest'
import { test } from '../setup'

describe('bedrock', () => {
  test('should call bedrock via gateway', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const result = await fetch('https://example.com/converse/model/amazon.nova-micro-v1%3A0/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'healthy' },
      body: JSON.stringify({
        modelId: 'amazon.nova-premier-v1:0',
        system: [{ text: 'You are a helpful assistant.' }],
        messages: [{ role: 'user', content: [{ text: 'What is the capital of France?' }] }],
      }),
    })

    const text = await result.text()
    const json = JSON.parse(text)

    expect(result.status).toBe(200)
    expect(json).toMatchSnapshot('bedrock')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
