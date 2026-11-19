// projects: the sidebar's fixed list of repos, each with its git worktrees under it, and the plans
// Claude wrote. Clicking a checkout shows its diff in the middle of the window (layout `dev`: stack
// work-main → diff, where github-diff follows shared("diff.target")); it never opens a terminal.
// The Plans view lists ~/.claude/plans; clicking one shows it in the side panel (plan-viewer).
// It also hands plans to that panel: the ExitPlanMode hook (herdr-plan-open.sh) drops
// ~/.local/state/herdr-devflow/plans/<terminal>.json, and the plan opens beside that terminal.
// Opened with props { menu } it is a checkout's right-click menu (a popup).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle, InputState, Input } from "gpui-base";
import {
  spaces, panes, agents, focused, exec, run, shared, setShared, theme, layout, window, home,
  readTextFile, watchFolder, pickFolder, openOverlay, closeOverlay, notify, props, nextCommand, checking,
} from "herdr";
import { readdir } from "fs/promises";
import {
  DEFAULT_BRANCHES, parseWorktrees, visibleWorktrees, countChanges, parseAheadBehind, mainCheckout,
  baseName, ownerOf, topStatus, parsePlanList, parsePlanEvent, colorOf, planTitle, ago, pool,
} from "./lib.js";

const REFRESH = 15000; // git status of every listed checkout, while the window is in front
const AT_ONCE = 6; // checkouts read together (two git runs each)
const MAX_PLANS = 40;
const STALE_EVENT = 120000; // a plan event older than this when Herdr starts is history, not news
const TERMINALS_SPACE = "Terminais"; // where new terminals go (shared with terminals-list)
const RAIL_CELL = 32;
// Avatar colors, as the shipped spaces mod draws them.
const MARK = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const repoList = () => (Array.isArray(shared("projects.repos")) ? shared("projects.repos") : []).filter((r) => typeof r?.path === "string");

// ---- actions shared by the list and its menu (another copy of this mod, so no instance state)

function showDiff(target) {
  setShared("diff.target", { ...target, at: Date.now() });
  if (find(layout(), "work-main")) run("layout.select", { stack: "work-main", child: "diff" });
  else openOverlay({ mod: "github-diff", kind: "dialog", modal: true, width: 0.96, height: 0.92, props: { repo: target.repo } });
}

function showPlanPanel() {
  if (!find(layout(), "panel-body")) return;
  run("layout.select", { stack: "panel-body", child: "plan" });
  run("layout.show", { id: "panel" });
}

function openTerminal(folder, argv) {
  const space = spaces().find((s) => s.named && s.name === TERMINALS_SPACE && !s.machine);
  const args = argv ? { folder, argv } : { folder };
  if (space) run("tab.new", { ...args, space: space.id });
  else run("space.new", { ...args, name: TERMINALS_SPACE, machine: "" });
  if (find(layout(), "work-main")) run("layout.select", { stack: "work-main", child: "term" });
}

function openPullRequest(path) {
  exec("gh", ["pr", "view", "--web"], { cwd: path })
    .then((r) => { if (r.code !== 0) notify({ title: "Sem PR aberto para esta branch", body: r.stderr.trim().split("\n")[0], level: "warning" }); })
    .catch((e) => notify({ title: "Não consegui rodar o gh", body: String(e?.message ?? e), level: "error" }));
}

async function mainOf(dir) {
  try {
    const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir });
    return r.code === 0 ? mainCheckout(r.stdout) : null;
  } catch {
    return null;
  }
}

const git = (args, cwd) => exec("git", ["--no-optional-locks", ...args], { cwd, timeout: 15000 });

