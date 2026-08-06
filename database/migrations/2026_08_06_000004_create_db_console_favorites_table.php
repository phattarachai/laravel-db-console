<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('db_console_favorites', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('session_id', 255)->nullable();
            $table->string('connection', 64);
            $table->string('schema', 128);
            // `table_name`, not `table`: Eloquent's own $table property would shadow
            // an attribute of that name on the model.
            $table->string('table_name', 255);
            $table->timestamps();

            $table->index('user_id');
            $table->index('session_id');
            // Not unique: exactly one owner column is ever set, and Postgres treats
            // the NULL half as distinct, so a unique index here would only pretend
            // to enforce anything. FavoriteStore is what keeps a star idempotent.
            $table->index(['connection', 'schema', 'table_name'], 'db_console_favorites_object_index');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('db_console_favorites');
    }
};
