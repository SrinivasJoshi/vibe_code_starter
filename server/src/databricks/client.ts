// Placeholder for Databricks SDK utilities
// Install @databricks/sdk and configure when ready

export function getDatabricksConfig() {
  return {
    host: process.env.DATABRICKS_HOST,
    token: process.env.DATABRICKS_TOKEN,
  }
}
