import { ColumnIcon, KeyIcon, LinkIcon } from './icons'
import { cx } from './lib'
import { useStrings } from './strings'

/**
 * Read-only structure view for the selected table/view — the `grid.structure` tab.
 * Three stacked sections: columns (name/type/nullable/default + PK·FK markers),
 * indexes, and foreign keys. FK targets jump to the referenced table via
 * `onJumpTo`. Fed the same table object as the DataGrid (see
 * `App\Support\DbConsole\Fixture`).
 */
export function TableStructure({ table, onJumpTo }) {
  const t = useStrings()
  const indexes = table.indexes ?? []
  const foreignKeys = table.foreignKeys ?? []

  return (
    <div className="dc-struct-root">
      <div className="dc-struct-body">
        <Section title={t('structure.columns')} count={table.columns.length}>
          <table className="dc-struct-table">
            <thead>
              <tr className="dc-struct-head">
                <Th className="num">#</Th>
                <Th>{t('structure.columnName')}</Th>
                <Th>{t('structure.columnType')}</Th>
                <Th className="center">{t('structure.columnNull')}</Th>
                <Th>{t('structure.columnDefault')}</Th>
                <Th>{t('structure.columnKey')}</Th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col, i) => (
                <tr key={col.name} className="dc-struct-row">
                  <Td className="idx">{i + 1}</Td>
                  <Td>
                    <span className="dc-struct-name">
                      {col.pk ? (
                        <KeyIcon className="dc-struct-icon key" />
                      ) : col.fk ? (
                        <LinkIcon className="dc-struct-icon faint" />
                      ) : (
                        <ColumnIcon className="dc-struct-icon faint" />
                      )}
                      <span className="dc-struct-colname">{col.name}</span>
                    </span>
                  </Td>
                  <Td className="type">
                    {col.type}
                  </Td>
                  <Td className="center">
                    {col.nullable ? (
                      <span className="dc-struct-faint">
                        {t('structure.nullableYes')}
                      </span>
                    ) : (
                      <span className="dc-struct-null-no">
                        {t('structure.nullableNo')}
                      </span>
                    )}
                  </Td>
                  <Td className="mono">
                    {col.default ?? <span className="dc-struct-faint">–</span>}
                  </Td>
                  <Td>
                    {col.pk && <Badge tone="key">PK</Badge>}
                    {col.fk && (
                      <button
                        type="button"
                        onClick={() => onJumpTo?.(String(col.fk).split('.')[0])}
                        className="dc-struct-jump"
                        title={t('common.jumpTo', { target: col.fk })}
                      >
                        <LinkIcon className="dc-struct-icon" />
                        {col.fk}
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title={t('structure.indexes')} count={indexes.length}>
          {indexes.length === 0 ? (
            <Empty>{t('structure.noIndexes')}</Empty>
          ) : (
            <ul className="dc-struct-list">
              {indexes.map((ix) => (
                <li key={ix.name} className="dc-struct-item">
                  <Badge
                    tone={ix.type === 'PRIMARY' ? 'key' : ix.type === 'UNIQUE' ? 'accent' : 'muted'}
                  >
                    {ix.type}
                  </Badge>
                  <span className="dc-struct-code">
                    {ix.name}
                  </span>
                  <span className="dc-struct-code dim">
                    ({ix.columns.join(', ')})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('structure.foreignKeys')} count={foreignKeys.length}>
          {foreignKeys.length === 0 ? (
            <Empty>{t('structure.noForeignKeys')}</Empty>
          ) : (
            <ul className="dc-struct-list">
              {foreignKeys.map((fk) => (
                <li key={fk.name} className="dc-struct-item wrap">
                  <span className="dc-struct-code dim">
                    {fk.name}
                  </span>
                  <span className="dc-struct-code">
                    ({fk.columns.join(', ')})
                  </span>
                  <span className="dc-struct-faint">→</span>
                  <button
                    type="button"
                    onClick={() => onJumpTo?.(String(fk.references).split('.')[0])}
                    className="dc-struct-jump"
                    title={t('common.jumpTo', { target: fk.references })}
                  >
                    <LinkIcon className="dc-struct-icon" />
                    {fk.references}
                  </button>
                  {(fk.onDelete !== 'NO ACTION' || fk.onUpdate !== 'NO ACTION') && (
                    <span className="dc-struct-action">
                      {fk.onDelete !== 'NO ACTION' &&
                        t('structure.onDelete', { action: fk.onDelete })}
                      {fk.onDelete !== 'NO ACTION' && fk.onUpdate !== 'NO ACTION' && ' · '}
                      {fk.onUpdate !== 'NO ACTION' &&
                        t('structure.onUpdate', { action: fk.onUpdate })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, count, children }) {
  return (
    <section className="dc-struct-section">
      <div className="dc-struct-section-head">
        <h3 className="dc-struct-section-title">
          {title}
        </h3>
        <span className="dc-struct-count">
          {count}
        </span>
      </div>
      <div className="dc-struct-section-body">{children}</div>
    </section>
  )
}

function Th({ className, children }) {
  return (
    <th className={cx('dc-struct-th', className)}>
      {children}
    </th>
  )
}

function Td({ className, children }) {
  return (
    <td className={cx('dc-struct-td', className)}>
      {children}
    </td>
  )
}

function Empty({ children }) {
  return <p className="dc-struct-empty">{children}</p>
}

function Badge({ tone, children }) {
  const tones = {
    key: 'key',
    accent: 'accent',
    muted: 'muted',
  }
  return (
    <span className={cx('dc-struct-badge', tones[tone] ?? tones.muted)}>
      {children}
    </span>
  )
}
