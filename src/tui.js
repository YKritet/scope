import { createRequire } from "module";
import { spawn, execSync } from "child_process";
import { scan, killPid, getLogFiles } from "./scanner.js";

const require = createRequire(import.meta.url);
const blessed = require("blessed");

const HOME = process.env.HOME ?? "";

const trunc = (s, n) => !s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s;
const pad   = (s, n) => (s ?? "").toString().padEnd(n).slice(0, n);

function shortenPath(p, max = 42) {
  if (!p) return null;
  const s = HOME ? p.replace(HOME, "~") : p;
  return s.length > max ? "…" + s.slice(-(max - 1)) : s;
}

function cpuColor(v) {
  if (v == null) return "{gray-fg}—{/}";
  const s = v.toFixed(1) + "%";
  if (v > 25) return `{red-fg}${s}{/}`;
  if (v > 5)  return `{yellow-fg}${s}{/}`;
  return `{green-fg}${s}{/}`;
}

function statusDot(s) {
  if (s === "running" || s === "listening") return "{green-fg}●{/}";
  if (s === "zombie")  return "{red-fg}●{/}";
  if (s === "orphaned") return "{yellow-fg}●{/}";
  return "{gray-fg}●{/}";
}

function summaryLine(services) {
  const counts = {};
  for (const s of services) {
    const k = s.source === "docker" ? "docker" : trunc(s.processName, 8);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, n]) => `{cyan-fg}${n}{/} ${k}`)
    .join("  ");
}

// ── Column definitions ─────────────────────────────────────────────────────
// width is the visible char count (not counting ANSI); adapt to terminal width
const COLS = [
  { key: "port",        label: "PORT",      w: 7  },
  { key: "processName", label: "PROCESS",   w: 13 },
  { key: "user",        label: "USER",      w: 14 },
  { key: "dir",         label: "DIR",       w: 36 },
  { key: "branch",      label: "BRANCH",    w: 19 },
  { key: "framework",   label: "FRAMEWORK", w: 11 },
  { key: "cpu",         label: "CPU",       w: 7  },
  { key: "memory",      label: "MEM",       w: 9  },
  { key: "uptime",      label: "UPTIME",    w: 9  },
  { key: "status",      label: "STATUS",    w: 10 },
];

function buildRow(s, selected) {
  const dir = s.source === "docker"
    ? shortenPath(s.composeWorkdir, 34)
    : shortenPath(s.cwd, 34);

  const branch = s.branch
    ? (s.isLinkedWorktree ? `{yellow-fg}${trunc(s.branch, 17)}{/}` : `{magenta-fg}${trunc(s.branch, 17)}{/}`)
    : s.source === "docker" ? "{blue-fg}docker{/}" : "{gray-fg}—{/}";

  const dot = statusDot(s.status);

  const cells = [
    `{bold}:${trunc(String(s.port), 5)}{/}`,
    trunc(s.processName ?? "—", 12),
    s.user ? trunc(s.user, 13) : "{gray-fg}—{/}",
    dir   ? `{dim}${pad(dir, 35)}{/}` : "{gray-fg}—{/}",
    branch,
    s.framework ? `{cyan-fg}${trunc(s.framework, 10)}{/}` : "{gray-fg}—{/}",
    cpuColor(s.cpu),
    s.memory ? `{green-fg}${trunc(s.memory, 8)}{/}` : "{gray-fg}—{/}",
    s.uptime ? `{yellow-fg}${trunc(s.uptime, 8)}{/}` : "{gray-fg}—{/}",
    dot,
  ];

  return cells.join("  ");
}

function buildHeader(label, val) {
  return `  {cyan-fg}${pad(label, 11)}{/}{white-fg}${val ?? "—"}{/}`;
}

