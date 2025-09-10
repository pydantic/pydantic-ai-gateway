/* eslint-disable no-undef */
/** Above is necessary for the cloudflare d1 types */
import type { ApiKeyInfo } from './types'

export abstract class KeysDb {
  abstract apiKeyAuth(key: string): Promise<ApiKeyInfo | null>

  abstract disableKey(id: string, reason: string): Promise<void>
}

export interface IntervalSpend {
  intervalId: string
  limit: number
}

export abstract class LimitDb {
  // increment spends and return true if the limit is exceeded
  abstract incrementSpend(spendLimits: IntervalSpend[], spend: number): Promise<boolean>
}

export class LimitDbD1 extends LimitDb {
  private db: D1Database

  constructor(db: D1Database) {
    super()
    this.db = db
  }

  async incrementSpend(intervalSpends: IntervalSpend[], spend: number): Promise<boolean> {
    const sqlValues: '(?, ?, ?)'[] = []
    const values: (string | number)[] = []
    for (const { intervalId, limit } of intervalSpends) {
      sqlValues.push('(?, ?, ?)')
      values.push(intervalId, limit, spend)
    }
    try {
      await this.db
        .prepare(
          `\
INSERT INTO spend (id, spendingLimit, spend)
VALUES ${sqlValues.join(', ')}
ON CONFLICT(id) DO UPDATE SET spend = spend.spend + EXCLUDED.spend;`,
        )
        .bind(...values)
        .run()
    } catch (error) {
      if (error instanceof Error && error.message.includes('spendingLimit: SQLITE_CONSTRAINT')) {
        return true
      } else {
        throw error
      }
    }
    return false
  }
}
