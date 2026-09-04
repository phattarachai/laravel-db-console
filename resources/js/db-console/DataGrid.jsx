import { useEffect, useMemo, useRef, useState } from 'react'

import { CellDrawer } from './CellDrawer'
import {
  CheckIcon,
  ColumnIcon,
  DownloadIcon,
  KeyIcon,
  LinkIcon,
  SearchIcon,
  SortIcon,
  TableIcon,
  TrashIcon,
  ViewIcon,
  WandIcon,
} from './icons'
import {
  classifyCell,
  compactCount,
  compareValues,
  cx,
  downloadText,
  isNumericType,
  readUrlState,
  sendJson,
  toCsv,
  updateUrlState,
} from './lib'
import { FilterAddButton, FilterConditions } from './FilterBar'
import { toPayload } from './filter-lib'
import { RowForm } from './RowForm'
import { useStrings } from './strings'
import { TableStructure } from './TableStructure'

const PAGE_SIZES = [25, 50, 100, 200]

const DEFAULT_PER_PAGE = 50

/**
 * Restore the grid's working state from the URL query string, so a refresh or a
 * shared link reopens the same filtered/sorted/paged view. Types are re-derived
 * from the live columns, and only complete (queryable) filters are ever on the
 * URL, so every restored condition is ready.
 *
 * @param {Array<{name: string, type: string}>} columns
 */
function readGridStateFromUrl(columns) {
  const params = readUrlState()
  const perPage = PAGE_SIZES.includes(Number(params.perPage))
    ? Number(params.perPage)
    : DEFAULT_PER_PAGE
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)

  let sort = null
  if (params.sort) {
    const [col, dir] = params.sort.split(':')
    if (col) {
      sort = { col, dir: dir === 'desc' ? 'desc' : 'asc' }
    }
  }

  let filters = []
  try {
    const raw = params.filters ? JSON.parse(params.filters) : []
    if (Array.isArray(raw)) {
      filters = raw
        .filter((f) => f && f.column && f.operator)
        .map((f, i) => ({
          id: `f${i}${Math.random().toString(36).slice(2, 6)}`,
          column: f.column,
          type: columns.find((c) => c.name === f.column)?.type ?? 'text',
          operator: f.operator,
          value: f.value ?? '',
        }))
    }
  } catch {
    filters = []
  }

  return { search: params.q ?? '', perPage, page, sort, filters }
}

/** localStorage slot for the View menu preferences (shape: `{types: boolean}`). */
const VIEW_PREFS_KEY = 'dc.view.v1'

/** Fallbacks = today's look: the column-type line under each header is on. */
const VIEW_PREFS_DEFAULT = { types: true }

/**
 * localStorage slot for hand-dragged column widths, shape
 * `{ '<table>': { '<column>': px } }` — per table, so two tables that share a
 * column name keep their own width.
 */
const COL_WIDTH_KEY = 'dc.colwidth.v1'
const COL_WIDTH_MIN = 60
const COL_WIDTH_MAX = 900

/** All persisted widths, or `{}` when there are none / storage is unreadable. */
function readAllColWidths() {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(COL_WIDTH_KEY) ?? 'null')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    return {}
  }
}

/** Widths for one table. Lazy `useState` initialiser — no first-paint jump. */
function readColWidths(tableName) {
  const forTable = readAllColWidths()[tableName]
  return forTable && typeof forTable === 'object' ? forTable : {}
}

/** Merge one table's widths back into the shared slot; dropping an empty entry. */
function writeColWidths(tableName, widths) {
  try {
    const all = readAllColWidths()
    if (Object.keys(widths).length === 0) {
      delete all[tableName]
    } else {
      all[tableName] = widths
    }
    window.localStorage.setItem(COL_WIDTH_KEY, JSON.stringify(all))
  } catch {
    // Private mode / quota — the widths just won't survive a reload.
  }
}

/** Cell-menu box, used only to keep it inside the viewport. */
const CELL_MENU_WIDTH = 224
const CELL_MENU_HEIGHT = 150
const CELL_MENU_HEIGHT_EDIT = 230

/**
 * Read the persisted View preferences. Called from a lazy `useState` initialiser,
 * never from an effect, so the first paint already honours the saved choice.
 */
