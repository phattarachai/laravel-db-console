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
    <div className="tw:min-h-0 tw:flex-1 tw:overflow-auto tw:px-4 tw:py-4">
      <div className="tw:mx-auto tw:flex tw:max-w-4xl tw:flex-col tw:gap-6">
        <Section title={t('structure.columns')} count={table.columns.length}>
          <table className="tw:w-full tw:border-separate tw:border-spacing-0 tw:text-xs">
            <thead>
              <tr className="tw:text-left tw:text-[var(--dc-text-muted)]">
                <Th className="tw:w-8 tw:text-right">#</Th>
                <Th>{t('structure.columnName')}</Th>
                <Th>{t('structure.columnType')}</Th>
                <Th className="tw:text-center">{t('structure.columnNull')}</Th>
                <Th>{t('structure.columnDefault')}</Th>
                <Th>{t('structure.columnKey')}</Th>
              </tr>
            </thead>
            <tbody>
              {table.columns.map((col, i) => (
                <tr key={col.name} className="tw:group tw:hover:bg-[var(--dc-hover)]">
                  <Td className="tw:text-right tw:text-[var(--dc-text-faint)]">{i + 1}</Td>
                  <Td>
                    <span className="tw:inline-flex tw:items-center tw:gap-1.5">
                      {col.pk ? (
                        <KeyIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-key)]" />
                      ) : col.fk ? (
                        <LinkIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-text-faint)]" />
                      ) : (
                        <ColumnIcon className="tw:h-3 tw:w-3 tw:shrink-0 tw:text-[var(--dc-text-faint)]" />
                      )}
                      <span className="tw:font-mono tw:text-[var(--dc-text)]">{col.name}</span>
                    </span>
                  </Td>
                  <Td className="tw:font-mono tw:text-[var(--dc-text-muted)] tw:lowercase">
                    {col.type}
                  </Td>
                  <Td className="tw:text-center">
                    {col.nullable ? (
                      <span className="tw:text-[var(--dc-text-faint)]">
                        {t('structure.nullableYes')}
                      </span>
                    ) : (
                      <span className="tw:font-medium tw:text-[var(--dc-key)]">
                        {t('structure.nullableNo')}
                      </span>
                    )}
                  </Td>
                  <Td className="tw:font-mono tw:text-[var(--dc-text-muted)]">
                    {col.default ?? <span className="tw:text-[var(--dc-text-faint)]">–</span>}
                  </Td>
                  <Td>
                    {col.pk && <Badge tone="key">PK</Badge>}
                    {col.fk && (
                      <button
                        type="button"
                        onClick={() => onJumpTo?.(String(col.fk).split('.')[0])}
                        className="tw:inline-flex tw:items-center tw:gap-1 tw:font-mono tw:text-[var(--dc-accent)] tw:hover:underline"
                        title={t('common.jumpTo', { target: col.fk })}
                      >
                        <LinkIcon className="tw:h-3 tw:w-3" />
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
            <ul className="tw:flex tw:flex-col tw:gap-1">
              {indexes.map((ix) => (
                <li
                  key={ix.name}
                  className="tw:flex tw:items-center tw:gap-2 tw:rounded tw:px-2 tw:py-1 tw:hover:bg-[var(--dc-hover)]"
                >
                  <Badge
                    tone={ix.type === 'PRIMARY' ? 'key' : ix.type === 'UNIQUE' ? 'accent' : 'muted'}
                  >
                    {ix.type}
                  </Badge>
                  <span className="tw:font-mono tw:text-xs tw:text-[var(--dc-text)]">
                    {ix.name}
                  </span>
                  <span className="tw:font-mono tw:text-xs tw:text-[var(--dc-text-muted)]">
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
            <ul className="tw:flex tw:flex-col tw:gap-1">
              {foreignKeys.map((fk) => (
                <li
                  key={fk.name}
                  className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:rounded tw:px-2 tw:py-1 tw:hover:bg-[var(--dc-hover)]"
                >
                  <span className="tw:font-mono tw:text-xs tw:text-[var(--dc-text-muted)]">
                    {fk.name}
                  </span>
                  <span className="tw:font-mono tw:text-xs tw:text-[var(--dc-text)]">
                    ({fk.columns.join(', ')})
                  </span>
                  <span className="tw:text-[var(--dc-text-faint)]">→</span>
                  <button
                    type="button"
                    onClick={() => onJumpTo?.(String(fk.references).split('.')[0])}
                    className="tw:inline-flex tw:items-center tw:gap-1 tw:font-mono tw:text-xs tw:text-[var(--dc-accent)] tw:hover:underline"
                    title={t('common.jumpTo', { target: fk.references })}
                  >
                    <LinkIcon className="tw:h-3 tw:w-3" />
                    {fk.references}
                  </button>
                  {(fk.onDelete !== 'NO ACTION' || fk.onUpdate !== 'NO ACTION') && (
                    <span className="tw:text-[10px] tw:text-[var(--dc-text-faint)] tw:uppercase">
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
    <section className="tw:overflow-hidden tw:rounded-lg tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-surface)]">
      <div className="tw:flex tw:items-center tw:gap-2 tw:border-b tw:border-[var(--dc-border)] tw:bg-[var(--dc-header)] tw:px-3 tw:py-2">
        <h3 className="tw:text-xs tw:font-semibold tw:tracking-wide tw:text-[var(--dc-text)] tw:uppercase">
          {title}
        </h3>
        <span className="tw:rounded-full tw:bg-[var(--dc-active)] tw:px-1.5 tw:text-[11px] tw:text-[var(--dc-text-muted)]">
          {count}
        </span>
      </div>
      <div className="tw:px-3 tw:py-2">{children}</div>
    </section>
  )
}

function Th({ className, children }) {
  return (
    <th
      className={cx(
        'tw:border-b tw:border-[var(--dc-border)] tw:px-2 tw:py-1.5 tw:font-medium',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({ className, children }) {
  return (
    <td
      className={cx(
        'tw:border-b tw:border-[var(--dc-border)] tw:px-2 tw:py-1.5 tw:align-top',
        className,
      )}
    >
      {children}
    </td>
  )
}

function Empty({ children }) {
  return <p className="tw:px-2 tw:py-1 tw:text-xs tw:text-[var(--dc-text-faint)]">{children}</p>
}

function Badge({ tone, children }) {
  const tones = {
    key: 'tw:text-[var(--dc-key)]',
    accent: 'tw:text-[var(--dc-accent)]',
    muted: 'tw:text-[var(--dc-text-muted)]',
  }
  return (
    <span
      className={cx(
        'tw:inline-block tw:rounded tw:border tw:border-[var(--dc-border)] tw:bg-[var(--dc-bg)] tw:px-1.5 tw:py-0.5 tw:text-[10px] tw:font-semibold tw:tracking-wide',
        tones[tone] ?? tones.muted,
      )}
    >
      {children}
    </span>
  )
}
