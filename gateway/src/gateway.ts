/* eslint-disable no-undef */
import * as logfire from '@pydantic/logfire-api'

import { ApiKeyInfo, guardProviderID, providerIdArray } from './types'
import { textResponse } from './utils'
import { apiKeyAuth, disableApiKeyAuth } from './auth'
import type { IntervalSpend } from './db'
import { getProvider } from './providers'
import { OtelTrace } from './otel'
import { genAiOtelAttributes } from './otelAttributes'
import type { GatewayEnv } from '.'

export async function gateway(request: Request, ctx: ExecutionContext, url: URL, env: GatewayEnv): Promise<Response> {
  const { pathname } = url
  const providerMatch = /^\/([^/]+)\/(.*)$/.exec(pathname)
  if (!providerMatch) {
    return textResponse(404, 'Path not found')
  }
  const [, provider, rest] = providerMatch as unknown as [string, string, string]

  if (!guardProviderID(provider)) {
    return textResponse(400, `Invalid provider '${provider}', should be one of ${providerIdArray.join(', ')}`)
  }

  const apiKey = await apiKeyAuth(request, env)

  if (!apiKey.active) {
    return textResponse(403, 'Unauthorized - Key not active')
  }

  let providerProxies = apiKey.providers.filter((p) => p.providerID === provider)

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

  const otel = new OtelTrace(request, apiKey.otelSettings, env.githubSha)

  const ProxyCls = getProvider(providerProxy.providerID)

  const proxy = new ProxyCls(request, env, apiKey, providerProxy, rest)

  const dispatchSpan = otel.startSpan()
  const result = await proxy.dispatch()

  const [spanName, attributes, level] = genAiOtelAttributes(result, proxy.providerId())
  dispatchSpan.end(spanName, attributes, { level })

  let response: Response
  if ('successStatus' in result) {
    const { successStatus, responseHeaders, responseBody, cost } = result
    runAfter(ctx, 'recordSpend', recordSpend(apiKey, cost, env))
    response = new Response(responseBody, {
      status: successStatus,
      headers: responseHeaders,
    })
  } else if ('error' in result) {
    const { error, disableKey } = result
    if (disableKey) {
      runAfter(ctx, 'disableApiKey', disableApiKey(apiKey, env, 'Invalid request'))
      response = textResponse(400, `${error}, API key disabled`)
    } else {
      response = textResponse(400, error)
    }
  } else {
    const { unexpectedStatus, responseHeaders, responseBody } = result
    response = new Response(responseBody, {
      status: unexpectedStatus,
      headers: responseHeaders,
    })
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

export async function disableApiKey(apiKey: ApiKeyInfo, env: GatewayEnv, reason: string): Promise<void> {
  await disableApiKeyAuth(apiKey, env)
  await env.keysDb.disableKey(apiKey.id, reason)
}

async function recordSpend(apiKey: ApiKeyInfo, spend: number, env: GatewayEnv): Promise<void> {
  const { id, team, user } = apiKey
  const now = new Date()
  const today = isoDate(now)
  const week = startOfWeek(now)
  const month = startOfMonth(now)
  const intervalSpends: IntervalSpend[] = []
  if (apiKey.keySpendingLimitDaily != null) {
    intervalSpends.push({ intervalId: `key-daily-${id}-${today}`, limit: apiKey.keySpendingLimitDaily })
  }
  if (apiKey.keySpendingLimitWeekly != null) {
    intervalSpends.push({ intervalId: `key-weekly-${id}-${week}`, limit: apiKey.keySpendingLimitWeekly })
  }
  if (apiKey.keySpendingLimitMonthly != null) {
    intervalSpends.push({ intervalId: `key-monthly-${id}-${month}`, limit: apiKey.keySpendingLimitMonthly })
  }
  if (apiKey.keySpendingLimitTotal != null) {
    intervalSpends.push({ intervalId: `key-total-${id}`, limit: apiKey.keySpendingLimitTotal })
  }

  if (user != null) {
    if (apiKey.userSpendingLimitDaily != null) {
      intervalSpends.push({ intervalId: `user-daily-${user}-${today}`, limit: apiKey.userSpendingLimitDaily })
    }
    if (apiKey.userSpendingLimitWeekly != null) {
      intervalSpends.push({ intervalId: `user-weekly-${user}-${week}`, limit: apiKey.userSpendingLimitWeekly })
    }
    if (apiKey.userSpendingLimitMonthly != null) {
      intervalSpends.push({ intervalId: `user-monthly-${user}-${month}`, limit: apiKey.userSpendingLimitMonthly })
    }
  }

  if (apiKey.teamSpendingLimitDaily != null) {
    intervalSpends.push({ intervalId: `team-daily-${team}-${today}`, limit: apiKey.teamSpendingLimitDaily })
  }
  if (apiKey.teamSpendingLimitWeekly != null) {
    intervalSpends.push({ intervalId: `team-weekly-${team}-${week}`, limit: apiKey.teamSpendingLimitWeekly })
  }
  if (apiKey.teamSpendingLimitMonthly != null) {
    intervalSpends.push({ intervalId: `team-monthly-${team}-${month}`, limit: apiKey.teamSpendingLimitMonthly })
  }
  const limitExceeded = await env.limitDb.incrementSpend(intervalSpends, spend)

  if (limitExceeded) {
    await disableApiKey(apiKey, env, 'spending limit exceeded')
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
