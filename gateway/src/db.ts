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
    if (!intervalSpends.length) {
      return []
    }

    const sqlValues: '(?, ?, ?)'[] = []
    const values: (string | number)[] = []
    for (const { scope, id, limit } of intervalSpends) {
      sqlValues.push('(?, ?, ?)')
      values.push(`${scope}:${id}`, limit, spend)
    }
    const { results } = await this.db
      .prepare(
        `\
INSERT INTO spend (id, spendingLimit, spend)
VALUES ${sqlValues.join(', ')}
ON CONFLICT(id) DO UPDATE SET spend = spend + EXCLUDED.spend
RETURNING id, spend > spendingLimit as limitExceeded;`,
      )
      .bind(...values)
      .run<{ id: string; limitExceeded: boolean }>()

    const exceededScopes: SpendLimitScope[] = []
    for (const { id, limitExceeded } of results) {
      if (limitExceeded) {
        exceededScopes.push(id.split(':')[0] as SpendLimitScope)
      }
    }
    return exceededScopes
  }
}
