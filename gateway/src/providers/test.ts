import { DefaultProviderProxy } from './default'

export class TestProvider extends DefaultProviderProxy {
  providerId(): string {
    return 'openai'
  }

  apiFlavour(): string | undefined {
    return 'chat'
  }

  fetch(url: string): Promise<Response> {
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
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers }))
  }
}
