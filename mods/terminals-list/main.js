// terminals-list: every terminal open in Herdr (shells and agents), wherever its space is, with the
// folder and branch it's in now. + opens a shell in ~/Workspace, ✦ a Claude there; both go to the
// "Terminais" space. Clicking one shows it in the middle of the window (layout `dev`: work-main →
// term). Agents keep what the shipped `agents` list gives them: status, pins, sub-agents in a tree.
// Opened with props { sortMenu: true } it is the sort menu (a popup).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay,
  closeOverlay, props, window, layout, home, nextCommand, checking,
} from "herdr";
import { baseName, ownerOf, clean, RANK, kidStatus, duration, placeOf } from "./lib.js";

const TERMINALS_SPACE = "Terminais"; // shared with the projects mod
const CONFIRM_MS = 3000; // a close asks again for this long
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;
const SORTS = [
  { id: "priority", label: "Prioridade", icon: "clock" },
  { id: "project", label: "Por projeto", icon: "layers" },
  { id: "opened", label: "Ordem de abertura", icon: "terminal" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("terminals.sort")) ?? SORTS[0];

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

function showTerminalArea() {
  if (find(layout(), "work-main")) run("layout.select", { stack: "work-main", child: "term" });
}

function openTerminal(folder, argv) {
  const space = spaces().find((s) => s.named && s.name === TERMINALS_SPACE && !s.machine);
  const args = argv ? { folder, argv } : { folder };
  if (space) run("tab.new", { ...args, space: space.id });
  else run("space.new", { ...args, name: TERMINALS_SPACE, machine: "" });
  showTerminalArea();
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class TerminalsList extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.workspace = `${home()}/Workspace`;
    this.folded = new Set();
    this.hovered = null;
    this.closing = null; // { pane, until }: the × asked once
    if (checking()) return;
    cx.timer.every(30000, (cx) => cx.notify()); // durations
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "new") openTerminal(this.workspace);
        else if (c === "claude") openTerminal(this.workspace, ["claude"]);
        cx.notify();
      }
    });
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex().w_full().p(5).bg(t.popover).text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Ordenar terminais"))
      .children(SORTS.map((s) => h_flex().id(`sort-${s.id}`).h(31).px(8).gap(9).rounded(7).items_center()
        .text_color(t.foreground).hover((el) => el.bg(t.hover))
        .on_click(() => { setShared("terminals.sort", s.id); closeOverlay(props().overlay); })
        .child(svg(ICON(s.icon)).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg(ICON("check")).size(14).flex_none().text_color(t.foreground)))));
  }

  // Live sub-agents of `addr`, depth first, with the tree lines in front of each.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...this.tree(all, k.address, [...lead, last ? "" : "│"])];
    });
  }

  status(t, status, compact = false) {
    if (status === "working") return svg(ICON("spinner")).size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Precisa de você");
    if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
    if (status === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done);
    return null;
  }

  subRow(t, s, listed, shown) {
    const k = s.t;
    const on = k.address === shown;
    const pic = icon(k.program, 14, t.foreground);
    return h_flex().id(`sub-${k.address}`).pl(39).pr(8).rounded(8).h(26).flex_none().items_center().text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.raised)).hover((el) => el.bg(t.hover))
      .on_click(() => (listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : run("terminal.peek", { terminal: k.address })))
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, kidStatus(k, listed)) ?? div());
  }

  // What a row says: the agent's own title or the tab's name, else the program.
  label(r, tabs) {
    const tab = tabs.get(r.p.tab);
    const live = clean(r.p.title);
    const path = /^[~/]/.test((r.p.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
    const telling = live && !path && !live.includes("@") && live !== r.p.program?.name && live.toLowerCase() !== r.p.program?.key;
    if (tab?.named) return tab.name;
    if (r.agent && telling) return live;
    return r.p.program?.name ?? "Terminal";
  }

  closeButton(t, r) {
    const asking = this.closing?.pane === r.p.pane && Date.now() < this.closing.until;
    const risky = r.agent && r.status !== "idle" && r.status !== "done";
    return div().id(`close-${r.p.pane}`).flex_none().px(asking ? 5 : 2).h(18).flex().items_center().rounded(4).text_size(10.5)
      .text_color(asking ? t.blocked : t.dim).when(asking, (el) => el.bg(t.blocked + "26"))
      .cursor_pointer().hover((s) => s.bg(t.hover).text_color(asking ? t.blocked : t.foreground))
      .tooltip(asking ? "Clique de novo para fechar" : "Fechar este terminal")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (risky && !asking) {
          this.closing = { pane: r.p.pane, until: Date.now() + CONFIRM_MS };
        } else {
          this.closing = null;
          this.hovered = null;
          run("pane.close", { pane: r.p.pane });
        }
        cx.notify();
      })
      .child(asking ? "fechar?" : svg(ICON("x")).size(12));
  }

  pinButton(t, r) {
    return div().id(`pin-${r.p.pane}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(r.pinned ? "Desafixar" : "Fixar no topo")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("terminal.pin", { terminal: r.address, pinned: !r.pinned });
        this.hovered = null;
        cx.notify();
      })
      .child(svg(ICON(r.pinned ? "pin-off" : "pin")).size(13));
  }

  row(t, r, i, ctx) {
    const { tabs, here, termShown, subs, now } = ctx;
    const on = here === r.p.pane && termShown;
    const name = this.label(r, tabs);
    const place = placeOf(r.p.cwd, r.p.branch, ctx.home, ctx.checkouts);
    const pic = icon(r.p.program, 16, t.foreground) ?? svg(ICON("terminal")).size(15).flex_none().text_color(t.dim);
    const hovered = this.hovered === r.p.pane;
    const quiet = r.agent ? r.status === "idle" && !on : !r.running;
    const go = () => { run("pane.focus", { pane: r.p.pane }); showTerminalArea(); };
    if (ctx.collapsed) {
      return h_flex().id(`term-${r.p.pane}`).h(26).px(8).flex_none().items_center().gap(4).rounded(6)
        .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click(go)
        .child(div().flex_1().min_w(0).text_right().text_color(t.muted).child(String(i + 1)))
        .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, r.status, true) ?? div()));
    }
    const folded = this.folded.has(r.p.pane);
    return h_flex().id(`term-${r.p.pane}`).px(8).h(30).flex_none().rounded(8).items_center().gap(8).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
      .tooltip([r.p.cwd, r.p.branch].filter(Boolean).join("\n") || name)
      .on_hover((over, cx) => {
        if (over) this.hovered = r.p.pane;
        else if (this.hovered === r.p.pane) this.hovered = null;
        cx.notify();
      })
      .on_click(go)
      .child(div().id(`fold-${r.p.pane}`).flex_none()
        .when(subs.length > 0, (el) => el.on_click((_e, cx) => {
          cx.stop_propagation();
          this.folded = new Set(folded ? [...this.folded].filter((p) => p !== r.p.pane) : [...this.folded, r.p.pane]);
          cx.notify();
        }))
        .child(pic))
      .child(h_flex().flex_1().min_w(0).gap(6).items_center()
        .child(div().min_w(0).max_w(150).truncate().text_color(quiet ? t.muted : t.foreground).child(name))
        .when(Boolean(place), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(place))))
      .when(subs.length > 0 && folded, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`+${subs.length}`)))
      .when(hovered && r.agent, (el) => el.child(this.pinButton(t, r)))
      .when(hovered, (el) => el.child(this.closeButton(t, r)))
      .when(!hovered && r.agent && Boolean(r.since), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - r.since))))
      .child(this.status(t, r.status, ctx.byPriority && !r.pinned) ?? div());
  }

  // Every terminal pane, merged with what agents() knows about it.
  rows(all) {
    const byPane = new Map(agents().map((a) => [a.pane, a]));
    const ps = panes().filter((p) => p.terminal);
    return ps.map((p, order) => {
      const a = byPane.get(p.pane);
      return {
        p, order, agent: Boolean(a), address: a?.address ?? p.terminal, status: a?.status ?? null,
        pinned: Boolean(a?.pinned), seq: a?.seq ?? 0, since: 0,
        running: !(p.program?.shell || p.program?.agent),
        kids: a ? this.tree(all, a.address) : [],
      };
    });
  }

  header(t, sort) {
    const button = (id, child, tip, action) => div().id(id).size(24).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(child);
    return h_flex().px(16).pr(8).h(41).pt(12).pb(5).flex_none().items_center().gap(2)
      .child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).child("Terminais"))
      .child(button("term-sort", svg(ICON(sort.icon)).size(14), `Ordenar: ${sort.label}`,
        () => openOverlay({ mod: "terminals-list", kind: "popup", width: 210, height: 150, props: { sortMenu: true } })))
      .child(button("term-claude", image("icons/claude.svg").size(14), "Novo Claude em ~/Workspace", () => openTerminal(this.workspace, ["claude"])))
      .child(button("term-new", svg(ICON("plus")).size(15), "Novo terminal em ~/Workspace (ctrl-shift-t)", () => openTerminal(this.workspace)));
  }

  // When each pane's status last changed, so a row can say for how long (done and idle count as one).
  track(rows, now) {
    const prev = this.lastStatus ?? {};
    const changed = { ...(this.changedAt ?? {}) };
    const last = {};
    for (const r of rows) {
      const s = r.status === "done" ? "idle" : r.status;
      last[r.p.pane] = s;
      if (prev[r.p.pane] !== s) changed[r.p.pane] = now;
    }
    this.lastStatus = last;
    this.changedAt = changed;
  }

  render() {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    const byPriority = sort.id === "priority";
    const now = Date.now();
    const all = terminals();
    const listed = new Map(agents().map((a) => [a.address, a.status]));
    let list = this.rows(all);
    this.track(list, now);
    list = list.map((r) => ({ ...r, since: r.agent ? this.changedAt[r.p.pane] ?? 0 : 0 }));
    // A kept sub-agent (one with its own pane) shows in its parent's tree, not twice.
    const nested = new Set(collapsed ? [] : list.flatMap((r) => r.kids.map((k) => k.t.address)));
    list = list.filter((r) => r.pinned || !nested.has(r.address));
    const checkouts = Array.isArray(shared("projects.checkouts")) ? shared("projects.checkouts") : [];
    const projectOf = (r) => {
      const owner = r.p.cwd ? ownerOf(r.p.cwd, checkouts) : null;
      return owner ? baseName(owner) : "Outros";
    };
    const urgency = (r) => Math.max(RANK[r.status] ?? 0, ...r.kids.map((k) => RANK[kidStatus(k.t, listed)] ?? 0));
    if (byPriority) list = [...list].sort((x, y) => urgency(y) - urgency(x) || (y.since - x.since) || (y.seq - x.seq) || (x.order - y.order));
    if (sort.id === "project") list = [...list].sort((x, y) => projectOf(x).localeCompare(projectOf(y)) || (x.order - y.order));
    list = [...list.filter((r) => r.pinned), ...list.filter((r) => !r.pinned)];
    setAgentOrder(list.filter((r) => r.agent).map((r) => r.address));

    const tabs = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, tab]));
    const ctx = {
      tabs, here: focused()?.pane, termShown: (find(layout(), "work-main")?.active ?? "term") === "term",
      now, collapsed, byPriority, home: home(), checkouts,
    };
    const draw = (r, i) => {
      const subs = collapsed ? [] : r.kids;
      const head = this.row(t, r, i, { ...ctx, subs });
      if (this.folded.has(r.p.pane)) return [head];
      return [head, ...subs.map((s) => this.subRow(t, s, listed, focused()?.agent))];
    };
    const groupHeader = (label) => div().px(8).pt(8).h(26).flex_none().text_size(11).font_medium().text_color(t.dim).truncate().child(label);
    let rows;
    if (collapsed || sort.id !== "project") {
      rows = list.flatMap(draw);
    } else {
      let lastGroup = null;
      rows = list.flatMap((r, i) => {
        const g = r.pinned ? "Fixados" : projectOf(r);
        const head = g !== lastGroup ? [groupHeader(g)] : [];
        lastGroup = g;
        return [...head, ...draw(r, i)];
      });
    }

    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .when(!collapsed, (el) => el.child(this.header(t, sort)))
      .when(list.length === 0 && !collapsed, (el) => el.child(div().px(16).text_size(12).text_color(t.dim)
        .child("Nenhum terminal aberto. Use o + para abrir um em ~/Workspace.")))
      .child(v_flex().id("term-list").flex_1().min_h(0).px(collapsed ? 0 : 8).pb(8).overflow_y_scrollbar().children(rows))
      .when(collapsed, (el) => el.child(h_flex().h(28).items_center().justify_center()
        .child(div().id("collapse").text_size(13).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click(toggleSidebar).child("»"))));
  }
}
