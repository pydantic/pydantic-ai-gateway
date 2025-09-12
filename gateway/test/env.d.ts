interface Env {
  KV: KVNamespace
  GITHUB_SHA: string
  limitsDB: D1Database
}

declare module 'cloudflare:test' {
  type ProvidedEnv = Env
}
