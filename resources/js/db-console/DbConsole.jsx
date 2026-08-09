import { useEffect, useMemo, useRef, useState } from 'react'

import { ConnectionPicker } from './ConnectionPicker'
import { DataGrid } from './DataGrid'
import {
  AlertIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  TableIcon,
  TerminalIcon,
} from './icons'
import './db-console.css'
import {
  cx,
  readConsoleMode,
  readScheme,
  SCHEMES,
  sendJson,
  writeConsoleMode,
  writeScheme,
} from './lib'
import { Sidebar } from './Sidebar'
import { SqlConsole } from './SqlConsole'
import { DEFAULT_STRINGS, StringsContext, useStrings } from './strings'
import { useTableDetails } from './useTableDetails'

/**
 * Database Console — a standalone DB explorer (Adminer-style). Renders a schema
 * tree on the left and a data grid (or the SQL console) on the right.
 *
 * Self-contained + re-themable (see db-console.css `--dc-*` tokens) so it can be
 * extracted into a package. Everything Laravel-shaped arrives as props: endpoint
 * URLs, brand, feature flags, strings — the module itself knows no routes.
 *
 * All copy comes from `strings.js` (English defaults → works with zero props);
 * pass `strings` to localise it, e.g. from `lang/{locale}/ui.php`.
 *
 * @param {Array<{key: string, label?: string, database?: string, driver?: string, mode?: string, confirmWrites?: boolean, error?: string}>} [connections]
 *   every configured connection (a broken one carries `error` instead of metadata).
 * @param {{key: string, name?: string, label?: string, database?: string, driver?: string, mode?: string, confirmWrites?: boolean} | null} [connection]
 *   the live connection — `null` when nothing could be opened (see `fatal`).
 * @param {Array<{name: string, tables: Array<{name: string, type: string, rowCount: number}>}>} [schemas]
 *   the shallow tree — a table's columns/indexes/rows are fetched from
 *   `endpoints.table` when it is selected, never shipped with the page.
 * @param {Array<string>} [favorites] starred tables as `schema.table` keys.
 * @param {{defaultQuery: string, saved: Array, history: Array}} [sql]
 * @param {{query: string, explain: string, row: string, share: string, saved: string, index: string, table: string, favorite: string}} [endpoints]
 *   absolute URLs for every POST/GET the console makes.
 * @param {{name?: string, accent?: string, scheme?: 'light'|'dark'|'auto', logo?: string}} [brand]
 * @param {{explain: boolean, share: boolean, rowEdit: boolean}} [features]
 * @param {{expired: boolean, sql: string|null}} [shared] present only on a share link.
 * @param {string|null} [fatal] a hard failure (e.g. unsupported driver) — shown in
 *   place of the sidebar + main area, toolbar still usable.
 * @param {string} [runEndpoint] legacy alias for `endpoints.query`.
 * @param {string} [csrfToken] CSRF token sent with every write/execute request.
 * @param {Record<string, string>} [strings] flat dotted-key copy overrides — see
 *   `DEFAULT_STRINGS` for the full key list.
 */
export function DbConsole({
  connections,
  connection,
  schemas,
  favorites,
  sql,
  endpoints,
  brand,
  features,
  shared,
  fatal,
  runEndpoint,
  csrfToken,
  strings,
}) {
  const copy = useMemo(() => ({ ...DEFAULT_STRINGS, ...(strings ?? {}) }), [strings])

  return (
    <StringsContext.Provider value={copy}>
      <Console
        connections={connections}
        connection={connection}
        schemas={schemas}
        favorites={favorites}
        sql={sql}
        endpoints={endpoints}
        brand={brand}
        features={features}
        shared={shared}
        fatal={fatal}
        runEndpoint={runEndpoint}
        csrfToken={csrfToken}
      />
    </StringsContext.Provider>
  )
}

/**
 * Logo + app name. A plain `<a>` (not an Inertia link) when `brand.url` is set:
 * the console is a self-contained tool, and leaving it should leave it entirely.
 */
function BrandMark({ brand, label, homeHint }) {
  const inner = (
    <>
      {brand?.logo ? (
        <img src={brand.logo} alt="" className="dc-top-brand-logo" />
      ) : (
        <span className="dc-top-brand-badge">
          <TableIcon className="dc-top-brand-badge-icon" />
        </span>
      )}
      <span className="dc-top-brand-name">
        {brand?.name || label}
      </span>
    </>
  )

  if (!brand?.url) {
    return <div className="dc-top-brand">{inner}</div>
  }

  return (
    <a
      href={brand.url}
      title={homeHint}
      className="dc-top-brand link"
    >
      {inner}
    </a>
  )
}

