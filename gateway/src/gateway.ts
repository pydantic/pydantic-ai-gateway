import * as logfire from '@pydantic/logfire-api'

import type { GatewayEnv } from '.'
import { apiKeyAuth, disableApiKeyAuth } from './auth'
import { type ExceededScope, endOfMonth, endOfWeek, type SpendScope, scopeIntervals } from './db'
import { OtelTrace } from './otel'
import { genAiOtelAttributes } from './otel/attributes'
import { getProvider } from './providers'
import { type ApiKeyInfo, guardProviderID, providerIdArray } from './types'
import { textResponse } from './utils'

export async function gateway(request: Request, ctx: ExecutionContext, env: GatewayEnv): Promise<Response> {
  const { pathname } = new URL(request.url)
  const proxyRegex = env.proxyRegex ?? /^\/(.+?)\/(.*)$/
  const providerMatch = proxyRegex.exec(pathname)
  if (!providerMatch) {
    return textResponse(404, 'Path not found')
  }
  const [, provider, rest] = providerMatch as unknown as [string, string, string]

  if (!guardProviderID(provider)) {
    return textResponse(400, `Invalid provider '${provider}', should be one of ${providerIdArray.join(', ')}`)
  }

  const apiKey = await apiKeyAuth(request, env)

  if (apiKey.status !== 'active') {
    return textResponse(403, `Unauthorized - Key ${apiKey.status}`)
  }

  let providerProxies = apiKey.providers.filter((p) => p.providerId === provider)

  const profile = request.headers.get('pydantic-ai-gateway-profile')
  if (profile !== null) {
    providerProxies = providerProxies.filter((p) => p.profile === profile)
  }

  // sort providers on priority, highest first
  providerProxies.sort((a, b) => (b.priority ?? 1) - (a.priority ?? 1))

  const providerProxy = providerProxies[0]
  if (!providerProxy) {
    return textResponse(403, 'Forbidden - Provider not supported by this API Key')
  }

  const otel = new OtelTrace(request, apiKey.otelSettings, env)

  const ProxyCls = getProvider(providerProxy.providerId)

  const proxy = new ProxyCls(request, env, apiKey, providerProxy, rest)

  const dispatchSpan = otel.startSpan()
  const result = await proxy.dispatch()

  const [spanName, attributes, level] = genAiOtelAttributes(result, proxy)
  dispatchSpan.end(spanName, attributes, { level })

  let response: Response
  if ('successStatus' in result) {
    const { successStatus, responseHeaders, responseBody, cost } = result
    runAfter(ctx, 'recordSpend', recordSpend(apiKey, cost, env))
    response = new Response(responseBody, { status: successStatus, headers: responseHeaders })
  } else if ('error' in result) {
    const { error, disableKey } = result
    if (disableKey) {
      runAfter(ctx, 'disableApiKey', blockApiKey(apiKey, env, 'Invalid request'))
      response = textResponse(400, `${error}, API key disabled`)
    } else {
      response = textResponse(400, error)
    }
  } else {
    const { unexpectedStatus, responseHeaders, responseBody } = result
    response = new Response(responseBody, { status: unexpectedStatus, headers: responseHeaders })
  }
  runAfter(ctx, 'otel.send', otel.send())
  return response
}

function runAfter(ctx: ExecutionContext, name: string, promise: Promise<unknown>) {
  ctx.waitUntil(wrapLogfire(name, promise))
}

async function wrapLogfire(functionName: string, promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch (error) {
    logfire.reportError(`Error running ${functionName} in ctx.waitUntil`, error as Error)
    throw error
  }
}

async function blockApiKey(apiKey: ApiKeyInfo, env: GatewayEnv, reason: string): Promise<void> {
  await disableApiKey(apiKey, env, reason, 'blocked')
}

export async function disableApiKey(
  apiKey: ApiKeyInfo,
  env: GatewayEnv,
  reason: string,
  newStatus: 'blocked' | 'limit-exceeded',
  expirationTtl?: number,
): Promise<void> {
  apiKey.status = newStatus
  await disableApiKeyAuth(apiKey, env, expirationTtl)
  await env.keysDb.disableKey(apiKey.id, reason, newStatus, expirationTtl)
}

