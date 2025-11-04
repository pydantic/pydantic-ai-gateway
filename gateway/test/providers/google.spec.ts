import { describe, expect } from 'vitest'
import { test } from '../setup'

const body = JSON.stringify({
  contents: [{ parts: [{ text: "Samuel lived in London and was born on Jan 28th '87" }], role: 'user' }],
  systemInstruction: { parts: [{ text: 'Extract information about the person' }], role: 'user' },
  tools: [
    {
      functionDeclarations: [
        {
          description: 'The final response which ends this conversation',
          name: 'final_result',
          parameters: {
            properties: {
              name: { description: 'The name of the person.', type: 'STRING' },
              dob: {
                description: 'The date of birth of the person. MUST BE A VALID ISO 8601 date. (format: date)',
                type: 'STRING',
              },
              city: { description: 'The city where the person lives.', type: 'STRING' },
            },
            required: ['name', 'dob', 'city'],
            type: 'OBJECT',
          },
        },
      ],
    },
  ],
  toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['final_result'] } },
  generationConfig: { temperature: 0.5, topP: 0.9, stopSequences: ['potato'] },
})
const headers = {
  Authorization: 'healthy',
  'x-goog-api-client': 'google-genai-sdk/1.36.0 gl-python/3.13.0',
  'x-goog-api-key': 'unset',
  accept: '*/*',
  'accept-encoding': 'deflate',
  'content-type': 'application/json',
  'content-length': body.length.toString(),
  'user-agent':
    'pydantic-ai/1.0.19.dev5+b3b34f9, google-genai-sdk/1.36.0 gl-python/3.13.0 via Pydantic AI Gateway unknown, contact engineering@pydantic.dev',
  traceparent: '00-019a4effa21047ac31372f093cb8e712-8b60768281864a49-01',
}

describe('google', () => {
  // TODO(Marcelo): When Google supports `fetch` parameter, we can fix this: https://github.com/googleapis/js-genai/issues/999
  test('google-vertex/default', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const response = await fetch(
      'https://example.com/google-vertex/v1beta1/projects/pydantic-ai/locations/global/publishers/google/models/gemini-2.5-flash:generateContent?alt=sse',
      { method: 'POST', headers, body },
    )

    const content = await response.text()

    expect(content).toMatchSnapshot('llm')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })

  test('google-vertex/stream', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const response = await fetch(
      'https://example.com/google-vertex/v1beta1/projects/pydantic-ai/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      { method: 'POST', headers: { ...headers, 'x-vcr-filename': 'stream' }, body },
    )

    const chunks: object[] = []
    for await (const chunk of response.body!) {
      chunks.push(chunk)
    }

    expect(chunks).toMatchSnapshot('chunks')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
