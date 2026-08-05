<?php

declare(strict_types=1);

namespace Phattarachai\DbConsole\Exceptions;

use RuntimeException;

/**
 * A statement the console refuses to run, or a driver error, carrying a message
 * that is safe to show in the browser. Surfaced as 422 by the controller.
 */
final class SqlGuardException extends RuntimeException {}
