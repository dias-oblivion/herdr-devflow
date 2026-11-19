// plan-viewer: a Claude plan as a document, its mermaid diagrams drawn. It lives in the side
// panel (layout `dev`: panel-body → plan) and shows shared("plan.open") = { file, terminal?, at }.
// Diagrams go through herdr-mermaid (headless Chrome) once per content and theme, cached as
// <appHome>/plan-cache/<hash>.png, which image() reads from the app's folder.
// Opened with props { zoom: { hash, width, height, title } } it is one diagram, big (a dialog).

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { shared, theme, settings, fonts, exec, readTextFile, watchFolder, home, appHome, openOverlay, closeOverlay, props, run } from "herdr";
import { mkdir, writeFile } from "fs/promises";
import { splitPlan, diagramHash, hashText, planTitle, ago, fitSize } from "./lib.js";

const PAD = 18; // the document's side margin
const CARD_PAD = 10; // a diagram card's inner margin
const RENDER_TIMEOUT = 90000; // a first Chrome start plus a dozen diagrams fits well inside
const POLL = 10000; // in case the folder watch misses a save (or is reclaimed)
const MONO = ["JetBrains Mono NL", "JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono"];

const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";
const baseOf = (p) => p.split("/").pop();

function monoFont() {
  let have = new Set();
  try { have = new Set(fonts()); } catch {}
  return MONO.find((name) => have.has(name)) ?? (settings().font_family || "monospace");
}

export default class PlanViewer extends View {
  init(_props, cx) {
    this.mono = monoFont();
    this.width = 0;
    if (props()?.zoom) return;
    this.file = null; // the plan on screen
    this.text = "";
    this.segments = []; // splitPlan(), each mermaid one with its hash
    this.diagrams = {}; // hash -> { width, height, error } once drawn or failed
    this.pending = new Set(); // hashes waiting for or inside a herdr-mermaid run
    this.drawing = false;
    this.error = null;
    this.loadedAt = 0;
    this.rev = 0;
    this.code = new Set(); // hashes whose source is shown
    this.watchDir = null;
    this.watch = null;
    cx.timer.every(POLL, (cx) => { if (this.file) cx.spawn((cx) => this.load(cx, true)); });
    cx.timer.every(30000, (cx) => cx.notify()); // "atualizado há"
  }

  themeName() {
    return settings().dark === false ? "default" : "dark";
  }

