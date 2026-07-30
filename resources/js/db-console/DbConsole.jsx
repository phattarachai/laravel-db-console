import { useMemo, useRef, useState } from 'react'

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
import { cx, readConsoleMode, readScheme, SCHEMES, writeConsoleMode, writeScheme } from './lib'
import { Sidebar } from './Sidebar'
import { SqlConsole } from './SqlConsole'
import { DEFAULT_STRINGS, StringsContext, useStrings } from './strings'

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
 * @param {Array<{name: string, tables: Array}>} [schemas]
 * @param {{defaultQuery: string, saved: Array, history: Array}} [sql]
 * @param {{query: string, explain: string, row: string, share: string, saved: string, index: string}} [endpoints]
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
        <img src={brand.logo} alt="" className="tw:h-5 tw:w-auto" />
      ) : (
        <span className="tw:flex tw:h-6 tw:w-6 tw:items-center tw:justify-center tw:rounded tw:bg-[var(--dc-accent)] tw:text-[var(--dc-accent-foreground)]">
          <TableIcon className="tw:h-3.5 tw:w-3.5" />
        </span>
      )}
      <span className="tw:text-sm tw:font-semibold tw:text-[var(--dc-text)]">
        {brand?.name || label}
      </span>
    </>
  )

  if (!brand?.url) {
    return <div className="tw:flex tw:items-center tw:gap-2">{inner}</div>
  }

  return (
    <a
      href={brand.url}
      title={homeHint}
      className="tw:-mx-1 tw:flex tw:items-center tw:gap-2 tw:rounded tw:px-1 tw:py-0.5 tw:hover:bg-[var(--dc-hover)]"
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
        'dc-root tw:flex tw:h-screen tw:flex-col tw:font-sans',
        // 'auto' → leave it to the host app's own `.dark` ancestor. 'light' is
        // stamped too, so it can override a host that is itself dark.
        scheme === 'dark' && 'dark',
        scheme === 'light' && 'light',
      )}
      style={rootStyle}
    >
      {/* Toolbar */}
      <header className="tw:flex tw:shrink-0 tw:items-center tw:gap-3 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-toolbar)] tw:px-3 tw:py-2">
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="tw:rounded tw:p-1.5 tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]"
          title={t('toolbar.toggleSidebar')}
        >
          <MenuIcon className="tw:h-4 tw:w-4" />
        </button>

        {/* The brand doubles as the way out: `brand.url` links back to the host app. */}
        <BrandMark brand={brand} label={t('toolbar.brand')} homeHint={t('toolbar.home')} />

        <ConnectionPicker
          connections={connections}
          connection={connection}
          indexEndpoint={endpoints?.index}
        />

        <div className="tw:ml-auto tw:flex tw:items-center tw:gap-3">
          <SchemeToggle scheme={scheme} onCycle={cycleScheme} />

          {sql && !fatalMessage && (
            <div className="tw:flex tw:items-center tw:gap-0.5 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:p-0.5">
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
        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:border-b tw:border-amber-500/40 tw:bg-amber-500/10 tw:px-3 tw:py-1.5 tw:text-xs tw:text-amber-600">
          <AlertIcon className="tw:h-3.5 tw:w-3.5 tw:shrink-0" />
          <span>{t('errors.shareExpired')}</span>
          <button
            type="button"
            onClick={() => setShareNoticeOpen(false)}
            title={t('common.dismiss')}
            aria-label={t('common.dismiss')}
            className="tw:ml-auto tw:rounded tw:px-1.5 tw:py-0.5 tw:font-medium tw:hover:bg-amber-500/20"
          >
            ✕
          </button>
        </div>
      )}

      {/* Body — replaced wholesale when the console cannot talk to a database. */}
      {fatalMessage ? (
        <div className="tw:flex tw:min-h-0 tw:flex-1 tw:items-center tw:justify-center tw:bg-[var(--dc-bg)] tw:px-6">
          <div className="tw:max-w-md tw:text-center">
            <AlertIcon className="tw:mx-auto tw:mb-3 tw:h-8 tw:w-8 tw:text-[var(--dc-danger,#dc2626)]" />
            <p className="tw:text-sm tw:font-semibold tw:text-[var(--dc-danger,#dc2626)]">
              {fatalMessage}
            </p>
            <p className="tw:mt-2 tw:text-xs tw:text-[var(--dc-text-muted)]">
              {t('errors.fatalHint')}
            </p>
          </div>
        </div>
      ) : (
        <div className="tw:flex tw:min-h-0 tw:flex-1">
          {sidebarOpen && (
            <aside className="tw:w-64 tw:shrink-0 tw:border-r tw:border-[var(--dc-border)]">
              <Sidebar
                schemas={schemaList}
                selected={selected}
                onSelect={setSelected}
                search={search}
                onSearch={setSearch}
                onInsert={mode === 'sql' && sql ? insertIdentifier : undefined}
              />
            </aside>
          )}

          <main className="tw:flex tw:min-w-0 tw:flex-1 tw:bg-[var(--dc-bg)]">
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
            ) : selected ? (
              <DataGrid
                table={selected}
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
            ) : (
              <div className="tw:flex tw:h-full tw:flex-1 tw:items-center tw:justify-center tw:text-sm tw:text-[var(--dc-text-muted)]">
                {t('explorer.selectTable')}
              </div>
            )}
          </main>
        </div>
      )}
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
      className="tw:rounded tw:p-1.5 tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]"
    >
      <Icon className="tw:h-4 tw:w-4" />
    </button>
  )
}

function ModeButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'tw:flex tw:items-center tw:gap-1.5 tw:rounded tw:px-2.5 tw:py-1 tw:text-xs tw:font-medium',
        active
          ? 'tw:bg-[var(--dc-accent)] tw:text-[var(--dc-accent-foreground)]'
          : 'tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]',
      )}
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
      {children}
    </button>
  )
}
