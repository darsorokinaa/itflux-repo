import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveAppVersion, resolveBuildTime } from './scripts/resolveAppVersion.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_VERSION = resolveAppVersion()
const APP_BUILD_TIME = resolveBuildTime()

function injectAppVersionPlugin() {
  const versionPayload = {
    version: APP_VERSION,
    builtAt: APP_BUILD_TIME,
  }
  let resolvedOutDir = path.resolve(__dirname, 'dist')

  const writeVersionedArtifacts = (outDir) => {
    fs.mkdirSync(outDir, { recursive: true })
    const swSrc = path.resolve(__dirname, 'public/sw.js')
    let body = fs.readFileSync(swSrc, 'utf8')
    body = body.replaceAll('__ITFLUX_APP_VERSION__', APP_VERSION)
    fs.writeFileSync(path.join(outDir, 'sw.js'), body)
    fs.writeFileSync(
      path.join(outDir, 'version.json'),
      `${JSON.stringify(versionPayload, null, 2)}\n`,
    )
  }

  return {
    name: 'itflux-app-version',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(APP_VERSION),
          __APP_BUILD_TIME__: JSON.stringify(APP_BUILD_TIME),
        },
      }
    },
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/version.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(versionPayload))
          return
        }
        if (req.url?.startsWith('/sw.js')) {
          const swPath = path.resolve(__dirname, 'public/sw.js')
          let body = fs.readFileSync(swPath, 'utf8')
          body = body.replaceAll('__ITFLUX_APP_VERSION__', APP_VERSION)
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate')
          res.setHeader('Service-Worker-Allowed', '/')
          res.end(body)
          return
        }
        next()
      })
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { id: 'itflux-app-version' },
          children: `window.__APP_VERSION__=${JSON.stringify(APP_VERSION)};window.__APP_BUILD_TIME__=${JSON.stringify(APP_BUILD_TIME)};`,
          injectTo: 'head-prepend',
        },
      ]
    },
    // После копирования public/ — иначе Vite может перезаписать sw.js плейсхолдером
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        stripSpaCollidingPublicDirs(resolvedOutDir)
        writeVersionedArtifacts(resolvedOutDir)
        restoreRootPublicUrls(path.join(resolvedOutDir, 'index.html'))
      },
    },
  }
}

/**
 * Vite копирует public/ в корень dist/. Каталог с тем же именем, что SPA-маршрут
 * (например public/interesting/), на проде даёт nginx 403: try_files заходит
 * в директорию без index.html вместо fallback на SPA.
 */
const SPA_RESERVED_PUBLIC_DIRS = [
  'interesting',
  'lessons',
  'cabinet',
  'teachers',
  'for-teachers',
  'generator',
  'tasks',
  'about',
  'privacy',
  'login',
  'subject',
  'pricing',
]

function stripSpaCollidingPublicDirs(outDir) {
  for (const name of SPA_RESERVED_PUBLIC_DIRS) {
    const target = path.join(outDir, name)
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        fs.rmSync(target, { recursive: true, force: true })
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Vite `base: '/static/'` переписывает публичные URL в /static/….
 * На itflux-academy.ru nginx отдаёт бандлы с /assets/, а /static/assets/*.js — 404.
 * Тогда #root пустой и boot-watchdog показывает «Не удалось загрузить приложение».
 * vendor/fonts/boot-watchdog — та же история: живые URL без префикса /static/.
 */
function restoreRootPublicUrls(indexPath) {
  if (!fs.existsSync(indexPath)) return
  let html = fs.readFileSync(indexPath, 'utf8')
  html = html
    .replaceAll('/static/assets/', '/assets/')
    .replaceAll('/static/vendor/', '/vendor/')
    .replaceAll('/static/fonts/', '/fonts/')
    .replaceAll('/static/boot-watchdog.js', '/boot-watchdog.js')
  fs.writeFileSync(indexPath, html)
}

/** Общий для dev и preview: без прокси запросы к /api на vite preview дают HTML SPA → ломается JSON.parse в клиенте */
const backendProxy = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    timeout: 600000,
    configure: (proxy) => {
      proxy.on('error', () => { /* ignore ECONNREFUSED when django not started yet */ });
    },
  },
  '/media': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/admin': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/ckeditor5': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/static': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '^/lesson(?:/|$)': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
  '/ws': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    ws: true,
  },
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), injectAppVersionPlugin()],
  base: command === 'build' ? '/static/' : '/',
  experimental: {
    renderBuiltUrl(filename) {
      if (
        filename.startsWith('assets/') ||
        filename.startsWith('vendor/') ||
        filename.startsWith('fonts/') ||
        filename === 'boot-watchdog.js'
      ) {
        return `/${filename}`
      }
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Единое имя входного бандла (как у стандартной SPA), чтобы не путаться с index-*.js и кэшем
        entryFileNames: 'assets/main-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5001,
    strictPort: false,
    allowedHosts: true,
    proxy: backendProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5001,
    strictPort: false,
    proxy: backendProxy,
  },
}))
