// Runs the server benchmark: Quillo, Node, Bun and PHP serving the same
// answers (quillo.qwe, node.js, bun.js, php/), on one core and on several,
// each loaded by load.rs (keep-alive connections, one request in flight on each).
//
//   node server/run.cjs [seconds=5] [names=quillo,node,bun] [cores=6]
//   node server/run.cjs 5 quillo,node,bun,fpm,franken
//
// Needs rustc (load.rs is built on first use), Node 24, Bun (BUN, else bun on
// the PATH); QUILLO names the quillo binary (QUILLO_DIR's target/release/quillo).
// PHP comes two ways: `fpm` is php-fpm behind nginx (PHP_FPM and NGINX, else
// php-fpm and nginx on the PATH), `franken` is FrankenPHP in worker mode
// (FRANKENPHP, else frankenphp). Both with OPcache and its JIT on.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

const here = __dirname;
// A checkout of quillolang/quillo, built: QUILLO_DIR, else ../quillo beside this one.
const root = process.env.QUILLO_DIR || path.join(here, "..", "..", "quillo");
const secs = Number(process.argv[2] || 5);
const names = (process.argv[3] || "quillo,node,bun").split(",");
const cores = Number(process.argv[4] || 6);
const quillo = process.env.QUILLO || path.join(root, "target", "release", "quillo");
const bun = process.env.BUN || "bun";
const scenarios = ["text", "json", "fortunes", "db", "compute"];
const conns = 64, threads = 4;

const load = path.join(os.tmpdir(), "quillo-bench-load");
if (!fs.existsSync(load) || fs.statSync(load).mtimeMs < fs.statSync(path.join(here, "load.rs")).mtimeMs) {
  execFileSync("rustc", ["-O", "-o", load, path.join(here, "load.rs")]);
}

// The fortunes, as a table for the /db answer, written afresh each run.
{
  process.removeAllListeners("warning"); // node:sqlite is still marked experimental
  const { DatabaseSync } = require("node:sqlite");
  const { fortunes } = require("./fortunes.js");
  const file = path.join(here, "fortunes.db");
  for (const f of [file, file + "-wal", file + "-shm"]) fs.rmSync(f, { force: true });
  const db = new DatabaseSync(file);
  db.exec("create table fortune (id integer primary key, message text not null)");
  const insert = db.prepare("insert into fortune (id, message) values (?, ?)");
  for (const f of fortunes) insert.run(f.id, f.message);
  db.close();
}

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PHP as it runs in production: OPcache with its JIT, files never checked for changes.
const opcache = { "opcache.enable": "1", "opcache.jit": "tracing", "opcache.jit_buffer_size": "64M", "opcache.validate_timestamps": "0" };

