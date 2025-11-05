interface Env {
  KV: KVNamespace
  GITHUB_SHA: string
  limitsDB: D1Database
  OPENAI_API_KEY: string
  GROQ_API_KEY: string
  ANTHROPIC_API_KEY: string
  AWS_BEARER_TOKEN_BEDROCK: string
  GOOGLE_SERVICE_ACCOUNT_KEY: string
}

declare module 'cloudflare:test' {
  type ProvidedEnv = Env
}
