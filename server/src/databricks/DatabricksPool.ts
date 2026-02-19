import axios, { type AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { Agent } from 'https'

export interface DatabricksConfig {
  host: string
  warehouseId: string
  clientId?: string
  clientSecret?: string
  pat?: string
  proxyUrl?: string
  enableOBO?: boolean
  enableLogging?: boolean
  queryTimeoutSeconds?: number
  pollIntervalMs?: number
}

export interface QueryOptions {
  userToken?: string | null
  retryCount?: number
}

export interface DatabricksUser {
  username: string
  email: string
  displayName: string
  firstName: string
  lastName: string
  isAuthenticated: boolean
  source: string
  employeeID: string
}

interface TokenResponse {
  access_token: string
  expires_in?: number
  error_description?: string
  error?: string
}

interface StatementResult {
  statement_id: string
  status?: {
    state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'
    error?: { message: string }
  }
  result?: {
    data_array: unknown[][]
  }
  manifest?: {
    schema?: {
      columns: Array<{ name: string }>
    }
  }
}

interface ScimUserResponse {
  userName?: string
  displayName?: string
  emails?: Array<{ value: string }>
  name?: { givenName?: string; familyName?: string }
  detail?: string
}

interface AxiosErrorLike {
  response?: {
    status?: number
    data?: Record<string, unknown>
  }
  message: string
}

function isAxiosError(error: unknown): error is AxiosErrorLike {
  return typeof error === 'object' && error !== null && 'message' in error
}

export class DatabricksDB {
  private readonly host: string
  private readonly warehouseId: string
  private readonly clientId?: string
  private readonly clientSecret?: string
  private readonly patToken?: string
  private readonly enableOBO: boolean
  private readonly enableLogging: boolean
  private readonly queryTimeoutSeconds: number
  private readonly pollIntervalMs: number
  private readonly baseUrl: string
  private readonly isOAuth: boolean
  private readonly isPAT: boolean
  private readonly httpsAgent: Agent | null

  private accessToken: string | null = null
  private tokenExpiresAt: number | null = null

  constructor(config: DatabricksConfig) {
    this.host = config.host
    this.warehouseId = config.warehouseId
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.patToken = config.pat
    this.enableOBO = config.enableOBO ?? true
    this.enableLogging = config.enableLogging ?? true
    this.queryTimeoutSeconds = config.queryTimeoutSeconds ?? 90
    this.pollIntervalMs = config.pollIntervalMs ?? 1000

    if (!this.host) {
      throw new Error('DATABRICKS_HOST (config.host) is required')
    }

    let raw = this.host
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      raw = `https://${raw}`
    }
    this.baseUrl = raw.replace(/\/+$/, '')

    this.isOAuth = !!(this.clientId && this.clientSecret)
    this.isPAT = !!this.patToken

    if (!this.isOAuth && !this.isPAT) {
      throw new Error('Need either clientId+clientSecret (OAuth) or pat (PAT) in config')
    }
    if (!this.warehouseId) {
      throw new Error('DATABRICKS_WAREHOUSE_ID (config.warehouseId) is required')
    }

    const proxyUrl = config.proxyUrl ?? null
    this.httpsAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null

    if (this.enableLogging) {
      console.log('')
      console.log('========== DATABRICKS CONFIG ==========')
      console.log(`  Auth    : ${this.isOAuth ? 'OAuth (service principal)' : 'PAT'}`)
      console.log(`  Host    : ${this.baseUrl}`)
      console.log(`  WH ID   : ${this.warehouseId}`)
      console.log(`  OBO     : ${this.enableOBO}`)
      console.log(`  Proxy   : ${proxyUrl ? proxyUrl.replace(/:[^:@]+@/, ':****@') : 'none'}`)
      console.log('=======================================')
      console.log('')
    }
  }

  private _axiosConfig(extra: AxiosRequestConfig = {}): AxiosRequestConfig {
    const cfg: AxiosRequestConfig = { ...extra }
    if (this.httpsAgent) {
      cfg.httpsAgent = this.httpsAgent
      cfg.proxy = false
    }
    return cfg
  }

  private async _getServicePrincipalToken(): Promise<string> {
    const tokenEndpoint = `${this.baseUrl}/oidc/v1/token`

    try {
      const response = await axios.post<TokenResponse>(
        tokenEndpoint,
        'grant_type=client_credentials&scope=all-apis',
        this._axiosConfig({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          auth: { username: this.clientId!, password: this.clientSecret! },
        })
      )

      this.accessToken = response.data.access_token
      const expiresIn = response.data.expires_in ?? 3600
      this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000

      if (this.enableLogging) {
        console.log('>> Token refreshed, expires in:', expiresIn, 's')
      }

      return this.accessToken
    } catch (error) {
      if (isAxiosError(error)) {
        const data = error.response?.data as TokenResponse | undefined
        const msg = data?.error_description ?? data?.error ?? error.message
        throw new Error(`Token fetch failed (${error.response?.status ?? 'network'}): ${msg}`)
      }
      throw error
    }
  }

  private _isTokenExpired(): boolean {
    if (!this.accessToken || !this.tokenExpiresAt) return true
    return Date.now() >= this.tokenExpiresAt
  }

  private async _ensureServicePrincipalToken(): Promise<void> {
    if (!this.isOAuth) return
    if (this._isTokenExpired()) {
      if (this.enableLogging) console.log('>> Token expired or missing, refreshing...')
      await this._getServicePrincipalToken()
    }
  }

  private async _resolveToken(userToken?: string | null): Promise<string> {
    if (userToken && this.enableOBO) return userToken
    await this._ensureServicePrincipalToken()
    return this.isOAuth ? this.accessToken! : this.patToken!
  }

  /** Execute SQL via the Databricks SQL Statements API. */
  async runQuery(sql: string, options: QueryOptions = {}): Promise<Record<string, unknown>[]> {
    const { userToken = null, retryCount = 0 } = options

    try {
      const bearerToken = await this._resolveToken(userToken)
      const waitTimeout = `${Math.min(this.queryTimeoutSeconds, 50)}s`
      const headers = {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      }

      const submitResponse = await axios.post<StatementResult>(
        `${this.baseUrl}/api/2.0/sql/statements`,
        { warehouse_id: this.warehouseId, statement: sql, wait_timeout: waitTimeout },
        this._axiosConfig({ headers })
      )

      let result = submitResponse.data
      const statementId = result.statement_id

      while (result.status?.state === 'PENDING' || result.status?.state === 'RUNNING') {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs))

        const statusResponse = await axios.get<StatementResult>(
          `${this.baseUrl}/api/2.0/sql/statements/${statementId}`,
          this._axiosConfig({ headers })
        )
        result = statusResponse.data
      }

      if (result.status?.state === 'FAILED') {
        throw new Error(result.status.error?.message || 'Query failed')
      }
      if (result.status?.state === 'CANCELED') {
        throw new Error(`Query canceled: ${result.status?.error?.message || 'Unknown'}`)
      }

      const rows = result?.result?.data_array ?? []
      if (!Array.isArray(rows) || rows.length === 0) return []

      const columns = (result.manifest?.schema?.columns ?? []).map((col) => col.name)
      return rows.map((row) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
          obj[col] = row[i]
        })
        return obj
      })
    } catch (error) {
      if (isAxiosError(error)) {
        const status = error.response?.status
        const isAuthError = status === 401 || status === 403

        if (isAuthError && !userToken && retryCount < 1) {
          if (this.enableLogging) console.log('>> Auth error, forcing token refresh and retrying...')
          this.accessToken = null
          this.tokenExpiresAt = null
          return this.runQuery(sql, { userToken: null, retryCount: retryCount + 1 })
        }

        if (this.enableLogging) console.error('>> Query failed:', error.response?.data ?? error.message)
      }
      throw error
    }
  }

  /** Get current user from Databricks SCIM API (requires user access token / OBO). */
  async getCurrentUser(userAccessToken: string): Promise<DatabricksUser> {
    if (!userAccessToken) {
      throw new Error('No user access token provided')
    }

    try {
      const response = await axios.get<ScimUserResponse>(
        `${this.baseUrl}/api/2.0/preview/scim/v2/Me`,
        this._axiosConfig({
          headers: {
            'Authorization': `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json',
          },
        })
      )

      const userData = response.data
      if (this.enableLogging) console.log('>> Current user retrieved from Databricks SCIM')

      return {
        username: userData.userName ?? userData.displayName ?? '',
        email: userData.emails?.[0]?.value ?? userData.userName ?? '',
        displayName: userData.displayName ?? userData.userName ?? '',
        firstName: userData.name?.givenName ?? '',
        lastName: userData.name?.familyName ?? '',
        isAuthenticated: true,
        source: 'databricks_scim',
        employeeID: userData.emails?.[0]?.value ?? userData.userName ?? '',
      }
    } catch (error) {
      if (isAxiosError(error)) {
        const data = error.response?.data as ScimUserResponse | undefined
        const msg = data?.detail ?? error.response?.data ?? error.message
        throw new Error(`SCIM /Me failed (${error.response?.status ?? 'network'}): ${msg}`)
      }
      throw error
    }
  }

  /** Run SELECT 1 to verify auth + warehouse + network. */
  async healthCheck(options: QueryOptions = {}): Promise<boolean> {
    try {
      await this.runQuery('SELECT 1', options)
      return true
    } catch {
      return false
    }
  }

  getWarehouseInfo() {
    return {
      host: this.host,
      warehouseId: this.warehouseId,
      authMode: this.isOAuth ? 'OAuth' : 'PAT',
      enableOBO: this.enableOBO,
      baseUrl: this.baseUrl,
    }
  }
}
