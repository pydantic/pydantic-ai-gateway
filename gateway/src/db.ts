import type { ApiKeyInfo, KeyStatus } from './types'

export abstract class KeysDb {
  abstract getApiKey(key: string): Promise<ApiKeyInfo | null>

  abstract disableKey(id: number, reason: string, newStatus: KeyStatus, expirationTtl?: number): Promise<void>
}

export type EntityType = 'project' | 'user' | 'key'

export const entityTypeLookup: Record<EntityType, number> = { project: 1, user: 2, key: 3 }
export const reverseEntityTypeLookup: Record<1 | 2 | 3, EntityType> = { 1: 'project', 2: 'user', 3: 'key' }

export type Scope = 'daily' | 'weekly' | 'monthly' | 'total'

export const scopeLookup: Record<Scope, number> = { daily: 1, weekly: 2, monthly: 3, total: 4 }
export const reverseScopeLookup: Record<1 | 2 | 3 | 4, Scope> = { 1: 'daily', 2: 'weekly', 3: 'monthly', 4: 'total' }

export interface SpendScope {
  entityType: EntityType
  entityId: number
  scope: Scope
  // scopeInterval is null for total scope
  scopeInterval?: number
  // we still set the spend even if there is not limit set
  limit?: number
}

export interface ExceededScope {
  entityType: EntityType
  scope: Scope
}

export interface LimitUpdate {
  // null means remove the limit, undefined means don't change the limit
  daily?: number | null
  weekly?: number | null
  monthly?: number | null
}

export type KeyLimitUpdate = LimitUpdate & { total?: number | null }
// 65536 equates to 2149-06-07
export const DISTANT_FUTURE = 65536

export interface SpendStatus {
  entityId: number
  scope: Scope
  scopeInterval: { date: Date; raw: number } | null
  limit: number | null
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

// Helper functions for date/time handling
interface ScopeIntervals {
  day: number
  eow: number
  eom: number
}

// get the current scope intervals for day, end of week, and end of month
export function currentScopeIntervals(): ScopeIntervals {
  const now = new Date()
  const day = new Date(now)
  day.setUTCHours(0, 0, 0, 0)
  return { day: dateAsInt(day), eow: dateAsInt(endOfWeek(now)), eom: dateAsInt(endOfMonth(now)) }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
export function dateAsInt(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

export function intAsDate(days: number): Date {
  return new Date(days * MS_PER_DAY)
}

/** get the last day of the week, e.g. "this Sunday" */
export function endOfWeek(date: Date): Date {
  const dayOfWeek = date.getUTCDay()
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  if (dayOfWeek === 0) {
    // Sunday -  return this date as it's the end of the week
    return d
  } else {
    // else if not Sunday, add enough days to get to the next Sunday
    d.setUTCDate(d.getUTCDate() + (7 - dayOfWeek))
    return d
  }
}

/** get the last day of the month */
export function endOfMonth(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d
}
