import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, basename, dirname } from "path";

// ── Docker ─────────────────────────────────────────────────────────────────

function scanDocker() {
  const map = new Map(); // host port -> container info
  try {
    const raw = execSync(
      `docker inspect --format '{{json .}}' $(docker ps -q) 2>/dev/null`,
      { encoding: "utf8", timeout: 6000 },
    ).trim();

    // docker inspect returns one JSON object per line when given multiple IDs
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let c;
      try { c = JSON.parse(line); } catch { continue; }

      const labels = c.Config?.Labels ?? {};
      const ports = c.NetworkSettings?.Ports ?? {};
      const composeProject = labels["com.docker.compose.project"] ?? null;
      const composeService = labels["com.docker.compose.service"] ?? null;
      const composeWorkdir = labels["com.docker.compose.project.working_dir"] ?? null;
      const image = c.Config?.Image ?? "";
      const name = c.Name?.replace(/^\//, "") ?? c.Id?.slice(0, 12);

      // Collect key env vars (PORT, NODE_ENV, DATABASE_URL prefix, etc.)
      const envVars = {};
      for (const e of (c.Config?.Env ?? [])) {
        const eq = e.indexOf("=");
        if (eq < 0) continue;
        const key = e.slice(0, eq);
        if (/^(PORT|NODE_ENV|APP_ENV|ENVIRONMENT|RAILS_ENV|DJANGO_SETTINGS|DATABASE_URL|REDIS_URL)$/.test(key)) {
          envVars[key] = e.slice(eq + 1);
        }
      }

      const startedAt = c.State?.StartedAt ?? null;
      let uptime = null;
      if (startedAt) {
        try {
          const ms = Date.now() - new Date(startedAt).getTime();
          uptime = formatUptime(ms);
        } catch {}
      }

      for (const [containerPort, bindings] of Object.entries(ports)) {
        if (!bindings) continue;
        for (const b of bindings) {
          const hostPort = parseInt(b.HostPort, 10);
          if (!hostPort) continue;
          map.set(hostPort, {
            source: "docker",
            name: composeService ?? name,
            image,
            composeProject,
            composeService,
            composeWorkdir,
            containerPort: containerPort.replace(/\/tcp|\/udp/, ""),
            envVars,
            uptime,
            containerId: c.Id?.slice(0, 12),
          });
        }
      }
    }
  } catch {}
  return map;
}

// ── Git worktree ───────────────────────────────────────────────────────────

const gitCache = new Map(); // projectRoot -> gitInfo

function getGitInfo(dir) {
  if (gitCache.has(dir)) return gitCache.get(dir);

  const info = { branch: null, isLinkedWorktree: false, mainPath: null };
  try {
    const raw = execSync(
      `git -C "${dir}" worktree list --porcelain 2>/dev/null`,
      { encoding: "utf8", timeout: 2000 },
    ).trim();

    if (!raw) { gitCache.set(dir, info); return info; }

    const worktrees = [];
    let cur = {};
    for (const line of raw.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (cur.path) worktrees.push(cur);
        cur = { path: line.slice(9).trim() };
      } else if (line.startsWith("branch ")) {
        cur.branch = line.slice(7).trim().replace("refs/heads/", "");
      } else if (line.startsWith("HEAD ")) {
        cur.head = line.slice(5).trim();
      } else if (line === "detached") {
        cur.detached = true;
      }
    }
    if (cur.path) worktrees.push(cur);

    const main = worktrees[0];
    const current = worktrees.find(
      (w) => dir === w.path || dir.startsWith(w.path + "/"),
    ) ?? main;

    info.branch = current?.branch ?? current?.head?.slice(0, 8) ?? null;
    info.isLinkedWorktree = !!(current && main && current.path !== main.path);
    info.mainPath = main?.path ?? null;
  } catch {}

  gitCache.set(dir, info);
  return info;
}

// ── Process scanning ───────────────────────────────────────────────────────

function batchPs(pids) {
  const map = new Map();
  if (!pids.length) return map;
  try {
    const raw = execSync(
      `ps -p ${pids.join(",")} -o pid=,ppid=,stat=,rss=,pcpu=,user=,lstart=,command= 2>/dev/null`,
      { encoding: "utf8", timeout: 5000 },
    ).trim();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const m = line.trim().match(
        /^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/,
      );
      if (!m) continue;
      map.set(parseInt(m[1], 10), {
        ppid: parseInt(m[2], 10),
        stat: m[3],
        rss: parseInt(m[4], 10),
        cpu: parseFloat(m[5]),
        user: m[6],
        lstart: m[7],
        command: m[8],
      });
    }
  } catch {}
  return map;
}

