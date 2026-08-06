import { useMemo, useState } from 'react'

import {
  ChevronIcon,
  ColumnIcon,
  DatabaseIcon,
  KeyIcon,
  SearchIcon,
  StarIcon,
  TableIcon,
  ViewIcon,
} from './icons'
import { compactCount, cx, readFavoritesOnly, writeFavoritesOnly } from './lib'
import { useStrings } from './strings'

/**
 * Object explorer — the left tree of schemas → tables/views, with a name filter,
 * a favourites-only filter, and a per-table expandable column list. Selecting a
 * table drives the data grid.
 *
 * The tree itself carries only names, kinds and row counts. A table's columns are
 * fetched the first time its row is expanded (`onLoadDetails`), so a database with
 * hundreds of tables costs nothing extra to render.
 *
 * When `onInsert` is provided (SQL mode), double-clicking a table or column name
 * inserts that identifier into the SQL editor at the cursor.
 */
export function Sidebar({
  schemas,
  selected,
  onSelect,
  search,
  onSearch,
  onInsert,
  favorites,
  onToggleFavorite,
  getDetails,
  onLoadDetails,
}) {
  const t = useStrings()
  const [openSchemas, setOpenSchemas] = useState(() => new Set(schemas.map((s) => s.name)))
  const [openColumns, setOpenColumns] = useState(() => new Set())
  const [favoritesOnly, setFavoritesOnly] = useState(readFavoritesOnly)

  const starred = useMemo(() => new Set(favorites ?? []), [favorites])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    if (!q && !favoritesOnly) {
      return schemas
    }

    return schemas
      .map((schema) => ({
        ...schema,
        tables: schema.tables.filter(
          (table) =>
            (!q || table.name.toLowerCase().includes(q)) &&
            (!favoritesOnly || starred.has(`${schema.name}.${table.name}`)),
        ),
      }))
      .filter((schema) => schema.tables.length > 0)
  }, [schemas, search, favoritesOnly, starred])

  const toggle = (set, key) => {
    const next = new Set(set)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  }

  const toggleColumns = (schemaName, table) => {
    setOpenColumns((open) => toggle(open, `${schemaName}.${table.name}`))
    onLoadDetails?.(schemaName, table.name)
  }

  const cycleFavoritesOnly = () => {
    const next = !favoritesOnly
    setFavoritesOnly(next)
    writeFavoritesOnly(next)
  }

  const total = schemas.reduce((n, s) => n + s.tables.length, 0)
  const canFavorite = Boolean(onToggleFavorite)
  const emptyMessage = favoritesOnly && !search.trim() ? t('sidebar.noFavorites') : null

  return (
    <div className="tw:flex tw:h-full tw:flex-col tw:bg-[var(--dc-sidebar)]">
      <div className="tw:flex tw:items-center tw:justify-between tw:px-3 tw:pt-3 tw:pb-2">
        <span className="tw:text-[11px] tw:font-semibold tw:tracking-wider tw:text-[var(--dc-text-muted)] tw:uppercase">
          {t('sidebar.heading')}
        </span>
        <span className="tw:rounded-full tw:bg-[var(--dc-active)] tw:px-1.5 tw:text-[11px] tw:text-[var(--dc-text-muted)]">
          {total}
        </span>
      </div>

      <div className="tw:flex tw:items-center tw:gap-1.5 tw:px-3 tw:pb-2">
        <div className="tw:relative tw:min-w-0 tw:flex-1">
          <SearchIcon className="tw:pointer-events-none tw:absolute tw:top-1/2 tw:left-2 tw:h-3.5 tw:w-3.5 tw:-translate-y-1/2 tw:text-[var(--dc-text-faint)]" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('sidebar.filter')}
            className="tw:w-full tw:rounded-md tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:py-1.5 tw:pr-2 tw:pl-7 tw:text-xs tw:text-[var(--dc-text)] tw:outline-none tw:placeholder:text-[var(--dc-text-faint)] tw:focus:border-[var(--dc-accent)]"
          />
        </div>

        {canFavorite && (
          <button
            type="button"
            onClick={cycleFavoritesOnly}
            aria-pressed={favoritesOnly}
            title={t(favoritesOnly ? 'sidebar.showAll' : 'sidebar.favoritesOnly')}
            aria-label={t(favoritesOnly ? 'sidebar.showAll' : 'sidebar.favoritesOnly')}
            className={cx(
              'tw:shrink-0 tw:rounded-md tw:border tw:p-1.5',
              favoritesOnly
                ? 'tw:border-[var(--dc-accent)] tw:bg-[var(--dc-accent-soft)] tw:text-[var(--dc-accent)]'
                : 'tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:text-[var(--dc-text-faint)] tw:hover:text-[var(--dc-text)]',
            )}
          >
            <StarIcon className="tw:h-3.5 tw:w-3.5" filled={favoritesOnly} />
          </button>
        )}
      </div>

      <div className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto tw:pb-4">
        {filtered.length === 0 && (
          <p className="tw:px-3 tw:py-6 tw:text-center tw:text-xs tw:text-[var(--dc-text-faint)]">
            {emptyMessage ?? t('sidebar.noMatches', { search })}
          </p>
        )}

        {filtered.map((schema) => {
          const schemaOpen = openSchemas.has(schema.name)
          return (
            <div key={schema.name}>
              <button
                type="button"
                onClick={() => setOpenSchemas((s) => toggle(s, schema.name))}
                className="tw:flex tw:w-full tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:text-left tw:hover:bg-[var(--dc-hover)]"
              >
                <ChevronIcon
                  className={cx(
                    'tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-text-faint)] tw:transition-transform',
                    schemaOpen && 'tw:rotate-90',
                  )}
                />
                <DatabaseIcon className="tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-text-muted)]" />
                <span className="tw:truncate tw:text-xs tw:font-medium tw:text-[var(--dc-text)]">
                  {schema.name}
                </span>
                <span className="tw:ml-auto tw:text-[11px] tw:text-[var(--dc-text-faint)]">
                  {schema.tables.length}
                </span>
              </button>

              {schemaOpen &&
                schema.tables.map((table) => {
                  const key = `${schema.name}.${table.name}`
                  const isSelected = selected?.name === table.name
                  const colsOpen = openColumns.has(key)
                  const isStarred = starred.has(key)
                  const columns = getDetails?.(schema.name, table.name)?.columns ?? null

                  return (
                    <div key={table.name}>
                      <div
                        className={cx(
                          'tw:group tw:flex tw:items-center tw:gap-1 tw:pr-1 tw:pl-3',
                          isSelected
                            ? 'tw:bg-[var(--dc-accent-soft)]'
                            : 'tw:hover:bg-[var(--dc-hover)]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleColumns(schema.name, table)}
                          className="tw:shrink-0 tw:p-1 tw:text-[var(--dc-text-faint)]"
                          title={t('sidebar.showColumns')}
                        >
                          <ChevronIcon
                            className={cx(
                              'tw:h-3 tw:w-3 tw:transition-transform',
                              colsOpen && 'tw:rotate-90',
                            )}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelect(table)}
                          onDoubleClick={() => onInsert?.(table.name)}
                          title={onInsert ? t('sidebar.insertTableHint') : undefined}
                          className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-1.5 tw:py-1 tw:text-left"
                        >
                          {table.type === 'view' ? (
                            <ViewIcon className="tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-view-icon)]" />
                          ) : (
                            <TableIcon className="tw:h-3.5 tw:w-3.5 tw:shrink-0 tw:text-[var(--dc-table-icon)]" />
                          )}
                          <span
                            className={cx(
                              'tw:truncate tw:text-xs',
                              isSelected
                                ? 'tw:font-medium tw:text-[var(--dc-text)]'
                                : 'tw:text-[var(--dc-text)]',
                            )}
                          >
                            {table.name}
                          </span>
                          {table.type === 'view' && (
                            <span className="tw:shrink-0 tw:rounded tw:bg-[var(--dc-active)] tw:px-1 tw:text-[9px] tw:tracking-wide tw:text-[var(--dc-text-muted)] tw:uppercase">
                              {t('sidebar.viewBadge')}
                            </span>
                          )}
                          <span className="tw:ml-auto tw:shrink-0 tw:text-[10px] tw:text-[var(--dc-text-faint)]">
                            {compactCount(table.rowCount)}
                          </span>
                        </button>

                        {canFavorite && (
                          <button
                            type="button"
                            onClick={() => onToggleFavorite(schema.name, table.name)}
                            title={t(isStarred ? 'sidebar.unfavorite' : 'sidebar.favorite')}
                            aria-label={t(isStarred ? 'sidebar.unfavorite' : 'sidebar.favorite')}
                            aria-pressed={isStarred}
                            className={cx(
                              'tw:shrink-0 tw:p-1',
                              isStarred
                                ? 'tw:text-[var(--dc-accent)]'
                                : 'tw:text-[var(--dc-text-faint)] tw:opacity-0 tw:group-hover:opacity-100 tw:hover:text-[var(--dc-text)] tw:focus:opacity-100',
                            )}
                          >
                            <StarIcon className="tw:h-3 tw:w-3" filled={isStarred} />
                          </button>
                        )}
                      </div>

                      {colsOpen && columns === null && (
                        <p className="tw:py-1 tw:pl-9 tw:text-[11px] tw:text-[var(--dc-text-faint)]">
                          {t('sidebar.loadingColumns')}
                        </p>
                      )}

                      {colsOpen &&
                        columns?.map((col) => (
                          <div
                            key={col.name}
                            onDoubleClick={() => onInsert?.(col.name)}
                            className={cx(
                              'tw:flex tw:items-center tw:gap-1.5 tw:py-0.5 tw:pr-2 tw:pl-9 tw:hover:bg-[var(--dc-hover)]',
                              onInsert && 'tw:cursor-pointer tw:select-none',
                            )}
                            title={`${col.type}${col.nullable ? '' : ` · ${t('common.notNull')}`}${col.fk ? ` · → ${col.fk}` : ''}${onInsert ? ` · ${t('sidebar.insertColumnHint')}` : ''}`}
                          >
                            {col.pk ? (
                              <KeyIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-key)]" />
                            ) : (
                              <ColumnIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-text-faint)]" />
                            )}
                            <span className="tw:truncate tw:text-[11px] tw:text-[var(--dc-text-muted)]">
                              {col.name}
                            </span>
                            <span className="tw:ml-auto tw:shrink-0 tw:text-[10px] tw:text-[var(--dc-text-faint)] tw:lowercase">
                              {col.type}
                            </span>
                          </div>
                        ))}
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
