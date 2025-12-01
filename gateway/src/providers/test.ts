import type { ModelAPI } from '../api'
import { ChatCompletionAPI } from '../api/chat'
import type { ErrorResponse } from '../handler'
import { BaseProvider, type ExtractedInfo } from './base'

export class TestProvider extends BaseProvider {
  getRequestModel(extracted: ExtractedInfo): string | undefined {
    const { requestBodyData } = extracted
    if ('model' in requestBodyData && typeof requestBodyData.model === 'string') {
      return requestBodyData.model
    }
    return undefined
  }

  getModelAPI(_extracted: ExtractedInfo): ModelAPI {
    return new ChatCompletionAPI('test')
  }

  authenticate(headers: Headers): Promise<ErrorResponse | null> {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
    return Promise.resolve(null)
  }

  protected initializeAPIFlavor(): string | undefined {
    return 'chat'
  }

  // Use OpenAI for pricing/usage calculations since test provider uses OpenAI-compatible models
  usageProviderId(): string {
    return 'openai'
  }

  // Mock fetch for testing - returns synthetic response instead of making real HTTP call
  async fetch(url: string, init: RequestInit): Promise<Response> {
    if (typeof init.body === 'string') {
      const sleepTime = /sleep=(?<sleep>\d+)/.exec(init.body)?.groups?.sleep
      if (sleepTime) {
        console.log(`Sleeping for ${sleepTime}ms`)
        await sleep(Number(sleepTime))
      }
    }
    const data = {
      choices: [
        {
          finish_reason: 'stop',
          index: 0,
          message: { annotations: [], content: `request URL: ${url}`, refusal: null, role: 'assistant' },
        },
      ],
      created: Math.floor(Date.now() / 1000),
      id: 'chatcmpl-test',
      model: 'gpt-5',
      object: 'chat.completion',
      service_tier: 'default',
      system_fingerprint: null,
      usage: {
        prompt_tokens: 4560,
        completion_tokens: 1230,
        completion_tokens_details: {
          accepted_prediction_tokens: 0,
          audio_tokens: 0,
          reasoning_tokens: 0,
          rejected_prediction_tokens: 0,
        },
        prompt_tokens_details: { audio_tokens: 0, cached_tokens: 0 },
        total_tokens: 5790,
      },
    }
    const headers = { 'Content-Type': 'application/json', 'pydantic-ai-gateway': 'test' }
    return new Response(JSON.stringify(data, null, 2) + '\n', { status: 200, headers })
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