function batchCwd(pids) {
  const map = new Map();
  if (!pids.length) return map;
  try {
    const raw = execSync(
      `lsof -a -d cwd -p ${pids.join(",")} 2>/dev/null`,
      { encoding: "utf8", timeout: 10000 },
    ).trim();
    for (const line of raw.split("\n").slice(1)) {
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;
      const pid = parseInt(parts[1], 10);
      const path = parts.slice(8).join(" ");
      if (path?.startsWith("/")) map.set(pid, path);
    }
  } catch {}
  return map;
}

function findProjectRoot(dir) {
  const markers = [
    "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
    "Gemfile", "pom.xml", "build.gradle", "setup.py",
  ];
  let cur = dir;
  for (let depth = 0; depth < 15 && cur !== "/" && cur !== dirname(cur); depth++) {
    if (markers.some((m) => existsSync(join(cur, m)))) return cur;
    cur = dirname(cur);
  }
  return dir;
}

function detectFramework(root, command) {
  const cmd = (command || "").toLowerCase();
  if (cmd.includes("next")) return "Next.js";
  if (cmd.includes("vite")) return "Vite";
  if (cmd.includes("nuxt")) return "Nuxt";
  if (cmd.includes("uvicorn") || cmd.includes("fastapi")) return "FastAPI";
  if (cmd.includes("flask")) return "Flask";
  if (cmd.includes("django") || cmd.includes("manage.py")) return "Django";
  if (cmd.includes("rails")) return "Rails";
  if (cmd.includes("cargo") || cmd.includes("rustc")) return "Rust";

  if (root) {
    const pkg = join(root, "package.json");
    if (existsSync(pkg)) {
      try {
        const { dependencies: d = {}, devDependencies: dd = {} } = JSON.parse(readFileSync(pkg, "utf8"));
        const all = { ...d, ...dd };
        if (all.next) return "Next.js";
        if (all.nuxt) return "Nuxt";
        if (all["@sveltejs/kit"]) return "SvelteKit";
        if (all.svelte) return "Svelte";
        if (all["@remix-run/react"]) return "Remix";
        if (all.astro) return "Astro";
        if (all.vite) return "Vite";
        if (all["@angular/core"]) return "Angular";
        if (all.vue) return "Vue";
        if (all.react) return "React";
        if (all.express) return "Express";
        if (all.fastify) return "Fastify";
        if (all["@nestjs/core"]) return "NestJS";
        if (all.hono) return "Hono";
      } catch {}
    }
    if (existsSync(join(root, "manage.py"))) return "Django";
    if (existsSync(join(root, "Cargo.toml"))) return "Rust";
    if (existsSync(join(root, "go.mod"))) return "Go";
    if (existsSync(join(root, "Gemfile"))) return "Ruby";
  }
  return null;
}

function detectFrameworkFromImage(image) {
  const img = (image || "").toLowerCase();
  if (img.includes("postgres")) return "PostgreSQL";
  if (img.includes("redis")) return "Redis";
  if (img.includes("mysql") || img.includes("mariadb")) return "MySQL";
  if (img.includes("mongo")) return "MongoDB";
  if (img.includes("nginx")) return "nginx";
  if (img.includes("localstack")) return "LocalStack";
  if (img.includes("rabbitmq")) return "RabbitMQ";
  if (img.includes("kafka")) return "Kafka";
  if (img.includes("elasticsearch") || img.includes("opensearch")) return "Elasticsearch";
  if (img.includes("minio")) return "MinIO";
  return "Docker";
}

// ── Log file detection ─────────────────────────────────────────────────────

