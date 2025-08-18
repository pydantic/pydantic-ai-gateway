import * as logfire from '@pydantic/logfire-api'
import { Usage, calcPrice, extractUsage, findProvider } from '@pydantic/genai-prices'

import { ApiKeyInfo, ProviderProxy } from '../types'
import { GatewayEnv } from '..'

interface ProxySuccess {
  successResponse: Response
  requestModel?: string
  responseModel: string
  usage: Usage
  price: number
}

interface ProxyInvalidRequest {
  error: string
  // if true we should disable the key immediately since it appears to be incurring cost we can't measure
  disableKey?: boolean
}

interface ProxyFailure {
  failResponse: Response
  requestModel?: string
}

interface Prepare {
  requestBody: BodyInit | null
  requestModel?: string
}

type JsonData = Record<string, unknown>

interface ProcessResponse {
  body: JsonData
  responseModel: string
  usage: Usage
  price: number
}

export class DefaultProviderProxy {
  request: Request
  env: GatewayEnv
  apiKey: ApiKeyInfo
  providerProxy: ProviderProxy
  restOfPath: string

  constructor(
    request: Request,
    env: GatewayEnv,
    apiKey: ApiKeyInfo,
    providerProxy: ProviderProxy,
    restOfPath: string,
  ) {
    this.request = request
    this.env = env
    this.apiKey = apiKey
    this.providerProxy = providerProxy
    this.restOfPath = restOfPath
  }

  providerId(): string {
    return this.providerProxy.providerId
  }

  apiFlavour(): string | undefined {
    return undefined
  }

  /* Check that the model being used is supported.
    In particular that we can accurately determine the token usage from the response.
    */
  check(): ProxyInvalidRequest | void {}

  method(): string {
    return this.request.method
  }

  url() {
    return `${this.providerProxy.baseUrl}/${this.restOfPath}`
  }

  userAgent(): string {
    const userAgent = this.request.headers.get('user-agent')
    return `${userAgent} via Pydantic AI Gateway ${this.env.githubSha.substring(0, 7)}, contact engineering@pydantic.dev`
  }

  requestHeaders(headers: Headers) {
    headers.set('Authorization', `Bearer ${this.providerProxy.credentials}`)
  }

  async prepRequest(): Promise<Prepare | ProxyInvalidRequest> {
    const requestBody = await this.request.text()
    let requestModel
    try {
      const data = JSON.parse(requestBody)
      requestModel = data.model
    } catch (error) {
      return { error: 'invalid request JSON' }
    }
    if (!requestModel || typeof requestModel === 'string') {
      return { requestBody, requestModel }
    } else {
      return { error: 'invalid request, "model" should be a string' }
    }
  }

  async extractUsage(response: Response): Promise<ProcessResponse | ProxyInvalidRequest> {
    try {
      const bodyText = await response.text()
      const body = JSON.parse(bodyText)
      const provider = findProvider({ providerId: this.providerId() })
      if (!provider) {
        return { error: 'invalid response JSON, provider not found' }
      }
      const [responseModel, usage] = extractUsage(provider, body, this.apiFlavour())

      const price = calcPrice(usage, responseModel, { provider })
      if (price) {
        return { body, responseModel, usage, price: price.total_price }
      } else {
        return { error: 'Unable to calculate spend' }
      }
    } catch (error) {
      logfire.reportError('Error extracting usage from response', error as Error)
      return { error: 'invalid response JSON, unable to extract usage' }
    }
  }

  responseHeaders(_headers: Headers): void {}

  async dispatch(): Promise<ProxySuccess | ProxyInvalidRequest | ProxyFailure> {
    const checkResult = this.check()
    if (checkResult) {
      return checkResult
    }

    const method = this.method()
    const url = this.url()

    const requestHeaders = new Headers(this.request.headers)
    requestHeaders.set('user-agent', this.userAgent())
    // authorization header was used by the gateway auth, it definitely should not be forwarded to the target api
    requestHeaders.delete('authorization')
    this.requestHeaders(requestHeaders)

    const prepResult = await this.prepRequest()
    if ('error' in prepResult) {
      return prepResult
    }
    const { requestBody, requestModel } = prepResult
    const response = await fetch(url, { method, headers: requestHeaders, body: requestBody })

    if (!response.ok) {
      // CAUTION: can we be charged in any way for failed requests?
      return { failResponse: response, requestModel }
    }

    const processResponse = await this.extractUsage(response)
    if ('error' in processResponse) {
      return { ...processResponse, disableKey: true }
    }
    const { body, usage, responseModel, price } = processResponse

    // TODO we will want to remove some response headers, e.g. openai org
    const headers = new Headers(response.headers)
    headers.set('pydantic-ai-gateway-price-estimate', `${price.toFixed(4)}USD`)
    this.responseHeaders(headers)

    if (this.providerProxy.injectPrice && 'usage' in body && isMapping(body.usage)) {
      body.usage.pydantic_ai_gateway = { price_estimate: price }
    }

    const successResponse = new Response(JSON.stringify(body), {
      status: response.status,
      headers,
    })

    return {
      successResponse,
      responseModel,
      requestModel,
      usage,
      price,
    }
  }
}

function isMapping(v: unknown): v is Record<string, unknown> {
  return v !== null && !Array.isArray(v) && typeof v === 'object'
}