  // A plan file changed on disk (Claude revising it after feedback): read it again.
  startWatch(dir, cx) {
    if (dir === this.watchDir) return;
    this.watch?.cancel();
    this.watch = null;
    this.watchDir = dir;
    if (!dir) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const pending = watchFolder(dir);
        this.watch = pending;
        let paths;
        try { paths = await pending; } catch { return; } // over the watch limit: POLL covers it
        if (this.watchDir !== dir || !paths.length) return; // cancelled
        if (this.file && (paths.includes(this.file) || paths.includes(dir))) await this.load(cx, true);
      }
    });
  }

  async load(cx, quiet = false) {
    const file = this.file;
    const rev = ++this.rev;
    if (!file) {
      Object.assign(this, { text: "", segments: [], error: null });
      return cx.notify();
    }
    let text = null;
    let error = null;
    try { text = await readTextFile(file); } catch (e) { error = String(e?.message ?? e); }
    if (rev !== this.rev || file !== this.file) return;
    if (text === null) {
      this.error = error ?? `Arquivo não encontrado: ${file}`;
      return cx.notify();
    }
    const themeName = this.themeName();
    if (quiet && text === this.text && themeName === this.drawnTheme) return;
    this.text = text;
    this.error = null;
    this.loadedAt = Date.now();
    this.drawnTheme = themeName;
    this.segments = splitPlan(text).map((s) => (s.kind === "mermaid" ? { ...s, hash: diagramHash(s.code, themeName) } : s));
    cx.notify();
    await this.draw(cx);
  }

  // Draws the diagrams no run has drawn yet, one herdr-mermaid run at a time.
  async draw(cx) {
    if (this.drawing) return;
    this.drawing = true;
    try {
      for (;;) {
        const items = this.segments.filter((s) => s.kind === "mermaid" && !this.diagrams[s.hash] && !this.pending.has(s.hash));
        const unique = [...new Map(items.map((s) => [s.hash, { hash: s.hash, code: s.code }])).values()];
        if (!unique.length) return;
        unique.forEach((i) => this.pending.add(i.hash));
        cx.notify();
        const results = await this.runRenderer(unique);
        for (const i of unique) {
          this.pending.delete(i.hash);
          const r = results.find((x) => x.hash === i.hash);
          this.diagrams = { ...this.diagrams, [i.hash]: r ?? { width: 0, height: 0, error: "O renderizador não respondeu sobre este diagrama." } };
        }
        cx.notify();
      }
    } finally {
      this.drawing = false;
    }
  }

  async runRenderer(items) {
    const out = `${appHome()}/plan-cache`;
    const job = `${out}/jobs/${hashText(items.map((i) => i.hash).join(","))}.json`;
    try {
      await mkdir(`${out}/jobs`, { recursive: true });
      await writeFile(job, JSON.stringify({ theme: this.drawnTheme ?? this.themeName(), out, items }));
      const r = await exec(`${home()}/.local/bin/herdr-mermaid`, [job], { timeout: RENDER_TIMEOUT });
      if (r.code !== 0) throw new Error(r.stderr.trim() || `herdr-mermaid saiu com ${r.code}`);
      return JSON.parse(r.stdout);
    } catch (e) {
      const why = String(e?.message ?? e);
      const missing = /no such file|not found|ENOENT|couldn't start|cannot start/i.test(why);
      const error = missing ? "O renderizador herdr-mermaid não está instalado: rode `sh install.sh` no herdr-devflow." : why;
      return items.map((i) => ({ hash: i.hash, width: 0, height: 0, error }));
    }
  }

  // Forget failed drawings and read the file again.
  reload(cx) {
    this.diagrams = Object.fromEntries(Object.entries(this.diagrams).filter(([, d]) => !d.error));
    cx.spawn((cx) => this.load(cx));
  }

  toTerminal(terminal) {
    run("pane.focus", { terminal });
    run("layout.select", { stack: "work-main", child: "term" });
  }

  button(id, icon, tip, action, t) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_click(action).child(icon);
  }

  header(t, open) {
    const title = planTitle(this.text) ?? (this.file ? baseOf(this.file) : "Plano");
    const meta = [baseOf(this.file), this.loadedAt ? `atualizado há ${ago(this.loadedAt)}`.replace("há agora", "agora") : null].filter(Boolean).join(" · ");
    return h_flex().h(52).flex_none().px(14).gap(6).items_center().border_b(1).border_color(t.border).bg(t.chrome)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(13).font_semibold().text_color(t.foreground).child(title))
        .child(div().truncate().text_size(11).text_color(t.dim).child(meta)))
      .when(Boolean(open?.terminal), (el) => el.child(h_flex().id("plan-terminal").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).text_color(t.muted).bg(t.raised).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip("Ir para o terminal que escreveu este plano")
        .on_click(() => this.toTerminal(open.terminal))
        .child(svg("mods/workspace-chrome/monitor.svg").size(13)).child("Terminal")))
      .child(this.button("plan-reload", svg("mods/github-diff/icons/reload.svg").size(14), "Recarregar", (_e, cx) => this.reload(cx), t))
      .child(this.button("plan-editor", svg("mods/workspace-chrome/file-text.svg").size(14), "Abrir no editor", () => { exec("xdg-open", [this.file]).catch(() => {}); }, t))
      .child(this.button("plan-copy", svg("mods/github-diff/icons/copy.svg").size(14), "Copiar caminho", (_e, cx) => cx.write_to_clipboard(this.file), t))
      .child(this.button("plan-close", svg("mods/workspace-chrome/x.svg").size(14), "Fechar painel", () => run("layout.hide", { id: "panel" }), t));
  }

  codeBlock(code, t) {
    return v_flex().p(8).rounded(6).bg(t.raised).text_size(11.5).font_family(this.mono).text_color(t.muted)
      .children(code.split("\n").map((line) => div().whitespace_nowrap().child(line || " ")));
  }

  diagram(s, i, t, room) {
    const d = this.diagrams[s.hash];
    const card = v_flex().id(`dia-${i}-${s.hash}`).flex_none().gap(6).p(CARD_PAD).rounded(8).border_1().border_color(t.border).bg(t.surface);
    if (!d) {
      return card.child(h_flex().h(28).gap(8).items_center().text_size(12).text_color(t.dim)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900))
        .child("desenhando diagrama…"));
    }
    if (d.error) {
      return card.border_color(t.blocked)
        .child(div().text_size(12).font_semibold().text_color(t.blocked).child("Diagrama com erro"))
        .child(div().text_size(11.5).text_color(t.muted).font_family(this.mono).child(d.error))
        .child(this.codeBlock(s.code, t));
    }
    const size = fitSize(d.width, d.height, room - 2 * CARD_PAD - 2);
    const showing = this.code.has(s.hash);
    return card
      .child(h_flex().justify_end().gap(4).text_size(11).text_color(t.dim)
        .child(div().id(`dia-code-${i}`).px(6).rounded(4).cursor_pointer().hover((el) => el.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { this.code = new Set(showing ? [...this.code].filter((h) => h !== s.hash) : [...this.code, s.hash]); cx.notify(); })
          .child(showing ? "ocultar código" : "código"))
        .child(div().id(`dia-zoom-${i}`).px(6).rounded(4).cursor_pointer().hover((el) => el.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.zoom(s.hash, d))
          .child("ampliar")))
      .child(div().id(`dia-img-${i}`).flex().justify_center().cursor_pointer().on_click(() => this.zoom(s.hash, d))
        .child(image(`plan-cache/${s.hash}.png`).w(size.width).h(size.height)))
      .when(showing, (el) => el.child(this.codeBlock(s.code, t)));
  }

  zoom(hash, d) {
    openOverlay({ mod: "plan-viewer", kind: "dialog", width: 0.92, height: 0.9, props: { zoom: { hash, width: d.width, height: d.height, title: planTitle(this.text) } } });
  }

  zoomView(t) {
    const z = props().zoom;
    const area = this.size ?? { width: 0, height: 0 };
    // Fit the dialog both ways; small diagrams may grow up to 2x (the PNG is drawn at 2x).
    const scale = area.width && area.height ? Math.min((area.width - 32) / z.width, (area.height - 32) / z.height, 2) : 1;
    const w = Math.max(1, Math.round(z.width * scale));
    const h = Math.max(1, Math.round(z.height * scale));
    return v_flex().size_full().bg(t.background).text_color(t.foreground)
      .child(h_flex().h(40).flex_none().px(14).items_center().justify_between().border_b(1).border_color(t.border)
        .child(div().truncate().text_size(12.5).text_color(t.muted).child(z.title ?? "Diagrama"))
        .child(this.button("zoom-close", svg("mods/workspace-chrome/x.svg").size(14), "Fechar (Esc)", () => closeOverlay(props().overlay), t)))
      .child(v_flex().id("zoom-area").flex_1().min_h(0).items_center().justify_center()
        .on_size_change((size, cx) => { this.size = size; cx.notify(); })
        .child(image(`plan-cache/${z.hash}.png`).w(w).h(h)));
  }

  empty(t) {
    return v_flex().flex_1().items_center().justify_center().gap(8).p(24).text_size(12.5).text_color(t.dim)
      .child(svg("mods/workspace-chrome/file-text.svg").size(22))
      .child(div().text_color(t.muted).child("Nenhum plano aberto"))
      .child(div().text_center().child("Os planos aparecem aqui quando o Claude pede aprovação, ou pela aba Planos da barra lateral."));
  }

  render(cx) {
    const t = theme();
    if (props()?.zoom) return this.zoomView(t);
    const open = shared("plan.open") ?? null;
    const want = open?.file ?? null;
    if (want !== this.file || (want && this.themeName() !== this.drawnTheme && this.text)) {
      this.file = want;
      this.startWatch(want ? dirOf(want) : null, cx);
      cx.spawn((cx) => this.load(cx));
    }
    const room = Math.max(160, this.width - 2 * PAD);
    const body = this.error
      ? v_flex().p(PAD).gap(6).child(div().text_color(t.blocked).text_size(12.5).child(this.error))
      : v_flex().id("plan-doc").flex_1().min_h(0).overflow_y_scrollbar().px(PAD).py(14).gap(12).text_size(13.5)
        .children(this.segments.map((s, i) => (s.kind === "md"
          ? TextView.markdown(`md-${i}-${hashText(s.text)}`, s.text).selectable(true)
          : this.diagram(s, i, t, room))));
    return v_flex().id("plan-viewer").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .when(!this.file, (el) => el.child(this.empty(t)))
      .when(Boolean(this.file), (el) => el.child(this.header(t, open)).child(body));
  }
}
