import type { ElectronAPI } from '@/types/electron'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

async function request<T>(method: HttpMethod, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function createPollingSubscription<T>(
  getter: () => Promise<T>,
  callback: (value: T) => void,
  intervalMs: number,
  isEqual: (left: T, right: T) => boolean = (left, right) => JSON.stringify(left) === JSON.stringify(right)
): () => void {
  let active = true
  let initialized = false
  let previousValue: T | undefined

  const poll = async () => {
    if (!active) return

    try {
      const nextValue = await getter()
      if (!initialized || previousValue === undefined || !isEqual(previousValue, nextValue)) {
        previousValue = nextValue
        initialized = true
        callback(nextValue)
      }
    } catch (error) {
      console.error('[browserElectronAPI] Polling failed:', error)
    }
  }

  void poll()
  const timer = window.setInterval(poll, intervalMs)

  return () => {
    active = false
    window.clearInterval(timer)
  }
}

function createNoopUnsubscribe(): () => void {
  return () => undefined
}

function createBrowserElectronAPI(): ElectronAPI {
  const api = {
    proxy: {
      start: (port?: number) => request('POST', '/api/proxy/start', { port }),
      stop: () => request('POST', '/api/proxy/stop'),
      getStatus: () => request('GET', '/api/proxy/status'),
      onStatusChanged: (callback: (status: any) => void) =>
        createPollingSubscription(() => request('GET', '/api/proxy/status'), callback, 3000),
    },
    store: {
      get: <T>(key: string) => request<T | undefined>('GET', `/api/store/${encodeURIComponent(key)}`),
      set: <T>(key: string, value: T) => request<void>('PUT', `/api/store/${encodeURIComponent(key)}`, { value }),
      delete: (key: string) => request<void>('DELETE', `/api/store/${encodeURIComponent(key)}`),
      clearAll: () => request<void>('POST', '/api/store/clear'),
    },
    providers: {
      getAll: () => request('GET', '/api/providers'),
      getBuiltin: () => request('GET', '/api/providers/builtin'),
      add: (data: any) => request('POST', '/api/providers', data),
      update: (id: string, updates: any) => request('PUT', `/api/providers/${encodeURIComponent(id)}`, updates),
      delete: (id: string) => request('DELETE', `/api/providers/${encodeURIComponent(id)}`),
      checkStatus: (providerId: string) => request('POST', `/api/providers/${encodeURIComponent(providerId)}/check-status`),
      checkAllStatus: () => request('POST', '/api/providers/check-all-status'),
      duplicate: (id: string) => request('POST', `/api/providers/${encodeURIComponent(id)}/duplicate`),
      export: async () => {
        throw new Error('Provider export is not supported in web mode yet')
      },
      import: async () => {
        throw new Error('Provider import is not supported in web mode yet')
      },
      updateModels: (providerId: string) => request('POST', `/api/providers/${encodeURIComponent(providerId)}/update-models`),
      getEffectiveModels: (providerId: string) => request('GET', `/api/providers/${encodeURIComponent(providerId)}/effective-models`),
      addCustomModel: (providerId: string, model: { displayName: string; actualModelId: string }) =>
        request('POST', `/api/providers/${encodeURIComponent(providerId)}/custom-models`, model),
      removeModel: (providerId: string, modelName: string) =>
        request('DELETE', `/api/providers/${encodeURIComponent(providerId)}/custom-models/${encodeURIComponent(modelName)}`),
      resetModels: (providerId: string) => request('POST', `/api/providers/${encodeURIComponent(providerId)}/reset-models`),
    },
    accounts: {
      getAll: (includeCredentials?: boolean) =>
        request('GET', `/api/accounts${includeCredentials ? '?includeCredentials=true' : ''}`),
      getById: (id: string, includeCredentials?: boolean) =>
        request('GET', `/api/accounts/${encodeURIComponent(id)}${includeCredentials ? '?includeCredentials=true' : ''}`),
      getByProvider: (providerId: string) => request('GET', `/api/providers/${encodeURIComponent(providerId)}/accounts`),
      add: (data: any) => request('POST', '/api/accounts', data),
      update: (id: string, updates: any) => request('PUT', `/api/accounts/${encodeURIComponent(id)}`, updates),
      delete: (id: string) => request('DELETE', `/api/accounts/${encodeURIComponent(id)}`),
      validate: (accountId: string) => request('POST', `/api/accounts/${encodeURIComponent(accountId)}/validate`),
      validateToken: (providerId: string, credentials: Record<string, string>) =>
        request('POST', '/api/accounts/validate-token', { providerId, credentials }),
      getCredits: (accountId: string) => request('GET', `/api/accounts/${encodeURIComponent(accountId)}/credits`),
      clearChats: (accountId: string) => request('POST', `/api/accounts/${encodeURIComponent(accountId)}/clear-chats`),
      batchImport: (data: { providerId: string; rawText: string; dailyLimit?: number }) =>
        request('POST', '/api/accounts/batch-import', data),
    },
    oauth: {
      startLogin: async () => ({ success: false, error: 'OAuth login is not supported in web mode' }),
      cancelLogin: async () => undefined,
      loginWithToken: async () => ({ success: false, error: 'OAuth login is not supported in web mode' }),
      validateToken: async () => ({ valid: false, error: 'OAuth validation is not supported in web mode' }),
      refreshToken: async () => null,
      getStatus: async () => 'idle',
      startInAppLogin: async () => ({ success: false, error: 'In-app login is not supported in web mode' }),
      cancelInAppLogin: async () => undefined,
      isInAppLoginOpen: async () => false,
      onCallback: createNoopUnsubscribe,
      onProgress: createNoopUnsubscribe,
    },
    logs: {
      get: (filter?: Record<string, unknown>) => {
        const params = new URLSearchParams()
        if (filter?.limit !== undefined) params.set('limit', String(filter.limit))
        if (filter?.level !== undefined) params.set('level', String(filter.level))
        return request('GET', `/api/logs${params.toString() ? `?${params.toString()}` : ''}`)
      },
      getStats: () => request('GET', '/api/logs/stats'),
      getTrend: (days?: number) => request('GET', `/api/logs/trend${days ? `?days=${days}` : ''}`),
      getAccountTrend: (accountId: string, days?: number) =>
        request('GET', `/api/logs/account-trend/${encodeURIComponent(accountId)}${days ? `?days=${days}` : ''}`),
      clear: () => request('POST', '/api/logs/clear'),
      export: async () => {
        throw new Error('Log export is not supported in web mode yet')
      },
      getById: async () => undefined,
      onNewLog: (callback: (log: any) => void) => {
        let latestId = ''
        return createPollingSubscription(
          () => request<any[]>('GET', '/api/logs?limit=1'),
          (logs) => {
            const newest = logs?.[0]
            if (newest && newest.id !== latestId) {
              latestId = newest.id
              callback(newest)
            }
          },
          3000
        )
      },
    },
    requestLogs: {
      get: (filter?: Record<string, unknown>) => {
        const params = new URLSearchParams()
        if (filter?.limit !== undefined) params.set('limit', String(filter.limit))
        if (filter?.status !== undefined) params.set('status', String(filter.status))
        if (filter?.providerId !== undefined) params.set('providerId', String(filter.providerId))
        return request('GET', `/api/request-logs${params.toString() ? `?${params.toString()}` : ''}`)
      },
      getById: async () => undefined,
      getStats: () => request('GET', '/api/request-logs/stats'),
      getTrend: (days?: number) => request('GET', `/api/request-logs/trend${days ? `?days=${days}` : ''}`),
      clear: () => request('POST', '/api/request-logs/clear'),
      onNewLog: (callback: (log: any) => void) => {
        let latestId = ''
        return createPollingSubscription(
          () => request<any[]>('GET', '/api/request-logs?limit=1'),
          (logs) => {
            const newest = logs?.[0]
            if (newest && newest.id !== latestId) {
              latestId = newest.id
              callback(newest)
            }
          },
          3000
        )
      },
    },
    statistics: {
      get: () => request('GET', '/api/statistics'),
      getToday: () => request('GET', '/api/statistics/today'),
    },
    app: {
      getVersion: async () => {
        const result = await request<{ version: string }>('GET', '/api/app/version')
        return result.version
      },
      checkUpdate: () => request('GET', '/api/app/check-update'),
      downloadUpdate: async () => undefined,
      installUpdate: async () => undefined,
      getUpdateStatus: async () => ({
        checking: false,
        available: false,
        downloading: false,
        downloaded: false,
        error: null,
        progress: null,
        version: null,
        releaseDate: null,
        releaseNotes: null,
      }),
      onUpdateChecking: createNoopUnsubscribe,
      onUpdateAvailable: createNoopUnsubscribe,
      onUpdateNotAvailable: createNoopUnsubscribe,
      onUpdateProgress: createNoopUnsubscribe,
      onUpdateDownloaded: createNoopUnsubscribe,
      onUpdateError: createNoopUnsubscribe,
      minimize: async () => undefined,
      maximize: async () => undefined,
      close: async () => undefined,
      showWindow: async () => undefined,
      hideWindow: async () => undefined,
      openExternal: async (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
    },
    config: {
      get: () => request('GET', '/api/config'),
      update: (updates: Record<string, unknown>) => request('PUT', '/api/config', updates),
      onConfigChanged: createNoopUnsubscribe,
    },
    prompts: {
      getAll: () => request('GET', '/api/prompts'),
      getBuiltin: () => request('GET', '/api/prompts/builtin'),
      getCustom: async () => [],
      getById: async () => undefined,
      add: async () => {
        throw new Error('Prompt editing is not supported in web mode yet')
      },
      update: async () => null,
      delete: async () => false,
      getByType: async () => [],
    },
    session: {
      getConfig: () => request('GET', '/api/session/config'),
      updateConfig: (config: Record<string, unknown>) => request('PUT', '/api/session/config', config),
      getAll: () => request('GET', '/api/session'),
      getActive: async () => [],
      getById: async () => undefined,
      getByAccount: async () => [],
      getByProvider: async () => [],
      delete: async () => false,
      clearAll: async () => undefined,
      cleanExpired: async () => 0,
    },
    managementApi: {
      getConfig: () => request('GET', '/api/management-api'),
      updateConfig: (updates: Record<string, unknown>) => request('PUT', '/api/management-api', updates),
      generateSecret: async () => {
        const result = await request<{ secret: string }>('POST', '/api/management-api/generate-secret')
        return result.secret
      },
    },
    contextManagement: {
      getConfig: () => request('GET', '/api/context-management'),
      updateConfig: (updates: Record<string, unknown>) => request('PUT', '/api/context-management', updates),
    },
    on: createNoopUnsubscribe,
    send: () => undefined,
    invoke: async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case 'proxy:getStatistics':
          return request('GET', '/api/proxy/statistics')
        case 'managementApi:getConfig':
          return request('GET', '/api/management-api')
        case 'managementApi:updateConfig':
          return request('PUT', '/api/management-api', args[0])
        case 'managementApi:generateSecret': {
          const result = await request<{ secret: string }>('POST', '/api/management-api/generate-secret')
          return result.secret
        }
        case 'app:openExternal':
          return api.app.openExternal(String(args[0] || ''))
        case 'oauth:loginWithToken':
          return { success: false, error: 'OAuth login is not supported in web mode' }
        default:
          throw new Error(`Unsupported invoke channel in web mode: ${channel}`)
      }
    },
  }

  return api as unknown as ElectronAPI
}

export function ensureBrowserElectronAPI(): void {
  if (typeof window === 'undefined' || window.electronAPI) {
    return
  }

  window.electronAPI = createBrowserElectronAPI()
}

export default ensureBrowserElectronAPI
