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
    <div className="dc-side-root">
      <div className="dc-side-head">
        <span className="dc-side-heading">{t('sidebar.heading')}</span>
        <span className="dc-pill round">{total}</span>
      </div>

      <div className="dc-side-filter">
        <div className="dc-side-search-wrap">
          <SearchIcon className="dc-side-search-icon" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={t('sidebar.filter')}
            className="dc-input dc-side-search"
          />
        </div>

        {canFavorite && (
          <button
            type="button"
            onClick={cycleFavoritesOnly}
            aria-pressed={favoritesOnly}
            title={t(favoritesOnly ? 'sidebar.showAll' : 'sidebar.favoritesOnly')}
            aria-label={t(favoritesOnly ? 'sidebar.showAll' : 'sidebar.favoritesOnly')}
            className={cx('dc-side-favfilter', favoritesOnly && 'on')}
          >
            <StarIcon className="dc-side-filterstar" filled={favoritesOnly} />
          </button>
        )}
      </div>

      <div className="dc-side-tree">
        {filtered.length === 0 && (
          <p className="dc-side-empty">{emptyMessage ?? t('sidebar.noMatches', { search })}</p>
        )}

        {filtered.map((schema) => {
          const schemaOpen = openSchemas.has(schema.name)
          return (
            <div key={schema.name}>
              <button
                type="button"
                onClick={() => setOpenSchemas((s) => toggle(s, schema.name))}
                className="dc-side-schema"
              >
                <ChevronIcon className={cx('dc-side-schema-chevron', schemaOpen && 'on')} />
                <DatabaseIcon className="dc-side-schema-icon" />
                <span className="dc-side-schema-name">{schema.name}</span>
                <span className="dc-side-schema-count">{schema.tables.length}</span>
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
                      <div className={cx('dc-side-table', isSelected && 'on')}>
                        <button
                          type="button"
                          onClick={() => toggleColumns(schema.name, table)}
                          className="dc-side-expand"
                          title={t('sidebar.showColumns')}
                        >
                          <ChevronIcon className={cx('dc-side-col-chevron', colsOpen && 'on')} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelect(table)}
                          onDoubleClick={() => onInsert?.(table.name)}
                          title={onInsert ? t('sidebar.insertTableHint') : undefined}
                          className="dc-side-table-btn"
                        >
                          {table.type === 'view' ? (
                            <ViewIcon className="dc-side-view-icon" />
                          ) : (
                            <TableIcon className="dc-side-table-icon" />
                          )}
                          <span className={cx('dc-side-table-name', isSelected && 'on')}>
                            {table.name}
                          </span>
                          {table.type === 'view' && (
                            <span className="dc-side-view-badge">{t('sidebar.viewBadge')}</span>
                          )}
                          <span className="dc-side-table-count">
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
                            className={cx('dc-side-fav', isStarred && 'on')}
                          >
                            <StarIcon className="dc-side-rowstar" filled={isStarred} />
                          </button>
                        )}
                      </div>

                      {colsOpen && columns === null && (
                        <p className="dc-side-loading">{t('sidebar.loadingColumns')}</p>
                      )}

                      {colsOpen &&
                        columns?.map((col) => (
                          <div
                            key={col.name}
                            onDoubleClick={() => onInsert?.(col.name)}
                            className={cx('dc-side-col', onInsert && 'ins')}
                            title={`${col.type}${col.nullable ? '' : ` · ${t('common.notNull')}`}${col.fk ? ` · → ${col.fk}` : ''}${onInsert ? ` · ${t('sidebar.insertColumnHint')}` : ''}`}
                          >
                            {col.pk ? (
                              <KeyIcon className="dc-side-col-key" />
                            ) : (
                              <ColumnIcon className="dc-side-col-icon" />
                            )}
                            <span className="dc-side-col-name">{col.name}</span>
                            <span className="dc-side-col-type">{col.type}</span>
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
