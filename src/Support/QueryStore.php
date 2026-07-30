<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;
use Phattarachai\DbConsole\Exceptions\SqlGuardException;
use Phattarachai\DbConsole\Models\HistoryEntry;
use Phattarachai\DbConsole\Models\SavedQuery;
use Phattarachai\DbConsole\Models\SharedQuery;

/**
 * Saved queries, run history, and share links.
 *
 * Everything is scoped to an "owner": the authenticated user when the host app
 * has auth, the session otherwise — so the console works unchanged in an app
 * with no auth at all, and one owner never sees or deletes another's rows.
 */
final class QueryStore
{
    /** Defensive cap so a pathological statement cannot bloat the row. */
    private const int SQL_LIMIT = 20000;

    /** The UI only ever renders a page of history; `keep_rows` bounds the table. */
    private const int HISTORY_LIMIT = 100;

    /** @return list<array{id:int,name:string,sql:string,connection:string}> */
    public function saved(): array
    {
        return $this->scopeToOwner(SavedQuery::query())
            ->orderByDesc('id')
            ->get()
            ->map(fn(SavedQuery $query): array => $this->presentSaved($query))
            ->all();
    }

    /**
     * Naming the same statement twice renames the existing row rather than
     * stacking duplicates in the sidebar.
     *
     * @return array{id:int,name:string,sql:string,connection:string}
     */
    public function save(string $connection, string $sql, string $name): array
    {
        $existing = $this->scopeToOwner(SavedQuery::query())
            ->where('connection', $connection)
            ->where('sql', $sql)
            ->first();

        if ($existing instanceof SavedQuery) {
            $existing->update(['name' => $name]);

            return $this->presentSaved($existing);
        }

        $saved = SavedQuery::query()->create([
            ...$this->ownerAttributes(),
            'connection' => $connection,
            'name' => $name,
            'sql' => $this->truncate($sql),
        ]);

        return $this->presentSaved($saved);
    }

    public function forget(int $id): bool
    {
        return $this->scopeToOwner(SavedQuery::query())->whereKey($id)->delete() > 0;
    }

    /** @return list<array{id:int,sql:string,connection:string,rows:int|null,elapsedMs:int,status:string,at:string}> */
    public function history(): array
    {
        return $this->scopeToOwner(HistoryEntry::query())
            ->orderByDesc('id')
            ->limit(self::HISTORY_LIMIT)
            ->get()
            ->map(fn(HistoryEntry $entry): array => [
                'id' => (int)$entry->id,
                'sql' => (string)$entry->sql,
                'connection' => (string)$entry->connection,
                'rows' => $entry->rows === null ? null : (int)$entry->rows,
                'elapsedMs' => (int)$entry->elapsed_ms,
                'status' => (string)$entry->status,
                'at' => $entry->created_at?->toIso8601String() ?? '',
            ])
            ->all();
    }

    /**
     * Written for every run — ok, rejected, and error alike. The history table
     * sits on the app's own connection, outside the console's read transaction,
     * so a rolled-back read still leaves its row behind.
     */
    public function record(string $connection, string $sql, ?int $rows, int $elapsedMs, string $status): void
    {
        HistoryEntry::query()->create([
            ...$this->ownerAttributes(),
            'connection' => $connection,
            'sql' => $this->truncate($sql),
            'rows' => $rows,
            'elapsed_ms' => $elapsedMs,
            'status' => $status,
            'created_at' => Date::now(),
        ]);
    }

    /** @return string the share token */
    public function share(string $connection, string $sql): string
    {
        if (!(bool)config('db-console.share.enabled', default: true)) {
            throw new SqlGuardException((string)__('db-console::guard.share_disabled'));
        }

        $token = mb_substr(Str::random(32), 0, 32);
        $expiresDays = config('db-console.share.expires_days');

        SharedQuery::query()->create([
            ...$this->ownerAttributes(),
            'token' => $token,
            'connection' => $connection,
            'sql' => $this->truncate($sql),
            'expires_at' => $expiresDays === null ? null : Date::now()->addDays((int)$expiresDays),
            'created_at' => Date::now(),
        ]);

        return $token;
    }

    /**
     * An expired token resolves to nothing but is left in place — pruning is the
     * scheduled command's job, not a side effect of opening a link.
     *
     * @return array{connection:string,sql:string}|null
     */
    public function resolveShare(string $token): ?array
    {
        $shared = SharedQuery::query()->where('token', $token)->first();

        if (!$shared instanceof SharedQuery) {
            return null;
        }

        if ($shared->expires_at !== null && $shared->expires_at->isPast()) {
            return null;
        }

        return [
            'connection' => (string)$shared->connection,
            'sql' => (string)$shared->sql,
        ];
    }

    /**
     * The single place the user/session branch is expressed for reads.
     */
    private function scopeToOwner(Builder $query): Builder
    {
        $owner = $this->ownerAttributes();

        if ($owner['user_id'] !== null) {
            return $query->where('user_id', $owner['user_id']);
        }

        if ($owner['session_id'] === null) {
            return $query->whereNull('user_id')->whereNull('session_id');
        }

        return $query->whereNull('user_id')->where('session_id', $owner['session_id']);
    }

    /**
     * The same branch for writes. Exactly one of the two is ever set, which is
     * what keeps the prune command's owner buckets disjoint.
     *
     * @return array{user_id:int|null,session_id:string|null}
     */
    private function ownerAttributes(): array
    {
        $userId = $this->ownerUserId();

        if ($userId !== null) {
            return ['user_id' => $userId, 'session_id' => null];
        }

        return ['user_id' => null, 'session_id' => $this->ownerSessionId()];
    }

    /**
     * Non-numeric keys (a UUID-keyed user table) fall through to session
     * scoping rather than being coerced into the integer column.
     */
    private function ownerUserId(): ?int
    {
        $id = auth()->hasUser() ? auth()->id() : null;

        return is_numeric($id) ? (int)$id : null;
    }

    private function ownerSessionId(): ?string
    {
        $id = session()->getId();

        return $id === '' ? null : $id;
    }

    private function truncate(string $sql): string
    {
        return mb_substr($sql, 0, self::SQL_LIMIT);
    }

    /** @return array{id:int,name:string,sql:string,connection:string} */
    private function presentSaved(SavedQuery $query): array
    {
        return [
            'id' => (int)$query->id,
            'name' => (string)$query->name,
            'sql' => (string)$query->sql,
            'connection' => (string)$query->connection,
        ];
    }
}
