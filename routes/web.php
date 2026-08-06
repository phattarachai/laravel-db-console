<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;
use Phattarachai\DbConsole\Http\Controllers\DbConsoleController;

Route::get('/', [DbConsoleController::class, 'index'])->name('index');
Route::get('/s/{token}', [DbConsoleController::class, 'shared'])->name('shared');

Route::get('/table', [DbConsoleController::class, 'table'])->name('table');

Route::post('/favorite', [DbConsoleController::class, 'favorite'])->name('favorite');

Route::post('/query', [DbConsoleController::class, 'query'])->name('query');
Route::post('/explain', [DbConsoleController::class, 'explain'])->name('explain');
Route::post('/row', [DbConsoleController::class, 'row'])->name('row');
Route::post('/share', [DbConsoleController::class, 'share'])->name('share');

Route::post('/saved', [DbConsoleController::class, 'storeSaved'])->name('saved.store');
Route::delete('/saved/{saved}', [DbConsoleController::class, 'destroySaved'])->name('saved.destroy');
