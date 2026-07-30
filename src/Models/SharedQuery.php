<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Override;

/**
 * A token that reopens the console with the same SQL. Expired rows stay until
 * `db-console:prune` clears them; resolving one just refuses to hand it back.
 *
 * Lives on the host application's default connection.
 *
 * @property int $id
 * @property string $token
 * @property int|null $user_id
 * @property string|null $session_id
 * @property string $connection
 * @property string $sql
 * @property Carbon|null $expires_at
 * @property Carbon|null $created_at
 */
final class SharedQuery extends Model
{
    public $timestamps = false;

    protected $table = 'db_console_shares';

    /** @var list<string> */
    protected $fillable = [
        'token',
        'user_id',
        'session_id',
        'connection',
        'sql',
        'expires_at',
        'created_at',
    ];

    /** @return array<string, string> */
    #[Override]
    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'expires_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }
}
