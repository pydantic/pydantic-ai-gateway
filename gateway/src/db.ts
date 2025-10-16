import type { ApiKeyInfo, KeyStatus } from './types'

export abstract class KeysDb {
  abstract getApiKey(key: string): Promise<ApiKeyInfo | null>

  disableKey(_id: number, _reason: string, _newStatus: string, _expirationTtl?: number): Promise<void> {
    return Promise.resolve()
  }
}

export abstract class KeysDbD1 extends KeysDb {
  protected db: D1Database

  constructor(db: D1Database) {
    super()
    this.db = db
  }

  async getDbKeyStatus(keyId: number): Promise<KeyStatus | undefined> {
    const result = await this.db
      .prepare(`SELECT status FROM keyStatus WHERE id = ? and expiresAt > datetime('now')`)
      .bind(keyId)
      .first<{ status: KeyStatus }>()
    return result?.status
  }

  async disableKey(id: number, _reason: string, newStatus: string, expirationTtl?: number): Promise<void> {
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

export type EntityType = 'project' | 'user' | 'key'

const entityTypeLookup: Record<EntityType, number> = { project: 1, user: 2, key: 3 }
const reverseEntityTypeLookup: Record<1 | 2 | 3, EntityType> = { 1: 'project', 2: 'user', 3: 'key' }

export type Scope = 'daily' | 'weekly' | 'monthly' | 'total'

const scopeLookup: Record<Scope, number> = { daily: 1, weekly: 2, monthly: 3, total: 4 }
const reverseScopeLookup: Record<1 | 2 | 3 | 4, Scope> = { 1: 'daily', 2: 'weekly', 3: 'monthly', 4: 'total' }

export interface SpendScope {
  entityType: EntityType
  entityId: number
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

const DISTANCE_FUTURE = 65536

export interface SpendStatus {
  entityId: number
  scope: Scope
  scopeInterval: Date | null
  limit: number
  spend: number
}

export abstract class LimitDb {
  // increment spends and return IDs of any scopes that have exceeded the spending limit
  abstract incrementSpend(spendScopes: SpendScope[], spend: number): Promise<ExceededScope[]>

  abstract updateProjectLimits(projectId: number, update: LimitUpdate): Promise<void>

  abstract updateUserLimits(userId: number, update: LimitUpdate): Promise<void>

  abstract updateKeyLimits(keyId: number, update: KeyLimitUpdate): Promise<void>

  abstract spendStatus(entityType: EntityType, entityId?: number): Promise<SpendStatus[]>
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
    const values: (string | number)[] = []
    for (const { entityType, entityId, scope, scopeInterval, limit } of intervalSpends) {
      sqlValues.push('(?, ?, ?, ?, ?, ?)')
      values.push(
        entityTypeLookup[entityType],
        entityId,
        scopeLookup[scope],
        scopeInterval ?? DISTANCE_FUTURE,
        limit,
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
    if (daily) {
      await this.updateSpend(daily, 'project', projectId, 'daily')
    }
    if (weekly) {
      await this.updateSpend(weekly, 'project', projectId, 'weekly')
    }
    if (monthly) {
      await this.updateSpend(monthly, 'project', projectId, 'monthly')
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
      .run<{ entityId: number; scope: 1 | 2 | 3 | 4; scopeInterval: number; spendingLimit: number; spend: number }>()

    return results.map(({ entityId, scope, scopeInterval, spendingLimit, spend }) => ({
      entityId,
      scope: reverseScopeLookup[scope],
      scopeInterval: scopeInterval === DISTANCE_FUTURE ? null : intAsDate(scopeInterval),
      limit: spendingLimit,
      spend,
    }))
  }

  protected async updateSpend(limit: number, entityType: EntityType, entityId: number, scope: Scope) {
    await this.db
      .prepare(`UPDATE spend SET spendingLimit = ? WHERE entityType = ? AND entityId = ? and scope = ?`)
      .bind(limit, entityTypeLookup[entityType], entityId, scopeLookup[scope])
      .run()
  }
}

interface ScopeIntervals {
  day: number
  endOfWeek: number
  endOfMonth: number
}

export function scopeIntervals(): ScopeIntervals {
  const now = new Date()
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return { day: dateAsInt(day), endOfWeek: dateAsInt(endOfWeek(now)), endOfMonth: dateAsInt(endOfMonth(now)) }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
function dateAsInt(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

function intAsDate(days: number): Date {
  return new Date(days * MS_PER_DAY)
}

/** get the last day of the week, e.g. "this Sunday" */
export function endOfWeek(date: Date): Date {
  const dayOfWeek = date.getDay()
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  if (dayOfWeek === 0) {
    // Sunday -  return this date as it's the end of the week
    return d
  } else {
    // else if not Sunday, add enough days to get to the next Sunday
    d.setDate(d.getDate() + (7 - dayOfWeek))
    return d
  }
}

/** get the last day of the month */
export function endOfMonth(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setMonth(d.getMonth() + 1, 0)
  return d
}