// Each returns the processes to stop afterwards. PHP's configuration goes in a
// folder of its own under the system's temp folder, whose short path keeps
// php-fpm's Unix socket under macOS's limit of 104 bytes.
function start(name, port, procs) {
  const opts = { cwd: here, stdio: "ignore", detached: true };
  if (name === "quillo") return [spawn(quillo, ["run", "quillo.qwe", "--port", String(port), "--log", "off", ...(procs > 1 ? ["--instances", String(procs)] : [])], opts)];
  if (name === "node") return [spawn("node", ["node.js", String(port), String(procs)], opts)];
  if (name === "bun") return [spawn(bun, ["bun.js", String(port), String(procs)], opts)];
  const php = path.join(here, "php");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-"));
  if (name === "fpm") {
    // One php-fpm worker for each process, and as many nginx workers in front.
    const sock = path.join(dir, "fpm.sock");
    fs.writeFileSync(path.join(dir, "fpm.conf"), [
      "[global]", `pid = ${dir}/fpm.pid`, `error_log = ${dir}/fpm.log`, "daemonize = no",
      "[www]", `listen = ${sock}`, "listen.backlog = 4096", "pm = static", `pm.max_children = ${procs}`, "pm.max_requests = 0", "",
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "nginx.conf"), `worker_processes ${procs};
pid ${dir}/nginx.pid;
error_log ${dir}/nginx.log warn;
events { worker_connections 4096; }
http {
  access_log off;
  keepalive_requests 10000000;
  client_body_temp_path ${dir}/body; proxy_temp_path ${dir}/proxy; fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi; scgi_temp_path ${dir}/scgi;
  server {
    listen 127.0.0.1:${port} backlog=4096;
    location / {
      fastcgi_param SCRIPT_FILENAME ${php}/index.php;
      fastcgi_param REQUEST_METHOD $request_method;
      fastcgi_param REQUEST_URI $request_uri;
      fastcgi_param QUERY_STRING $query_string;
      fastcgi_param SERVER_PROTOCOL $server_protocol;
      fastcgi_pass unix:${sock};
    }
  }
}
`);
    const ini = Object.entries(opcache).flatMap(([k, v]) => ["-d", `${k}=${v}`]);
    return [
      spawn(process.env.PHP_FPM || "php-fpm", ["-p", dir, "-y", path.join(dir, "fpm.conf"), ...ini], opts),
      spawn(process.env.NGINX || "nginx", ["-p", dir, "-c", path.join(dir, "nginx.conf"), "-g", "daemon off;"], opts),
    ];
  }
  if (name === "franken") {
    // A PHP thread and a worker for each process, and as many cores for Go's HTTP server.
    fs.writeFileSync(path.join(dir, "Caddyfile"), `{
  admin off
  auto_https off
  persist_config off
  frankenphp {
    num_threads ${procs}
${Object.entries(opcache).map(([k, v]) => `    php_ini ${k} ${v}`).join("\n")}
  }
}
http://127.0.0.1:${port} {
  php_server {
    root ${php}
    worker {
      file ${php}/worker.php
      num ${procs}
      match *
    }
  }
}
`);
    const env = { ...process.env, GOMAXPROCS: String(procs), XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir };
    return [spawn(process.env.FRANKENPHP || "frankenphp", ["run", "--config", path.join(dir, "Caddyfile")], { ...opts, env })];
  }
  throw new Error(`unknown runtime ${name}`);
}

async function main() {
  const rows = [];
  for (const procs of [1, cores]) {
    for (const name of names) {
      const port = await freePort();
      const servers = start(name, port, procs);
      try {
        let up = false;
        for (let i = 0; i < 200 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/text`)).ok; } catch (_) {} if (!up) await sleep(50); }
        if (!up) throw new Error(`${name} did not start`);
        await sleep(300);
        for (const sc of scenarios) {
          const url = `http://127.0.0.1:${port}/${sc}`;
          execFileSync(load, [url, String(conns), String(threads), "1"]);
          const r = JSON.parse(execFileSync(load, [url, String(conns), String(threads), String(secs)]));
          rows.push({ procs, name, sc, ...r });
          process.stderr.write(`${procs} ${name} ${sc}: ${r.rps} req/s${r.errors ? `, ${r.errors} errors` : ""}\n`);
        }
      } finally {
        for (const s of servers) { try { process.kill(-s.pid, "SIGKILL"); } catch (_) {} }
        await sleep(500);
      }
    }
  }
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
  for (const procs of [1, cores]) {
    console.log(`\n${procs === 1 ? "one process" : `${procs} processes`}: requests a second (p99 latency, ms)`);
    console.log("".padEnd(10) + names.map((n) => n.padStart(18)).join(""));
    for (const sc of scenarios) {
      console.log(sc.padEnd(10) + names.map((n) => {
        const r = rows.find((x) => x.procs === procs && x.name === n && x.sc === sc);
        return `${fmt(r.rps)} (${r.p99.toFixed(1)})${r.errors ? "!" : ""}`.padStart(18);
      }).join(""));
    }
  }
  if (process.env.BENCH_JSON) fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(rows, null, 1));
}

main().catch((e) => { console.error(String(e.stack || e)); process.exit(1); });
