<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Override;

/**
 * A query the owner named and kept. Never pruned.
 *
 * Lives on the host application's default connection — the console's browsable
 * connections are read-only targets, not where the tool keeps its own state.
 *
 * @property int $id
 * @property int|null $user_id
 * @property string|null $session_id
 * @property string $connection
 * @property string $name
 * @property string $sql
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class SavedQuery extends Model
{
    protected $table = 'db_console_queries';

    /** @var list<string> */
    protected $fillable = [
        'user_id',
        'session_id',
        'connection',
        'name',
        'sql',
    ];

    /** @return array<string, string> */
    #[Override]
    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
        ];
    }
}
