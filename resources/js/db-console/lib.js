/**
 * Self-contained helpers for the Database Console module — no external deps, so the
 * whole folder can be lifted into another project (or a package) as-is.
 */

/** Tiny clsx-lite: join truthy strings / object keys. Avoids a runtime dep. */
export function cx(...args) {
  const out = []
  for (const a of args) {
    if (!a) {
      continue
    }
    if (typeof a === 'string') {
      out.push(a)
    } else if (Array.isArray(a)) {
      out.push(cx(...a))
    } else if (typeof a === 'object') {
      for (const [k, v] of Object.entries(a)) {
        if (v) {
          out.push(k)
        }
      }
    }
  }
  return out.join(' ')
}

const NUMERIC_TYPES = /int|serial|numeric|decimal|real|double|money|float/i

/** A column holds numbers → right-align + tabular figures. */
export function isNumericType(type) {
  return NUMERIC_TYPES.test(type ?? '')
}

/** A stringified JSON object/array (fixtures store jsonb as text). */
export function isJsonString(value) {
  if (typeof value !== 'string') {
    return false
  }
  const t = value.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

/** Loose ISO-ish timestamp/date detector for calmer rendering. */
export function looksLikeDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(value)
}

/**
 * Classify a cell value for rendering.
 *
 * @returns {{kind: 'null'|'json'|'date'|'number'|'text', text: string}}
 */
export function classifyCell(value, column) {
  if (value === null || value === undefined) {
    return { kind: 'null', text: 'NULL' }
  }
  if (isJsonString(value)) {
    return { kind: 'json', text: prettyJson(value) }
  }
  if (column && isNumericType(column.type)) {
    return { kind: 'number', text: String(value) }
  }
  if (looksLikeDate(value)) {
    return { kind: 'date', text: String(value) }
  }
  return { kind: 'text', text: String(value) }
}

function prettyJson(value) {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    return String(value)
  }
}

/** Comparator that keeps NULLs last and sorts numbers numerically. */
export function compareValues(a, b, numeric) {
  const an = a === null || a === undefined
  const bn = b === null || b === undefined
  if (an || bn) {
    return an === bn ? 0 : an ? 1 : -1
  }
  if (numeric) {
    return Number(a) - Number(b)
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true })
}

/** Build a CSV string (with BOM) from columns + rows for the current view. */
export function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) {
      return ''
    }
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const head = columns.map((c) => esc(c.name)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c.name])).join(',')).join('\n')
  // Prepend a UTF-8 BOM (\uFEFF) so Excel reads Thai/UTF-8 CSV correctly.
  return `\uFEFF${head}\n${body}`
}

/** Trigger a client-side download of `content` as `filename`. */
export function downloadText(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** localStorage key for the user's saved SQL queries (bump the suffix to migrate). */
const SAVED_QUERIES_KEY = 'dc.saved.v1'

/**
 * Load the user's saved queries from localStorage, or `null` on first run /
 * unavailable storage (private mode, quota, SSR) so the caller can seed defaults.
 *
 * @returns {Array | null}
 */
export function loadSavedQueries() {
  return readJsonArray(SAVED_QUERIES_KEY)
}

/** Persist the saved-queries list to localStorage (no-op if storage is unavailable). */
export function persistSavedQueries(list) {
  writeJson(SAVED_QUERIES_KEY, list)
}

/** localStorage key for the run history. */
const HISTORY_KEY = 'dc.history.v1'

/** Keep the most recent N history entries (older ones are dropped). */
export const HISTORY_LIMIT = 100

/**
 * Load the run history from localStorage, or `null` on first run / unavailable
 * storage so the caller can seed the fixture history.
 *
 * @returns {Array | null}
 */
export function loadHistory() {
  return readJsonArray(HISTORY_KEY)
}

/** Persist the (already-capped) run history to localStorage. */
export function persistHistory(list) {
  writeJson(HISTORY_KEY, list.slice(0, HISTORY_LIMIT))
}

/** @returns {Array | null} the parsed array, or null when absent/unreadable. */
function readJsonArray(key) {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage disabled / full — keep working in-memory for the session.
  }
}

/** localStorage key for the viewer's colour-scheme override. */
const SCHEME_KEY = 'dc.scheme.v1'

/** @type {ReadonlyArray<'light'|'dark'|'auto'>} the toggle's cycle order. */
export const SCHEMES = ['light', 'dark', 'auto']

/**
 * The viewer's own scheme choice, which outranks `brand.scheme` from the server.
 *
 * @returns {'light'|'dark'|'auto'|null} null when they have never chosen, so the
 *   configured default still applies.
 */
export function readScheme() {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    const raw = window.localStorage.getItem(SCHEME_KEY)
    return SCHEMES.includes(raw) ? raw : null
  } catch {
    return null
  }
}

/** Persist the viewer's scheme choice (no-op if storage is unavailable). */
export function writeScheme(scheme) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(SCHEME_KEY, scheme)
  } catch {
    // Storage disabled / full — the choice lasts for this session only.
  }
}

/** localStorage key for the sidebar's favourites-only filter. */
const FAVORITES_ONLY_KEY = 'dc.favonly.v1'

/**
 * Whether the sidebar is filtered to starred tables. A working mode rather than
 * a one-off filter, so it survives a reload — like the grid's column widths.
 */
export function readFavoritesOnly() {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    return window.localStorage.getItem(FAVORITES_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the favourites-only filter (no-op if storage is unavailable). */
export function writeFavoritesOnly(only) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(FAVORITES_ONLY_KEY, only ? '1' : '0')
  } catch {
    // Private mode / quota — the filter lasts for this session only.
  }
}

/**
 * Read the console mode from the URL (`?mode=sql`). Defaults to `explorer`.
 * Lets a refresh / shared link restore the Table-vs-SQL view.
 */
export function readConsoleMode() {
  if (typeof window === 'undefined') {
    return 'explorer'
  }
  return new URLSearchParams(window.location.search).get('mode') === 'sql' ? 'sql' : 'explorer'
}

/**
 * Reflect the console mode into the URL without navigating (History API).
 * `explorer` (the default) drops the param to keep the URL clean.
 */
export function writeConsoleMode(mode) {
  if (typeof window === 'undefined') {
    return
  }
  const url = new URL(window.location.href)
  if (mode === 'sql') {
    url.searchParams.set('mode', 'sql')
  } else {
    url.searchParams.delete('mode')
  }
  window.history.replaceState(window.history.state, '', url)
}

/**
 * One JSON request to a console endpoint. Never throws on a non-2xx — the caller
 * branches on `status` (409 is the confirmation handshake, 422 a guard / DB
 * rejection carrying a localised `message`).
 *
 * @returns {Promise<{ok: boolean, status: number, data: Record<string, any>}>}
 */
export async function sendJson(url, method, csrfToken, body) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-TOKEN': csrfToken ?? '',
      'X-Requested-With': 'XMLHttpRequest',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  const data = await response.json().catch(() => ({}))

  return { ok: response.ok, status: response.status, data }
}

/** Append query params to an endpoint URL, skipping null/undefined values. */
export function withQuery(url, params) {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined),
  )
  return search.size === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}${search}`
}

/** Compact integer formatting for row-count badges (1280 → 1.3k). */
export function compactCount(n) {
  if (n < 1000) {
    return String(n)
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  }
  return `${(n / 1_000_000).toFixed(1)}M`
}
