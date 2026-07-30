<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Override;

/**
 * One run of one statement, written whether it succeeded, was rejected by the
 * guard, or errored. Append-only, so there is no `updated_at`.
 *
 * Lives on the host application's default connection, outside the console's
 * rolled-back read transaction — a discarded read still leaves its trail.
 *
 * @property int $id
 * @property int|null $user_id
 * @property string|null $session_id
 * @property string $connection
 * @property string $sql
 * @property int|null $rows
 * @property int $elapsed_ms
 * @property string $status
 * @property Carbon|null $created_at
 */
final class HistoryEntry extends Model
{
    public $timestamps = false;

    protected $table = 'db_console_history';

    /** @var list<string> */
    protected $fillable = [
        'user_id',
        'session_id',
        'connection',
        'sql',
        'rows',
        'elapsed_ms',
        'status',
        'created_at',
    ];

    /** @return array<string, string> */
    #[Override]
    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'rows' => 'integer',
            'elapsed_ms' => 'integer',
            'created_at' => 'datetime',
        ];
    }
}
