import * as logfire from '@pydantic/logfire-api'

import { ApiKeyInfo } from '../types'
import { textResponse } from '../utils'
import type { GatewayEnv } from '..'

import { apiKeyAuth, disableApiKeyAuth } from './auth'
import { getProvider } from './providers'
import { OtelTrace } from './otel'

export async function gateway(request: Request, ctx: ExecutionContext, url: URL, env: GatewayEnv): Promise<Response> {
  const { pathname } = url
  const providerMatch = pathname.match(/^\/([^\/]+)\/(.*)$/)
  if (!providerMatch) {
    return textResponse(404, 'Path not found')
  }
  const [, provider, rest] = providerMatch as [string, string, string]

  const apiKey = await apiKeyAuth(request, env)
  const otel = new OtelTrace(request.headers, apiKey.otelSettings || {})

  const providerProxy = apiKey.providers[provider]
  if (!providerProxy) {
    return textResponse(404, `No provider found named '${provider}'`)
  }

  const proxyCls = getProvider(providerProxy.providerId)

  const proxy = new proxyCls(request, env, apiKey, providerProxy, rest)

  const dispatchSpan = otel.startSpan()
  const result = await proxy.dispatch()

  if ('successResponse' in result) {
    dispatchSpan.end('dispatch success', { price: result.price })
    runAfter(ctx, otel.send())
    runAfter(ctx, recordSpend(apiKey, result.price, env))
    return result.successResponse
  } else if ('error' in result) {
    dispatchSpan.end('dispatch error', { error: result.error }, { level: 'error' })
    runAfter(ctx, otel.send())
    const { error, disableKey } = result
    if (disableKey) {
      runAfter(ctx, disableApiKey(apiKey, env, 'Invalid request'))
      return textResponse(400, `${error}, API key disabled`)
    } else {
      return textResponse(400, error)
    }
  } else {
    dispatchSpan.end('dispatch failed', { response_status: result.failResponse.status }, { level: 'warn' })
    runAfter(ctx, otel.send())
    return result.failResponse
  }
}

function runAfter(ctx: ExecutionContext, promise: Promise<unknown>) {
  ctx.waitUntil(wrapLogfire(promise))
}

async function wrapLogfire(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch (error) {
    logfire.reportError('Error in ctx.waitUntil', error as Error)
    throw error
  }
}

export async function disableApiKey(apiKey: ApiKeyInfo, env: GatewayEnv, reason: string): Promise<void> {
  await disableApiKeyAuth(apiKey, env)
  await env.keysDb.disableKey(apiKey.id, reason)
}

async function recordSpend(apiKey: ApiKeyInfo, spend: number, env: GatewayEnv): Promise<void> {
  const { id, org, team, user } = apiKey
  const now = new Date()
  const today = isoDate(now)
  const week = startOfWeek(now)
  const month = startOfMonth(now)
  const ex: string[] = []
  if (typeof apiKey.keySpendingLimitDaily === 'number') {
    await incrementSpend('key-daily', `${id}-${today}`, spend, apiKey.keySpendingLimitDaily, ex, env)
  }
  if (typeof apiKey.keySpendingLimitWeekly === 'number') {
    await incrementSpend('key-weekly', `${id}-${week}`, spend, apiKey.keySpendingLimitWeekly, ex, env)
  }
  if (typeof apiKey.keySpendingLimitMonthly === 'number') {
    await incrementSpend('key-monthly', `${id}-${month}`, spend, apiKey.keySpendingLimitMonthly, ex, env)
  }
  if (typeof apiKey.keySpendingLimitTotal === 'number') {
    await incrementSpend('key-total', `${id}`, spend, apiKey.keySpendingLimitTotal, ex, env)
  }

  if (typeof user === 'string') {
    if (typeof apiKey.userSpendingLimitDaily === 'number') {
      await incrementSpend('user-daily', `${user}-${today}`, spend, apiKey.userSpendingLimitDaily, ex, env)
    }
    if (typeof apiKey.userSpendingLimitWeekly === 'number') {
      await incrementSpend('user-weekly', `${user}-${week}`, spend, apiKey.userSpendingLimitWeekly, ex, env)
    }
    if (typeof apiKey.userSpendingLimitMonthly === 'number') {
      await incrementSpend('user-monthly', `${user}-${month}`, spend, apiKey.userSpendingLimitMonthly, ex, env)
    }
  }

  if (typeof apiKey.teamSpendingLimitDaily === 'number') {
    await incrementSpend('team-daily', `${team}-${today}`, spend, apiKey.teamSpendingLimitDaily, ex, env)
  }
  if (typeof apiKey.teamSpendingLimitWeekly === 'number') {
    await incrementSpend('team-weekly', `${team}-${week}`, spend, apiKey.teamSpendingLimitWeekly, ex, env)
  }
  // always set monthly team spend and include org in the key so we can sum to get monthly org spend
  await incrementSpend('team-monthly', `${org}-${team}-${month}`, spend, apiKey.teamSpendingLimitMonthly, ex, env)

  if (ex.length) {
    await disableApiKey(apiKey, env, `limits exceeded: ${ex.join(', ')}`)
  }
}

async function incrementSpend(
  scope: string,
  uniqueID: string,
  spend: number,
  limit: number | null,
  scopesExceeded: string[],
  env: GatewayEnv,
): Promise<void> {
  let limitExceeded = await env.limitDb.incrementSpend(`${scope}-${uniqueID}`, spend, limit)
  if (limitExceeded) {
    scopesExceeded.push(scope)
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function startOfWeek(date: Date): string {
  const dayOfWeek = date.getDay()
  const sOfWeek = new Date(date)
  if (dayOfWeek === 0) {
    // sunday -  subtract 6 days to get back to monday
    sOfWeek.setDate(date.getDate() - 6)
  } else if (dayOfWeek !== 1) {
    // else if not monday, subtract day + 1 to get back to monday
    sOfWeek.setDate(date.getDate() - dayOfWeek + 1)
  }
  return isoDate(sOfWeek)
}

function startOfMonth(date: Date): string {
  const sOfMonth = new Date(date)
  sOfMonth.setDate(1)
  return isoDate(sOfMonth)
}
