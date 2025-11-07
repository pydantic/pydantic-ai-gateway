import { EventStreamCodec } from '@smithy/eventstream-codec'
import { describe, expect } from 'vitest'
import { deserializeRequest } from '../otel'
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
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })

  test('bedrock/stream', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const result = await fetch('https://example.com/converse/model/amazon.nova-micro-v1%3A0/converse-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'healthy', 'x-vcr-filename': 'stream' },
      body: JSON.stringify({
        modelId: 'amazon.nova-premier-v1:0',
        system: [{ text: 'You are a helpful assistant.' }],
        messages: [{ role: 'user', content: [{ text: 'What is the capital of France?' }] }],
      }),
    })
    const chunks: string[] = []
    for await (const chunk of parseEventStream(result.body!)) {
      chunks.push(chunk)
    }
    expect(chunks).toMatchSnapshot('chunks')
    expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    expect(deserializeRequest(otelBatch[0]!)).toMatchSnapshot('span')
  })
})

async function* parseEventStream(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const encoder = new TextEncoder()
  const codec = new EventStreamCodec((str) => str, encoder.encode)
  const decoder = new TextDecoder()
  let buffer = new Uint8Array(0)

  for await (const chunk of stream) {
    const combined = new Uint8Array(buffer.length + chunk.length)
    combined.set(buffer, 0)
    combined.set(chunk, buffer.length)
    buffer = combined

    while (buffer.length >= 4) {
      const messageLength = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)
      if (buffer.length < messageLength) break

      const message = codec.decode(buffer.subarray(0, messageLength))
      if (message.body?.length > 0) {
        yield JSON.parse(decoder.decode(message.body))
      }
      buffer = buffer.subarray(messageLength)
    }
  }
}
