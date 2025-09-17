import { DefaultProviderProxy, JsonData, isMapping } from '../default'
import { authToken, getServiceAccount } from './auth'
import { otelEvents, GoogleRequest, GenerateContentResponse } from './otel'

export class GoogleVertexProvider extends DefaultProviderProxy {
  protected usageField = 'usageMetadata'

  url() {
    if (this.providerProxy.baseUrl) {
      // Extract project ID from credentials
      const projectId = getServiceAccount(this.providerProxy.credentials).project_id

      // Extract location from baseUrl (e.g., us-central1 from https://us-central1-aiplatform.googleapis.com)
      // If no location is found, use "global"
      const locationMatch = /https:\/\/(.+)-aiplatform\.googleapis\.com/.exec(this.providerProxy.baseUrl)
      const location = locationMatch ? locationMatch[1] : 'global'

      // Transform the path to inject correct project and location
      const extra = transformPath(this.restOfPath, projectId, location!)
      const finalUrl = `${this.providerProxy.baseUrl}/${extra}`
      console.log('Final URL:', finalUrl)
      return finalUrl
    } else {
      return { error: 'baseUrl is required for the Google Provider' }
    }
  }

  async prepRequest() {
    const requestBodyText = await this.request.text()
    let requestBodyData
    try {
      requestBodyData = JSON.parse(requestBodyText) as JsonData
    } catch (_error) {
      return { error: 'invalid request JSON' }
    }
    const m = /\/models\/(.+?):/.exec(this.restOfPath)
    if (m) {
      return { requestBodyText, requestBodyData, requestModel: m[1] }
    } else {
      return { error: 'unable to find model in path' }
    }
  }

  async requestHeaders(headers: Headers): Promise<void> {
    const token = await authToken(this.providerProxy.credentials, this.env.kv)
    headers.set('Authorization', `Bearer ${token}`)
  }

  otelEvents(requestBody: GoogleRequest, responseBody: GenerateContentResponse) {
    return otelEvents(requestBody, responseBody)
  }

  responseId(responseBody: JsonData): string | undefined {
    return isMapping(responseBody) && typeof responseBody.responseId === 'string' ? responseBody.responseId : undefined
  }
}

function transformPath(restOfPath: string, projectId: string, location: string): string {
  return restOfPath
    .replace(
      /^v1beta1\/publishers\/google\/models/,
      `v1beta1/projects/${projectId}/locations/${location}/publishers/google/models`,
    )
    .replace(/^projects\/unset\/locations\/unset/, `projects/${projectId}/locations/${location}`)
}
