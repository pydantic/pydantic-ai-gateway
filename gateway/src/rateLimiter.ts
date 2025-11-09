import type { ApiKeyInfo } from './types'

export type LimiterResult = { slot: string } | { error: string }

export interface RateLimiter {
  // returns either a slot if the request is allowed, or a string error message if not
  requestStart(request: Request, keyInfo: ApiKeyInfo): Promise<LimiterResult>

  requestFinish(slot: string): Promise<void>
}

export const noopLimiter: RateLimiter = {
  requestStart(_: Request, __: ApiKeyInfo): Promise<LimiterResult> {
    return Promise.resolve({ slot: 'ok' })
  },
  requestFinish(_: string): Promise<void> {
    return Promise.resolve()
  },
}
