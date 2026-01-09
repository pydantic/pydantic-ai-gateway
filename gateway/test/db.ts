// Test-specific D1 database implementations
import type { ApiKeyInfo, KeyLimitUpdate } from '@pydantic/ai-gateway'
import {
  DISTANT_FUTURE,
  type EntityType,
  type ExceededScope,
  entityTypeLookup,
  type KeyStatus,
  KeysDb,
  LimitDb,
  type LimitUpdate,
  reverseEntityTypeLookup,
  reverseScopeLookup,
  type Scope,
  type SpendScope,
  type SpendStatus,
  scopeLookup,
} from '@pydantic/ai-gateway'

export class KeysDbD1 extends KeysDb {
  protected db: D1Database

  constructor(db: D1Database) {
    super()
    this.db = db
  }

  getApiKey(_key: string): Promise<ApiKeyInfo | null> {
    throw new Error('getApiKey must be implemented by subclass')
  }

  async getDbKeyStatus(keyId: number): Promise<KeyStatus | undefined> {
    const result = await this.db
      .prepare(`SELECT status FROM keyStatus WHERE id = ? and expiresAt > datetime('now')`)
      .bind(keyId)
      .first<{ status: KeyStatus }>()
    return result?.status
  }

  async disableKey(id: number, _reason: string, newStatus: KeyStatus, expirationTtl?: number): Promise<void> {
    if (typeof expirationTtl === 'number') {
      await this.db
        .prepare(
          `
INSERT INTO keyStatus (id, status, expiresAt) VALUES (?, ?, datetime('now', ?))
ON CONFLICT (id) DO UPDATE SET status = excluded.status, expiresAt = excluded.expiresAt`,
        )
        .bind(id, newStatus, `${expirationTtl} seconds`)
        .run()
    } else {
      await this.db
        .prepare(
          `
INSERT INTO keyStatus (id, status) VALUES (?, ?)
ON CONFLICT (id) DO UPDATE SET status = excluded.status, expiresAt = null`,
        )
        .bind(id, newStatus)
        .run()
    }
  }
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
    for (const { entityType, entityId, scope, scopeInterval, limit } of intervalSpends) {
      sqlValues.push('(?, ?, ?, ?, ?, ?)')
      values.push(
        entityTypeLookup[entityType],
        entityId,
        scopeLookup[scope],
        scopeInterval ?? DISTANT_FUTURE,
        limit ?? null,
        spend,
      )
    }
    const { results } = await this.db
      .prepare(
        `\
INSERT INTO spend (entityType, entityId, scope, scopeInterval, spendingLimit, spend)
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

  async updateProjectLimits(projectId: number, { daily, weekly, monthly }: LimitUpdate) {
    const stmts = []
    if (daily !== undefined) {
      // Check undefined, not truthiness
      stmts.push(this.updateSpend(daily, 'project', projectId, 'daily'))
    }
    if (weekly !== undefined) {
      stmts.push(this.updateSpend(weekly, 'project', projectId, 'weekly'))
    }
    if (monthly !== undefined) {
      stmts.push(this.updateSpend(monthly, 'project', projectId, 'monthly'))
    }
    if (stmts.length > 0) {
      await this.db.batch(stmts)
    }
  }

  async updateUserLimits(userId: number, { daily, weekly, monthly }: LimitUpdate) {
    const stmts = []
    if (daily !== undefined) {
      stmts.push(this.updateSpend(daily, 'user', userId, 'daily'))
    }
    if (weekly !== undefined) {
      stmts.push(this.updateSpend(weekly, 'user', userId, 'weekly'))
    }
    if (monthly !== undefined) {
      stmts.push(this.updateSpend(monthly, 'user', userId, 'monthly'))
    }
    if (stmts.length > 0) {
      await this.db.batch(stmts)
    }
  }

  async updateKeyLimits(keyId: number, { daily, weekly, monthly, total }: KeyLimitUpdate) {
    const stmts = []
    if (daily !== undefined) {
      stmts.push(this.updateSpend(daily, 'key', keyId, 'daily'))
    }
    if (weekly !== undefined) {
      stmts.push(this.updateSpend(weekly, 'key', keyId, 'weekly'))
    }
    if (monthly !== undefined) {
      stmts.push(this.updateSpend(monthly, 'key', keyId, 'monthly'))
    }
    if (total !== undefined) {
      stmts.push(this.updateSpend(total, 'key', keyId, 'total'))
    }
    if (stmts.length > 0) {
      await this.db.batch(stmts)
    }
  }

  async spendStatus(entityType: EntityType, entityId?: number): Promise<SpendStatus[]> {
    const entityIdClause = entityId ? ` AND entityId = ?` : ''
    const params = [entityTypeLookup[entityType]]
    if (entityId) {
      params.push(entityId)
    }

    const { results } = await this.db
      .prepare(
        `
SELECT entityId, scope, scopeInterval, spendingLimit, spend
FROM spend
WHERE entityType = ? ${entityIdClause}
`,
      )
      .bind(...params)
      .run<{
        entityId: number
        scope: 1 | 2 | 3 | 4
        scopeInterval: number
        spendingLimit: number | null
        spend: number
      }>()

    return results.map(({ entityId, scope, scopeInterval, spendingLimit, spend }) => ({
      entityId,
      scope: reverseScopeLookup[scope],
      scopeInterval: scopeInterval === DISTANT_FUTURE ? null : { date: intAsDate(scopeInterval), raw: scopeInterval },
      limit: spendingLimit,
      spend,
    }))
  }

  protected updateSpend(
    limit: number | null,
    entityType: EntityType,
    entityId: number,
    scope: Scope,
  ): D1PreparedStatement {
    return this.db
      .prepare(`UPDATE spend SET spendingLimit = ? WHERE entityType = ? AND entityId = ? and scope = ?`)
      .bind(limit, entityTypeLookup[entityType], entityId, scopeLookup[scope])
  }
}

// Helper functions for date handling
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function dateAsInt(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

export function intAsDate(days: number): Date {
  return new Date(days * MS_PER_DAY)
}
