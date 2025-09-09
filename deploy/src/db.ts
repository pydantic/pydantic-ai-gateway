import { KeysDb, ApiKeyInfo, OtelSettings, ProviderProxy } from '@pydantic/ai-gateway'
import { config } from './config'
import type { ApiKey, Config } from './types'

export class ConfigDB extends KeysDb {
  async apiKeyAuth(key: string): Promise<ApiKeyInfo | null> {
    const keyInfo = config.apiKeys[key]
    if (!keyInfo) {
      return null
    }
    const team = config.teams[keyInfo.team]!
    let user = keyInfo.user ? team.users[keyInfo.user] : undefined
    let otelSettings: OtelSettings | null = null
    if (user?.otelWriteToken || user?.otelBaseUrl) {
      otelSettings = {
        writeToken: user.otelWriteToken,
        baseUrl: user.otelBaseUrl,
        exporterOtlpProtocol: user.otelExporterOtlpProtocol,
      }
    } else if (team.otelWriteToken || team.otelBaseUrl) {
      otelSettings = {
        writeToken: team.otelWriteToken,
        baseUrl: team.otelBaseUrl,
        exporterOtlpProtocol: team.otelExporterOtlpProtocol,
      }
    }
    return {
      id: key.substring(0, 5),
      user: keyInfo.user ?? null,
      team: keyInfo.team,
      org: config.org,
      key,
      active: keyInfo.expires ? Date.now() < keyInfo.expires : true,
      // key limits
      keySpendingLimitDaily: keyInfo.spendingLimitDaily ?? null,
      keySpendingLimitWeekly: keyInfo.spendingLimitWeekly ?? null,
      keySpendingLimitMonthly: keyInfo.spendingLimitMonthly ?? null,
      keySpendingLimitTotal: keyInfo.spendingLimitTotal ?? null,
      // team limits
      teamSpendingLimitDaily: team.spendingLimitDaily ?? null,
      teamSpendingLimitWeekly: team.spendingLimitWeekly ?? null,
      teamSpendingLimitMonthly: team.spendingLimitMonthly ?? null,
      // user limits
      userSpendingLimitDaily: user?.spendingLimitDaily ?? null,
      userSpendingLimitWeekly: user?.spendingLimitWeekly ?? null,
      userSpendingLimitMonthly: user?.spendingLimitMonthly ?? null,
      providers: getProviders(keyInfo, config),
      otelSettings,
    }
  }

  async disableKey(_id: string, _reason: string): Promise<void> {
    // do nothing
  }
}

function getProviders<T extends string>(keyInfo: ApiKey<T>, config: Config<T>): ProviderProxy[] {
  let providers: ProviderProxy[]
  if (keyInfo.providers == '__all__') {
    providers = Object.values(config.providers)
  } else {
    providers = keyInfo.providers.map((name) => config.providers[name]).filter((provider) => !!provider)
  }
  return providers
}