function renderDetailContent(s) {
  if (!s) return "\n  {gray-fg}No service selected.{/}";

  const dir    = s.source === "docker" ? shortenPath(s.composeWorkdir, 52) : shortenPath(s.cwd, 52);
  const branch = s.branch
    ? s.branch + (s.isLinkedWorktree ? " {yellow-fg}(linked worktree){/}" : "")
    : null;

  // Two-column layout: left col (label+value) right col (label+value)
  const L = (lbl, val) => `  {cyan-fg}${pad(lbl, 10)}{/} ${val ?? "{gray-fg}—{/}"}`;
  const row = (left, right) => `${left.padEnd ? left : left}   ${right ?? ""}`;

  if (s.source === "process") {
    const lines = [
      "",
      row(
        L("DIR",     dir ? `{blue-fg}${dir}{/}` : null),
        L("USER",    s.user ? `{white-fg}${s.user}{/}` : null),
      ),
      row(
        L("BRANCH",  branch ? `{magenta-fg}${branch}{/}` : null),
        L("PID",     s.pid ? `{gray-fg}${s.pid}{/}` : null),
      ),
      row(
        L("PROJECT", s.projectName ? `{white-fg}${s.projectName}{/}` : null),
        L("MEMORY",  s.memory ? `{green-fg}${s.memory}{/}` : null),
      ),
      row(
        L("FRAMEWORK", s.framework ? `{cyan-fg}${s.framework}{/}` : null),
        L("CPU",     cpuColor(s.cpu)),
      ),
      row(
        L("CMD",     s.command ? `{gray-fg}${trunc(s.command, 52)}{/}` : null),
        L("UPTIME",  s.uptime ? `{yellow-fg}${s.uptime}{/}` : null),
      ),
    ];
    if (s.isLinkedWorktree && s.mainPath) {
      lines.push(row(
        L("MAIN REPO", `{gray-fg}${shortenPath(s.mainPath, 52)}{/}`),
        L("STATUS",  `${statusDot(s.status)} {green-fg}${s.status}{/}`),
      ));
    }
    return lines.join("\n");
  } else {
    // Docker
    const lines = [
      "",
      row(
        L("COMPOSE", s.composeProject ? `{blue-fg}${s.composeProject}{/} / {white-fg}${s.composeService ?? "?"}{/}` : null),
        L("IMAGE",   s.image ? `{gray-fg}${trunc(s.image, 30)}{/}` : null),
      ),
      row(
        L("WORKDIR", dir ? `{blue-fg}${dir}{/}` : null),
        L("CONTAINER", s.containerId ? `{gray-fg}${s.containerId}{/}` : null),
      ),
      row(
        L("PORT MAP", s.containerPort ? `{gray-fg}:${s.port} → :${s.containerPort}{/}` : null),
        L("UPTIME",  s.uptime ? `{yellow-fg}${s.uptime}{/}` : null),
      ),
    ];
    const envEntries = Object.entries(s.envVars ?? {});
    if (envEntries.length > 0) {
      for (let i = 0; i < envEntries.length; i += 2) {
        const [k1, v1] = envEntries[i];
        const right = envEntries[i + 1]
          ? L(envEntries[i + 1][0], `{gray-fg}${trunc(envEntries[i + 1][1], 24)}{/}`)
          : "";
        lines.push(row(L(k1, `{gray-fg}${trunc(v1, 24)}{/}`), right));
      }
    }
    return lines.join("\n");
  }
}

// ── Main TUI ───────────────────────────────────────────────────────────────

