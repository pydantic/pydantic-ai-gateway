import { KeysDb, ApiKeyInfo, OtelSettings } from '@pydantic/ai-gateway'
import { config } from './config'

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
      }
    } else if (team.otelWriteToken || team.otelBaseUrl) {
      otelSettings = {
        writeToken: team.otelWriteToken,
        baseUrl: team.otelBaseUrl,
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
      providers: Object.fromEntries(keyInfo.providers.map((name) => [name, config.providers[name]!])),
      otelSettings,
    }
  }

  async disableKey(_id: string, _reason: string): Promise<void> {
    // do nothing
  }
}