function readViewPrefs() {
  if (typeof window === 'undefined') {
    return VIEW_PREFS_DEFAULT
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(VIEW_PREFS_KEY) ?? 'null')
    return { types: stored?.types !== false }
  } catch {
    return VIEW_PREFS_DEFAULT
  }
}

/** Persist the View preferences; a blocked storage just means they don't survive a reload. */
function writeViewPrefs(prefs) {
  try {
    window.localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode / quota — nothing to do.
  }
}

/**
 * Read-only data grid for the selected table/view: sortable sticky header,
 * client-side filter + pagination over the sample rows, typed cell rendering
 * (null / json / number / date), FK cells that jump to the referenced table,
 * a gear `View` menu, and CSV export of the current view.
 *
 * Cell interaction: **double-click** toggles the `CellDrawer` beside the grid
 * (closed until asked for), **right-click** opens the one menu the grid has —
 * inspect the value, follow an FK, the three copies (value / row as JSON / row as
 * text) and, when editing is on, edit and delete the row. A single click does
 * nothing, so dragging out a selection to copy by hand still works.
 *
 * Optionally editable: pass `rowEditing` (`{enabled, endpoint, csrfToken,
 * connectionKey, schema, confirmWrites}`) and the grid grows a `New row` button
 * plus the two row entries in that menu, driven by `RowForm`. There is no actions
 * column — it cost a column of width on every table to hold one button.
 * Editing needs a real table (never a view) **with** a primary key; without one
 * the grid shows a single muted note instead. The SQL console passes no
 * `rowEditing`, so result sets stay exactly read-only.
 */
