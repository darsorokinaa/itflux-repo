import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  '/lesson': {
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
  plugins: [react(), tailwindcss()],
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
    port: 5000,
    allowedHosts: true,
    proxy: backendProxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 5000,
    proxy: backendProxy,
  },
}))
