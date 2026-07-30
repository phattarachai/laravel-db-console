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
  toCsv,
} from './lib'
import { RowForm } from './RowForm'
import { useStrings } from './strings'
import { TableStructure } from './TableStructure'

const PAGE_SIZES = [25, 50, 100, 200]

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
}) {
  const t = useStrings()
  const [sort, setSort] = useState(null)
  const [filter, setFilter] = useState('')
  const [perPage, setPerPage] = useState(50)
  const [page, setPage] = useState(1)
  const [copied, setCopied] = useState(null)
  const [view, setView] = useState('data')
  const [editor, setEditor] = useState(null)
  const [rowDelta, setRowDelta] = useState(0)

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

  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage))
  const current = Math.min(page, pageCount)
  const start = (current - 1) * perPage
  const pageRows = sorted.slice(start, start + perPage)

  const cycleSort = (name) =>
    setSort((s) => {
      if (!s || s.col !== name) {
        return { col: name, dir: 'asc' }
      }
      if (s.dir === 'asc') {
        return { col: name, dir: 'desc' }
      }
      return null
    })

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
    <div className="tw:flex tw:h-full tw:min-w-0 tw:flex-1 tw:flex-col">
      {/* Header bar */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-4 tw:py-2.5">
        <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
          {table.type === 'view' && (
            <ViewIcon className="tw:h-4 tw:w-4 tw:shrink-0 tw:text-[var(--dc-view-icon)]" />
          )}
          <h2 className="tw:truncate tw:font-mono tw:text-sm tw:font-semibold tw:text-[var(--dc-text)]">
            {title ?? table.name}
          </h2>
          <span className="tw:shrink-0 tw:text-xs tw:text-[var(--dc-text-muted)]">
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
          <div className="tw:flex tw:items-center tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)]">
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
          <div className="tw:ml-auto tw:flex tw:items-center tw:gap-2">
            <div className="tw:relative">
              <SearchIcon className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-2 tw:h-3.5 tw:w-3.5 tw:-translate-y-1/2 tw:text-[var(--dc-text-faint)]" />
              <input
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setPage(1)
                }}
                placeholder={t('grid.filter')}
                className="tw:h-7 tw:w-44 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:pr-2 tw:pl-7 tw:text-xs tw:text-[var(--dc-text)] tw:outline-none tw:placeholder:text-[var(--dc-text-faint)] tw:focus:border-[var(--dc-accent)]"
              />
            </div>

            {/* New row is the only labelled action — it is the only one that writes. */}
            {canEdit && (
              <button
                type="button"
                onClick={() => openEditor('create', null)}
                className="tw:flex tw:h-7 tw:items-center tw:gap-1 tw:rounded-md tw:bg-[var(--dc-accent)] tw:px-2.5 tw:text-xs tw:font-semibold tw:text-[var(--dc-accent-foreground)]"
                title={t('grid.newRow')}
              >
                <span aria-hidden="true">+</span>
                {t('grid.newRow')}
              </button>
            )}

            {/* View + CSV: one segmented icon cluster, verdict in the tooltip. */}
            <div className="tw:flex tw:items-center tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)]">
              <div ref={viewMenuRef} className="tw:relative">
                <GridIconButton
                  onClick={() => setViewMenuOpen((v) => !v)}
                  label={t('grid.viewOptions')}
                  icon={GearIcon}
                  active={viewMenuOpen}
                  aria-haspopup="menu"
                  aria-expanded={viewMenuOpen}
                />

                {viewMenuOpen && (
                  <div
                    role="menu"
                    aria-label={t('grid.viewOptions')}
                    className="tw:absolute tw:top-full tw:left-0 tw:z-30 tw:mt-1 tw:w-52 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:py-1 tw:shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={viewPrefs.types}
                      onClick={toggleColumnTypes}
                      className="tw:flex tw:w-full tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:text-left tw:text-xs tw:text-[var(--dc-text)] tw:hover:bg-[var(--dc-hover)]"
                    >
                      <span
                        className={cx(
                          'tw:flex tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:items-center tw:justify-center tw:rounded tw:border',
                          viewPrefs.types
                            ? 'tw:border-[var(--dc-accent)] tw:bg-[var(--dc-accent)] tw:text-[var(--dc-accent-foreground)]'
                            : 'tw:border-[var(--dc-border)]',
                        )}
                      >
                        {viewPrefs.types && <CheckIcon className="tw:h-2.5 tw:w-2.5" />}
                      </span>
                      {t('grid.columnTypes')}
                    </button>
                  </div>
                )}
              </div>
              <GridIconButton
                onClick={() =>
                  downloadText(csvName ?? `${table.name}.csv`, toCsv(table.columns, sorted))
                }
                label={t('grid.exportCsv')}
                icon={DownloadIcon}
                divided
              />
            </div>
          </div>
        )}
      </div>

      {showStructure ? (
        <TableStructure table={table} onJumpTo={onJumpTo} />
      ) : (
        <>
          {editableTable && pkColumns.length === 0 && (
            <p className="tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-4 tw:py-1.5 tw:text-xs tw:text-[var(--dc-text-faint)]">
              {t('grid.noPrimaryKey')}
            </p>
          )}

          {/* Grid + the cell drawer beside it: the table keeps its own horizontal
              scroll and shrinks, the drawer owns its width. */}
          <div className="tw:flex tw:min-h-0 tw:flex-1">
            <div className="tw:min-w-0 tw:flex-1 tw:overflow-auto">
              <table className="tw:min-w-full tw:border-separate tw:border-spacing-0 tw:text-xs">
                <thead className="tw:sticky tw:top-0 tw:z-10">
                  <tr>
                    <th className="tw:sticky tw:left-0 tw:z-20 tw:w-10 tw:border-r tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-header)] tw:px-2 tw:py-1.5 tw:text-right tw:font-normal tw:text-[var(--dc-text-faint)]">
                      #
                    </th>
                    {table.columns.map((col) => {
                      const active = sort?.col === col.name
                      const width = colWidths[col.name]
                      return (
                        <th
                          key={col.name}
                          style={width ? { width, minWidth: width, maxWidth: width } : undefined}
                          className={cx(
                            'tw:relative tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-header)] tw:px-3 tw:py-1.5 tw:font-semibold tw:whitespace-nowrap tw:text-[var(--dc-text)]',
                            isNumericType(col.type) ? 'tw:text-right' : 'tw:text-left',
                            width && 'tw:overflow-hidden',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => cycleSort(col.name)}
                            className="tw:inline-flex tw:items-center tw:gap-1 tw:align-middle tw:hover:text-[var(--dc-accent)]"
                          >
                            {col.pk && (
                              <KeyIcon className="tw:h-3 tw:w-3 tw:text-[var(--dc-key)]" />
                            )}
                            {col.fk && !col.pk && (
                              <LinkIcon className="tw:h-3 tw:w-3 tw:text-[var(--dc-text-faint)]" />
                            )}
                            <span className="tw:font-mono">{col.name}</span>
                            <SortIcon
                              className="tw:h-3 tw:w-3 tw:text-[var(--dc-text-faint)]"
                              dir={active ? sort.dir : null}
                            />
                          </button>
                          {viewPrefs.types && (
                            <div className="tw:font-mono tw:text-[10px] tw:font-normal tw:lowercase tw:text-[var(--dc-text-faint)]">
                              {col.type}
                              {!col.nullable && (
                                <span className="tw:text-[var(--dc-key)]"> ·nn</span>
                              )}
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
                            className="tw:absolute tw:top-0 tw:right-0 tw:bottom-0 tw:z-10 tw:w-1.5 tw:cursor-col-resize tw:hover:bg-[var(--dc-accent)]"
                          />
                        </th>
                      )
                    })}
                    {/* Spacer column absorbs leftover width so the grid spans the full pane. */}
                    <th className="tw:w-full tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-header)]" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => {
                    const rowKey = `row:${start + i}`
                    return (
                      <tr key={start + i} className="tw:group tw:hover:bg-[var(--dc-hover)]">
                        <td className="tw:sticky tw:left-0 tw:z-10 tw:border-r tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-2 tw:py-1 tw:text-right tw:text-[var(--dc-text-faint)] tw:group-hover:bg-[var(--dc-hover)]">
                          {copied === rowKey ? (
                            <CheckIcon className="tw:inline-block tw:h-3 tw:w-3 tw:text-[var(--dc-view-icon)]" />
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
                        <td className="tw:border-b tw:border-[var(--dc-border)] tw:group-hover:bg-[var(--dc-hover)]" />
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={table.columns.length + 2}
                        className="tw:px-4 tw:py-10 tw:text-center tw:text-[var(--dc-text-muted)]"
                      >
                        {t('grid.noMatchingRows')}
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
              className="tw:fixed tw:z-50 tw:w-56 tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:py-1 tw:shadow-lg"
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

              <hr className="tw:my-1 tw:border-0 tw:border-t tw:border-[var(--dc-border)]" />
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
                  <hr className="tw:my-1 tw:border-0 tw:border-t tw:border-[var(--dc-border)]" />
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
          <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-2 tw:border-t tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)] tw:px-4 tw:py-2 tw:text-xs tw:text-[var(--dc-text-muted)]">
            <span>
              {sorted.length === 0
                ? t('grid.noRows')
                : t('grid.showingRows', {
                    from: start + 1,
                    to: start + pageRows.length,
                    total: sorted.length,
                  })}
            </span>
            <label className="tw:flex tw:items-center tw:gap-1.5">
              <span>{t('grid.perPage')}</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value))
                  setPage(1)
                }}
                className="tw:rounded tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-1 tw:py-0.5 tw:text-xs tw:text-[var(--dc-text)] tw:outline-none"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="tw:ml-auto tw:flex tw:items-center tw:gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={current <= 1}
                className="tw:rounded tw:border tw:border-[var(--dc-border)] tw:px-2 tw:py-0.5 tw:hover:bg-[var(--dc-hover)] tw:disabled:opacity-40"
              >
                {t('grid.previous')}
              </button>
              <span>{t('grid.page', { current, total: pageCount })}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={current >= pageCount}
                className="tw:rounded tw:border tw:border-[var(--dc-border)] tw:px-2 tw:py-0.5 tw:hover:bg-[var(--dc-hover)] tw:disabled:opacity-40"
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
      className={cx(
        'tw:flex tw:w-full tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:text-left tw:text-xs tw:hover:bg-[var(--dc-hover)]',
        accent ? 'tw:text-[var(--dc-accent)]' : 'tw:text-[var(--dc-text)]',
      )}
    >
      <Icon className="tw:h-3.5 tw:w-3.5 tw:shrink-0" />
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
      className={cx(
        'tw:flex tw:h-7 tw:w-8 tw:items-center tw:justify-center tw:border-l tw:border-[var(--dc-border)] tw:first:rounded-l-md tw:first:border-l-0 tw:last:rounded-r-md',
        active
          ? 'tw:bg-[var(--dc-accent)] tw:text-[var(--dc-accent-foreground)]'
          : 'tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]',
      )}
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
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
      className={cx(
        'tw:flex tw:h-7 tw:w-8 tw:items-center tw:justify-center tw:rounded-md',
        divided && 'tw:rounded-l-none tw:border-l tw:border-[var(--dc-border)]',
        active
          ? 'tw:bg-[var(--dc-hover)] tw:text-[var(--dc-text)]'
          : 'tw:text-[var(--dc-text-muted)] tw:hover:bg-[var(--dc-hover)] tw:hover:text-[var(--dc-text)]',
      )}
      {...rest}
    >
      <Icon className="tw:h-3.5 tw:w-3.5" />
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
        <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-[var(--dc-view-icon)]">
          <CheckIcon className="tw:h-3 tw:w-3" /> {t('grid.copied')}
        </span>
      )
    }
    if (kind === 'null') {
      return <span className="tw:text-[var(--dc-null)] tw:italic">NULL</span>
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
          className="tw:inline-flex tw:items-center tw:gap-1 tw:font-mono tw:text-[var(--dc-accent)] tw:hover:underline"
          title={t('common.jumpTo', { target: column.fk })}
        >
          <LinkIcon className="tw:h-3 tw:w-3" />
          {text}
        </button>
      )
    }
    if (kind === 'json') {
      return <span className="tw:font-mono tw:text-[var(--dc-table-icon)]">{text}</span>
    }
    return <span className={cx(numeric && 'tw:font-mono')}>{text}</span>
  }

  return (
    <td
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      title={kind === 'null' ? 'NULL' : text}
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
      className={cx(
        'tw:truncate tw:border-b tw:border-[var(--dc-border)] tw:px-3 tw:py-1 tw:text-[var(--dc-text)]',
        !width && 'tw:max-w-[22rem]',
        numeric ? 'tw:text-right' : 'tw:text-left',
        active && 'tw:bg-[var(--dc-accent-soft)]',
      )}
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
