import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'

const appConfig = JSON.parse(readFileSync('./app.config.json', 'utf-8'))
const appName: string = appConfig.appName

export default defineConfig({
  base: `/${appName}/`,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BACKEND_BASE_PATH__: JSON.stringify(`/${appName}-s`),
  },
  server: {
    proxy: {
      [`/${appName}-s`]: {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
