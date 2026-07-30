<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Console;

use Closure;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Date;
use Phattarachai\DbConsole\Models\HistoryEntry;
use Phattarachai\DbConsole\Models\SharedQuery;

/**
 * Trims run history by age and then per owner, and clears expired share links.
 * Saved queries are kept indefinitely and never touched here.
 *
 * Idempotent, and deletes in chunks so a long-neglected install does not hold a
 * table lock for the length of one enormous statement.
 */
final class PruneCommand extends Command
{
    private const int CHUNK = 1000;

    protected $signature = 'db-console:prune';

    protected $description = 'Prune DB Console run history and expired share links.';

    public function handle(): int
    {
        $keepDays = (int)config('db-console.history.keep_days', 30);
        $keepRows = (int)config('db-console.history.keep_rows', 500);

        $byAge = $this->pruneHistoryByAge($keepDays);
        $this->line("History older than {$keepDays} days: {$byAge} row(s) deleted.");

        $byOwner = $this->trimHistoryPerOwner($keepRows);
        $this->line("History beyond the newest {$keepRows} per owner: {$byOwner} row(s) deleted.");

        $shares = $this->pruneExpiredShares();
        $this->line("Expired share links: {$shares} row(s) deleted.");

        return self::SUCCESS;
    }

    private function pruneHistoryByAge(int $keepDays): int
    {
        if ($keepDays <= 0) {
            return 0;
        }

        $cutoff = Date::now()->subDays($keepDays);

        return $this->deleteInChunks(fn(): Builder => HistoryEntry::query()
            ->whereNotNull('created_at')
            ->where('created_at', '<', $cutoff));
    }

    /**
     * Owners are bucketed by `user_id` when there is one and by `session_id`
     * otherwise — the same split `QueryStore` writes, so buckets never overlap.
     */
    private function trimHistoryPerOwner(int $keepRows): int
    {
        if ($keepRows <= 0) {
            return 0;
        }

        $deleted = 0;

        foreach ($this->ownerBuckets() as $bucket) {
            $deleted += $this->trimBucket($bucket, $keepRows);
        }

        return $deleted;
    }

    /**
     * @return list<Closure(Builder): Builder>
     */
    private function ownerBuckets(): array
    {
        $userBuckets = HistoryEntry::query()
            ->whereNotNull('user_id')
            ->distinct()
            ->pluck('user_id')
            ->map(fn(mixed $userId): Closure => fn(Builder $query): Builder => $query->where('user_id', $userId))
            ->all();

        $sessionBuckets = HistoryEntry::query()
            ->whereNull('user_id')
            ->whereNotNull('session_id')
            ->distinct()
            ->pluck('session_id')
            ->map(fn(mixed $sessionId): Closure => fn(Builder $query): Builder => $query
                ->whereNull('user_id')
                ->where('session_id', $sessionId))
            ->all();

        return [...$userBuckets, ...$sessionBuckets];
    }

    /**
     * @param Closure(Builder): Builder $bucket
     */
    private function trimBucket(Closure $bucket, int $keepRows): int
    {
        $cutoff = $bucket(HistoryEntry::query())
            ->orderByDesc('id')
            ->skip($keepRows)
            ->take(1)
            ->value('id');

        if ($cutoff === null) {
            return 0;
        }

        return $this->deleteInChunks(fn(): Builder => $bucket(HistoryEntry::query())
            ->where('id', '<=', $cutoff));
    }

    private function pruneExpiredShares(): int
    {
        $now = Date::now();

        return $this->deleteInChunks(fn(): Builder => SharedQuery::query()
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', $now));
    }

    /**
     * Deletes by explicit key batches: Postgres has no `DELETE ... LIMIT`, so a
     * limited builder would silently delete the whole match in one statement.
     *
     * @param Closure(): Builder $filtered a fresh, filtered query per pass
     */
    private function deleteInChunks(Closure $filtered): int
    {
        $deleted = 0;

        while (true) {
            $ids = $filtered()->orderBy('id')->limit(self::CHUNK)->pluck('id');

            if ($ids->isEmpty()) {
                return $deleted;
            }

            $removed = $filtered()->whereIn('id', $ids->all())->delete();

            if ($removed === 0) {
                return $deleted;
            }

            $deleted += $removed;
        }
    }
}
