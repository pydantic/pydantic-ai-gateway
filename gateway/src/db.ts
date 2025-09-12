import type { ApiKeyInfo, KeyStatus } from './types'

export abstract class KeysDb {
  abstract apiKeyAuth(key: string): Promise<ApiKeyInfo | null>

  disableKey(_id: string, _reason: string, _newStatus: string, _expirationTtl?: number): Promise<void> {
    return Promise.resolve()
  }
}

export abstract class KeysDbD1 extends KeysDb {
  private Db: D1Database

  constructor(DB: D1Database) {
    super()
    this.Db = DB
  }

  async getDbKeyStatus(keyId: string): Promise<KeyStatus | undefined> {
    const result = await this.Db.prepare(`SELECT status FROM keyStatus WHERE id = ? and expiresAt > datetime('now')`)
      .bind(keyId)
      .first<{ status: KeyStatus }>()
    return result?.status
  }

  async disableKey(id: string, _reason: string, newStatus: string, expirationTtl?: number): Promise<void> {
    if (typeof expirationTtl === 'number') {
      await this.Db.prepare(
        `
INSERT INTO keyStatus (id, status, expiresAt) VALUES (?, ?, datetime('now', ?))
ON CONFLICT (id) DO UPDATE SET status = excluded.status, expiresAt = excluded.expiresAt`,
      )
        .bind(id, newStatus, `${expirationTtl} seconds`)
        .run()
    } else {
      await this.Db.prepare(
        `
INSERT INTO keyStatus (id, status) VALUES (?, ?)
ON CONFLICT (id) DO UPDATE SET status = excluded.status, expiresAt = null`,
      )
        .bind(id, newStatus)
        .run()
    }
  }
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
RETURNING id, spend > spendingLimit as ex;`,
      )
      .bind(...values)
      .run<{ id: string; ex: 0 | 1 }>()

    return results.filter(({ ex }) => ex).map(({ id }) => id.split(':')[0] as SpendLimitScope)
  }
}
