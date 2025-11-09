import type { ApiKeyInfo } from './types'

export interface RateLimiter {
  // returns either a string which is the text content of a 429 response, or null to indicate no rate limit exceeded
  requestStart(keyInfo: ApiKeyInfo): Promise<string | null>

  requestFinish(): Promise<void>
}

export const noopLimiter: RateLimiter = {
  requestStart(_: ApiKeyInfo): Promise<string | null> {
    return Promise.resolve(null)
  },
  requestFinish(): Promise<void> {
    return Promise.resolve()
  },
}
