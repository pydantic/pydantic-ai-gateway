export function ctHeader(contentType: string) {
  return { 'Content-Type': contentType }
}

export function textResponse(status: number, message: string, headers?: Record<string, string>) {
  return new Response(message, { status, headers: { ...ctHeader('text/plain'), ...headers } })
}

export function jsonResponse(data: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(data, null, 2) + '\n', {
    headers: { ...ctHeader('application/json'), ...headers },
  })
}

export function response405(...allowMethods: string[]): Response {
  const allow = allowMethods.join(', ')
  return new Response(`405: Method not allowed, Allowed: ${allow}`, {
    status: 405,
    headers: { allow, ...ctHeader('text/plain') },
  })
}

// TODO: this is not used at the moment. We can remove it or keep it for the future
export function getIP(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) {
    return ip
  } else {
    throw new Error('IP address not found')
  }
}

export class ResponseError extends Error {
  status: number
  message: string
  headers?: Record<string, string>

  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message)
    this.status = status
    this.message = message
    this.headers = headers
  }

  response(): Response {
    return textResponse(this.status, this.message, this.headers)
  }
}
