import { createContext, useCallback, useContext } from 'react'

/**
 * Every user-visible string in the Database Console, keyed by a flat dotted key
 * grouped by area (`toolbar.*`, `sidebar.*`, `grid.*`, `structure.*`, `sql.*`,
 * `guard.*`, `common.*`).
 *
 * The defaults are **English** so the module renders standalone with zero props.
 * A host app overrides any subset by passing `strings` to `<DbConsole>` — the
 * Laravel side ships the same flat keys in `lang/{locale}/ui.php`, so the JS
 * object and the PHP array are the same shape.
 *
 * Placeholders use Laravel's `:name` convention (see `interpolate`).
 */
export const DEFAULT_STRINGS = {
  // Toolbar (DbConsole)
  'toolbar.brand': 'DB Console',
  'toolbar.toggleSidebar': 'Toggle sidebar',
  'toolbar.modeExplorer': 'Tables',
  'toolbar.modeSql': 'SQL',
  'toolbar.modeRead': 'Read-only',
  'toolbar.modeWrite': 'Writable',
  'toolbar.switchConnection': 'Switch connection',
  'toolbar.home': 'Back to the app',
  'toolbar.schemeLight': 'Light — click for dark',
  'toolbar.schemeDark': 'Dark — click to follow the app',
  'toolbar.schemeAuto': 'Following the app — click for light',

  // Explorer body (DbConsole)
  'explorer.selectTable': 'Pick a table from the sidebar to view its data',
  'explorer.loadingTable': 'Loading :table…',

  // Fatal / share-link notices (DbConsole)
  'errors.fatalHint': 'Check config/db-console.php and your database connection.',
  'errors.shareExpired': 'That share link has expired.',

  // Object explorer (Sidebar)
  'sidebar.heading': 'Tables & Views',
  'sidebar.filter': 'Filter tables…',
  'sidebar.noMatches': 'No table matches “:search”',
  'sidebar.showColumns': 'Show columns',
  'sidebar.favorite': 'Add to favourites',
  'sidebar.unfavorite': 'Remove from favourites',
  'sidebar.favoritesOnly': 'Show favourites only',
  'sidebar.showAll': 'Show all tables',
  'sidebar.noFavorites': 'No favourite yet — star a table to pin it here',
  'sidebar.loadingColumns': 'Loading columns…',
  'sidebar.viewBadge': 'view',
  'sidebar.insertTableHint': 'Double-click to insert the name into the SQL editor',
  'sidebar.insertColumnHint': 'Double-click to insert into the SQL editor',

  // Data grid (DataGrid)
  'grid.structure': 'Structure',
  'grid.data': 'Data',
  'grid.subtitle': ':columns columns · ~:rows rows',
  'grid.filter': 'Search in this table…',
  'grid.exportCsv': 'Export current view to CSV',
  'grid.noRows': 'No rows',
  'grid.noMatchingRows': 'No row matches the filter',
  'grid.showingRows': 'Showing :from–:to of :total rows (sample)',
  'grid.perPage': 'Per page',
  'grid.previous': 'Previous',
  'grid.next': 'Next',
  'grid.page': 'Page :current / :total',
  'grid.copied': 'Copied',
  'grid.resizeColumn': 'Drag to resize · double-click to reset',

  // Right-click cell menu (DataGrid) — the grid's only actions menu
  'grid.cellMenu': 'Cell actions',
  'grid.inspectValue': 'Inspect full value',
  'grid.hideValue': 'Hide the value panel',
  'grid.copyValue': 'Copy value',

  // View menu (DataGrid) — the gear that toggles optional header detail
  'grid.view': 'View',
  'grid.viewOptions': 'View options',
  'grid.columnTypes': 'Column types',

  // Row editing (DataGrid + RowForm) — only on a writable connection
  'grid.newRow': 'New row',
  'grid.editRow': 'Edit row',
  'grid.copyRowJson': 'Copy row as JSON',
  'grid.copyRowText': 'Copy row as text',
  'grid.deleteRow': 'Delete row',
  'grid.noPrimaryKey': 'This table has no primary key, so rows cannot be edited.',
  'grid.createTitle': 'Insert row',
  'grid.updateTitle': 'Edit row',
  'grid.deleteTitle': 'Delete row',
  'grid.deletePrompt': 'Delete this row? This cannot be undone.',
  'grid.insert': 'Insert',
  'grid.save': 'Save',
  'grid.delete': 'Delete',
  'grid.cancel': 'Cancel',
  'grid.working': 'Working…',
  'grid.nullToggle': 'null',
  'grid.defaultHint': 'default: :value — leave blank to use it',
  'grid.maskedColumn': 'Masked — cannot be edited.',
  'grid.primaryKeyField': 'Primary key — read-only',
  'grid.noChanges': 'Nothing changed — no update to save.',
  'grid.confirmWord': 'RUN',
  'grid.confirmIntro': 'This statement is about to run on a writable connection.',
  'grid.confirmPrompt': 'Type :word to confirm',
  'grid.confirm': 'Confirm',
  'grid.requestFailed': 'Request failed (:status)',

  // Structure view (TableStructure)
  'structure.columns': 'Columns',
  'structure.columnName': 'Name',
  'structure.columnType': 'Type',
  'structure.columnNull': 'null',
  'structure.columnDefault': 'Default',
  'structure.columnKey': 'Key',
  'structure.nullableYes': 'yes',
  'structure.nullableNo': 'no',
  'structure.indexes': 'Indexes',
  'structure.noIndexes': 'No indexes',
  'structure.foreignKeys': 'Foreign keys',
  'structure.noForeignKeys': 'No foreign keys',
  'structure.onDelete': 'on delete :action',
  'structure.onUpdate': 'on update :action',

  // Cell inspector panel (CellDrawer)
  'drawer.copy': 'Copy value',
  'drawer.copied': 'Copied',
  'drawer.close': 'Close panel',
  'drawer.resize': 'Drag to resize · double-click to reset',
  'drawer.pretty': 'Pretty',
  'drawer.raw': 'Raw',
  'drawer.null': 'null',
  'drawer.empty': 'empty string',

  // SQL console (SqlConsole / SqlEditor)
  'sql.run': 'Run',
  'sql.running': 'Running…',
  'sql.runHint': 'Run (⌘/Ctrl + Enter)',
  'sql.format': 'Format',
  'sql.formatHint': 'Format SQL',
  'sql.clear': 'Clear',
  'sql.clearHint': 'Clear the editor',
  'sql.save': 'Save',
  'sql.saveHint': 'Save this query',
  'sql.explain': 'Explain',
  'sql.explainHint': 'Show the query plan (EXPLAIN)',
  'sql.share': 'Share',
  'sql.shareHint': 'Copy a link to this query',
  'sql.shareCopied': 'Link copied.',
  'sql.shareFallback': 'Copy this link:',
  'sql.editorPlaceholder': 'SELECT … (read-only)  —  press ⌘/Ctrl + Enter to run',
  'sql.tabs.result': 'Results',
  'sql.tabs.saved': 'Saved (:count)',
  'sql.tabs.history': 'History (:count)',
  'sql.tabs.plan': 'Plan',
  'sql.chip.read': 'Read-only',
  'sql.chip.write': 'Write',
  'sql.chip.blocked': 'Blocked',
  'sql.confirmWord': 'RUN',
  'sql.confirmNeeded': 'This write needs confirmation before it runs.',
  'sql.confirm.title': 'Confirm this write',
  'sql.confirm.body': 'Type :word to run this statement.',
  'sql.confirm.placeholder': 'Type :word',
  'sql.confirm.cancel': 'Cancel',
  'sql.confirm.run': 'Confirm and run',
  'sql.result.title': 'Results',
  'sql.result.running': 'Running the query…',
  'sql.result.empty': 'Write a SELECT and press Run (⌘/Ctrl + Enter) to see the results',
  'sql.result.columns': ':count columns',
  'sql.result.rows': ':count rows',
  'sql.result.elapsed': ':ms ms',
  'sql.result.truncated': 'Truncated at 5000',
  'sql.result.simulated': 'Simulated result',
  'sql.result.writeTitle': 'Statement applied',
  'sql.result.rowsAffected': ':count rows affected',
  'sql.plan.title': 'Query plan',
  'sql.saved.empty': 'No saved query yet',
  'sql.saved.remove': 'Delete saved query',
  'sql.saved.removeLabel': 'Delete :name',
  'sql.history.empty': 'No run history yet',
  'sql.history.meta': ':rows rows · :ms ms · :at',
  'sql.history.failed': 'failed',
  'sql.error.title': 'Query failed',
  'sql.error.request': 'Request failed (:status)',
  'sql.error.noEndpoint': 'No query endpoint is configured.',

  // Statement guard (sql-lib classifySql — keys mirror the server's guard lang file)
  'guard.title': 'Blocked by the guard',
  'guard.hint': 'This console runs one statement at a time',
  'guard.empty': 'No statement to run.',
  'guard.single_statement': 'Only one statement at a time.',
  'guard.must_start': 'A statement must start with SELECT.',
  'guard.blocked': ':keyword is blocked — never allowed on any connection.',
  'guard.read_only': ':keyword needs a writable connection; this one is read-only.',
  'guard.unsupported': ':keyword is not supported.',
  'guard.read': 'Read-only',
  'guard.write': ':keyword changes data on this writable connection.',

  // Shared fragments
  'common.notNull': 'not null',
  'common.jumpTo': 'Go to :target',
  'common.dismiss': 'Dismiss',
}

/**
 * Copy overrides for the whole module. Defaults to `DEFAULT_STRINGS` so any
 * component used outside `<DbConsole>` still renders real English copy.
 */
export const StringsContext = createContext(DEFAULT_STRINGS)

/**
 * Substitute Laravel-style `:name` placeholders. Longer keys are replaced first
 * so `:count` never eats the head of `:countTotal`.
 */
export function interpolate(template, replacements) {
  if (!replacements) {
    return template
  }
  return Object.keys(replacements)
    .sort((a, b) => b.length - a.length)
    .reduce((out, key) => out.replaceAll(`:${key}`, String(replacements[key] ?? '')), template)
}

/**
 * Resolve one key against `strings`, falling back to the English default and
 * then to the key itself — so a missing key never renders `undefined`.
 */
export function translate(strings, key, replacements) {
  return interpolate(strings?.[key] ?? DEFAULT_STRINGS[key] ?? key, replacements)
}

/**
 * @returns {(key: string, replacements?: Record<string, unknown>) => string} the
 *   `t` translator bound to the nearest `StringsContext`.
 */
export function useStrings() {
  const strings = useContext(StringsContext)
  return useCallback((key, replacements) => translate(strings, key, replacements), [strings])
}
