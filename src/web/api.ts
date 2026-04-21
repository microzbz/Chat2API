import Router from '@koa/router'
import type { Context } from 'koa'
import axios from 'axios'
import { storeManager } from '../main/store/store'
import { ProviderManager } from '../main/store/providers'
import AccountManager from '../main/store/accounts'
import { ConfigManager } from '../main/store/config'
import { ProviderChecker } from '../main/providers/checker'
import { CustomProviderManager } from '../main/providers/custom'
import { getBuiltinProvider, getBuiltinProviders } from '../main/providers/builtin'
import { proxyServer } from '../main/proxy/server'
import { proxyStatusManager } from '../main/proxy/status'
import { sessionManager } from '../main/proxy/sessionManager'
import { generateManagementSecret } from '../main/proxy/middleware/managementAuth'
import { runtimeApp } from '../main/platform/runtime'
import type { Account, Provider, ProviderCheckResult } from '../shared/types'

const router = new Router({ prefix: '/api' })

function getProxyStatus() {
  const status = proxyStatusManager.getRunningStatus()
  return {
    isRunning: status.isRunning,
    port: proxyStatusManager.getPort(),
    host: proxyStatusManager.getHost(),
    uptime: status.uptime,
    connections: proxyStatusManager.getStatistics().activeConnections,
  }
}

function getProviderOrBuiltin(providerId: string): Provider | null {
  const provider = ProviderManager.getById(providerId)
  if (provider) {
    return provider
  }

  const builtin = getBuiltinProvider(providerId)
  if (!builtin) {
    return null
  }

  return {
    id: builtin.id,
    name: builtin.name,
    type: 'builtin',
    authType: builtin.authType,
    apiEndpoint: builtin.apiEndpoint,
    chatPath: builtin.chatPath,
    headers: builtin.headers,
    enabled: true,
    description: builtin.description,
    supportedModels: builtin.supportedModels || [],
    modelMappings: builtin.modelMappings || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function getPrimaryCredentialField(providerId: string, authType?: string): string {
  const builtin = getBuiltinProvider(providerId)
  const credentialField = builtin?.credentialFields?.[0]?.name
  if (credentialField) {
    return credentialField
  }

  switch (providerId) {
    case 'glm':
      return 'refresh_token'
    case 'qwen':
      return 'ticket'
    case 'perplexity':
      return 'sessionToken'
    default:
      break
  }

  switch (authType) {
    case 'refresh_token':
      return 'refresh_token'
    case 'tongyi_sso_ticket':
      return 'ticket'
    default:
      return 'token'
  }
}

function parseBatchImportLine(line: string): string[] {
  const delimiters = ['----', '\t', ',', '|']

  for (const delimiter of delimiters) {
    if (line.includes(delimiter)) {
      return line
        .split(delimiter)
        .map(part => part.trim())
        .filter(Boolean)
    }
  }

  return [line.trim()].filter(Boolean)
}

router.get('/health', (ctx: Context) => {
  ctx.body = {
    ok: true,
    proxy: getProxyStatus(),
  }
})

router.get('/proxy/status', (ctx: Context) => {
  ctx.body = getProxyStatus()
})

router.get('/proxy/statistics', (ctx: Context) => {
  ctx.body = proxyStatusManager.getStatistics()
})

router.post('/proxy/start', async (ctx: Context) => {
  const request = (ctx.request.body as { port?: number; host?: string }) || {}
  const success = await proxyServer.start(request.port, request.host)
  if (!success) {
    ctx.throw(500, 'Failed to start proxy')
  }
  ctx.body = getProxyStatus()
})

router.post('/proxy/stop', async (ctx: Context) => {
  const success = await proxyServer.stop()
  if (!success && proxyServer.isRunning()) {
    ctx.throw(500, 'Failed to stop proxy')
  }
  ctx.body = getProxyStatus()
})

router.get('/store/:key', (ctx: Context) => {
  const key = ctx.params.key
  ctx.body = storeManager.getStore()?.get(key)
})

router.put('/store/:key', (ctx: Context) => {
  const key = ctx.params.key
  const payload = ctx.request.body as { value?: unknown }
  storeManager.getStore()?.set(key, payload.value)
  ctx.body = { success: true }
})

router.delete('/store/:key', (ctx: Context) => {
  const key = ctx.params.key
  storeManager.getStore()?.delete(key)
  ctx.body = { success: true }
})

router.post('/store/clear', (ctx: Context) => {
  storeManager.clearAll()
  ctx.body = { success: true }
})

router.get('/config', (ctx: Context) => {
  ctx.body = ConfigManager.get()
})

router.put('/config', (ctx: Context) => {
  ctx.body = ConfigManager.update((ctx.request.body as Record<string, unknown>) || {})
})

router.get('/management-api', (ctx: Context) => {
  ctx.body = ConfigManager.get().managementApi
})

router.put('/management-api', (ctx: Context) => {
  const config = ConfigManager.get()
  const updates = (ctx.request.body as Record<string, unknown>) || {}
  const next = {
    ...config.managementApi,
    ...updates,
  }
  ConfigManager.update({ managementApi: next })
  ctx.body = next
})

router.post('/management-api/generate-secret', (ctx: Context) => {
  const config = ConfigManager.get()
  const secret = generateManagementSecret()
  ConfigManager.update({
    managementApi: {
      ...config.managementApi,
      managementApiSecret: secret,
    },
  })
  ctx.body = { secret }
})

router.get('/context-management', (ctx: Context) => {
  const config = ConfigManager.get()
  ctx.body = config.contextManagement || {
    enabled: true,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 20 },
      tokenLimit: { enabled: false, maxTokens: 4000 },
      summary: { enabled: false, keepRecentMessages: 20 },
    },
    executionOrder: ['slidingWindow', 'tokenLimit', 'summary'],
  }
})

