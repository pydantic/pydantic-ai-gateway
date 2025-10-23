import { calcPrice, findProvider, type Usage } from '@pydantic/genai-prices'
import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { ProviderID } from '../types'

export class SSEStreamAccumulator {
  private events: EventSourceMessage[] = []
  private providerId: ProviderID
  private parser

  constructor(providerId: ProviderID) {
    this.providerId = providerId
    this.parser = createParser({
      onEvent: (event) => {
        this.events.push(event)
      },
    })
  }

  feed(chunk: string): void {
    this.parser.feed(chunk)
  }

  extractUsage(): Usage | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]

      if (!event) continue

      try {
        const data = JSON.parse(event.data)

        if (this.providerId === 'openai') {
          // Chat completions format: data.usage
          if (data.usage) {
            return { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
          }

          // Responses format: data.response.usage
          if (data.response?.usage) {
            return { input_tokens: data.response.usage.input_tokens, output_tokens: data.response.usage.output_tokens }
          }
        }
        if (this.providerId === 'anthropic' && event.event === 'message_delta' && data.usage) {
          return { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens }
        }
      } catch {}
    }
    return null
  }

  extractModel(): string | null {
    for (const event of this.events) {
      if (!event) continue

      try {
        const data = JSON.parse(event.data)

        // Chat completions format: data.model
        if (data.model) {
          return data.model
        }

        // Responses format: data.response.model
        if (data.response?.model) {
          return data.response.model
        }
      } catch {}
    }
    return null
  }

  // biome-ignore lint/suspicious/useAwait: Return type must be Promise to match caller expectations
  async calculateCost(
    requestModel: string | undefined,
  ): Promise<{ cost: number; usage: Usage; responseModel: string }> {
    const usage = this.extractUsage()
    if (!usage) {
      throw new Error('Unable to extract usage from stream')
    }

    const responseModel = this.extractModel() ?? requestModel
    if (!responseModel) {
      throw new Error('Unable determine response model')
    }

    const provider = findProvider({ providerId: this.providerId })
    if (!provider) {
      throw new Error(`Provider not found: ${this.providerId}`)
    }

    const price = calcPrice(usage, responseModel, { provider })
    if (!price) {
      throw new Error(`Unable to calculate price for model: ${responseModel}`)
    }
    return { cost: price.total_price, usage, responseModel }
  }
}
