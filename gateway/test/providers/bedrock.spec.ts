import '../polyfills'
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { describe } from 'vitest'
import { test } from '../setup'

describe.only('bedrock', () => {
  test('should call bedrock via gateway', async ({ gateway }) => {
    const { fetch, otelBatch } = gateway

    const client = new BedrockRuntimeClient({
      region: 'us-east-1',
      // Provide dummy credentials to bypass the credential provider chain
      // since we're using Bearer token authentication via the Authorization header
      credentials: { accessKeyId: 'dummy', secretAccessKey: 'dummy' },
      endpoint: 'https://example.com/bedrock',
      requestHandler: { requestTimeout: 30000, fetchFunction: fetch },
    })
    const _command = new ConverseCommand({
      modelId: 'amazon.nova-premier-v1:0',
      system: [{ text: 'You are a helpful assistant.' }],
      messages: [{ role: 'user', content: [{ text: 'What is the capital of France?' }] }],
    })

    const _completion = await client.send(_command)
    console.log('completion', _completion)

    // expect(_completion).toMatchSnapshot('llm')
    // expect(otelBatch, 'otelBatch length not 1').toHaveLength(1)
    // expect(JSON.parse(otelBatch[0]!).resourceSpans?.[0].scopeSpans?.[0].spans?.[0]?.attributes).toMatchSnapshot('span')
  })
})
