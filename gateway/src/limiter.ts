import type { ApiKeyInfo } from './types'

export type LimiterResult = { slot: string } | { error: string }

export interface Limiter {
  // returns either a slot if the request is allowed, or a string error message if not
  requestStart(request: Request, keyInfo: ApiKeyInfo): Promise<LimiterResult>

  requestFinish(slot: string): Promise<void>
}

export class NoOpLimiter implements Limiter {
  async requestStart(_: Request, __: ApiKeyInfo): Promise<LimiterResult> {
    return Promise.resolve({ slot: 'ok' })
  }

  async requestFinish(_: string): Promise<void> {
    return Promise.resolve()
  }
}
