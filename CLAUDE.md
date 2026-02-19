# CLAUDE.md

## Project Structure

```
├── app.config.json          # Single source of truth for app name (change here, flows everywhere)
├── src/                     # React frontend (Vite + TypeScript)
│   ├── components/ui/       # shadcn/ui components (do NOT edit directly — customize via App.css)
│   ├── data/                # API client + React Query hooks
│   └── store/               # Zustand stores
├── server/                  # Express backend (separate package.json)
│   └── src/
│       ├── routes/          # Express route modules
│       └── databricks/      # Databricks SQL client (OAuth/PAT, OBO, singleton pattern)
```

## Commands

```bash
npm install          # Installs both frontend and server (postinstall hook)
npm run dev          # Runs frontend (Vite) + backend (tsx watch) concurrently
npm run build        # Type-checks frontend → Vite build → server tsc
npm run dev:client   # Frontend only
npm run dev:server   # Backend only
```

## Routing

- Frontend served at `/<appName>` — configured in `app.config.json`
- Backend API at `/<appName>-s` — same config, suffix `-s`
- Backend port: `8000`

## Frontend

### Stack
React 19, TypeScript, Vite, TailwindCSS, React Router, TanStack React Query, Zustand

### shadcn/ui Components
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group, calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, data-table, date-picker, dialog, direction, drawer, dropdown-menu, empty, field, form, hover-card, input, input-group, input-otp, item, kbd, label, menubar, native-select, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toast, toggle, toggle-group, tooltip, typography

```bash
npx shadcn@latest add <component-name>   # Adds to @/components/ui/
```

**Do NOT modify files in `@/components/ui/` directly.** Customize styles through `App.css` using CSS custom properties and utility classes.

### Custom Components
- `@/components/multi-select.tsx` — Multi-select dropdown (built on shadcn popover + command)

### State Management
- **Server state**: TanStack React Query (see `src/data/example-hooks.ts` for patterns)
- **Client state**: Zustand (see `src/store/app-store.ts` for patterns)
- Use the right tool: React Query for API data, Zustand for global UI state

### Guidelines
- Use AI SDK by Vercel (`ai` package) and its components for chatbot/LLM-based features
- Use the `interface-design` skill to add personality and decide UX direction for UI work
- Code should be readable and maintainable long-term — favor clarity over cleverness
- Handle edge cases thoughtfully; err on the side of more coverage, not less

## Backend

### Stack
Express 4, TypeScript, Databricks SQL Statements API

### Databricks Client
- `server/src/databricks/DatabricksPool.ts` — OAuth + PAT auth, OBO, query polling
- `server/src/databricks/index.ts` — `initDBR()` / `getDBR()` / `runQuery()` / `runProcedure()`
- Auto-initializes when `DATABRICKS_HOST` env var is set

### Environment Variables
```
DATABRICKS_HOST
DATABRICKS_WAREHOUSE_ID
DATABRICKS_CLIENT_ID
DATABRICKS_CLIENT_SECRET
```