export function getLogFiles(pid) {
  const files = [];
  try {
    const raw = execSync(`lsof -p ${pid} 2>/dev/null`, {
      encoding: "utf8", timeout: 5000,
    }).trim();
    for (const line of raw.split("\n").slice(1)) {
      const cols = line.split(/\s+/);
      if (cols.length < 9) continue;
      const fd = cols[3];
      const type = cols[4];
      const name = cols.slice(8).join(" ");
      if ((fd === "1w" || fd === "2w") && type === "REG") {
        files.push({ path: name, type: fd === "1w" ? "stdout" : "stderr", priority: 1 });
      } else if (type === "REG" && /w$/.test(fd) && isLogPath(name)) {
        files.push({ path: name, type: "logfile", priority: 2 });
      }
    }
  } catch {}
  files.sort((a, b) => a.priority - b.priority);
  const seen = new Set();
  return files.filter((f) => { if (seen.has(f.path)) return false; seen.add(f.path); return true; });
}

function isLogPath(p) {
  const l = p.toLowerCase();
  return l.endsWith(".log") || l.includes("/logs/") || l.includes("/log/") || l.includes("nohup");
}

// ── Main export ────────────────────────────────────────────────────────────

export async function scan() {
  gitCache.clear();

  const dockerMap = scanDocker();

  // lsof for all LISTEN sockets
  let listeningRaw = "";
  try {
    listeningRaw = execSync(
      "lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null",
      { encoding: "utf8", timeout: 8000 },
    ).trim();
  } catch { return []; }

  const portToPid = new Map();
  for (const line of listeningRaw.split("\n").slice(1)) {
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;
    const pid = parseInt(parts[1], 10);
    const addrField = parts[8];
    const colonIdx = addrField.lastIndexOf(":");
    const port = parseInt(addrField.slice(colonIdx + 1), 10);
    if (port && pid && !portToPid.has(port)) portToPid.set(port, pid);
  }

  const pids = [...new Set(portToPid.values())];
  const psMap = batchPs(pids);
  const cwdMap = batchCwd(pids);

  const results = [];

  for (const [port, pid] of portToPid) {
    // Docker takes priority for its bound ports
    if (dockerMap.has(port)) {
      const d = dockerMap.get(port);
      results.push({
        source: "docker",
        port,
        pid,
        name: d.name,
        processName: "docker",
        user: null,
        status: "running",
        uptime: d.uptime,
        memory: null,
        command: null,
        cwd: d.composeWorkdir,
        projectName: d.composeProject ?? d.name,
        framework: detectFrameworkFromImage(d.image),
        branch: null,
        isLinkedWorktree: false,
        mainPath: null,
        composeProject: d.composeProject,
        composeService: d.composeService,
        composeWorkdir: d.composeWorkdir,
        containerPort: d.containerPort,
        envVars: d.envVars,
        containerId: d.containerId,
        image: d.image,
      });
      continue;
    }

    const ps = psMap.get(pid);
    const rawCwd = cwdMap.get(pid);

    const entry = {
      source: "process",
      port,
      pid,
      name: ps ? basename(ps.command.split(" ")[0]) : "unknown",
      processName: ps ? basename(ps.command.split(" ")[0]) : "unknown",
      user: ps?.user ?? null,
      cpu: ps?.cpu ?? null,
      status: "listening",
      uptime: null,
      memory: null,
      command: ps?.command ?? null,
      cwd: null,
      projectName: null,
      framework: null,
      branch: null,
      isLinkedWorktree: false,
      mainPath: null,
      composeProject: null,
      composeService: null,
      composeWorkdir: null,
      containerPort: null,
      envVars: {},
      containerId: null,
      image: null,
    };

    if (ps) {
      if (ps.stat?.includes("Z")) entry.status = "zombie";
      if (ps.rss > 0) entry.memory = formatMemory(ps.rss);
      if (ps.lstart) {
        try {
          const ms = Date.now() - new Date(ps.lstart).getTime();
          if (!isNaN(ms)) entry.uptime = formatUptime(ms);
        } catch {}
      }
      entry.framework = detectFramework(null, ps.command);
    }

    if (rawCwd) {
      const root = findProjectRoot(rawCwd);
      entry.cwd = root;
      entry.projectName = basename(root);
      entry.framework ??= detectFramework(root, ps?.command);

      const git = getGitInfo(root);
      entry.branch = git.branch;
      entry.isLinkedWorktree = git.isLinkedWorktree;
      entry.mainPath = git.mainPath;
    }

    results.push(entry);
  }

  results.sort((a, b) => a.port - b.port);
  return results;
}

export function killPid(pid, force = false) {
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    return true;
  } catch { return false; }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function formatMemory(kb) {
  if (kb > 1048576) return `${(kb / 1048576).toFixed(1)} GB`;
  if (kb > 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}
