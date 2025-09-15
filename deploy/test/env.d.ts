declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    limitsDB: D1Database
  }
}
