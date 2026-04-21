import fs from 'fs'
import path from 'path'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mime from 'mime-types'
import apiRouter from './api'
import { storeManager } from '../main/store/store'
import { proxyServer } from '../main/proxy/server'

const WEB_PORT = Number(process.env.WEB_PORT || 3000)
const WEB_HOST = process.env.WEB_HOST || '0.0.0.0'

function resolveRendererDist(): string {
  const candidates = [
    process.env.CHAT2API_WEB_RENDERER_DIR,
    path.resolve(__dirname, '../../renderer'),
    path.resolve(process.cwd(), 'dist/web/renderer'),
    path.resolve(process.cwd(), 'src/renderer/dist/web/renderer'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  const match = candidates.find(candidate => fs.existsSync(path.join(candidate, 'index.html')))
  return match || candidates[0]
}

const RENDERER_DIST = resolveRendererDist()

process.on('uncaughtException', (error) => {
  console.error('[Web] Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Web] Unhandled rejection:', reason)
})

function resolveStaticFile(requestPath: string): string | null {
  const safePath = decodeURIComponent(requestPath.split('?')[0])
  const relativePath = safePath === '/' ? '/index.html' : safePath
  const absolutePath = path.resolve(RENDERER_DIST, `.${relativePath}`)

  if (!absolutePath.startsWith(RENDERER_DIST)) {
    return null
  }

  if (!fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    return null
  }

  return absolutePath
}

async function createWebServer() {
  await storeManager.initialize()

  const config = storeManager.getConfig()
  if (config.autoStartProxy && !proxyServer.isRunning()) {
    await proxyServer.start(config.proxyPort, config.proxyHost || '127.0.0.1')
  }

  const app = new Koa()

  app.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*')
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    if (ctx.method === 'OPTIONS') {
      ctx.status = 204
      return
    }

    await next()
  })

  app.use(bodyParser({
    jsonLimit: '50mb',
    formLimit: '50mb',
    textLimit: '50mb',
  }))

  app.use(apiRouter.routes())
  app.use(apiRouter.allowedMethods())

  app.use(async (ctx) => {
    const requestedFile = resolveStaticFile(ctx.path)

    if (requestedFile) {
      ctx.type = mime.lookup(requestedFile) || 'application/octet-stream'
      ctx.body = fs.createReadStream(requestedFile)
      return
    }

    const indexFile = path.join(RENDERER_DIST, 'index.html')
    if (!fs.existsSync(indexFile)) {
      ctx.status = 503
      ctx.body = 'Web assets not found. Run `npm run build:web` first.'
      return
    }

    ctx.type = 'text/html'
    ctx.body = fs.createReadStream(indexFile)
  })

  app.listen(WEB_PORT, WEB_HOST, () => {
    console.log(`[Web] Admin UI listening on http://${WEB_HOST}:${WEB_PORT}`)
    console.log(`[Web] Static assets directory: ${RENDERER_DIST}`)
  })
}

createWebServer().catch((error) => {
  console.error('[Web] Failed to start server:', error)
  process.exit(1)
})
