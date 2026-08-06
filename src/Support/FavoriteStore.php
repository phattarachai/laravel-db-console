<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Phattarachai\DbConsole\Models\Favorite;

/**
 * Starred tables, per connection and per owner.
 *
 * Owner scoping is the same rule as {@see QueryStore}: the authenticated user
 * when the host app has auth, the session otherwise. Kept server-side rather
 * than in localStorage because a favourite is a statement about the database,
 * not about this browser — it should follow the person to their laptop.
 */
final class FavoriteStore
{
    use ScopesToOwner;

    /**
     * The starred tables for one connection, as `schema.table` keys — the shape
     * the sidebar matches against, so the client does no joining.
     *
     * @return list<string>
     */
    public function all(string $connection): array
    {
        return $this->scopeToOwner(Favorite::query())
            ->where('connection', $connection)
            ->orderBy('schema')
            ->orderBy('table_name')
            ->get()
            ->map(fn (Favorite $favorite): string => $favorite->schema.'.'.$favorite->table_name)
            ->all();
    }

    /**
     * Star or unstar one table.
     *
     * @return bool whether it is starred afterwards
     */
    public function toggle(string $connection, string $schema, string $table): bool
    {
        $existing = $this->find($connection, $schema, $table);

        if ($existing !== null) {
            $this->scopeToOwner(Favorite::query())
                ->where('connection', $connection)
                ->where('schema', $schema)
                ->where('table_name', $table)
                ->delete();

            return false;
        }

        Favorite::query()->create([
            ...$this->ownerAttributes(),
            'connection' => $connection,
            'schema' => $schema,
            'table_name' => $table,
        ]);

        return true;
    }

    private function find(string $connection, string $schema, string $table): ?Favorite
    {
        $favorite = $this->scopeToOwner(Favorite::query())
            ->where('connection', $connection)
            ->where('schema', $schema)
            ->where('table_name', $table)
            ->first();

        return $favorite instanceof Favorite ? $favorite : null;
    }
}
