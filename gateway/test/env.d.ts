interface Env {
  KV: KVNamespace
  GITHUB_SHA: string
  limitsDB: D1Database
  OPENAI_API_KEY: string
  GROQ_API_KEY: string
  ANTHROPIC_API_KEY: string
}

declare module 'cloudflare:test' {
  type ProvidedEnv = Env
}