export function DataGrid({
  table,
  onJumpTo,
  title,
  subtitle,
  csvName,
  structural = false,
  rowEditing = null,
  source = null,
}) {
  const t = useStrings()

  // Server-driven data: with a `source` (the explorer) the grid fetches a
  // filtered/sorted/paginated slice from the `rows` endpoint. Without one (an
  // in-memory SQL result set) it stays client-side over `table.rows`.
  const serverMode = Boolean(source?.endpoint)

  // On the very first mount, seed the working state from the URL so a refresh or
  // shared link reopens the same view. Computed once (a ref, not per render); a
  // later table switch resets to defaults instead — see the reset block below.
  const initialGrid = useRef(null)
  if (initialGrid.current === null) {
    initialGrid.current = serverMode
      ? readGridStateFromUrl(table.columns ?? [])
      : { search: '', perPage: DEFAULT_PER_PAGE, page: 1, sort: null, filters: [] }
  }
  const ig = initialGrid.current

  const [sort, setSort] = useState(ig.sort)
  const [filter, setFilter] = useState(ig.search)
  const [perPage, setPerPage] = useState(ig.perPage)
  const [page, setPage] = useState(ig.page)
  const [copied, setCopied] = useState(null)
  const [view, setView] = useState('data')
  const [editor, setEditor] = useState(null)
  const [rowDelta, setRowDelta] = useState(0)

  const [filters, setFilters] = useState(ig.filters)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(null)
  const [appliedFilters, setAppliedFilters] = useState(() => toPayload(ig.filters))
  const [appliedSearch, setAppliedSearch] = useState(ig.search)
  const fetchSeq = useRef(0)

  // View menu (gear) — which optional header detail is rendered.
  const [viewPrefs, setViewPrefs] = useState(readViewPrefs)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const viewMenuRef = useRef(null)

  // The right-click cell menu: viewport-anchored at the pointer, or null.
  const [cellMenu, setCellMenu] = useState(null)

  // Hand-dragged column widths for this table, `{column: px}`; missing = auto.
  const [colWidths, setColWidths] = useState(() => readColWidths(table.name))

  // The cell whose full value the side drawer is showing, or null when closed.
  const [cellView, setCellView] = useState(null)

  // Locally edited copy of the rows prop — re-seeded below whenever the prop
  // identity changes, so a new table (or a reloaded one) never shows stale edits.
  const [rows, setRows] = useState(table.rows)
  const [seededFrom, setSeededFrom] = useState(table.rows)
  if (table.rows !== seededFrom) {
    setSeededFrom(table.rows)
    setRows(table.rows)
    setRowDelta(0)
    setEditor(null)
    setCellMenu(null)
    setCellView(null)
  }

  // Reset view state whenever a different table is opened — the React-recommended
  // "adjust state during render" pattern instead of a setState-in-effect.
  const [prevTableName, setPrevTableName] = useState(table.name)
  if (table.name !== prevTableName) {
    setPrevTableName(table.name)
    setColWidths(readColWidths(table.name))
    setSort(null)
    setFilter('')
    setFilters([])
    setAppliedFilters([])
    setAppliedSearch('')
    setHasMore(false)
    setFetchError(null)
    setPage(1)
    setView('data')
    setEditor(null)
    setCellMenu(null)
    setCellView(null)
  }

  // Outside click / Escape for the View menu. Bound only while open, so the grid
  // adds no document listeners in its resting state.
  useEffect(() => {
    if (!viewMenuOpen) {
      return
    }
    const onPointerDown = (event) => {
      if (!viewMenuRef.current?.contains(event.target)) {
        setViewMenuOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setViewMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [viewMenuOpen])

  // Same again for the right-click cell menu, which is anchored at the pointer.
  useEffect(() => {
    if (!cellMenu) {
      return
    }
    const close = () => setCellMenu(null)
    const onPointerDown = (event) => {
      if (!event.target?.closest?.('[data-dc-cell-menu]')) {
        close()
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [cellMenu])

  // Escape closes the cell drawer.
  useEffect(() => {
    if (!cellView) {
      return
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setCellView(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cellView])

  const showStructure = structural && view === 'structure'

  const pkColumns = useMemo(
    () => (table.columns ?? []).filter((col) => col.pk).map((col) => col.name),
    [table.columns],
  )
  const editableTable = Boolean(
    rowEditing?.enabled && rowEditing?.endpoint && table.type === 'table' && table.columns,
  )
  const canEdit = editableTable && pkColumns.length > 0

  // Masked columns can't be filtered on (probing them would leak the value the
  // server took care to hide), so the builder never offers them.
  const filterableColumns = useMemo(
    () => (table.columns ?? []).filter((col) => !col.masked),
    [table.columns],
  )

  // Debounce the filter builder + quick search so typing fires one query, not
  // one per keystroke. Structured conditions are reduced to the wire payload here.
  useEffect(() => {
    if (!serverMode) {
      return
    }
    const id = window.setTimeout(() => {
      setAppliedFilters(toPayload(filters))
      setAppliedSearch(filter)
    }, 350)
    return () => window.clearTimeout(id)
  }, [serverMode, filters, filter])

  // The server-driven data feed: refetch whenever the applied filters, search,
  // sort, page or size change. The server returns `perPage + 1` rows, which it
  // reports back as `hasMore` — no full-table count.
  useEffect(() => {
    if (!serverMode || showStructure) {
      return
    }
    const seq = ++fetchSeq.current
    setLoading(true)
    sendJson(source.endpoint, 'POST', source.csrfToken, {
      connection: source.connectionKey,
      schema: source.schema,
      table: table.name,
      filters: appliedFilters,
      search: appliedSearch || undefined,
      sort: sort ? { column: sort.col, dir: sort.dir } : undefined,
      page,
      perPage,
    }).then(({ ok, data }) => {
      if (seq !== fetchSeq.current) {
        return
      }
      setLoading(false)
      if (ok) {
        setRows(Array.isArray(data.rows) ? data.rows : [])
        setHasMore(Boolean(data.hasMore))
        setFetchError(null)
        setRowDelta(0)
        return
      }
      setRows([])
      setHasMore(false)
      setFetchError(data?.message ?? t('grid.requestFailed', { status: 0 }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    serverMode,
    showStructure,
    source?.endpoint,
    source?.connectionKey,
    source?.schema,
    table.name,
    appliedFilters,
    appliedSearch,
    sort,
    page,
    perPage,
  ])

  // Mirror the applied query state onto the URL (History API) so a refresh or a
  // shared link restores it. Only the applied (debounced) values are written and
  // defaults are omitted, keeping the URL clean; the table name is owned by the
  // page shell.
  useEffect(() => {
    if (!serverMode) {
      return
    }
    updateUrlState({
      q: appliedSearch || null,
      filters: appliedFilters.length ? JSON.stringify(appliedFilters) : null,
      sort: sort ? `${sort.col}:${sort.dir}` : null,
      page: page > 1 ? page : null,
      perPage: perPage !== DEFAULT_PER_PAGE ? perPage : null,
    })
  }, [serverMode, appliedSearch, appliedFilters, sort, page, perPage])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) {
      return rows
    }
    return rows.filter((row) =>
      table.columns.some((c) =>
        String(row[c.name] ?? '')
          .toLowerCase()
          .includes(q),
      ),
    )
  }, [rows, table.columns, filter])

  const sorted = useMemo(() => {
    if (!sort) {
      return filtered
    }
    const col = table.columns.find((c) => c.name === sort.col)
    const numeric = col ? isNumericType(col.type) : false
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => dir * compareValues(a[sort.col], b[sort.col], numeric))
  }, [filtered, sort, table.columns])

  // Server mode already returns exactly the page; client mode slices locally.
  const pageCount = serverMode ? null : Math.max(1, Math.ceil(sorted.length / perPage))
  const current = serverMode ? Math.max(1, page) : Math.min(page, pageCount)
  const start = (current - 1) * perPage
  const pageRows = serverMode ? rows : sorted.slice(start, start + perPage)

  const cycleSort = (name) => {
    setPage(1)
    setSort((s) => {
      if (!s || s.col !== name) {
        return { col: name, dir: 'asc' }
      }
      if (s.dir === 'asc') {
        return { col: name, dir: 'desc' }
      }
      return null
    })
  }

  /** The shared "Copied" flash — one key at a time, cleared after ~1s. */
  const flashCopied = (key) => {
    setCopied(key)
    window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 900)
  }

  const copyCell = (key, value) => {
    navigator.clipboard?.writeText(value === null || value === undefined ? '' : String(value))
    flashCopied(key)
  }

  const copyRowJson = (key, row) => {
    navigator.clipboard?.writeText(JSON.stringify(row, null, 2))
    flashCopied(key)
  }

  /** `column<TAB>value` per line — pastes into a spreadsheet as two columns. */
  const copyRowText = (key, row) => {
    const text = table.columns.map((col) => `${col.name}\t${row[col.name] ?? ''}`).join('\n')
    navigator.clipboard?.writeText(text)
    flashCopied(key)
  }

  const toggleColumnTypes = () => {
    const next = { ...viewPrefs, types: !viewPrefs.types }
    setViewPrefs(next)
    writeViewPrefs(next)
  }

  /**
   * Drag a header's right edge to set that column's width. The starting point is
   * whatever the column measures now, so the first drag continues from the
   * auto-sized width instead of jumping. Persisted on pointer-up only.
   */
  const startColResize = (event, name) => {
    event.preventDefault()
    event.stopPropagation()
    const cell = event.currentTarget.closest('th')
    const startX = event.clientX
    const startWidth = colWidths[name] ?? cell?.getBoundingClientRect().width ?? COL_WIDTH_MIN
    let latest = startWidth

    const onMove = (move) => {
      latest = Math.min(
        COL_WIDTH_MAX,
        Math.max(COL_WIDTH_MIN, startWidth + (move.clientX - startX)),
      )
      setColWidths((prev) => ({ ...prev, [name]: latest }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setColWidths((prev) => {
        const next = { ...prev, [name]: Math.round(latest) }
        writeColWidths(table.name, next)
        return next
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Double-click the handle to give one column its automatic width back. */
  const resetColWidth = (name) =>
    setColWidths((prev) => {
      const next = { ...prev }
      delete next[name]
      writeColWidths(table.name, next)
      return next
    })

  /** Double-click a cell to inspect it; the same cell again closes, a different one swaps. */
  const openCell = (key, column, value) =>
    setCellView((prev) => (prev?.key === key ? null : { key, column, value }))

  /** Right-click anchors the cell menu at the pointer, flipped in near an edge. */
  const openCellMenu = (event, target) => {
    event.preventDefault()
    const height = canEdit ? CELL_MENU_HEIGHT_EDIT : CELL_MENU_HEIGHT
    setCellMenu({
      ...target,
      left: Math.min(event.clientX, window.innerWidth - CELL_MENU_WIDTH - 8),
      top: Math.min(event.clientY, window.innerHeight - height - 8),
    })
  }

  const primaryKeyOf = (row) =>
    Object.fromEntries(pkColumns.map((name) => [name, row?.[name] ?? null]))

  const samePrimaryKey = (a, b) =>
    pkColumns.every((name) => String(a?.[name] ?? '') === String(b?.[name] ?? ''))

  /** Fold a successful write into the local rows + the visible row count. */
  const applyResult = (action, target, data, values) => {
    if (action === 'create') {
      setRows((prev) => [data?.row ?? values ?? {}, ...prev])
      setRowDelta((delta) => delta + 1)
      setPage(1)
      return
    }
    if (action === 'update') {
      const updated = data?.row ?? { ...target, ...values }
      setRows((prev) => prev.map((row) => (samePrimaryKey(row, target) ? updated : row)))
      return
    }
    setRows((prev) => prev.filter((row) => !samePrimaryKey(row, target)))
    setRowDelta((delta) => delta - 1)
  }

  /**
   * One row write. A 409 is the confirmation handshake, not a failure: the server
   * answers with the generated statement + a token, and the same body is posted
   * again with `confirm_token` once the user confirms.
   */
  const sendRow = async (action, target, values, token) => {
    setEditor((state) => (state ? { ...state, pending: true, error: null, values } : state))

    const payload = {
      connection: rowEditing.connectionKey,
      schema: rowEditing.schema,
      table: table.name,
      action,
      pk: action === 'create' ? {} : primaryKeyOf(target),
      values: values ?? {},
    }
    if (token) {
      payload.confirm_token = token
    }

    let status = 0
    let data = {}
    try {
      const response = await fetch(rowEditing.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-TOKEN': rowEditing.csrfToken ?? '',
        },
        body: JSON.stringify(payload),
      })
      status = response.status
      data = await response.json().catch(() => ({}))
    } catch {
      setEditor((state) =>
        state ? { ...state, pending: false, error: t('grid.requestFailed', { status: 0 }) } : state,
      )
      return
    }

    if (status === 409 && data?.confirm) {
      setEditor((state) => (state ? { ...state, pending: false, confirm: data.confirm } : state))
      return
    }
    if (status >= 200 && status < 300) {
      applyResult(action, target, data, values)
      setEditor(null)
      return
    }
    setEditor((state) =>
      state
        ? {
            ...state,
            pending: false,
            confirm: null,
            error: data?.message ?? t('grid.requestFailed', { status }),
          }
        : state,
    )
  }

  const openEditor = (mode, row, pending = false) =>
    setEditor({ mode, row, pending, error: null, confirm: null, values: null })

  const openDelete = (row) => {
    // With confirmations on, the server owns the DELETE preview — ask for it right
    // away so the user confirms the real statement. With them off there is nothing
    // to preview, so the panel asks first and only then fires the write.
    const straightToServer = rowEditing.confirmWrites !== false
    openEditor('delete', row, straightToServer)
    if (straightToServer) {
      sendRow('delete', row, {})
    }
  }

  return (
    <div className="dc-grid-root">
      {/* Header bar */}
      <div className="dc-grid-head">
        <div className="dc-grid-titlebox">
          {table.type === 'view' && <ViewIcon className="dc-grid-view-icon" />}
          <h2 className="dc-grid-title">{title ?? table.name}</h2>
          <span className="dc-grid-subtitle">
            {subtitle ??
              t('grid.subtitle', {
                columns: table.columns.length,
                rows: compactCount(
                  rowDelta === 0
                    ? table.rowCount
                    : Math.max(0, (table.rowCount ?? rows.length) + rowDelta),
                ),
              })}
          </span>
        </div>

        {/* Structure | Data as one icon-only segmented switch, the same shape the
            SQL toolbar uses: the labels said what the icons already say. */}
        {structural && (
          <div className="dc-grid-segbar">
            <SegmentButton
              active={view === 'structure'}
              onClick={() => setView('structure')}
              icon={ColumnIcon}
              label={t('grid.structure')}
            />
            <SegmentButton
              active={view === 'data'}
              onClick={() => setView('data')}
              icon={TableIcon}
              label={t('grid.data')}
            />
          </div>
        )}

        {!showStructure && (
          <div className="dc-grid-toolbar">
            <div className="dc-grid-search">
              <SearchIcon className="dc-grid-search-icon" />
              <input
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setPage(1)
                }}
                placeholder={t('grid.filter')}
                className="dc-grid-search-input"
              />
            </div>

            {serverMode && (
              <FilterAddButton
                columns={filterableColumns}
                value={filters}
                onChange={(next) => {
                  setFilters(next)
                  setPage(1)
                }}
              />
            )}

            {/* New row is the only labelled action — it is the only one that writes. */}
            {canEdit && (
              <button
                type="button"
                onClick={() => openEditor('create', null)}
                className="dc-grid-newrow"
                title={t('grid.newRow')}
              >
                <span aria-hidden="true">+</span>
                {t('grid.newRow')}
              </button>
            )}

            {/* View + CSV: one segmented icon cluster, verdict in the tooltip. */}
            <div className="dc-grid-segbar">
              <div ref={viewMenuRef} className="dc-grid-menuwrap">
                <GridIconButton
                  onClick={() => setViewMenuOpen((v) => !v)}
                  label={t('grid.viewOptions')}
                  icon={GearIcon}
                  active={viewMenuOpen}
                  aria-haspopup="menu"
                  aria-expanded={viewMenuOpen}
                />

                {viewMenuOpen && (
                  <div role="menu" aria-label={t('grid.viewOptions')} className="dc-grid-menu">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={viewPrefs.types}
                      onClick={toggleColumnTypes}
                      className="dc-grid-menu-item"
                    >
                      <span className={cx('dc-grid-check', viewPrefs.types && 'on')}>
                        {viewPrefs.types && <CheckIcon className="dc-grid-check-icon" />}
                      </span>
                      {t('grid.columnTypes')}
                    </button>
                  </div>
                )}
              </div>
              <GridIconButton
                onClick={() =>
                  downloadText(
                    csvName ?? `${table.name}.csv`,
                    toCsv(table.columns, serverMode ? rows : sorted),
                  )
                }
                label={t('grid.exportCsv')}
                icon={DownloadIcon}
                divided
              />
            </div>
          </div>
        )}
      </div>

      {serverMode && !showStructure && filters.length > 0 && (
        <div className="dc-grid-filterbar">
          <FilterConditions
            value={filters}
            onChange={(next) => {
              setFilters(next)
              setPage(1)
            }}
          />
        </div>
      )}

      {showStructure ? (
        <TableStructure table={table} onJumpTo={onJumpTo} />
      ) : (
        <>
          {editableTable && pkColumns.length === 0 && (
            <p className="dc-grid-nopk">{t('grid.noPrimaryKey')}</p>
          )}

          {/* Grid + the cell drawer beside it: the table keeps its own horizontal
              scroll and shrinks, the drawer owns its width. */}
          <div className="dc-grid-body">
            <div className="dc-grid-scroll">
              <table className="dc-grid-table">
                <thead className="dc-grid-thead">
                  <tr>
                    <th className="dc-grid-num-head">#</th>
                    {table.columns.map((col) => {
                      const active = sort?.col === col.name
                      const width = colWidths[col.name]
                      return (
                        <th
                          key={col.name}
                          style={width ? { width, minWidth: width, maxWidth: width } : undefined}
                          className={cx(
                            'dc-grid-col-head',
                            isNumericType(col.type) && 'num',
                            width && 'clip',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => cycleSort(col.name)}
                            className="dc-grid-sort"
                          >
                            {col.pk && <KeyIcon className="dc-grid-key-icon" />}
                            {col.fk && !col.pk && <LinkIcon className="dc-grid-faint-icon" />}
                            <span className="dc-grid-mono">{col.name}</span>
                            <SortIcon
                              className="dc-grid-faint-icon"
                              dir={active ? sort.dir : null}
                            />
                          </button>
                          {viewPrefs.types && (
                            <div className="dc-grid-coltype">
                              {col.type}
                              {!col.nullable && <span className="dc-grid-nn"> ·nn</span>}
                            </div>
                          )}
                          {/* Right-edge grab handle — same gesture as the drawer's. */}
                          <div
                            onPointerDown={(event) => startColResize(event, col.name)}
                            onDoubleClick={() => resetColWidth(col.name)}
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={t('grid.resizeColumn')}
                            title={t('grid.resizeColumn')}
                            className="dc-grid-resize"
                          />
                        </th>
                      )
                    })}
                    {/* Spacer column absorbs leftover width so the grid spans the full pane. */}
                    <th className="dc-grid-spacer-head" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const rowKey = `row:${start + i}`
                    return (
                      <tr key={start + i} className="dc-grid-row">
                        <td className="dc-grid-numcell">
                          {copied === rowKey ? (
                            <CheckIcon className="dc-grid-numcheck" />
                          ) : (
                            start + i + 1
                          )}
                        </td>
                        {table.columns.map((col) => {
                          const value = row[col.name]
                          const cellKey = `${start + i}:${col.name}`
                          return (
                            <Cell
                              key={col.name}
                              column={col}
                              value={value}
                              width={colWidths[col.name]}
                              copied={copied === cellKey}
                              active={cellView?.key === cellKey}
                              onOpen={() => openCell(cellKey, col, value)}
                              onContextMenu={(event) =>
                                openCellMenu(event, { cellKey, column: col, value, row, rowKey })
                              }
                              onJumpTo={onJumpTo}
                            />
                          )
                        })}
                        <td className="dc-grid-endcell" />
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={table.columns.length + 2} className="dc-grid-empty">
                        {serverMode && loading
                          ? t('grid.loading')
                          : (fetchError ?? t('grid.noMatchingRows'))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {cellView && (
              <CellDrawer
                column={cellView.column}
                value={cellView.value}
                onClose={() => setCellView(null)}
              />
            )}
          </div>

          {/* One menu for everything a row or a cell can do — the grid has no
              actions column, so right-click is the way in. */}
          {cellMenu && (
            <div
              data-dc-cell-menu="true"
              role="menu"
              aria-label={t('grid.cellMenu')}
              style={{ top: cellMenu.top, left: cellMenu.left }}
              className="dc-grid-cellmenu"
            >
              <MenuItem
                icon={ColumnIcon}
                onClick={() => {
                  openCell(cellMenu.cellKey, cellMenu.column, cellMenu.value)
                  setCellMenu(null)
                }}
              >
                {cellView?.key === cellMenu.cellKey ? t('grid.hideValue') : t('grid.inspectValue')}
              </MenuItem>
              {cellMenu.column?.fk && (
                <MenuItem
                  icon={LinkIcon}
                  onClick={() => {
                    setCellMenu(null)
                    onJumpTo?.(String(cellMenu.column.fk).split('.')[0])
                  }}
                >
                  {t('common.jumpTo', { target: cellMenu.column.fk })}
                </MenuItem>
              )}

              <hr className="dc-grid-divider" />
              {/* All three copies together — same intent, different scope/format. */}
              <MenuItem
                icon={CopyIcon}
                onClick={() => {
                  copyCell(cellMenu.cellKey, cellMenu.value)
                  setCellMenu(null)
                }}
              >
                {t('grid.copyValue')}
              </MenuItem>
              <MenuItem
                icon={CopyIcon}
                onClick={() => {
                  copyRowJson(cellMenu.rowKey, cellMenu.row)
                  setCellMenu(null)
                }}
              >
                {t('grid.copyRowJson')}
              </MenuItem>
              <MenuItem
                icon={CopyIcon}
                onClick={() => {
                  copyRowText(cellMenu.rowKey, cellMenu.row)
                  setCellMenu(null)
                }}
              >
                {t('grid.copyRowText')}
              </MenuItem>

              {canEdit && (
                <>
                  <hr className="dc-grid-divider" />
                  <MenuItem
                    icon={WandIcon}
                    onClick={() => {
                      setCellMenu(null)
                      openEditor('update', cellMenu.row)
                    }}
                  >
                    {t('grid.editRow')}
                  </MenuItem>
                  <MenuItem
                    icon={TrashIcon}
                    accent
                    onClick={() => {
                      setCellMenu(null)
                      openDelete(cellMenu.row)
                    }}
                  >
                    {t('grid.deleteRow')}
                  </MenuItem>
                </>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="dc-grid-foot">
            <span>
              {serverMode
                ? pageRows.length === 0
                  ? t('grid.noRows')
                  : t(hasMore ? 'grid.showingServerMore' : 'grid.showingServer', {
                      from: start + 1,
                      to: start + pageRows.length,
                    })
                : sorted.length === 0
                  ? t('grid.noRows')
                  : t('grid.showingRows', {
                      from: start + 1,
                      to: start + pageRows.length,
                      total: sorted.length,
                    })}
            </span>
            <label className="dc-grid-perpage">
              <span>{t('grid.perPage')}</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value))
                  setPage(1)
                }}
                className="dc-grid-select"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="dc-grid-toolbar">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={current <= 1}
                className="dc-grid-pagebtn"
              >
                {t('grid.previous')}
              </button>
              <span>
                {serverMode
                  ? t('grid.pageOnly', { current })
                  : t('grid.page', { current, total: pageCount })}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => (serverMode ? p + 1 : Math.min(pageCount, p + 1)))}
                disabled={serverMode ? !hasMore : current >= pageCount}
                className="dc-grid-pagebtn"
              >
                {t('grid.next')}
              </button>
            </div>
          </div>
        </>
      )}

      {editor && canEdit && (
        <RowForm
          mode={editor.mode}
          columns={table.columns}
          row={editor.row}
          pending={editor.pending}
          error={editor.error}
          confirm={editor.confirm}
          onCancel={() => setEditor(null)}
          onSubmit={(values) => sendRow(editor.mode, editor.row, values)}
          onConfirm={(token) => sendRow(editor.mode, editor.row, editor.values ?? {}, token)}
        />
      )}
    </div>
  )
}

/** One line of a popup menu (row `⋯` or cell); `accent` paints the destructive entry. */
function MenuItem({ icon: Icon, onClick, accent, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx('dc-grid-menu-item', accent && 'accent')}
    >
      <Icon className="dc-grid-menu-icon" />
      {children}
    </button>
  )
}

/** One half of the Structure | Data switch: icon only, name in the tooltip. */
function SegmentButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      aria-label={label}
      className={cx('dc-grid-seg', active && 'on')}
    >
      <Icon className="dc-grid-icon" />
    </button>
  )
}

/** Icon-only toolbar action, sized to match the SQL console's cluster. */
function GridIconButton({ onClick, label, icon: Icon, active, divided, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cx('dc-grid-iconbtn', divided && 'divided', active && 'on')}
      {...rest}
    >
      <Icon className="dc-grid-icon" />
    </button>
  )
}

function Cell({ column, value, width, copied, active, onOpen, onContextMenu, onJumpTo }) {
  const t = useStrings()
  const { kind, text } = classifyCell(value, column)
  const numeric = kind === 'number'

  const inner = () => {
    if (copied) {
      return (
        <span className="dc-grid-copied">
          <CheckIcon className="dc-grid-icon-sm" /> {t('grid.copied')}
        </span>
      )
    }
    if (kind === 'null') {
      return <span className="dc-grid-null">NULL</span>
    }
    if (column.fk && value !== null && value !== undefined) {
      const target = String(column.fk).split('.')[0]
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onJumpTo?.(target)
          }}
          className="dc-grid-fk"
          title={t('common.jumpTo', { target: column.fk })}
        >
          <LinkIcon className="dc-grid-icon-sm" />
          {text}
        </button>
      )
    }
    if (kind === 'json') {
      return <span className="dc-grid-json">{text}</span>
    }
    return <span className={cx(numeric && 'dc-grid-mono')}>{text}</span>
  }

  return (
    <td
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      title={kind === 'null' ? 'NULL' : text}
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
      className={cx('dc-grid-cell', !width && 'cap', numeric && 'num', active && 'on')}
    >
      {inner()}
    </td>
  )
}

/**
 * Local glyphs: `icons.jsx` carries no dots / gear / copy icon and is owned
 * elsewhere, so the three the menus need live here.
 */

const strokeBase = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
}

function CopyIcon({ className }) {
  return (
    <svg className={className} {...strokeBase} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M6 15H5a2 2 0 01-2-2V5a2 2 0 012-2h8a2 2 0 012 2v1" />
    </svg>
  )
}

function GearIcon({ className }) {
  return (
    <svg className={className} {...strokeBase} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5l1.2 2.6 2.8-.6.6 2.8 2.6 1.2-1.6 2.4 1.6 2.4-2.6 1.2-.6 2.8-2.8-.6L12 21.5l-1.2-2.6-2.8.6-.6-2.8-2.6-1.2L6.4 13 4.8 10.6l2.6-1.2.6-2.8 2.8.6z" />
    </svg>
  )
}
