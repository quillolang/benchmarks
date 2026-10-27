<?php
// php-fpm: a fresh request each time (OPcache keeps the compiled code).
require __DIR__ . "/app.php";
handle(open_db());
