import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../app.config.json'), 'utf-8')
) as { appName: string }

export const APP_NAME = appConfig.appName
export const FRONTEND_BASE = `/${APP_NAME}`
export const BACKEND_BASE = `/${APP_NAME}-s`
export const PORT = parseInt(process.env.PORT || '8000', 10)