router.put('/context-management', (ctx: Context) => {
  const config = ConfigManager.get()
  const current = config.contextManagement || {
    enabled: true,
    strategies: {
      slidingWindow: { enabled: true, maxMessages: 20 },
      tokenLimit: { enabled: false, maxTokens: 4000 },
      summary: { enabled: false, keepRecentMessages: 20 },
    },
    executionOrder: ['slidingWindow', 'tokenLimit', 'summary'],
  }
  const updates = (ctx.request.body as Record<string, any>) || {}
  const next = {
    ...current,
    ...updates,
    strategies: {
      ...current.strategies,
      ...(updates.strategies || {}),
    },
  }
  ConfigManager.update({ contextManagement: next })
  ctx.body = next
})

router.get('/providers', (ctx: Context) => {
  ctx.body = ProviderManager.getAll()
})

router.get('/providers/builtin', (ctx: Context) => {
  ctx.body = getBuiltinProviders()
})

router.post('/providers', (ctx: Context) => {
  ctx.body = CustomProviderManager.create((ctx.request.body as any) || {})
})

router.put('/providers/:id', (ctx: Context) => {
  const updated = ProviderManager.update(ctx.params.id, (ctx.request.body as Partial<Provider>) || {})
  if (!updated) {
    ctx.throw(404, 'Provider not found')
  }
  ctx.body = updated
})

router.delete('/providers/:id', (ctx: Context) => {
  ctx.body = CustomProviderManager.delete(ctx.params.id)
})

router.post('/providers/:id/duplicate', (ctx: Context) => {
  ctx.body = CustomProviderManager.duplicate(ctx.params.id)
})

router.post('/providers/:id/check-status', async (ctx: Context) => {
  const provider = ProviderManager.getById(ctx.params.id)
  if (!provider) {
    ctx.throw(404, 'Provider not found')
  }
  const result = await ProviderChecker.checkProviderStatus(provider)
  ProviderManager.update(provider.id, {
    status: result.status,
    lastStatusCheck: Date.now(),
  })
  ctx.body = result
})

router.post('/providers/check-all-status', async (ctx: Context) => {
  const providers = ProviderManager.getAll()
  const results: Record<string, ProviderCheckResult> = {}

  await Promise.all(providers.map(async provider => {
    const result = await ProviderChecker.checkProviderStatus(provider)
    results[provider.id] = result
    ProviderManager.update(provider.id, {
      status: result.status,
      lastStatusCheck: Date.now(),
    })
  }))

  ctx.body = results
})

