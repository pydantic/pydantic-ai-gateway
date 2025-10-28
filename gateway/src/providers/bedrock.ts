import type { ConverseRequest } from '@aws-sdk/client-bedrock-runtime'
import * as logfire from '@pydantic/logfire-api'
import type { ModelAPI } from '../api'
import { ConverseAPI } from '../api/bedrock'
import { DefaultProviderProxy } from './default'

export class BedrockProvider extends DefaultProviderProxy {
  // TODO(Marcelo): Add Anthropic handler here.
  protected modelAPI(): ModelAPI | undefined {
    return new ConverseAPI('bedrock')
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData: ConverseRequest
    try {
      requestBodyData = JSON.parse(requestBodyText)
    } catch (_error) {
      return { error: 'invalid request JSON' }
    }
    const m = this.inferModel(this.restOfPath)
    if (m) {
      return { requestBodyText, requestBodyData, requestModel: m[1] }
    } else {
      return { error: 'unable to find model in path' }
    }
  }

  protected inferModel(url: string): string | null {
    const m = url.match(/model\/(.+?)\/converse/)
    return m?.[1] ?? null
  }

  inferResponseModel(): string | null {
    // We need to decode the rest of the path because it may contain encoded characters like "%3A" (:).
    try {
      const decodedRestOfPath = decodeURIComponent(this.restOfPath)
      return this.inferModel(decodedRestOfPath)
    } catch (error) {
      logfire.reportError('Error decoding URI', error as Error)
      return null
    }
  }
}
