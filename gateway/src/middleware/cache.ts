import logfire from 'logfire'
import type { HandlerResponse, Middleware, Next, RequestHandler } from '../handler'
import type { CachedResponse, CacheStorage as GatewayCacheStorage } from './storage'

export interface CacheOptions {
  storage: GatewayCacheStorage
}

export class CacheMiddleware implements Middleware {
  private options: CacheOptions

  constructor(options: CacheOptions) {
    this.options = options
  }

  dispatch(next: Next): Next {
    return async (handler: RequestHandler) => {
      if (!handler.apiKeyInfo.cacheEnabled) {
        return await next(handler)
      }

      const { method, url, headers } = handler.request
      // Clone the request to read the body without consuming the original
      const requestBody = await handler.request.clone().text()
      const requestUrl = new URL(url)
      requestUrl.pathname = handler.restOfPath
      const path = requestUrl.toString()

      const apiKeyId = handler.apiKeyInfo.id
      const hash = await this.calculateHash(method, path, requestBody, apiKeyId)

      const shouldBypassCache = this.shouldBypassCache(headers)

      if (!shouldBypassCache) {
        const cached = await this.getCachedResponse(hash)

        if (cached) {
          logfire.info('Cache hit', { hash, apiKeyId: handler.apiKeyInfo.id })
          return this.toCachedHandlerResponse(requestBody, cached)
        }
      }

      const result = await next(handler)

      const shouldStoreCache = this.shouldStoreCache(handler.request, result)
      if (shouldStoreCache) {
        handler.runAfter('cache-store', this.storeCachedResponse(hash, result))
      }

      return this.addCacheHeaders(result, shouldBypassCache ? 'BYPASS' : 'MISS')
    }
  }

  private shouldBypassCache(requestHeaders: Headers): boolean {
    const cacheControl = requestHeaders.get('cache-control')
    return cacheControl?.includes('no-cache') || cacheControl?.includes('no-store') || false
  }

  private shouldStoreCache(request: Request, result: HandlerResponse): boolean {
    const cacheControl = request.headers.get('cache-control')

    if (cacheControl?.includes('no-store')) {
      return false
    }

    if ('responseStream' in result) {
      return false
    }

    if ('error' in result || 'unexpectedStatus' in result || 'response' in result || 'modelNotFound' in result) {
      return false
    }

    return true
  }

  private async calculateHash(method: string, url: string, body: string, apiKeyId: number): Promise<string> {
    const data = `${apiKeyId}:${method}:${url}:${body}`
    const encoder = new TextEncoder()
    const dataBuffer = encoder.encode(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    return hashHex
  }

  private async getCachedResponse(hash: string): Promise<CachedResponse | null> {
    try {
      return await this.options.storage.get(hash)
    } catch (error) {
      logfire.reportError('Error getting cached response', error as Error, { hash })
      return null
    }
  }

  private async storeCachedResponse(hash: string, result: HandlerResponse): Promise<void> {
    if (!('successStatus' in result) || 'responseStream' in result) {
      return
    }

    try {
      const { successStatus, responseHeaders, responseBody, requestModel, responseModel } = result

      const headers: Record<string, string> = {}
      responseHeaders.forEach((value, key) => {
        headers[key] = value
      })

      const cached: CachedResponse = {
        status: successStatus,
        headers,
        body: responseBody,
        timestamp: Date.now(),
        requestModel,
        responseModel,
      }

      await this.options.storage.set(hash, cached)

      const sizeBytes = new TextEncoder().encode(responseBody).length

      logfire.info('Response cached', { hash, sizeBytes })
    } catch (error) {
      logfire.reportError('Error storing cached response', error as Error, { hash })
    }
  }

  private toCachedHandlerResponse(
    requestBody: string,
    cached: CachedResponse,
  ): Extract<HandlerResponse, { successStatus: number }> {
    const responseHeaders = new Headers(cached.headers)
    const age = Math.floor((Date.now() - cached.timestamp) / 1000)

    responseHeaders.set('Age', age.toString())
    responseHeaders.set('X-Cache-Status', 'HIT')

    return {
      successStatus: cached.status,
      responseHeaders,
      responseBody: cached.body,
      requestBody,
      requestModel: cached.requestModel,
      responseModel: cached.responseModel ?? 'unknown',
      usage: { input_tokens: 0, output_tokens: 0 },
      cost: 0,
    }
  }

  private addCacheHeaders(result: HandlerResponse, status: 'HIT' | 'MISS' | 'BYPASS'): HandlerResponse {
    if ('responseHeaders' in result) {
      result.responseHeaders.set('X-Cache-Status', status)
    }

    return result
  }
}
