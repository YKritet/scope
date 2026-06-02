#!/usr/bin/env node

import { scan, killPid } from "./scanner.js";
import { runTui } from "./tui.js";
import chalk from "chalk";
import Table from "cli-table3";

const args = process.argv.slice(2);
const command = args[0];

if (command === "--version" || command === "-v") {
  const { createRequire } = await import("module");
  const req = createRequire(import.meta.url);
  const { version } = req("../package.json");
  console.log(version);
  process.exit(0);
}

async function main() {
  // Default: static table
  if (!command || command === "ls") {
    const services = await scan();
    printTable(services);
    return;
  }

  // Interactive TUI
  if (command === "tui") {
    await runTui();
    return;
  }

  // Inspect a single port
  const port = parseInt(command, 10);
  if (!isNaN(port)) {
    const services = await scan();
    const s = services.find((x) => x.port === port);
    if (!s) {
      console.log(chalk.red(`\n  No service found on :${port}\n`));
      return;
    }
    printDetail(s);
    return;
  }

  console.log(chalk.red(`\n  Unknown command: ${command}\n`));
  printHelp();
}

function printTable(services) {
  if (!services.length) {
    console.log(chalk.gray("\n  No listening services found.\n"));
    return;
  }

  const table = new Table({
    chars: {
      top: "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      bottom: "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      left: "│", "left-mid": "├", mid: "─", "mid-mid": "┼",
      right: "│", "right-mid": "┤", middle: "│",
    },
    style: { head: [], border: ["gray"], "padding-left": 1, "padding-right": 1 },
    head: [
      chalk.cyan.bold("PORT"), chalk.cyan.bold("PROCESS"), chalk.cyan.bold("USER"),
      chalk.cyan.bold("DIR"), chalk.cyan.bold("BRANCH"), chalk.cyan.bold("FRAMEWORK"),
      chalk.cyan.bold("CPU"), chalk.cyan.bold("MEM"), chalk.cyan.bold("UPTIME"), chalk.cyan.bold("STATUS"),
    ],
  });

  for (const s of services) {
    const home = process.env.HOME ?? "";
    const dir = s.cwd ?? s.composeWorkdir;
    const dirShort = dir
      ? ((home ? dir.replace(home, "~") : dir)).slice(-26)
      : null;

    const branch = s.branch
      ? (s.isLinkedWorktree ? chalk.yellow(trunc(s.branch, 14)) : chalk.magenta(trunc(s.branch, 14)))
      : chalk.gray("—");

    table.push([
      chalk.white.bold(`:${s.port}`),
      chalk.white(trunc(s.processName, 10)),
      s.user ? chalk.white(trunc(s.user, 12)) : chalk.gray("—"),
      dirShort ? chalk.dim(dirShort) : chalk.gray("—"),
      branch,
      s.framework ? chalk.cyan(trunc(s.framework, 10)) : chalk.gray("—"),
      s.cpu != null ? (s.cpu > 25 ? chalk.red(s.cpu.toFixed(1) + "%") : s.cpu > 5 ? chalk.yellow(s.cpu.toFixed(1) + "%") : chalk.green(s.cpu.toFixed(1) + "%")) : chalk.gray("—"),
      s.memory ? chalk.green(s.memory) : chalk.gray("—"),
      s.uptime ? chalk.yellow(s.uptime) : chalk.gray("—"),
      statusStr(s.status),
    ]);
  }

  console.log();
  console.log(table.toString());
  console.log();
  console.log(
    chalk.gray(`  ${services.length} service${services.length === 1 ? "" : "s"}  ·  `) +
    chalk.cyan("scope tui") + chalk.gray(" for interactive view"),
  );
  console.log();
}

function printDetail(s) {
  const home = process.env.HOME ?? "";
  const row = (lbl, val) =>
    console.log(`  ${chalk.cyan(lbl.padEnd(14))} ${val}`);

  console.log();
  console.log(chalk.white.bold(`  :${s.port}`));
  console.log(chalk.gray("  " + "─".repeat(40)));
  console.log();
  row("PROCESS", chalk.white.bold(s.processName) + chalk.gray(` (PID ${s.pid ?? "—"})`));
  row("USER", s.user ? chalk.white(s.user) : chalk.gray("—"));
  row("STATUS", statusStr(s.status));
  row("MEMORY", s.memory ? chalk.green(s.memory) : chalk.gray("—"));
  row("UPTIME", s.uptime ? chalk.yellow(s.uptime) : chalk.gray("—"));
  console.log();
  if (s.source === "process") {
    const dir = s.cwd ? (home ? s.cwd.replace(home, "~") : s.cwd) : null;
    row("DIR", dir ? chalk.blue(dir) : chalk.gray("—"));
    row("PROJECT", s.projectName ? chalk.white(s.projectName) : chalk.gray("—"));
    row("BRANCH", s.branch
      ? (s.isLinkedWorktree ? chalk.yellow(s.branch) + chalk.gray(" (linked worktree)") : chalk.magenta(s.branch))
      : chalk.gray("—"));
    if (s.isLinkedWorktree && s.mainPath) {
      row("MAIN REPO", chalk.gray(home ? s.mainPath.replace(home, "~") : s.mainPath));
    }
    row("FRAMEWORK", s.framework ? chalk.cyan(s.framework) : chalk.gray("—"));
    console.log();
    row("CMD", s.command ? chalk.gray(s.command) : chalk.gray("—"));
  } else {
    row("IMAGE", chalk.gray(s.image ?? "—"));
    row("CONTAINER", chalk.gray(s.containerId ?? "—"));
    if (s.composeProject) {
      console.log();
      row("COMPOSE", chalk.blue(s.composeProject) + chalk.gray(" / ") + chalk.white(s.composeService ?? "?"));
      if (s.composeWorkdir) {
        const wd = home ? s.composeWorkdir.replace(home, "~") : s.composeWorkdir;
        row("WORKDIR", chalk.blue(wd));
      }
    }
  }
  console.log();
}

function printHelp() {
  console.log(chalk.cyan.bold("\n  scope\n"));
  console.log(chalk.gray("  scope         ") + "list all services (static table)");
  console.log(chalk.gray("  scope tui     ") + "interactive TUI (navigate, logs, kill)");
  console.log(chalk.gray("  scope <port>  ") + "inspect a specific port");
  console.log();
}

function statusStr(s) {
  const icons = { running: chalk.green("●"), listening: chalk.green("●"), zombie: chalk.red("●"), orphaned: chalk.yellow("●") };
  const icon = icons[s] ?? chalk.gray("●");
  const labels = { running: chalk.green("running"), listening: chalk.green("listening"), zombie: chalk.red("zombie"), orphaned: chalk.yellow("orphaned") };
  return `${icon} ${labels[s] ?? chalk.gray(s)}`;
}

function trunc(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

main().catch((e) => {
  console.error(chalk.red("\n  Error:"), e.message);
  process.exit(1);
});
