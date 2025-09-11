/* eslint-disable no-undef */
/** Above is necessary for the cloudflare d1 types */
import type { ApiKeyInfo } from './types'

export abstract class KeysDb {
  abstract apiKeyAuth(key: string): Promise<ApiKeyInfo | null>

  abstract disableKey(id: string, reason: string, newStatus: string): Promise<void>
}

export type SpendLimitScope =
  | 'key-daily'
  | 'key-weekly'
  | 'key-monthly'
  | 'key-total'
  | 'user-daily'
  | 'user-weekly'
  | 'user-monthly'
  | 'team-daily'
  | 'team-weekly'
  | 'team-monthly'

export interface IntervalSpend {
  scope: SpendLimitScope
  id: string
  limit: number
}

export abstract class LimitDb {
  // increment spends and return IDs of any scopes that are exceeded
  abstract incrementSpend(spendLimits: IntervalSpend[], spend: number): Promise<SpendLimitScope[]>
}

export class LimitDbD1 extends LimitDb {
  private db: D1Database

  constructor(db: D1Database) {
    super()
    this.db = db
  }

  async incrementSpend(intervalSpends: IntervalSpend[], spend: number): Promise<SpendLimitScope[]> {
    const sqlValues: '(?, ?, ?)'[] = []
    const values: (string | number)[] = []
    for (const { scope, id, limit } of intervalSpends) {
      sqlValues.push('(?, ?, ?)')
      values.push(`${scope}:${id}`, limit, spend)
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
        return await this.findExceededScopes(intervalSpends)
      } else {
        throw error
      }
    }
    return []
  }

  protected async findExceededScopes(intervalSpends: IntervalSpend[]): Promise<SpendLimitScope[]> {
    const sqlValues: '?'[] = []
    const values: (string | number)[] = []
    for (const { scope, id } of intervalSpends) {
      sqlValues.push('?')
      values.push(`${scope}:${id}`)
    }
    const { results } = await this.db
      .prepare(
        `\
SELECT id
FROM spend
WHERE spend > spendingLimit and id IN (${sqlValues.join(', ')})`,
      )
      .bind(...values)
      .run<{ id: string }>()
    return results.map((row) => row.id.split(':', 1)[0] as SpendLimitScope)
  }
}
