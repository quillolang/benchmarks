<?php
// FrankenPHP worker mode: loaded once, then each request handled in a loop.
require __DIR__ . "/app.php";
ignore_user_abort(true);
$db = open_db();
$handler = static function () use ($db) { handle($db); };
while (frankenphp_handle_request($handler)) {}