router.post('/providers/:id/update-models', async (ctx: Context) => {
  const providerId = ctx.params.id
  const provider = ProviderManager.getById(providerId)

  if (!provider) {
    ctx.throw(404, 'Provider not found')
  }

  let modelsApiEndpoint: string | undefined
  let modelsApiHeaders: Record<string, string> | undefined

  if (provider.type === 'builtin') {
    const builtinConfig = getBuiltinProvider(providerId) as any
    if (builtinConfig) {
      modelsApiEndpoint = builtinConfig.modelsApiEndpoint
      modelsApiHeaders = builtinConfig.modelsApiHeaders
    }
  }

  if (!modelsApiEndpoint) {
    ctx.body = { success: false, error: 'This provider does not support dynamic model updates' }
    return
  }

  const accounts = AccountManager.getByProviderId(providerId, true)
  const activeAccount = accounts.find(account => account.status === 'active')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(modelsApiHeaders || {}),
  }

  if (activeAccount?.credentials?.token) {
    headers.Authorization = `Bearer ${activeAccount.credentials.token}`
  }

  if ((activeAccount?.credentials as any)?.cookies) {
    headers.Cookie = (activeAccount!.credentials as any).cookies
  }

  const response = await axios.get(modelsApiEndpoint, {
    headers,
    timeout: 15000,
    validateStatus: () => true,
  })

  if (response.status !== 200) {
    ctx.body = { success: false, error: `Failed to fetch models: HTTP ${response.status}` }
    return
  }

  const models = response.data.data || response.data
  if (!Array.isArray(models) || models.length === 0) {
    ctx.body = { success: false, error: 'No models found in the response' }
    return
  }

  const supportedModels: string[] = []
  const modelMappings: Record<string, string> = {}

  models.forEach((model: any) => {
    if (typeof model === 'string') {
      supportedModels.push(model)
      modelMappings[model] = model
      return
    }

    if (model && typeof model === 'object') {
      const modelId = model.id || model.model_id || model.name
      const modelName = model.name || model.display_name || modelId
      if (modelId) {
        supportedModels.push(modelName || modelId)
        modelMappings[modelName || modelId] = modelId
      }
    }
  })

  ProviderManager.update(providerId, {
    supportedModels,
    modelMappings,
  })

  ctx.body = {
    success: true,
    modelsCount: supportedModels.length,
  }
})

router.get('/providers/:id/effective-models', (ctx: Context) => {
  ctx.body = storeManager.getEffectiveModels(ctx.params.id)
})

router.post('/providers/:id/custom-models', (ctx: Context) => {
  ctx.body = {
    success: true,
    models: storeManager.addCustomModel(ctx.params.id, ctx.request.body as { displayName: string; actualModelId: string }),
  }
})

router.delete('/providers/:id/custom-models/:modelName', (ctx: Context) => {
  ctx.body = {
    success: true,
    models: storeManager.removeModel(ctx.params.id, decodeURIComponent(ctx.params.modelName)),
  }
})

router.post('/providers/:id/reset-models', (ctx: Context) => {
  ctx.body = {
    success: true,
    models: storeManager.resetModels(ctx.params.id),
  }
})

router.get('/accounts', (ctx: Context) => {
  const includeCredentials = ctx.query.includeCredentials === 'true'
  ctx.body = AccountManager.getAll(includeCredentials)
})

router.get('/providers/:providerId/accounts', (ctx: Context) => {
  const includeCredentials = ctx.query.includeCredentials === 'true'
  ctx.body = AccountManager.getByProviderId(ctx.params.providerId, includeCredentials)
})

router.get('/accounts/:id', (ctx: Context) => {
  const includeCredentials = ctx.query.includeCredentials === 'true'
  ctx.body = AccountManager.getById(ctx.params.id, includeCredentials) || null
})

router.post('/accounts', (ctx: Context) => {
  ctx.body = AccountManager.create((ctx.request.body as any) || {})
})

