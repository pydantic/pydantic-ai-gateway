import type { ApiKeyInfo, KeyStatus } from './types'

export abstract class KeysDb {
  abstract apiKeyAuth(key: string): Promise<ApiKeyInfo | null>

  disableKey(_id: number, _reason: string, _newStatus: string, _expirationTtl?: number): Promise<void> {
    return Promise.resolve()
  }
}

export abstract class KeysDbD1 extends KeysDb {
  private Db: D1Database

  constructor(DB: D1Database) {
    super()
    this.Db = DB
  }

  async getDbKeyStatus(keyId: number): Promise<KeyStatus | undefined> {
    const result = await this.Db.prepare(`SELECT status FROM keyStatus WHERE id = ? and expiresAt > datetime('now')`)
      .bind(keyId)
      .first<{ status: KeyStatus }>()
    return result?.status
  }

  async disableKey(id: number, _reason: string, newStatus: string, expirationTtl?: number): Promise<void> {
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

export type EntityType = 'team' | 'user' | 'key'

const entityTypeLookup: Record<EntityType, number> = {
  team: 1,
  user: 2,
  key: 3,
}
const reverseEntityTypeLookup: Record<1 | 2 | 3, EntityType> = {
  1: 'team',
  2: 'user',
  3: 'key',
}

export type Scope = 'daily' | 'weekly' | 'monthly' | 'total'

const scopeLookup: Record<Scope, number> = {
  daily: 1,
  weekly: 2,
  monthly: 3,
  total: 4,
}
const reverseScopeLookup: Record<1 | 2 | 3 | 4, Scope> = {
  1: 'daily',
  2: 'weekly',
  3: 'monthly',
  4: 'total',
}

export interface SpendScope {
  entityId: number
  entityType: EntityType
  scope: Scope
  // scopeInterval is null for total scope
  scopeInterval?: number
  limit: number
}

export interface ExceededScope {
  entityType: EntityType
  scope: Scope
}

export interface LimitUpdate {
  daily?: number
  weekly?: number
  monthly?: number
}

export type KeyLimitUpdate = LimitUpdate & { total?: number }

export abstract class LimitDb {
  // increment spends and return IDs of any scopes that have exceeded the spending limit
  abstract incrementSpend(spenScopes: SpendScope[], spend: number): Promise<ExceededScope[]>

  abstract updateTeamLimits(teamId: number, update: LimitUpdate): Promise<void>

  abstract updateUserLimits(userId: number, update: LimitUpdate): Promise<void>

  abstract updateKeyLimits(keyId: number, update: KeyLimitUpdate): Promise<void>
}

export class LimitDbD1 extends LimitDb {
  private db: D1Database

  constructor(db: D1Database) {
    super()
    this.db = db
  }

  async incrementSpend(intervalSpends: SpendScope[], spend: number): Promise<ExceededScope[]> {
    if (!intervalSpends.length) {
      return []
    }

    const sqlValues: '(?, ?, ?, ?, ?, ?)'[] = []
    const values: (string | number | null)[] = []
    for (const { entityId, entityType, scope, scopeInterval, limit } of intervalSpends) {
      sqlValues.push('(?, ?, ?, ?, ?, ?)')
      values.push(entityId, entityTypeLookup[entityType], scopeLookup[scope], scopeInterval ?? null, limit, spend)
    }
    const { results } = await this.db
      .prepare(
        `\
INSERT INTO spend (entityId, entityType, scope, scopeInterval, spendingLimit, spend)
VALUES ${sqlValues.join(', ')}
ON CONFLICT DO UPDATE SET spend = spend + EXCLUDED.spend
RETURNING entityType, scope, spend > spendingLimit as ex;`,
      )
      .bind(...values)
      .run<{ entityType: 1 | 2 | 3; scope: 1 | 2 | 3 | 4; ex: 0 | 1 }>()

    return results
      .filter(({ ex }) => ex)
      .map(({ entityType, scope }) => ({
        entityType: reverseEntityTypeLookup[entityType],
        scope: reverseScopeLookup[scope],
      }))
  }

  async updateTeamLimits(teamId: number, { daily, weekly, monthly }: LimitUpdate) {
    if (daily) {
      await this.updateSpend(daily, 'team', teamId, 'daily')
    }
    if (weekly) {
      await this.updateSpend(weekly, 'team', teamId, 'weekly')
    }
    if (monthly) {
      await this.updateSpend(monthly, 'team', teamId, 'monthly')
    }
  }

  async updateUserLimits(userId: number, { daily, weekly, monthly }: LimitUpdate) {
    if (daily) {
      await this.updateSpend(daily, 'user', userId, 'daily')
    }
    if (weekly) {
      await this.updateSpend(weekly, 'user', userId, 'weekly')
    }
    if (monthly) {
      await this.updateSpend(monthly, 'user', userId, 'monthly')
    }
  }

  async updateKeyLimits(keyId: number, { daily, weekly, monthly, total }: KeyLimitUpdate) {
    if (daily) {
      await this.updateSpend(daily, 'key', keyId, 'daily')
    }
    if (weekly) {
      await this.updateSpend(weekly, 'key', keyId, 'weekly')
    }
    if (monthly) {
      await this.updateSpend(monthly, 'key', keyId, 'monthly')
    }
    if (total) {
      await this.updateSpend(total, 'key', keyId, 'total')
    }
  }

  protected async updateSpend(limit: number, entityType: EntityType, entityId: number, scope: Scope) {
    await this.db
      .prepare(`UPDATE spend SET spendingLimit = ? WHERE entityType = ? AND entityId = ? and scope = ?`)
      .bind(limit, entityTypeLookup[entityType], entityId, scopeLookup[scope])
      .run()
  }
}
