/* eslint-disable no-undef */
/** Above is necessary for the cloudflare d1 types */
import type { ApiKeyInfo } from './types'

export abstract class KeysDb {
  abstract apiKeyAuth(key: string): Promise<ApiKeyInfo | null>

  abstract disableKey(id: string, reason: string): Promise<void>
}

export abstract class LimitDb {
  // increment spend and return true if the limit is exceeded
  abstract incrementSpend(id: string, spend: number, limit: number | null): Promise<boolean>
}

export class LimitDbD1 extends LimitDb {
  private db: D1Database

  constructor(db: D1Database) {
    super()
    this.db = db
  }

  async incrementSpend(id: string, spend: number, limit: number | null): Promise<boolean> {
    try {
      await this.db
        .prepare(
          `
        INSERT INTO spend (id, spend, spendingLimit)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET spend = spend.spend + EXCLUDED.spend;
        `,
        )
        .bind(id, spend, limit)
        .run()
    } catch (error) {
      const errorString = (error as Error).toString()
      if (errorString.includes('SQLITE_CONSTRAINT')) {
        return true
      } else {
        throw error
      }
    }
    return false
  }
}