/** The console itself — rendered inside the strings provider so `useStrings` sees it. */
function Console({
  connections,
  connection,
  schemas,
  favorites,
  sql,
  endpoints,
  brand,
  features,
  shared,
  fatal,
  runEndpoint,
  csrfToken,
}) {
  const t = useStrings()
  const schemaList = useMemo(() => schemas ?? [], [schemas])

  // Flattened with the owning schema kept alongside each table — the row editor
  // needs the schema name of whatever is selected, which a bare table list loses.
  const entries = useMemo(
    () => schemaList.flatMap((schema) => schema.tables.map((table) => ({ schema, table }))),
    [schemaList],
  )

  const [selected, setSelected] = useState(() => entries[0]?.table ?? null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [shareNoticeOpen, setShareNoticeOpen] = useState(true)
  // A share link always opens on its query; otherwise the URL decides the view.
  const [mode, setMode] = useState(() => {
    if (shared?.sql) {
      return 'sql'
    }
    return sql ? readConsoleMode() : 'explorer'
  })
  // `brand.scheme` is only the default: once the viewer picks one it is theirs,
  // kept in localStorage rather than on the server, exactly like the grid's
  // column widths — a preference of this browser, not of the installation.
  const [scheme, setScheme] = useState(() => readScheme() ?? brand?.scheme ?? 'auto')
  const editorRef = useRef(null)

  const cycleScheme = () => {
    const next = SCHEMES[(SCHEMES.indexOf(scheme) + 1) % SCHEMES.length]
    setScheme(next)
    writeScheme(next)
  }

  const currentSchemaName = useMemo(() => {
    if (!selected) {
      return undefined
    }
    const owner =
      entries.find((entry) => entry.table === selected) ??
      entries.find((entry) => entry.table.name === selected.name)
    return owner?.schema.name
  }, [entries, selected])

  // The tree carries names only; the selected table's columns and rows are
  // fetched on demand and cached for as long as the page lives.
  const {
    get: getDetails,
    errorFor: detailErrorFor,
    load: loadDetails,
  } = useTableDetails({
    endpoint: endpoints?.table,
    csrfToken,
    connectionKey: connection?.key,
  })

  useEffect(() => {
    if (selected && currentSchemaName) {
      loadDetails(currentSchemaName, selected.name)
    }
  }, [selected, currentSchemaName, loadDetails])

  const selectedDetail = selected ? getDetails(currentSchemaName, selected.name) : null
  const selectedError = selected ? detailErrorFor(currentSchemaName, selected.name) : null

  // Favourites are server-owned (they follow the person, not the browser), but
  // the star flips immediately and the response is the correction.
  const [starred, setStarred] = useState(() => favorites ?? [])

  const toggleFavorite = async (schema, table) => {
    const key = `${schema}.${table}`

    setStarred((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))

    const { ok, data } = await sendJson(endpoints.favorite, 'POST', csrfToken, {
      connection: connection?.key,
      schema,
      table,
    })

    if (ok && Array.isArray(data?.favorites)) {
      setStarred(data.favorites)
    }
  }

  // Mode is URL-backed (?mode=sql) so a refresh / shared link restores the view.
  const changeMode = (next) => {
    setMode(next)
    writeConsoleMode(next)
  }

  const jumpTo = (name) => {
    const target = entries.find((entry) => entry.table.name === name)?.table
    if (target) {
      setSelected(target)
      changeMode('explorer')
    }
  }

  // In SQL mode, double-clicking a table/column in the sidebar inserts its name
  // into the editor at the cursor (schema-aware query building).
  const insertIdentifier = (name) => editorRef.current?.insertText(name)

  const fatalMessage = typeof fatal === 'string' && fatal.trim() !== '' ? fatal : null

  // `brand.accent` re-skins the whole module through the one token every other
  // colour derives from. Omitted (not `undefined`) when the host sends no accent.
  const rootStyle = brand?.accent ? { '--dc-accent': brand.accent } : undefined

  return (
    <div
      className={cx(
        'dc-root dc-shell',
        // 'auto' → leave it to the host app's own `.dark` ancestor. 'light' is
        // stamped too, so it can override a host that is itself dark.
        scheme === 'dark' && 'dark',
        scheme === 'light' && 'light',
      )}
      style={rootStyle}
    >
      {/* Toolbar */}
      <header className="dc-top-bar">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="dc-top-icon"
          title={t('toolbar.toggleSidebar')}
        >
          <MenuIcon className="dc-top-icon-glyph" />
        </button>

        {/* The brand doubles as the way out: `brand.url` links back to the host app. */}
        <BrandMark brand={brand} label={t('toolbar.brand')} homeHint={t('toolbar.home')} />

        <ConnectionPicker
          connections={connections}
          connection={connection}
          indexEndpoint={endpoints?.index}
        />

        <div className="dc-top-actions">
          <SchemeToggle scheme={scheme} onCycle={cycleScheme} />

          {sql && !fatalMessage && (
            <div className="dc-top-modes">
              <ModeButton
                active={mode === 'explorer'}
                onClick={() => changeMode('explorer')}
                icon={TableIcon}
              >
                {t('toolbar.modeExplorer')}
              </ModeButton>
              <ModeButton
                active={mode === 'sql'}
                onClick={() => changeMode('sql')}
                icon={TerminalIcon}
              >
                {t('toolbar.modeSql')}
              </ModeButton>
            </div>
          )}
        </div>
      </header>

      {shared?.expired && shareNoticeOpen && (
        <div className="dc-top-notice">
          <AlertIcon className="dc-top-notice-icon" />
          <span>{t('errors.shareExpired')}</span>
          <button
            type="button"
            onClick={() => setShareNoticeOpen(false)}
            title={t('common.dismiss')}
            aria-label={t('common.dismiss')}
            className="dc-top-notice-close"
          >
            ✕
          </button>
        </div>
      )}

      {/* Body — replaced wholesale when the console cannot talk to a database. */}
      {fatalMessage ? (
        <div className="dc-shell-fatal">
          <div className="dc-shell-msg">
            <AlertIcon className="dc-shell-fatal-icon" />
            <p className="dc-shell-fatal-title">
              {fatalMessage}
            </p>
            <p className="dc-shell-fatal-hint">
              {t('errors.fatalHint')}
            </p>
          </div>
        </div>
      ) : (
        <div className="dc-shell-body">
          {sidebarOpen && (
            <aside className="dc-shell-side">
              <Sidebar
                schemas={schemaList}
                selected={selected}
                onSelect={setSelected}
                search={search}
                onSearch={setSearch}
                onInsert={mode === 'sql' && sql ? insertIdentifier : undefined}
                favorites={starred}
                onToggleFavorite={endpoints?.favorite ? toggleFavorite : undefined}
                getDetails={getDetails}
                onLoadDetails={loadDetails}
              />
            </aside>
          )}

          <main className="dc-shell-main">
            {mode === 'sql' && sql ? (
              <SqlConsole
                sql={sql}
                endpoints={endpoints}
                csrfToken={csrfToken}
                editorRef={editorRef}
                connectionKey={connection?.key}
                mode={connection?.mode ?? 'read'}
                confirmWrites={connection?.confirmWrites ?? true}
                features={features}
                initialSql={shared?.sql ?? sql?.defaultQuery ?? ''}
                runEndpoint={endpoints?.query ?? runEndpoint}
              />
            ) : selectedDetail ? (
              <DataGrid
                table={selectedDetail}
                onJumpTo={jumpTo}
                structural
                rowEditing={{
                  enabled: Boolean(features?.rowEdit),
                  endpoint: endpoints?.row,
                  csrfToken,
                  connectionKey: connection?.key,
                  schema: currentSchemaName,
                  confirmWrites: connection?.confirmWrites ?? true,
                }}
              />
            ) : selected ? (
              <TableLoading name={selected.name} error={selectedError} />
            ) : (
              <div className="dc-shell-empty">
                {t('explorer.selectTable')}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

/**
 * Stands in for the grid while the selected table's columns and rows are on the
 * wire — a skeleton of the header row and a few body rows, so the switch to real
 * data does not jump the layout.
 */
function TableLoading({ name, error }) {
  const t = useStrings()

  if (error) {
    return (
      <div className="dc-shell-load-error">
        <div className="dc-shell-msg">
          <AlertIcon className="dc-shell-load-error-icon" />
          <p className="dc-shell-load-error-text">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dc-shell-load">
      <div className="dc-shell-load-title" />
      <div className="dc-shell-load-head" />
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="dc-shell-load-row" />
      ))}
      <span className="dc-shell-sr">{t('explorer.loadingTable', { table: name })}</span>
    </div>
  )
}

const SCHEME_ICONS = { light: SunIcon, dark: MoonIcon, auto: MonitorIcon }
const SCHEME_HINTS = {
  light: 'toolbar.schemeLight',
  dark: 'toolbar.schemeDark',
  auto: 'toolbar.schemeAuto',
}

/**
 * One button cycling light → dark → auto. It shows the scheme currently in
 * force, and its tooltip names both that and what a click will do.
 */
function SchemeToggle({ scheme, onCycle }) {
  const t = useStrings()
  const Icon = SCHEME_ICONS[scheme] ?? MonitorIcon
  const hint = t(SCHEME_HINTS[scheme] ?? SCHEME_HINTS.auto)

  return (
    <button
      type="button"
      onClick={onCycle}
      title={hint}
      aria-label={hint}
      className="dc-top-icon"
    >
      <Icon className="dc-top-icon-glyph" />
    </button>
  )
}

function ModeButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('dc-top-mode', active && 'on')}
    >
      <Icon className="dc-top-mode-icon" />
      {children}
    </button>
  )
}