export async function runTui() {
  let services  = await scan();
  let filtered  = services;
  let selectedIdx = 0;
  let searchMode  = false;
  let searchTerm  = "";
  let logProc     = null;
  let logsVisible = false;
  let countdown   = 3;

  const screen = blessed.screen({ smartCSR: true, title: "scope", fullUnicode: true });

  // ── Header bar ──────────────────────────────────────────────────
  const headerBar = blessed.box({
    parent: screen, top: 0, left: 0, width: "100%", height: 1,
    style: { bg: "black" }, tags: true,
    content: buildTopBar(),
  });

  // ── Column headers ───────────────────────────────────────────────
  const colHeader = blessed.box({
    parent: screen, top: 1, left: 0, width: "100%", height: 1,
    style: { bg: "black" }, tags: true,
    content: buildColHeaders(),
  });

  // ── Service list ─────────────────────────────────────────────────
  const list = blessed.list({
    parent: screen, top: 2, left: 0, width: "100%",
    height: logsVisible ? "42%" : "62%",
    style: {
      selected: { bg: "blue", fg: "white", bold: true },
      item: { fg: "white" },
    },
    keys: true, vi: true, mouse: true, tags: true,
    scrollbar: { ch: "│", style: { fg: "cyan" } },
  });

  // ── Detail strip ─────────────────────────────────────────────────
  const detailBox = blessed.box({
    parent: screen,
    left: 0, width: "100%", height: 9,
    border: { type: "line" },
    label: " Details ",
    style: { border: { fg: "cyan" }, label: { fg: "cyan", bold: true } },
    tags: true,
  });

  // ── Log panel ────────────────────────────────────────────────────
  const logPanel = blessed.log({
    parent: screen,
    left: 0, width: "100%", height: "28%",
    border: { type: "line" },
    label: " Logs ",
    style: { border: { fg: "yellow" }, label: { fg: "yellow", bold: true } },
    tags: false, scrollable: true, alwaysScroll: true,
    hidden: true, mouse: true,
  });

  // ── Status bar ───────────────────────────────────────────────────
  const statusBar = blessed.box({
    parent: screen, bottom: 0, left: 0, width: "100%", height: 1,
    style: { bg: "blue", fg: "white" }, tags: true,
    content: buildStatusBar(),
  });

  // ── Search box ───────────────────────────────────────────────────
  const searchBox = blessed.box({
    parent: screen, bottom: 1, left: 0, width: 40, height: 3,
    border: { type: "line" },
    label: " / search ",
    style: { border: { fg: "yellow" } },
    tags: true, hidden: true,
  });

  // ── Layout helpers ───────────────────────────────────────────────

  function reflow() {
    const rows = screen.rows;
    const detailH = 9;
    const logH    = logsVisible ? Math.floor(rows * 0.25) : 0;
    const listH   = rows - 2 - detailH - logH - 1; // header(1) + cols(1) + statusbar(1)

    list.height      = Math.max(4, listH);
    detailBox.top    = 2 + list.height;
    detailBox.height = detailH;

    if (logsVisible) {
      logPanel.top    = detailBox.top + detailH;
      logPanel.height = logH;
      logPanel.show();
      statusBar.bottom = 0;
    } else {
      logPanel.hide();
    }
  }

  // ── Builders ─────────────────────────────────────────────────────

  function buildTopBar() {
    const n = filtered.length;
    const total = services.length;
    const countStr = searchTerm
      ? `{yellow-fg}${n}/${total}{/} services`
      : `{white-fg}{bold}${n}{/} services`;
    const summary = summaryLine(services);
    return `  {cyan-fg}{bold}scope{/}   ${countStr}   ${summary}   {gray-fg}⟳ ${countdown}s{/}`;
  }

  function buildColHeaders() {
    const heads = COLS.map((c) => pad(c.label, c.w)).join("  ");
    return "  " + `{cyan-fg}${heads}{/}`;
  }

  function buildStatusBar() {
    if (searchMode) return `  {yellow-fg}/${searchTerm}{/}  {gray-fg}Enter confirm   Esc cancel{/}`;
    return "  {bold}j/k{/} navigate  {bold}l{/} logs  {bold}K{/} kill  {bold}o{/} open  {bold}/{/} search  {bold}r{/} refresh  {bold}q{/} quit";
  }

  // ── Renderers ─────────────────────────────────────────────────────

  function renderList() {
    const items = filtered.map((s) => "  " + buildRow(s, false));
    list.setItems(items);
    list.select(Math.min(selectedIdx, Math.max(0, filtered.length - 1)));
  }

  function renderDetail() {
    const s = filtered[selectedIdx];
    detailBox.setContent(s ? renderDetailContent(s) : "\n  {gray-fg}Nothing selected.{/}");
    detailBox.setLabel(s ? ` :${s.port}  ${s.processName ?? ""}  ${s.uptime ?? ""} ` : " Details ");
  }

  // ── Logs ──────────────────────────────────────────────────────────

  function stopLogs() {
    if (!logProc) return;
    try { logProc.kill(); } catch {}
    logProc = null;
  }

  function startLogs(s) {
    stopLogs();
    logPanel.setContent("");
    if (!s?.pid) { logPanel.add("No PID available."); return; }
    logPanel.setLabel(` Logs :${s.port} — ${s.processName} `);

    const files = getLogFiles(s.pid);
    if (files.length > 0) {
      const f = files[0];
      logPanel.add(`[tailing ${f.path}]`);
      logProc = spawn("tail", ["-f", "-n", "50", f.path], { stdio: ["ignore", "pipe", "pipe"] });
    } else {
      logPanel.add(`[system logs PID ${s.pid}]`);
      logProc = spawn("log", ["stream", "--predicate", `processID == ${s.pid}`, "--style", "compact"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    logProc.stdout?.on("data", (d) => { for (const l of d.toString().split("\n")) if (l.trim()) logPanel.add(l); screen.render(); });
    logProc.stderr?.on("data", (d) => { for (const l of d.toString().split("\n")) if (l.trim()) logPanel.add(l); screen.render(); });
  }

  function toggleLogs() {
    logsVisible = !logsVisible;
    reflow();
    if (logsVisible) startLogs(filtered[selectedIdx]);
    else stopLogs();
    screen.render();
  }

  // ── Refresh ───────────────────────────────────────────────────────

  async function refresh() {
    const prevPort = filtered[selectedIdx]?.port;
    services = await scan();
    applyFilter();
    const idx = filtered.findIndex((s) => s.port === prevPort);
    selectedIdx = idx >= 0 ? idx : Math.min(selectedIdx, Math.max(0, filtered.length - 1));
    countdown = 3;
    reflow();
    renderList();
    renderDetail();
    headerBar.setContent(buildTopBar());
    screen.render();
  }

  function applyFilter() {
    if (!searchTerm) { filtered = services; return; }
    const q = searchTerm.toLowerCase();
    filtered = services.filter((s) =>
      String(s.port).includes(q) ||
      s.processName?.toLowerCase().includes(q) ||
      s.branch?.toLowerCase().includes(q) ||
      s.projectName?.toLowerCase().includes(q) ||
      s.framework?.toLowerCase().includes(q) ||
      s.user?.toLowerCase().includes(q) ||
      s.composeProject?.toLowerCase().includes(q),
    );
  }

  // ── Timers ────────────────────────────────────────────────────────

  const refreshTimer    = setInterval(() => refresh(), 3000);
  const countdownTimer  = setInterval(() => {
    countdown = Math.max(0, countdown - 1);
    headerBar.setContent(buildTopBar());
    screen.render();
  }, 1000);

  // ── Key bindings ──────────────────────────────────────────────────

  screen.key(["q", "C-c"], () => {
    clearInterval(refreshTimer); clearInterval(countdownTimer); stopLogs();
    screen.destroy(); process.exit(0);
  });

  screen.key(["l"], () => { if (!searchMode) toggleLogs(); });
  screen.key(["r"], () => { if (!searchMode) refresh(); });

  screen.key(["K"], () => {
    if (searchMode) return;
    const s = filtered[selectedIdx];
    if (!s?.pid) return;
    killPid(s.pid);
    setTimeout(() => refresh(), 600);
  });

  screen.key(["o"], () => {
    if (searchMode) return;
    const s = filtered[selectedIdx];
    if (!s) return;
    try { execSync(`open http://localhost:${s.port}`, { stdio: "ignore" }); } catch {}
  });

  screen.key(["/"]), () => {
    if (searchMode) return;
    searchMode = true;
    searchBox.show();
    statusBar.setContent(buildStatusBar());
    screen.render();
  };

  screen.key(["escape"], () => {
    if (!searchMode) return;
    searchMode = false; searchTerm = "";
    searchBox.hide(); searchBox.setContent("");
    applyFilter(); selectedIdx = 0;
    renderList(); renderDetail();
    headerBar.setContent(buildTopBar());
    statusBar.setContent(buildStatusBar());
    screen.render();
  });

  screen.key(["enter"], () => {
    if (!searchMode) return;
    searchMode = false;
    searchBox.hide();
    applyFilter(); selectedIdx = 0;
    renderList(); renderDetail();
    headerBar.setContent(buildTopBar());
    statusBar.setContent(buildStatusBar());
    screen.render();
  });

  screen.on("keypress", (ch, key) => {
    if (!searchMode || !ch || key.ctrl || key.meta) return;
    if (key.name === "backspace") searchTerm = searchTerm.slice(0, -1);
    else if (ch.length === 1) searchTerm += ch;
    searchBox.setContent(`{yellow-fg}/${searchTerm}{/}`);
    statusBar.setContent(buildStatusBar());
    screen.render();
  });

  screen.on("resize", () => { reflow(); screen.render(); });

  list.on("select item", (item, idx) => {
    selectedIdx = idx;
    renderDetail();
    if (logsVisible) startLogs(filtered[idx]);
    screen.render();
  });

  screen.on("destroy", () => {
    clearInterval(refreshTimer); clearInterval(countdownTimer); stopLogs();
  });

  // ── Initial render ─────────────────────────────────────────────────

  reflow();
  renderList();
  renderDetail();
  list.focus();
  screen.render();
}
