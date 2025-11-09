import type { ApiKeyInfo } from './types'

export interface RateLimiter {
  // returns either a slot if the request is allowed, or a string error message if not
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
