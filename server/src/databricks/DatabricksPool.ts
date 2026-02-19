export interface DatabricksConfig {
  host: string
  warehouseId: string
  clientId?: string
  clientSecret?: string
  pat?: string
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

    this.baseUrl = this.host.startsWith('http://') || this.host.startsWith('https://')
      ? this.host
      : `https://${this.host}`

    this.isOAuth = !!(this.clientId && this.clientSecret)
    this.isPAT = !!this.patToken

    if (!this.isOAuth && !this.isPAT) {
      throw new Error('Need either clientId+clientSecret (OAuth) or pat (PAT) in config')
    }
    if (!this.warehouseId) {
      throw new Error('DATABRICKS_WAREHOUSE_ID (config.warehouseId) is required')
    }

    if (this.enableLogging) {
      console.log(
        `Databricks client: ${this.isOAuth ? 'OAuth' : 'PAT'}, warehouse: ${this.warehouseId}, OBO: ${this.enableOBO}`
      )
    }
  }

  private async _getServicePrincipalToken(): Promise<string> {
    const tokenEndpoint = `${this.baseUrl}/oidc/v1/token`
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials&scope=all-apis',
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token fetch failed (${response.status}): ${text}`)
    }

    const data = (await response.json()) as TokenResponse
    this.accessToken = data.access_token
    const expiresIn = data.expires_in ?? 3600
    this.tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000

    if (this.enableLogging) {
      console.log('Service principal token refreshed, expires in:', expiresIn, 's')
    }

    return this.accessToken
  }

  private _isTokenExpired(): boolean {
    if (!this.accessToken || !this.tokenExpiresAt) return true
    return Date.now() >= this.tokenExpiresAt
  }

  private async _ensureServicePrincipalToken(): Promise<void> {
    if (!this.isOAuth) return
    if (this._isTokenExpired()) {
      if (this.enableLogging) console.log('Token expired or missing, refreshing...')
      await this._getServicePrincipalToken()
    }
  }

  /** Resolve bearer token: OBO user token > service principal > PAT. */
  private async _resolveToken(userToken?: string | null): Promise<string> {
    if (userToken && this.enableOBO) {
      return userToken
    }

    await this._ensureServicePrincipalToken()

    if (this.isOAuth) {
      return this.accessToken!
    }

    return this.patToken!
  }

  /** Execute SQL via the Databricks SQL Statements API. */
  async runQuery(sql: string, options: QueryOptions = {}): Promise<Record<string, unknown>[]> {
    const { userToken = null, retryCount = 0 } = options

    try {
      const bearerToken = await this._resolveToken(userToken)
      const waitTimeout = `${Math.min(this.queryTimeoutSeconds, 50)}s`

      const submitResponse = await fetch(`${this.baseUrl}/api/2.0/sql/statements`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          warehouse_id: this.warehouseId,
          statement: sql,
          wait_timeout: waitTimeout,
        }),
      })

      if (!submitResponse.ok) {
        const errorData = await submitResponse.text()
        throw new Error(`Query submission failed (${submitResponse.status}): ${errorData}`)
      }

      let result = (await submitResponse.json()) as StatementResult
      const statementId = result.statement_id

      while (result.status?.state === 'PENDING' || result.status?.state === 'RUNNING') {
        await new Promise((r) => setTimeout(r, this.pollIntervalMs))

        const statusResponse = await fetch(
          `${this.baseUrl}/api/2.0/sql/statements/${statementId}`,
          {
            headers: {
              'Authorization': `Bearer ${bearerToken}`,
              'Content-Type': 'application/json',
            },
          }
        )

        if (!statusResponse.ok) {
          const text = await statusResponse.text()
          throw new Error(`Query status check failed (${statusResponse.status}): ${text}`)
        }

        result = (await statusResponse.json()) as StatementResult
      }

      if (result.status?.state === 'FAILED') {
        throw new Error(result.status.error?.message || 'Query failed')
      }
      if (result.status?.state === 'CANCELED') {
        throw new Error(`Query canceled: ${result.status?.error?.message || 'Unknown'}`)
      }

      const rows = result?.result?.data_array ?? []
      if (!Array.isArray(rows) || rows.length === 0) {
        return []
      }

      const columns = (result.manifest?.schema?.columns ?? []).map((col) => col.name)
      return rows.map((row) => {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
          obj[col] = row[i]
        })
        return obj
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isAuthError = message.includes('401') || message.includes('403')

      if (isAuthError && !userToken && retryCount < 1) {
        if (this.enableLogging) console.log('Auth error, refreshing token and retrying...')
        this.accessToken = null
        this.tokenExpiresAt = null
        return this.runQuery(sql, { userToken: null, retryCount: retryCount + 1 })
      }

      if (this.enableLogging) console.error('Query failed:', message)
      throw error
    }
  }

  /** Get current user from Databricks SCIM API (requires user access token / OBO). */
  async getCurrentUser(userAccessToken: string): Promise<DatabricksUser> {
    if (!userAccessToken) {
      throw new Error('No user access token provided')
    }

    const response = await fetch(`${this.baseUrl}/api/2.0/preview/scim/v2/Me`, {
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`SCIM /Me failed (${response.status}): ${text}`)
    }

    const userData = (await response.json()) as ScimUserResponse
    if (this.enableLogging) console.log('Current user retrieved from Databricks SCIM')

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
