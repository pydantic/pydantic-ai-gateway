import { KeysDb, ApiKeyInfo } from '@pydantic/ai-gateway'
import { config } from './config'

export class ConfigDB extends KeysDb {
  async apiKeyAuth(key: string): Promise<ApiKeyInfo | null> {
    return null
  }

  async disableKey(_id: string, _reason: string): Promise<void> {
    // do nothing
  }
}
