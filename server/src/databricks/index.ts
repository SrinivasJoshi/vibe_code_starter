import { DatabricksDB } from './DatabricksPool.js'
import type { DatabricksConfig, QueryOptions } from './DatabricksPool.js'

let instance: DatabricksDB | null = null

export function initDBR(config: DatabricksConfig): DatabricksDB {
  instance = new DatabricksDB(config)
  return instance
}

export function getDBR(): DatabricksDB {
  if (!instance) throw new Error('DBR not initialized. Call initDBR(config) first.')
  return instance
}

/** Execute a SQL query. Returns { Output: rows } for API consistency. */
export async function runQuery(
  _systemName: string,
  query: string,
  options: QueryOptions = {}
): Promise<{ Output: Record<string, unknown>[] }> {
  const rows = await getDBR().runQuery(query, options)
  return { Output: rows }
}

/** Execute a stored procedure via CALL statement. Same as runQuery internally. */
export async function runProcedure(
  _systemName: string,
  proceduralCall: string,
  options: QueryOptions = {}
): Promise<{ Output: Record<string, unknown>[] }> {
  const rows = await getDBR().runQuery(proceduralCall, options)
  return { Output: rows }
}

export { DatabricksDB } from './DatabricksPool.js'
export type { DatabricksConfig, QueryOptions, DatabricksUser } from './DatabricksPool.js'
