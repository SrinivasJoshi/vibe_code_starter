import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { apiRouter } from './routes/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = parseInt(process.env.PORT || '8080', 10)
const BASE_PATH = process.env.BASE_PATH || '/app-name'

app.use(cors())
app.use(express.json())

// API routes
app.use('/api', apiRouter)

// Serve frontend build and fall back to index.html for SPA routing
const clientBuildPath = path.resolve(__dirname, '../../dist')
app.use(BASE_PATH, express.static(clientBuildPath))
app.get(`${BASE_PATH}/*`, (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`)
})
