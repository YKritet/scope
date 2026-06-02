import { createRequire } from "module";
import { spawn, execSync } from "child_process";
import { scan, killPid, getLogFiles } from "./scanner.js";

const require = createRequire(import.meta.url);
const blessed = require("blessed");

const HOME = process.env.HOME ?? "";

function shortenPath(p) {
  if (!p) return null;
  const s = HOME ? p.replace(HOME, "~") : p;
  return s.length > 46 ? "…" + s.slice(-45) : s;
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function statusDot(s) {
  if (s === "running" || s === "listening") return "{green-fg}●{/}";
  if (s === "zombie") return "{red-fg}●{/}";
  if (s === "orphaned") return "{yellow-fg}●{/}";
  return "{gray-fg}●{/}";
}

function statusLabel(s) {
  const dot = statusDot(s);
  const colors = { running: "green", listening: "green", zombie: "red", orphaned: "yellow" };
  const c = colors[s] ?? "gray";
  return `${dot} {${c}-fg}${s}{/}`;
}

export async function runTui() {
  let services = await scan();
  let filtered = services;
  let selectedIdx = 0;
  let searchMode = false;
  let searchTerm = "";
  let logProc = null;
  let logsVisible = false;
  let countdown = 3;
  let countdownTimer = null;

  const screen = blessed.screen({ smartCSR: true, title: "scope", fullUnicode: true });

  // ── Header ───────────────────────────────────────────────────────
  const header = blessed.box({
    parent: screen,
    top: 0, left: 0, width: "100%", height: 1,
    style: { bg: "black", fg: "cyan", bold: true },
    tags: true,
    content: buildHeader(),
  });

  // ── List (left) ──────────────────────────────────────────────────
  const list = blessed.list({
    parent: screen,
    top: 1, left: 0, width: "42%",
    height: logsVisible ? "57%" : "97%",
    border: { type: "line" },
    label: " Services ",
    style: {
      border: { fg: "cyan" },
      label: { fg: "cyan", bold: true },
      selected: { bg: "blue", fg: "white", bold: true },
      item: { fg: "white" },
    },
    keys: true, vi: true, mouse: true, tags: true,
    scrollbar: { ch: "│", style: { fg: "cyan" } },
  });

  // ── Detail (right) ───────────────────────────────────────────────
  const detail = blessed.box({
    parent: screen,
    top: 1, right: 0, width: "58%",
    height: logsVisible ? "57%" : "97%",
    border: { type: "line" },
    label: " Details ",
    style: { border: { fg: "cyan" }, label: { fg: "cyan", bold: true } },
    tags: true, scrollable: true, alwaysScroll: true,
    keys: true, vi: true, mouse: true,
  });

  // ── Log panel (bottom) ───────────────────────────────────────────
  const logPanel = blessed.log({
    parent: screen,
    bottom: 1, left: 0, width: "100%", height: "38%",
    border: { type: "line" },
    label: " Logs ",
    style: { border: { fg: "yellow" }, label: { fg: "yellow", bold: true } },
    tags: false, scrollable: true, alwaysScroll: true,
    hidden: true, mouse: true,
  });

  // ── Status bar ───────────────────────────────────────────────────
  const statusBar = blessed.box({
    parent: screen,
    bottom: 0, left: 0, width: "100%", height: 1,
    style: { bg: "blue", fg: "white" },
    tags: true,
    content: buildStatusBar(),
  });

  // ── Search box ───────────────────────────────────────────────────
  const searchBox = blessed.box({
    parent: screen,
    bottom: 1, left: 0, width: "42%", height: 3,
    border: { type: "line" },
    label: " Search ",
    style: { border: { fg: "yellow" }, label: { fg: "yellow" } },
    tags: true,
    hidden: true,
    content: "",
  });

  // ── Builders ─────────────────────────────────────────────────────

  function buildHeader() {
    const n = filtered.length;
    const total = services.length;
    const countStr = searchTerm
      ? `{yellow-fg}${n}/${total}{/} services`
      : `{white-fg}${n}{/} services`;
    return `  {cyan-fg}{bold}scope{/}   ${countStr}   {gray-fg}refreshing in ${countdown}s{/}`;
  }

  function buildStatusBar() {
    if (searchMode) {
      return `  {yellow-fg}/${searchTerm}{/}  {gray-fg}Enter confirm   Esc cancel{/}`;
    }
    return "  {bold}j/k{/} navigate  {bold}l{/} logs  {bold}K{/} kill  {bold}o{/} open  {bold}/{/} search  {bold}r{/} refresh  {bold}q{/} quit";
  }

  function renderList() {
    const items = filtered.map((s) => {
      const dot = statusDot(s.status);
      const port = `{bold}:${s.port}{/}`.padEnd(7);
      const name = truncate(s.processName, 9).padEnd(9);
      const fw = s.framework
        ? `{cyan-fg}${truncate(s.framework, 9)}{/}`
        : "{gray-fg}—{/}";
      const branch = s.branch
        ? `{magenta-fg}${truncate(s.branch, 13)}{/}`
        : s.source === "docker" ? `{blue-fg}docker{/}` : "{gray-fg}—{/}";
      return `${dot} ${port} ${name} ${fw}  ${branch}`;
    });
    list.setItems(items);
    list.select(Math.min(selectedIdx, Math.max(0, filtered.length - 1)));
    list.setLabel(` Services (${filtered.length}) `);
  }

  function renderDetail(s) {
    if (!s) {
      detail.setContent("\n  {gray-fg}Nothing selected.{/}");
      detail.setLabel(" Details ");
      return;
    }

    const row = (lbl, val) =>
      `  {cyan-fg}${lbl.padEnd(11)}{/} ${val ?? "{gray-fg}—{/}"}`;

    const lines = [
      "",
      row("PORT", `{white-fg}{bold}:${s.port}{/} {gray-fg}← ${s.source}{/}`),
      row("PROCESS", `{white-fg}${s.processName}{/} {gray-fg}(PID ${s.pid ?? "—"}){/}`),
      row("USER", s.user ? `{white-fg}${s.user}{/}` : null),
      row("STATUS", statusLabel(s.status)),
      row("MEMORY", s.memory ? `{green-fg}${s.memory}{/}` : null),
      row("UPTIME", s.uptime ? `{yellow-fg}${s.uptime}{/}` : null),
      "",
    ];

    if (s.source === "process") {
      const dir = shortenPath(s.cwd);
      lines.push(row("DIR", dir ? `{blue-fg}${dir}{/}` : null));
      lines.push(row("PROJECT", s.projectName ? `{white-fg}${s.projectName}{/}` : null));
      if (s.branch) {
        const wt = s.isLinkedWorktree ? " {yellow-fg}(linked worktree){/}" : "";
        lines.push(row("BRANCH", `{magenta-fg}${s.branch}{/}${wt}`));
      } else {
        lines.push(row("BRANCH", null));
      }
      if (s.isLinkedWorktree && s.mainPath) {
        lines.push(row("MAIN REPO", `{gray-fg}${shortenPath(s.mainPath)}{/}`));
      }
      lines.push(row("FRAMEWORK", s.framework ? `{cyan-fg}${s.framework}{/}` : null));
      lines.push("");
      const cmd = s.command ? truncate(s.command, 54) : null;
      lines.push(row("CMD", cmd ? `{gray-fg}${cmd}{/}` : null));
    } else {
      lines.push(row("IMAGE", s.image ? `{gray-fg}${s.image}{/}` : null));
      lines.push(row("CONTAINER", s.containerId ? `{gray-fg}${s.containerId}{/}` : null));
      if (s.composeProject) {
        lines.push("");
        lines.push(row("COMPOSE", `{blue-fg}${s.composeProject}{/} / {white-fg}${s.composeService ?? "?"}{/}`));
        const wd = shortenPath(s.composeWorkdir);
        if (wd) lines.push(row("WORKDIR", `{blue-fg}${wd}{/}`));
      }
      lines.push(row("MAPS TO", s.containerPort ? `{gray-fg}:${s.containerPort}{/}` : null));
      if (Object.keys(s.envVars ?? {}).length > 0) {
        lines.push("");
        for (const [k, v] of Object.entries(s.envVars)) {
          lines.push(row(k, `{gray-fg}${truncate(v, 36)}{/}`));
        }
      }
    }

    detail.setContent(lines.join("\n"));
    detail.setLabel(` Details :${s.port} `);
    detail.scrollTo(0);
  }

  // ── Log management ────────────────────────────────────────────────

  function stopLogs() {
    if (!logProc) return;
    try { logProc.kill(); } catch {}
    logProc = null;
  }

  function startLogs(s) {
    stopLogs();
    logPanel.setContent("");
    if (!s?.pid) {
      logPanel.add("No PID available for this service.");
      return;
    }
    logPanel.setLabel(` Logs :${s.port} — ${s.processName} `);

    const files = getLogFiles(s.pid);
    if (files.length > 0) {
      const f = files[0];
      logPanel.add(`[tailing ${f.path}]`);
      logProc = spawn("tail", ["-f", "-n", "50", f.path], { stdio: ["ignore", "pipe", "pipe"] });
    } else {
      // macOS system log fallback
      logPanel.add(`[system logs for PID ${s.pid}]`);
      logProc = spawn("log", ["stream", "--predicate", `processID == ${s.pid}`, "--style", "compact"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    logProc.stdout?.on("data", (d) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) logPanel.add(line);
      }
      screen.render();
    });
    logProc.stderr?.on("data", (d) => {
      for (const line of d.toString().split("\n")) {
        if (line.trim()) logPanel.add(line);
      }
      screen.render();
    });
  }

  function toggleLogs() {
    logsVisible = !logsVisible;
    const listHeight = logsVisible ? "57%" : "97%";
    list.height = listHeight;
    detail.height = listHeight;
    if (logsVisible) {
      logPanel.show();
      startLogs(filtered[selectedIdx]);
    } else {
      logPanel.hide();
      stopLogs();
    }
    screen.render();
  }

  // ── Refresh ───────────────────────────────────────────────────────

  async function refresh() {
    const prevPort = filtered[selectedIdx]?.port;
    services = await scan();
    applyFilter();
    const newIdx = filtered.findIndex((s) => s.port === prevPort);
    selectedIdx = newIdx >= 0 ? newIdx : Math.min(selectedIdx, Math.max(0, filtered.length - 1));
    countdown = 3;
    renderList();
    renderDetail(filtered[selectedIdx]);
    header.setContent(buildHeader());
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

  // ── Countdown ticker ──────────────────────────────────────────────

  const refreshTimer = setInterval(() => refresh(), 3000);
  countdownTimer = setInterval(() => {
    countdown = Math.max(0, countdown - 1);
    header.setContent(buildHeader());
    screen.render();
  }, 1000);

  // ── Bindings ──────────────────────────────────────────────────────

  screen.key(["q", "C-c"], () => {
    clearInterval(refreshTimer);
    clearInterval(countdownTimer);
    stopLogs();
    screen.destroy();
    process.exit(0);
  });

  screen.key(["l"], () => { if (!searchMode) toggleLogs(); });

  screen.key(["r"], () => { if (!searchMode) refresh(); });

  screen.key(["tab"], () => {
    if (searchMode) return;
    screen.focused === list ? detail.focus() : list.focus();
    screen.render();
  });

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
    try {
      execSync(`open http://localhost:${s.port}`, { stdio: "ignore" });
    } catch {}
  });

  screen.key(["/"]) , () => {
    if (searchMode) return;
    searchMode = true;
    searchBox.show();
    searchBox.setContent(`{yellow-fg}/${searchTerm}{/}`);
    statusBar.setContent(buildStatusBar());
    screen.render();
  };

  screen.key(["escape"], () => {
    if (!searchMode) return;
    searchMode = false;
    searchTerm = "";
    searchBox.hide();
    searchBox.setContent("");
    applyFilter();
    renderList();
    header.setContent(buildHeader());
    statusBar.setContent(buildStatusBar());
    screen.render();
  });

  screen.key(["enter"], () => {
    if (!searchMode) return;
    searchMode = false;
    searchBox.hide();
    applyFilter();
    selectedIdx = 0;
    renderList();
    renderDetail(filtered[0]);
    header.setContent(buildHeader());
    statusBar.setContent(buildStatusBar());
    screen.render();
  });

  // Printable characters for search
  screen.on("keypress", (ch, key) => {
    if (!searchMode) return;
    if (!ch || key.ctrl || key.meta) return;
    if (key.name === "backspace") {
      searchTerm = searchTerm.slice(0, -1);
    } else if (ch.length === 1) {
      searchTerm += ch;
    }
    searchBox.setContent(`{yellow-fg}/${searchTerm}{/}`);
    statusBar.setContent(buildStatusBar());
    screen.render();
  });

  list.on("select item", (item, idx) => {
    selectedIdx = idx;
    renderDetail(filtered[idx]);
    if (logsVisible) startLogs(filtered[idx]);
    screen.render();
  });

  screen.on("destroy", () => {
    clearInterval(refreshTimer);
    clearInterval(countdownTimer);
    stopLogs();
  });

  // ── Initial render ────────────────────────────────────────────────

  renderList();
  renderDetail(filtered[0]);
  list.focus();
  screen.render();
}
