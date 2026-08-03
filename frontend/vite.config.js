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
        writeVersionedArtifacts(resolvedOutDir)
      },
    },
  }
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
