<?php
// The server benchmark in PHP: the same answers as quillo.qwe, node.js and
// bun.js. index.php serves it through php-fpm, worker.php through FrankenPHP.

const FORTUNES = [
    [1, "fortune: No such file or directory"],
    [2, "A computer scientist is someone who fixes things that aren't broken."],
    [3, "After enough decimal places, nobody gives a damn."],
    [4, "A bad random number generator: 1, 1, 1, 1, 1, 4.33e+67, 1, 1, 1"],
    [5, "A computer program does what you tell it to do, not what you want it to do."],
    [6, "Emacs is a nice operating system, but I prefer UNIX. — Tom Christaensen"],
    [7, "Any program that runs right is obsolete."],
    [8, "A list is only as strong as its weakest link. — Donald Knuth"],
    [9, "Feature: A bug with seniority."],
    [10, "Computers make very fast, very accurate mistakes."],
    [11, '<script>alert("This should not be displayed in a browser alert box.");</script>'],
    [12, "フレームワークのベンチマーク"],
];

function fortunes_page(array $all): string {
    $all[] = [0, "Additional fortune added at request time."];
    usort($all, fn($a, $b) => strcmp($a[1], $b[1]));
    $rows = "";
    foreach ($all as [$id, $message]) {
        $rows .= "<tr><td>$id</td><td>" . htmlspecialchars($message, ENT_QUOTES | ENT_HTML5) . "</td></tr>";
    }
    return "<!doctype html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>$rows</table></body></html>";
}

function work(int $n): int {
    $total = 0;
    for ($i = 0; $i < $n; $i++) $total = ($total + $i * $i) % 1000003;
    return $total;
}

function handle(PDO $db): void {
    switch (strtok($_SERVER["REQUEST_URI"], "?")) {
        case "/text":
            header("Content-Type: text/plain; charset=utf-8");
            echo "Hello, World!";
            break;
        case "/json":
            header("Content-Type: application/json");
            echo json_encode(["message" => "Hello, World!"]);
            break;
        case "/fortunes":
            header("Content-Type: text/html; charset=utf-8");
            echo fortunes_page(FORTUNES);
            break;
        case "/db":
            header("Content-Type: text/html; charset=utf-8");
            echo fortunes_page($db->query("select id, message from fortune")->fetchAll(PDO::FETCH_NUM));
            break;
        case "/compute":
            header("Content-Type: application/json");
            echo json_encode(["total" => work(10000)]);
            break;
        default:
            http_response_code(404);
    }
}

function open_db(): PDO {
    // Persistent under php-fpm: each worker keeps its connection, as a tuned app would.
    return new PDO("sqlite:" . __DIR__ . "/../fortunes.db", null, null, [PDO::ATTR_PERSISTENT => true]);
}
