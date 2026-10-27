# Benchmarks

How fast [Quillo](https://github.com/quillolang/quillo) is, in two suites: the
browser side (components updating the page) against plain JavaScript and other
frameworks, and the server side (answering requests) against Node, Bun and PHP.

Both run a checkout of [quillolang/quillo](https://github.com/quillolang/quillo)
beside this one (`../quillo`, or `QUILLO_DIR=/path/to/quillo`), built with
`cargo build --release`. The browser suite also uses its headless-Chrome runner,
`tests/browser/run.js`. `ui/sample-run.log` is the output of one full browser run.

## In the browser: `ui`

The [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
app, keyed: a table of rows and buttons for the usual operations, in Quillo
(`quillo.qwe`), plain JavaScript (`vanilla.html`, as vanillajs-keyed writes it)
and, under `frameworks/`, Solid, Svelte 5, Vue 3, Preact and React 19, each
written as that framework's own entry writes it and built for production with
its own compiler. All have the same markup, labels and button ids.
`driver.js` clicks the buttons in headless Chrome and times each operation from
the click until the update is done and laid out (and, in the `…Js` rows, until
the update is done, before layout; small operations are timed 20 at a time).
Medians of 15 runs per page load, then the median of the loads.

```sh
(cd ../quillo && cargo build --release)
(cd ui/frameworks && npm install --ignore-scripts && node build.mjs)
node ui/run.js 3                      # or: node ui/run.js 3 vanilla,quillo,solid
```

On an Apple M-series laptop (10 cores), Chrome headless, October 2026:

| | vanilla | **Quillo** | Solid | Svelte | Vue | Preact | React |
|---|---:|---:|---:|---:|---:|---:|---:|
| create 1,000 rows | 10.7 | **11.1** | 10.5 | 10.7 | 12.3 | 13.6 | 12.2 |
| replace 1,000 rows | 11.1 | **11.9** | 11.7 | 12.0 | 13.1 | 15.7 | 15.3 |
| update every 10th row | 2.3 | **2.5** | 2.4 | 2.3 | 3.4 | 3.0 | 2.7 |
| select a row | 0.1 | **0.1** | 0.1 | 0.2 | 1.0 | 0.4 | 0.3 |
| swap two rows | 0.9 | **0.9** | 0.9 | 1.0 | 1.8 | 11.5 | 12.0 |
| remove a row | 0.9 | **0.9** | 0.9 | 0.9 | 1.9 | 1.1 | 1.1 |
| create 10,000 rows | 119 | **131** | 122 | 127 | 139 | 159 | 216 |
| append 1,000 rows | 12.0 | **13.0** | 12.4 | 12.6 | 15.1 | 16.7 | 14.5 |
| clear 1,000 rows | 1.0 | **1.2** | 1.2 | 1.3 | 1.4 | 1.4 | 3.6 |
| **geometric mean** (over the fastest) | 1.00 | **1.07** | 1.04 | 1.15 | 1.78 | 1.94 | 2.08 |
| script only, geometric mean | 1.00 | **2.08** | 1.83 | 2.12 | 9.11 | 6.14 | 6.94 |
| JS heap with 1,000 rows (MB) | 0.78 | **1.86** | 1.71 | 2.05 | 3.34 | 3.17 | 3.71 |
| scripts, compressed (KB) | 0 | **13.1** | 6.5 | 13.1 | 64.1 | 8.5 | 58.2 |

Times in milliseconds. Quillo's script includes its whole runtime (standard
library, resuming the server's HTML, live updates), compressed.

## On the server: `server`

The same five answers from Quillo (`quillo.qwe`), Node's `http` (`node.js`),
`Bun.serve` (`bun.js`) and PHP (`php/`): plain text, JSON, TechEmpower's Fortunes
without a database (the list, one more added per request, sorted, as an escaped
HTML table; computed on every request), the same page with the list read from
SQLite (`fortunes.db`, written by `run.cjs` at the start of each run), and a loop
of arithmetic in the language itself. `load.rs` (built with `rustc -O` on first
use) keeps 64 connections busy from 4 threads on the same machine.

PHP runs two ways, both with OPcache and its JIT on and files never checked for
changes: `fpm`, php-fpm behind nginx (static workers, a Unix socket between them),
as most PHP is served; and `franken`, FrankenPHP in worker mode, where the program
stays loaded between requests, as Quillo's does. Each keeps its SQLite connection
open between requests.

```sh
(cd ../quillo && cargo build --release)
node server/run.cjs 8                                 # Quillo, Node and Bun
node server/run.cjs 5 quillo,node,bun,fpm,franken     # and PHP: php-fpm, nginx and frankenphp on the PATH
```

`run.cjs` prints requests a second (and p99 latency) for each runtime and answer,
on one process each and then on several (`--instances`, Node's cluster, Bun's
`reusePort`, as many PHP workers); `BENCH_JSON=file` also writes every figure.

Figures are published here only when measured with a current Quillo build, named
by its commit, all runtimes in one run on an otherwise idle machine. They will be
added for the next one.

Reading them: with several processes, macOS does not spread connections across
Bun's `reusePort` sockets, so Bun stays at one process's figures; and for text and
JSON the load generator, on the same cores as the servers, is what limits several
processes, so those figures say more about the machine than about the servers.
Each PHP figure includes the server in front of PHP (nginx, or FrankenPHP's Go
HTTP server), as it does in production. A benchmark measures one machine at one
time: run it on yours, with nothing else busy, before quoting a figure.
