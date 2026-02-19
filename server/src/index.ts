import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { apiRouter } from './routes/index.js'
import { initDBR } from './databricks/index.js'
import { FRONTEND_BASE, BACKEND_BASE, PORT } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(cors())
app.use(express.json())

// Initialize Databricks client if configured
if (process.env.DATABRICKS_HOST) {
  initDBR({
    host: process.env.DATABRICKS_HOST,
    warehouseId: process.env.DATABRICKS_WAREHOUSE_ID ?? '',
    clientId: process.env.DATABRICKS_CLIENT_ID,
    clientSecret: process.env.DATABRICKS_CLIENT_SECRET,
    enableOBO: false,
  })
} else {
  console.log('Databricks not configured — set DATABRICKS_HOST to enable')
}

// Backend API routes at /app-name-s
app.use(BACKEND_BASE, apiRouter)

// Serve frontend build at /app-name and fall back to index.html for SPA routing
const clientBuildPath = path.resolve(__dirname, '../../dist')
app.use(FRONTEND_BASE, express.static(clientBuildPath))
app.get(`${FRONTEND_BASE}/*`, (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})