async function recordSpend(apiKey: ApiKeyInfo, spend: number, env: GatewayEnv): Promise<void> {
  const { id, team, user } = apiKey

  const { day, endOfWeek, endOfMonth } = scopeIntervals()

  const intervalSpends: SpendScope[] = []
  if (isSet(apiKey.keySpendingLimitDaily)) {
    intervalSpends.push({
      entityId: id,
      entityType: 'key',
      scope: 'daily',
      scopeInterval: day,
      limit: apiKey.keySpendingLimitDaily,
    })
  }
  if (isSet(apiKey.keySpendingLimitWeekly)) {
    intervalSpends.push({
      entityId: id,
      entityType: 'key',
      scope: 'weekly',
      scopeInterval: endOfWeek,
      limit: apiKey.keySpendingLimitWeekly,
    })
  }
  if (isSet(apiKey.keySpendingLimitMonthly)) {
    intervalSpends.push({
      entityId: id,
      entityType: 'key',
      scope: 'monthly',
      scopeInterval: endOfMonth,
      limit: apiKey.keySpendingLimitMonthly,
    })
  }
  if (isSet(apiKey.keySpendingLimitTotal)) {
    intervalSpends.push({ entityId: id, entityType: 'key', scope: 'total', limit: apiKey.keySpendingLimitTotal })
  }

  if (user != null) {
    if (isSet(apiKey.userSpendingLimitDaily)) {
      intervalSpends.push({
        entityId: user,
        entityType: 'user',
        scope: 'daily',
        scopeInterval: day,
        limit: apiKey.userSpendingLimitDaily,
      })
    }
    if (isSet(apiKey.userSpendingLimitWeekly)) {
      intervalSpends.push({
        entityId: user,
        entityType: 'user',
        scope: 'weekly',
        scopeInterval: endOfWeek,
        limit: apiKey.userSpendingLimitWeekly,
      })
    }
    if (isSet(apiKey.userSpendingLimitMonthly)) {
      intervalSpends.push({
        entityId: user,
        entityType: 'user',
        scope: 'monthly',
        scopeInterval: endOfMonth,
        limit: apiKey.userSpendingLimitMonthly,
      })
    }
  }

  if (isSet(apiKey.teamSpendingLimitDaily)) {
    intervalSpends.push({
      entityId: team,
      entityType: 'team',
      scope: 'daily',
      scopeInterval: day,
      limit: apiKey.teamSpendingLimitDaily,
    })
  }
  if (isSet(apiKey.teamSpendingLimitWeekly)) {
    intervalSpends.push({
      entityId: team,
      entityType: 'team',
      scope: 'weekly',
      scopeInterval: endOfWeek,
      limit: apiKey.teamSpendingLimitWeekly,
    })
  }
  if (isSet(apiKey.teamSpendingLimitMonthly)) {
    intervalSpends.push({
      entityId: team,
      entityType: 'team',
      scope: 'monthly',
      scopeInterval: endOfMonth,
      limit: apiKey.teamSpendingLimitMonthly,
    })
  }
  const scopesExceeded = await env.limitDb.incrementSpend(intervalSpends, spend)

  if (scopesExceeded.length) {
    await disableApiKey(
      apiKey,
      env,
      'limits exceeded: ' + scopesExceeded.map(({ entityType, scope }) => `${entityType}-${scope}`).join(', '),
      'limit-exceeded',
      calculateExpirationTtl(scopesExceeded),
    )
  }
}

/**
 * Calculates the time-to-live (TTL) in seconds for API key expiration based on exceeded scopes.
 *
 * @param ex: Set of scope exceeded types that determine the expiration period
 * @returns TTL in seconds until the next reset period, undefined for permanently disabled keys
 *
 * - `key-total`: undefined
 * - Monthly scopes: Returns seconds until next month boundary
 * - Weekly scopes: Returns seconds until next week boundary
 * - Daily scopes: Returns seconds until next day boundary
 */
function calculateExpirationTtl(ex: ExceededScope[]): number | undefined {
  const scopes = new Set(ex.map(({ scope }) => scope))
  const now = new Date()
  let d: Date
  if (scopes.has('total')) {
    return
  } else if (scopes.has('monthly')) {
    d = endOfMonth(now)
  } else if (scopes.has('weekly')) {
    d = endOfWeek(now)
  } else if (scopes.has('daily')) {
    d = new Date(now)
  } else {
    throw new Error('Invalid spending limit scopes, unable to calculate expiration TTL')
  }
  d.setHours(23, 59, 59)
  return Math.floor((d.getTime() - now.getTime()) / 1000)
}

function isSet(value: number | null | undefined): value is number {
  return value !== null && value !== undefined
}