export default class Projects extends View {
  init(_props, cx) {
    if (props()?.menu) return;
    this.home = home();
    this.plansDir = `${this.home}/.claude/plans`;
    this.stateDir = `${this.home}/.local/state/herdr-devflow/plans`;
    this.git = {}; // repo -> { worktrees, error }
    this.status = {}; // checkout -> { changes, ahead, behind }
    this.queued = new Set();
    this.running = false;
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.watching = new Map(); // git common dir -> FolderWatch
    this.plans = []; // [{ file, mtime, title }]
    this.titles = {}; // file -> { mtime, title }
    this.events = {}; // terminal -> latest plan event from the hook
    this.notified = new Set();
    this.seen = this.stored("seen", {});
    this.folded = new Set(this.stored("folded", []));
    this.filter = InputState.new({ placeholder: "Filtrar planos" });
    this.filter.on("change", (_e, cx) => cx.notify());
    this.scroll = ScrollHandle.new();
    if (checking()) return;
    cx.spawn((cx) => this.seed(cx));
    cx.timer.every(REFRESH, (cx) => { if (window().active) this.refresh(repoList().map((r) => r.path), cx); });
    this.watchLoop(this.plansDir, (cx) => this.loadPlans(cx), cx);
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", this.stateDir]).catch(() => null);
      await this.readEvents(true);
      this.watchLoop(this.stateDir, async (cx) => { await this.readEvents(false); this.deliver(); }, cx);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        this.command(await nextCommand());
        cx.notify();
      }
    });
  }

  stored(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "null");
      return v && typeof v === "object" ? v : fallback;
    } catch {
      return fallback;
    }
  }

  // ---- repos and their checkouts

  // First run: the repos the current spaces and terminals are in.
  async seed(cx) {
    if (!Array.isArray(shared("projects.repos"))) {
      const places = [...new Set([...spaces().map((s) => s.folder), ...panes().map((p) => p.cwd)].filter(Boolean))];
      const found = [];
      for (const dir of places) {
        const main = await mainOf(dir);
        if (main && !found.includes(main)) found.push(main);
      }
      setShared("projects.repos", found.map((path) => ({ path })));
    }
    this.refresh(repoList().map((r) => r.path), cx);
  }

  // Reads repos one at a time, each once however often it was asked for meanwhile.
  refresh(repos, cx) {
    repos.forEach((r) => this.queued.add(r));
    if (this.running || !this.queued.size) return;
    this.running = true;
    cx.spawn(async (cx) => {
      try {
        while (this.queued.size) {
          const batch = [...this.queued];
          this.queued.clear();
          for (const repo of batch) await this.readRepo(repo, cx);
        }
      } finally {
        this.running = false;
        cx.notify();
      }
    });
  }

  async readRepo(repo, cx) {
    try {
      const [list, common] = await Promise.all([
        git(["worktree", "list", "--porcelain"], repo),
        git(["rev-parse", "--path-format=absolute", "--git-common-dir"], repo),
      ]);
      if (list.code !== 0) {
        this.git = { ...this.git, [repo]: { worktrees: [], error: list.stderr.trim() || "não é um repositório git" } };
        return;
      }
      const worktrees = visibleWorktrees(parseWorktrees(list.stdout));
      this.git = { ...this.git, [repo]: { worktrees, error: null } };
      this.publishCheckouts();
      if (common.code === 0) this.watchRepo(common.stdout.trim(), repo, cx);
      cx.notify();
      await pool(worktrees, AT_ONCE, (w) => this.readStatus(w.path));
    } catch (e) {
      this.git = { ...this.git, [repo]: { worktrees: this.git[repo]?.worktrees ?? [], error: String(e?.message ?? e) } };
    }
  }

  // Other mods (terminals-list) say which checkout a terminal is in from this list.
  publishCheckouts() {
    const paths = repoList().flatMap((r) => (this.git[r.path]?.worktrees ?? []).map((w) => w.path));
    const now = Array.isArray(shared("projects.checkouts")) ? shared("projects.checkouts") : [];
    if (paths.length !== now.length || paths.some((p, i) => p !== now[i])) setShared("projects.checkouts", paths);
  }

  async readStatus(path) {
    const [st, counts] = await Promise.all([
      git(["status", "--porcelain"], path),
      git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], path),
    ]);
    const ab = counts.code === 0 ? parseAheadBehind(counts.stdout) : { ahead: 0, behind: 0 };
    this.status = { ...this.status, [path]: { changes: st.code === 0 ? countChanges(st.stdout) : null, ...ab } };
  }

  // A commit, checkout or new worktree changes the repo's own .git folder. Our reads take no locks,
  // so they never wake this watch themselves.
  watchRepo(common, repo, cx) {
    if (this.watching.has(common)) return;
    this.watching.set(common, true);
    this.watchLoop(common, (cx) => {
      if (!repoList().some((r) => r.path === repo)) return false;
      this.refresh([repo], cx);
      return true;
    }, cx, () => this.watching.delete(common));
  }

  // Calls `onChange` each time something under `dir` changes; a false return stops watching.
  watchLoop(dir, onChange, cx, onEnd) {
    cx.spawn(async (cx) => {
      await onChange(cx);
      try {
        for (;;) {
          const paths = await watchFolder(dir);
          if (!paths.length) break; // cancelled
          if ((await onChange(cx)) === false) break;
          cx.notify();
        }
      } catch { /* over the watch limit: REFRESH still runs */ }
      onEnd?.();
    });
  }

  // A command or an agent's turn that just ended may have committed or edited: look again there.
  trackAgents(ps, cx) {
    const busy = {};
    const ended = [];
    for (const p of ps) {
      if (!p.terminal) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane] && p.cwd) ended.push(p.cwd);
    }
    this.busy = busy;
    if (!ended.length) return;
    const repos = repoList().map((r) => r.path).filter((repo) => {
      const paths = (this.git[repo]?.worktrees ?? []).map((w) => w.path);
      return ended.some((cwd) => ownerOf(cwd, paths));
    });
    if (repos.length) this.refresh(repos, cx);
  }

  async addRepo(cx) {
    const dir = await pickFolder({ prompt: "Adicionar" });
    if (!dir) return;
    const main = await mainOf(dir);
    if (!main) {
      notify({ title: "Não é um repositório git", body: dir, level: "warning" });
      return;
    }
    if (!repoList().some((r) => r.path === main)) setShared("projects.repos", [...repoList(), { path: main }]);
    this.refresh([main], cx);
  }

  // ---- plans

  async loadPlans(cx) {
    let list = [];
    try {
      const r = await exec("find", [this.plansDir, "-maxdepth", "1", "-name", "*.md", "-printf", "%T@\t%p\n"]);
      list = parsePlanList(r.stdout).slice(0, MAX_PLANS);
    } catch { /* no plans folder yet */ }
    for (const p of list) {
      if (this.titles[p.file]?.mtime === p.mtime) continue;
      const text = await readTextFile(p.file).catch(() => null);
      this.titles = { ...this.titles, [p.file]: { mtime: p.mtime, title: planTitle(text) ?? baseName(p.file).replace(/\.md$/, "") } };
    }
    this.plans = list.map((p) => ({ ...p, title: this.titles[p.file]?.title ?? baseName(p.file) }));
    cx.notify();
  }

  // The hook's files, one per terminal. On start, what's already there counts as seen.
  async readEvents(starting) {
    const names = await readdir(this.stateDir).catch(() => []);
    const events = {};
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      const e = parsePlanEvent(await readTextFile(`${this.stateDir}/${name}`).catch(() => null));
      if (e) events[e.terminal] = e;
    }
    this.events = events;
    if (starting) {
      const old = Object.values(events).filter((e) => e.at < Date.now() - STALE_EVENT && (this.seen[e.terminal] ?? 0) < e.at);
      if (old.length) this.markSeen(old);
    }
  }

  markSeen(list) {
    const seen = { ...this.seen };
    for (const e of list) seen[e.terminal] = e.at;
    // Keep the newest 100: terminals come and go.
    this.seen = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 100));
    localStorage.setItem("seen", JSON.stringify(this.seen));
  }

  unseen() {
    return Object.values(this.events).filter((e) => (this.seen[e.terminal] ?? 0) < e.at);
  }

  // A new plan opens beside its terminal when that terminal is in front; otherwise a toast
  // takes you there, and it opens once you are (see render).
  deliver() {
    const here = focused()?.terminal;
    for (const e of this.unseen()) {
      if (e.terminal === here) {
        this.openPlan(e);
        continue;
      }
      const key = `${e.terminal}:${e.at}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      const title = this.titles[e.file]?.title ?? baseName(e.file);
      notify({ title: "Plano pronto para revisar", body: `${title} · terminal ${e.terminal}`, level: "info", action: { name: "pane.focus", args: { terminal: e.terminal } } });
    }
  }

  openPlan(e) {
    this.markSeen([e]);
    setShared("plan.open", { file: e.file, terminal: e.terminal, at: e.at });
    showPlanPanel();
    if (find(layout(), "work-main")) run("layout.select", { stack: "work-main", child: "term" });
  }

  command(c) {
    const root = layout();
    const main = find(root, "work-main");
    if (c === "toggle-main" && main) {
      if (main.active === "diff") {
        run("layout.select", { stack: "work-main", child: "term" });
        const pane = focused()?.pane;
        if (pane) run("pane.focus", { pane });
      } else {
        // From a terminal: the diff of the checkout it's in (else the last one shown).
        const cwd = focused()?.cwd;
        const checkouts = repoList().flatMap((r) => (this.git[r.path]?.worktrees ?? []).map((w) => w.path));
        if (cwd) showDiff({ repo: ownerOf(cwd, checkouts) ?? cwd });
        else run("layout.select", { stack: "work-main", child: "diff" });
      }
    } else if (c === "toggle-plan") {
      const panel = find(root, "panel");
      if (panel && !panel.hidden && find(root, "panel-body")?.active === "plan") run("layout.hide", { id: "panel" });
      else showPlanPanel();
    } else if (c === "projects" || c === "plans") {
      setShared("projects.view", c);
    }
  }

  // ---- drawing

  menu(t) {
    const m = props().menu;
    const close = () => closeOverlay(props().overlay);
    const item = (id, label, icon, action) => h_flex().id(id).h(30).px(8).gap(9).rounded(7).items_center()
      .text_color(t.foreground).cursor_pointer().hover((el) => el.bg(t.hover))
      .on_click((_e, cx) => { action(cx); close(); })
      .child(svg(icon).size(14).flex_none().text_color(t.muted))
      .child(div().flex_1().truncate().child(label));
    return v_flex().w_full().p(5).bg(t.popover).text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).truncate().child(baseName(m.path)))
      .child(item("m-diff", "Ver diff", ICON("git-compare"), () => showDiff({ repo: m.path })))
      .child(item("m-commits", "Ver commits", ICON("git-branch"), () => showDiff({ repo: m.path, view: "commits" })))
      .child(item("m-term", "Abrir terminal aqui", ICON("terminal"), () => openTerminal(m.path)))
      .child(item("m-claude", "Abrir Claude aqui", ICON("square-pen"), () => openTerminal(m.path, ["claude"])))
      .child(item("m-pr", "Abrir PR no GitHub", ICON("git-branch"), () => openPullRequest(m.path)))
      .child(item("m-copy", "Copiar caminho", ICON("file-text"), (cx) => cx.write_to_clipboard(m.path)))
      .when(m.kind === "repo", (el) => el.child(item("m-remove", "Remover da lista", ICON("x"), () => {
        setShared("projects.repos", repoList().filter((r) => r.path !== m.path));
      })));
  }

  openMenu(path, kind) {
    openOverlay({ mod: "projects", kind: "popup", width: 220, height: 280, props: { menu: { path, kind } } });
  }

  // Branch, changes and ahead/behind, after the name: only what's unusual.
  tail(path, branch, isMain, t) {
    const s = this.status[path];
    const shownBranch = isMain && DEFAULT_BRANCHES.has(branch) ? "" : (branch ?? "");
    return h_flex().flex_auto().min_w(0).gap(5).justify_end().items_center().text_size(11.5).text_color(t.dim)
      .when(Boolean(shownBranch) && isMain, (el) => el.child(div().min_w(0).truncate().child(shownBranch)))
      .when(Boolean(s?.changes), (el) => el.child(div().flex_none().text_color(t.ansi3).tooltip(`${s.changes} arquivo(s) não commitados`).child(`●${s.changes}`)))
      .when(s?.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${s.ahead}`)))
      .when(s?.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${s.behind}`)));
  }

  agentMark(status, t) {
    if (status === "working") return svg(ICON("spinner")).size(11).flex_none().text_color(t.working).spin(900);
    if (status === "blocked") return div().flex_none().px(4).h(15).rounded(4).bg(t.blocked + "26").text_size(10).font_bold().text_color(t.blocked).flex().items_center().child("!");
    if (status === "done") return div().size(6).flex_none().rounded(3).bg(t.done);
    return null;
  }

  checkoutRow({ id, path, label, branch, isMain, repo, folds, folded, status, active }, t) {
    const color = colorOf(repo, MARK);
    const mark = this.agentMark(status, t);
    return h_flex().id(id).h(isMain ? 30 : 28).flex_none().px(8).gap(9).rounded(8).items_center().cursor_pointer()
      .when(active, (el) => el.bg(t.selected))
      .when(!active, (el) => el.hover((s) => s.bg(t.hover)))
      .tooltip(branch ? `${path}\n${branch}` : path)
      .on_click(() => showDiff({ repo: path }))
      .on_mouse_down("right", () => this.openMenu(path, isMain ? "repo" : "worktree"))
      .when(isMain, (el) => el.child(h_flex().size(18).flex_none().rounded(5).bg(color).items_center().justify_center()
        .text_size(10.5).font_bold().text_color("#ffffff").child([...label][0]?.toUpperCase() ?? "?")))
      .when(!isMain, (el) => el.pl(22).child(svg(ICON("branch")).size(13).flex_none().text_color(t.dim)))
      .child(div().flex_initial().min_w(40).truncate().text_color(t.foreground).child(label))
      .when(!isMain && Boolean(branch) && branch !== label, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(branch)))
      .child(this.tail(path, branch, isMain, t))
      .when(Boolean(mark), (el) => el.child(mark))
      .when(folds, (el) => el.child(div().id(`${id}-fold`).flex_none().px(2).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.folded = new Set(folded ? [...this.folded].filter((p) => p !== repo) : [...this.folded, repo]);
          localStorage.setItem("folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(ICON(folded ? "chevron-right" : "chevron-down")).size(11))));
  }

  projectRows(t, collapsed) {
    const target = shared("diff.target")?.repo;
    const showingDiff = find(layout(), "work-main")?.active === "diff";
    const byPane = new Map(agents().map((a) => [a.pane, a.status]));
    const repos = repoList();
    const all = repos.flatMap((r) => (this.git[r.path]?.worktrees ?? []).map((w) => w.path));
    const statuses = {};
    for (const p of panes()) {
      const s = byPane.get(p.pane);
      const owner = s && p.cwd ? ownerOf(p.cwd, all.length ? all : repos.map((r) => r.path)) : null;
      if (owner) statuses[owner] = [...(statuses[owner] ?? []), s];
    }
    if (!repos.length) {
      return [div().px(collapsed ? 0 : 8).py(6).text_size(12).text_color(t.dim)
        .child(collapsed ? "" : "Nenhum projeto ainda. Use o + para adicionar um repositório.")];
    }
    return repos.flatMap((r, ri) => {
      const info = this.git[r.path];
      const wts = info?.worktrees ?? [];
      const main = wts.find((w) => w.main) ?? { path: r.path, branch: null, main: true };
      const kids = wts.filter((w) => !w.main).sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)));
      const folded = this.folded.has(r.path);
      const active = (path) => showingDiff && target === path;
      if (collapsed) {
        const top = topStatus([main, ...kids].flatMap((w) => statuses[w.path] ?? []));
        return [h_flex().id(`rail-${ri}`).w(RAIL_CELL).h(28).flex_none().relative().rounded(6).justify_center().items_center()
          .when(active(r.path), (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
          .tooltip(baseName(r.path)).on_click(() => showDiff({ repo: r.path }))
          .child(h_flex().size(18).rounded(5).bg(colorOf(r.path, MARK)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff")
            .child([...baseName(r.path)][0]?.toUpperCase() ?? "?"))
          .when(Boolean(top) && top !== "idle", (el) => el.child(div().absolute().right(2).top(2).size(6).rounded(3).bg(t[top] ?? t.dim)))];
      }
      const head = this.checkoutRow({
        id: `repo-${ri}`, path: main.path, label: baseName(r.path), branch: main.branch, isMain: true, repo: r.path,
        folds: kids.length > 0, folded, status: topStatus([...(statuses[main.path] ?? []), ...(folded ? kids.flatMap((k) => statuses[k.path] ?? []) : [])]),
        active: active(main.path),
      }, t);
      const error = info?.error ? [div().pl(35).pr(8).h(22).flex_none().truncate().text_size(11).text_color(t.blocked).child(info.error)] : [];
      const rows = folded ? [] : kids.map((w, wi) => this.checkoutRow({
        id: `wt-${ri}-${wi}`, path: w.path, label: baseName(w.path), branch: w.branch ?? (w.detached ? "(detached)" : null),
        isMain: false, repo: r.path, folds: false, folded: false, status: topStatus(statuses[w.path] ?? []), active: active(w.path),
      }, t));
      return [head, ...error, ...rows];
    });
  }

  planRows(t) {
    const open = shared("plan.open")?.file;
    const live = new Set(panes().map((p) => p.terminal).filter(Boolean));
    const waiting = new Map(Object.values(this.events).filter((e) => live.has(e.terminal)).map((e) => [e.file, e.terminal]));
    const q = this.filter.value().trim().toLowerCase();
    const list = q ? this.plans.filter((p) => p.title.toLowerCase().includes(q) || baseName(p.file).toLowerCase().includes(q)) : this.plans;
    if (!list.length) return [div().px(8).py(6).text_size(12).text_color(t.dim).child(q ? "Nenhum plano com esse nome." : "Nenhum plano salvo ainda.")];
    return list.map((p, i) => {
      const terminal = waiting.get(p.file) ?? null;
      return h_flex().id(`plan-${i}`).h(30).flex_none().px(8).gap(8).rounded(8).items_center().cursor_pointer()
        .when(open === p.file, (el) => el.bg(t.selected))
        .when(open !== p.file, (el) => el.hover((s) => s.bg(t.hover)))
        .tooltip(p.file)
        .on_click(() => { setShared("plan.open", { file: p.file, terminal, at: Date.now() }); showPlanPanel(); })
        .child(svg(ICON("file-text")).size(13).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(p.title))
        .when(Boolean(terminal), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.accent).tooltip(`Ligado ao terminal ${terminal}`)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(p.mtime)));
    });
  }

  head(t, view, collapsed) {
    const tab = (id, label) => div().id(`view-${id}`).px(7).h(22).flex().items_center().rounded(6).cursor_pointer()
      .text_color(view === id ? t.foreground : t.dim).when(view === id, (el) => el.bg(t.raised))
      .hover((s) => s.text_color(t.foreground))
      .on_click(() => setShared("projects.view", id)).child(label);
    const plus = div().id("project-add").size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(view === "plans" ? "Abrir a pasta de planos" : "Adicionar um repositório")
      .on_click((_e, cx) => {
        if (view === "plans") exec("xdg-open", [this.plansDir]).catch(() => {});
        else cx.spawn((cx) => this.addRepo(cx));
      })
      .child(svg(ICON(view === "plans" ? "folder" : "plus")).size(14));
    return h_flex().h(34).flex_none().pl(collapsed ? 0 : 10).pr(collapsed ? 0 : 8).gap(2).items_center().text_size(11.5).text_color(t.dim)
      .when(collapsed, (el) => el.justify_center().child(plus))
      .when(!collapsed, (el) => el.child(tab("projects", "Projetos")).child(tab("plans", "Planos")).child(div().flex_1()).child(plus));
  }

  render(cx) {
    const t = theme();
    if (props()?.menu) return this.menu(t);
    const ps = panes();
    this.trackAgents(ps, cx);
    // A plan waiting for the terminal now in front: show it beside it.
    const here = focused()?.terminal;
    const mine = here ? this.unseen().find((e) => e.terminal === here) : null;
    if (mine) this.openPlan(mine);
    const collapsed = narrow();
    const view = !collapsed && shared("projects.view") === "plans" ? "plans" : "projects";
    const rows = view === "plans" ? this.planRows(t) : this.projectRows(t, collapsed);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(this.head(t, view, collapsed))
      .when(view === "plans", (el) => el.child(div().px(10).pb(6).flex_none()
        .child(Input.new(this.filter).h(28).px(8).rounded(7).text_size(12).bg(t.surface).border_1().border_color(t.border))))
      .child(v_flex().id("project-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(10)
        .when(collapsed, (el) => el.items_center())
        .overflow_y_scrollbar().track_scroll(this.scroll).children(rows));
  }
}
