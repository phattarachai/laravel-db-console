<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Tests\Fixtures;

use Illuminate\Foundation\Auth\User as Authenticatable;

/**
 * The suite's authenticatable. The console never touches the host's user model
 * beyond `$request->user()`, so a four-column stand-in is the whole contract.
 */
final class DcUser extends Authenticatable
{
    protected $table = 'dc_users';

    protected $guarded = [];

    public $timestamps = false;
}
