import { DefaultProviderProxy } from './default'
import { ResponseError } from '../utils'

export class GoogleVertexProvider extends DefaultProviderProxy {
  url() {
    if (this.providerProxy.baseUrl) {
      const restOfPath = this.restOfPath.replace(/^v1beta\/models\//, '')
      return `${this.providerProxy.baseUrl}/${restOfPath}`
    } else {
      return { error: 'baseUrl is required for the Google Provider' }
    }
  }

  async requestHeaders(headers: Headers): Promise<void> {
    const token = await this.authToken()
    headers.set('Authorization', `Bearer ${token}`)
  }

  async authToken(): Promise<string> {
    const serviceAccountHash = await hash(this.providerProxy.credentials)
    const cacheKey = `google-vertex:${serviceAccountHash}`
    const cachedToken = await this.env.kv.get(cacheKey, { cacheTtl: 300 })
    if (cachedToken) {
      return cachedToken
    }
    const serviceAccount = getServiceAccount(this.providerProxy.credentials)
    const jwt = await jwtSign(serviceAccount)
    const token = await getAccessToken(jwt)
    await this.env.kv.put(cacheKey, token, { expirationTtl: 3000 })
    return token
  }
}

function getServiceAccount(credentials: string): ServiceAccount {
  let client_email, private_key
  try {
    ;({ client_email, private_key } = JSON.parse(credentials))
  } catch (error) {
    throw new ResponseError(400, 'provider credentials are not valid JSON')
  }
  if (typeof client_email !== 'string') {
    throw new ResponseError(400, `"client_email" should be a string, not ${typeof client_email}`)
  }
  if (typeof private_key !== 'string') {
    throw new ResponseError(400, `"private_key" should be a string, not ${typeof private_key}`)
  }
  return { client_email, private_key }
}

interface ServiceAccount {
  client_email: string
  private_key: string
}

const encoder = new TextEncoder()

async function hash(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(input))
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const tokenUrl = 'https://oauth2.googleapis.com/token'

async function jwtSign(serviceAccount: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUrl,
    exp: now + 3600,
    iat: now,
  }

  const encodedHeader = b64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const encodedPayload = b64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const privateKeyPem = serviceAccount.private_key.replace(/-{5}[A-Z]+ PRIVATE KEY-{5}/g, '').replace(/\s/g, '')

  const privateKeyArray = Uint8Array.from(atob(privateKeyPem), (c) => c.charCodeAt(0))

  const algo = 'RSASSA-PKCS1-v1_5'
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyArray,
    {
      name: algo,
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(algo, key, encoder.encode(signingInput))

  const encodedSignature = b64UrlEncodeArray(new Uint8Array(signature))

  return `${signingInput}.${encodedSignature}`
}

async function getAccessToken(jwt: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    signal: AbortSignal.timeout(10000),
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new ResponseError(400, `Failed to get GCP access token, response:\n${response.status}: ${text}`)
  }
  const { access_token } = (await response.json()) as TokenResponse
  return access_token
}

interface TokenResponse {
  access_token: string
}

const b64UrlEncode = (data: string): string => btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
const b64UrlEncodeArray = (data: Uint8Array): string => b64UrlEncode(String.fromCharCode(...data))