router.post('/accounts/batch-import', (ctx: Context) => {
  const body = (ctx.request.body as {
    providerId?: string
    rawText?: string
    dailyLimit?: number
  }) || {}

  if (!body.providerId || !body.rawText?.trim()) {
    ctx.throw(400, 'providerId and rawText are required')
  }

  const provider = getProviderOrBuiltin(body.providerId)
  if (!provider) {
    ctx.throw(404, 'Provider not found')
  }

  if (body.providerId === 'mimo') {
    ctx.throw(400, 'Batch import is not supported for Mimo accounts')
  }

  const credentialField = getPrimaryCredentialField(body.providerId, provider.authType)
  const lines = body.rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const created: Account[] = []
  const errors: string[] = []

  lines.forEach((line, index) => {
    const parts = parseBatchImportLine(line)
    const token = parts[parts.length - 1]

    if (!token) {
      errors.push(`Line ${index + 1}: missing credential`)
      return
    }

    const firstPart = parts[0] || ''
    const name = parts.length === 1
      ? `${provider.name} ${index + 1}`
      : firstPart
    const email = firstPart.includes('@') ? firstPart : undefined

    try {
      const account = AccountManager.create({
        providerId: body.providerId!,
        name,
        email,
        credentials: {
          [credentialField]: token,
        },
        dailyLimit: body.dailyLimit,
      })
      created.push(account)
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error instanceof Error ? error.message : 'Import failed'}`)
    }
  })

  ctx.body = {
    success: errors.length === 0,
    created,
    errors,
  }
})

router.put('/accounts/:id', (ctx: Context) => {
  ctx.body = AccountManager.update(ctx.params.id, (ctx.request.body as Partial<Account>) || {})
})

router.delete('/accounts/:id', (ctx: Context) => {
  ctx.body = AccountManager.delete(ctx.params.id)
})

router.post('/accounts/:id/validate', async (ctx: Context) => {
  const result = await AccountManager.validate(ctx.params.id)
  ctx.body = result.valid
})

router.post('/accounts/validate-token', async (ctx: Context) => {
  const body = (ctx.request.body as { providerId?: string; credentials?: Record<string, string> }) || {}
  if (!body.providerId || !body.credentials) {
    ctx.throw(400, 'providerId and credentials are required')
  }

  const provider = getProviderOrBuiltin(body.providerId)
  if (!provider) {
    ctx.throw(404, 'Provider not found')
  }

  const tempAccount: Account = {
    id: 'temp',
    providerId: body.providerId,
    name: 'temp',
    credentials: body.credentials,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  ctx.body = await ProviderChecker.checkAccountToken(provider, tempAccount)
})

router.get('/accounts/:id/credits', async (ctx: Context) => {
  const account = AccountManager.getById(ctx.params.id, true)
  if (!account) {
    ctx.body = null
    return
  }

  const provider = ProviderManager.getById(account.providerId)
  if (!provider || provider.id !== 'minimax') {
    ctx.body = null
    return
  }

  try {
    const { MiniMaxAdapter } = await import('../main/proxy/adapters/minimax')
    const adapter = new MiniMaxAdapter(provider, account)
    ctx.body = await adapter.getCredits()
  } catch {
    ctx.body = null
  }
})

router.post('/accounts/:id/clear-chats', async (ctx: Context) => {
  try {
    const account = AccountManager.getById(ctx.params.id, true)
    if (!account) {
      ctx.body = { success: false, error: 'Account not found' }
      return
    }

    const provider = ProviderManager.getById(account.providerId)
    if (!provider) {
      ctx.body = { success: false, error: 'Provider not found' }
      return
    }

    if (provider.id === 'qwen-ai') {
      const { QwenAiAdapter } = await import('../main/proxy/adapters/qwen-ai')
      ctx.body = { success: await new QwenAiAdapter(provider, account).deleteAllChats() }
      return
    }

    if (provider.id === 'minimax') {
      const { MiniMaxAdapter } = await import('../main/proxy/adapters/minimax')
      ctx.body = { success: await new MiniMaxAdapter(provider, account).deleteAllChats() }
      return
    }

    if (provider.id === 'zai') {
      const { ZaiAdapter } = await import('../main/proxy/adapters/zai')
      ctx.body = { success: await new ZaiAdapter(provider, account).deleteAllChats() }
      return
    }

    if (provider.id === 'perplexity') {
      const { PerplexityAdapter } = await import('../main/proxy/adapters/perplexity')
      ctx.body = { success: await new PerplexityAdapter(provider, account).deleteAllChats() }
      return
    }

    if (provider.id === 'deepseek') {
      const { DeepSeekAdapter } = await import('../main/proxy/adapters/deepseek')
      ctx.body = { success: await new DeepSeekAdapter(provider, account).deleteAllChats() }
      return
    }

    if (provider.id === 'glm') {
      const { GLMAdapter } = await import('../main/proxy/adapters/glm')
      ctx.body = { success: await new GLMAdapter(provider, account).deleteAllChats() }
      return
    }

    if (provider.id === 'mimo') {
      const { MimoAdapter } = await import('../main/proxy/adapters/mimo')
      ctx.body = { success: await new MimoAdapter(provider, account).deleteAllChats() }
      return
    }

    ctx.body = { success: false, error: 'This feature is not available for this provider' }
  } catch (error) {
    ctx.body = {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear chats',
    }
  }
})

router.get('/logs', (ctx: Context) => {
  const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined
  const level = ctx.query.level === 'all' ? undefined : (ctx.query.level as any)
  ctx.body = storeManager.getLogs(limit, level)
})

router.get('/logs/stats', (ctx: Context) => {
  ctx.body = storeManager.getLogStats()
})

router.get('/logs/trend', (ctx: Context) => {
  const days = ctx.query.days ? Number(ctx.query.days) : undefined
  ctx.body = storeManager.getLogTrend(days)
})

router.get('/logs/account-trend/:accountId', (ctx: Context) => {
  const days = ctx.query.days ? Number(ctx.query.days) : undefined
  ctx.body = storeManager.getAccountLogTrend(ctx.params.accountId, days)
})

router.post('/logs/clear', (ctx: Context) => {
  storeManager.clearLogs()
  ctx.body = { success: true }
})

router.get('/request-logs', (ctx: Context) => {
  const limit = ctx.query.limit ? Number(ctx.query.limit) : undefined
  const status = ctx.query.status as 'success' | 'error' | undefined
  const providerId = ctx.query.providerId as string | undefined
  ctx.body = storeManager.getRequestLogs(limit, { status, providerId })
})

router.get('/request-logs/stats', (ctx: Context) => {
  ctx.body = storeManager.getRequestLogStats()
})

router.get('/request-logs/trend', (ctx: Context) => {
  const days = ctx.query.days ? Number(ctx.query.days) : undefined
  ctx.body = storeManager.getRequestLogTrend(days)
})

router.post('/request-logs/clear', (ctx: Context) => {
  storeManager.clearRequestLogs()
  ctx.body = { success: true }
})

router.get('/statistics', (ctx: Context) => {
  ctx.body = storeManager.getStatistics()
})

router.get('/statistics/today', (ctx: Context) => {
  ctx.body = storeManager.getTodayStatistics()
})

router.get('/prompts', (ctx: Context) => {
  ctx.body = storeManager.getSystemPrompts()
})

router.get('/prompts/builtin', (ctx: Context) => {
  ctx.body = storeManager.getBuiltinPrompts()
})

router.get('/session/config', (ctx: Context) => {
  ctx.body = sessionManager.getSessionConfig()
})

router.put('/session/config', (ctx: Context) => {
  ctx.body = sessionManager.updateSessionConfig((ctx.request.body as Record<string, unknown>) || {})
})

router.get('/session', (ctx: Context) => {
  ctx.body = sessionManager.getAllSessions()
})

router.get('/app/version', (ctx: Context) => {
  ctx.body = { version: runtimeApp.getVersion() }
})

router.get('/app/check-update', async (ctx: Context) => {
  try {
    const response = await axios.get('https://api.github.com/repos/xiaoY233/Chat2API/releases/latest', {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Chat2API-Web',
      },
      timeout: 10000,
    })

    const data = response.data
    const latestVersion = data.tag_name?.replace(/^v/, '') || ''
    const currentVersion = runtimeApp.getVersion()
    const releaseUrl = data.html_url || 'https://github.com/xiaoY233/Chat2API/releases'

    const compareVersions = (v1: string, v2: string): number => {
      const parts1 = v1.split('.').map(Number)
      const parts2 = v2.split('.').map(Number)
      const maxLength = Math.max(parts1.length, parts2.length)
      for (let i = 0; i < maxLength; i++) {
        const left = parts1[i] || 0
        const right = parts2[i] || 0
        if (left > right) return 1
        if (left < right) return -1
      }
      return 0
    }

    ctx.body = {
      hasUpdate: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
      currentVersion,
      latestVersion,
      releaseUrl,
    }
  } catch (error) {
    ctx.body = {
      hasUpdate: false,
      currentVersion: runtimeApp.getVersion(),
      latestVersion: runtimeApp.getVersion(),
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

export default router
