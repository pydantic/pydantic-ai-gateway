/* eslint-disable no-undef */
import * as logfire from '@pydantic/logfire-api'

import { ApiKeyInfo, guardProviderID } from './types'
import { textResponse } from './utils'
import { apiKeyAuth, disableApiKeyAuth } from './auth'
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
    return textResponse(400, `Invalid provider '${provider}'`)
  }

  const apiKey = await apiKeyAuth(request, env)

  if (!apiKey.active) {
    return textResponse(403, 'Unauthorized - Key not active')
  }

  let providerProxies = apiKey.providers.filter((p) => p.providerID === provider)

  const profile = url.searchParams.get('pydantic-ai-gateway-profile')
  if (profile) {
    providerProxies = providerProxies.filter((p) => p.profile === profile)
  }

  // sort providers on priority
  providerProxies.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1))

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
    await incrementSpend('key-total', id, spend, apiKey.keySpendingLimitTotal, ex, env)
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
  const limitExceeded = await env.limitDb.incrementSpend(`${scope}-${uniqueID}`, spend, limit)
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
