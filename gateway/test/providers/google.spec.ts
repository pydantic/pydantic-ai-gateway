import { GoogleGenAI } from '@google/genai'
import { describe, expect } from 'vitest'
import { test } from '../setup'

describe('google', () => {
  // TODO(Marcelo): When Google supports `fetch` parameter, we can fix this: https://github.com/googleapis/js-genai/issues/999
  test.fails('google-vertex/default', async ({ gateway }) => {
    const { otelBatch } = gateway

    // The `authToken` is passed as `Authorization` header with the anthropic client.
    const client = new GoogleGenAI({
      apiKey: 'healthy',
      httpOptions: { baseUrl: 'https://example.com/google-vertex' },
    })

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'What is the capital of france?',
      config: { maxOutputTokens: 1024, topP: 0.95, topK: 1, temperature: 0.5, stopSequences: ['potato'] },
    })

    expect(response).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
