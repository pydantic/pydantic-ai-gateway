import { Usage, calcPrice, extractUsage, findProvider } from '@pydantic/genai-prices'

import { ApiKeyInfo, ProviderProxy } from '../../types'
import { GatewayEnv } from '../..'

interface ProxySuccess {
  successResponse: Response
  model: string
  usage: Usage
  spend: number
}

interface ProxyInvalidRequest {
  error: string
  // if true we should disable the key immediately since it appears to be incurring cost we can't measure
  disableKey?: boolean
}

interface ProxyFailure {
  failResponse: Response
  model: string
}

interface Prepare {
  body: BodyInit | null
  model: string
}

interface ProcessResponse {
  body: BodyInit | null
  model: string
  usage: Usage
  spend: number
}

export abstract class AbstractProviderProxy {
  request: Request
  env: GatewayEnv
  apiKey: ApiKeyInfo
  provider: ProviderProxy
  restOfPath: string

  constructor(request: Request, env: GatewayEnv, apiKey: ApiKeyInfo, provider: ProviderProxy, restOfPath: string) {
    this.request = request
    this.env = env
    this.apiKey = apiKey
    this.provider = provider
    this.restOfPath = restOfPath
  }

  abstract providerId(): string

  apiFlavour(): string | undefined {
    return undefined
  }

  /* Check that the model being used is supported.
    In particular that we can accurately determine the token usage from the response.
    */
  abstract check(): ProxyInvalidRequest | void

  method(): string {
    return this.request.method
  }

  abstract url(): string

  userAgent(): string {
    const userAgent = this.request.headers.get('user-agent')
    return `${userAgent} via Pydantic AI Gateway ${this.env.githubSha.substring(0, 7)}, contact engineering@pydantic.dev`
  }

  abstract requestHeaders(headers: Headers): void

  abstract prepRequest(): Promise<Prepare | ProxyInvalidRequest>

  async extractUsage(response: Response): Promise<ProcessResponse | ProxyInvalidRequest> {
    try {
      const body = await response.text()
      const data = JSON.parse(body)
      const provider = findProvider({ providerId: this.providerId() })
      if (!provider) {
        return { error: 'invalid response JSON, provider not found' }
      }
      const [model, usage] = extractUsage(provider, data, this.apiFlavour())

      const price = calcPrice(usage, model, { provider })
      if (price) {
        return { body, model, usage, spend: price.total_price }
      } else {
        return { error: 'Unable to calculate spend' }
      }
    } catch (error) {
      return { error: 'invalid response JSON, unable to extract usage' }
    }
  }

  responseHeaders(headers: Headers): void {}

  async dispatch(): Promise<ProxySuccess | ProxyInvalidRequest | ProxyFailure> {
    const checkResult = this.check()
    if (checkResult) {
      return checkResult
    }
    const method = this.method()
    const url = this.url()

    const headers = new Headers(this.request.headers)
    headers.set('user-agent', this.userAgent())
    // authorization header was used by the gateway auth, it definitely should not be forwarded to the target api
    headers.delete('authorization')
    this.requestHeaders(headers)

    const prepResult = await this.prepRequest()
    if ('error' in prepResult) {
      return prepResult
    }
    const { body, model: requestModel } = prepResult
    const response = await fetch(url, { method, headers, body })

    if (!response.ok) {
      // CAUTION: can we be charged in any way for failed requests?
      return { failResponse: response, model: requestModel }
    } else {
      const processResponse = await this.extractUsage(response)
      if ('error' in processResponse) {
        return { ...processResponse, disableKey: true }
      }
      const { body, usage, model, spend } = processResponse

      // TODO we will want to remove some response headers, e.g. openai org
      const headers = new Headers(response.headers)
      headers.set('pydantic-ai-gateway-spend-estimate', `${spend.toFixed(2)}USD`)
      this.responseHeaders(headers)

      const successResponse = new Response(body, {
        status: response.status,
        headers,
      })

      return {
        successResponse,
        usage,
        model,
        spend,
      }
    }
  }
}
