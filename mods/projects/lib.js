// Pure helpers for the projects sidebar. No herdr imports: `node --test` runs them as they are.

/** Branches a main checkout is usually on: not worth repeating next to its name. */
export const DEFAULT_BRANCHES = new Set(["main", "master", "homolog", "develop"]);

/** How urgent an agent status is: the sidebar shows the most urgent one in a checkout. */
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

/**
 * `git worktree list --porcelain` → [{ path, head, branch, detached, bare, prunable, locked, main }].
 * The first entry is the main checkout.
 */
export function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const line of String(porcelain ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) out.push(cur);
      cur = { path: line.slice(9), head: null, branch: null, detached: false, bare: false, prunable: false, locked: false };
    } else if (!cur) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      cur = { ...cur, head: line.slice(5) };
    } else if (line.startsWith("branch ")) {
      cur = { ...cur, branch: line.slice(7).replace(/^refs\/heads\//, "") };
    } else if (line === "detached") {
      cur = { ...cur, detached: true };
    } else if (line === "bare") {
      cur = { ...cur, bare: true };
    } else if (line.startsWith("prunable")) {
      cur = { ...cur, prunable: true };
    } else if (line.startsWith("locked")) {
      cur = { ...cur, locked: true };
    }
  }
  if (cur) out.push(cur);
  return out.map((w, i) => ({ ...w, main: i === 0 }));
}

/** Worktrees a sub-agent made for itself (Claude Code's isolation): noise in the list. */
export const isAgentWorktree = (path) => /\/\.claude\/worktrees\/agent-[^/]+\/?$/.test(path);

/** The checkouts worth listing: no bare repo, nothing git would prune, no sub-agent sandboxes. */
export const visibleWorktrees = (list) => list.filter((w) => !w.bare && !w.prunable && !isAgentWorktree(w.path));

/** Changed files in `git status --porcelain` output. */
export const countChanges = (status) => String(status ?? "").split("\n").filter((l) => l.trim()).length;

/** `git rev-list --left-right --count HEAD...@{upstream}` → { ahead, behind }. */
export function parseAheadBehind(out) {
  const [ahead, behind] = String(out ?? "").trim().split(/\s+/).map(Number);
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 };
}

/** The main checkout a `git rev-parse --git-common-dir` answer names, or null (a bare or odd repo). */
export function mainCheckout(commonDir) {
  const dir = String(commonDir ?? "").trim().replace(/\/+$/, "");
  return dir.endsWith("/.git") ? dir.slice(0, -5) : null;
}

export const baseName = (path) => String(path ?? "").replace(/\/+$/, "").split("/").pop();

/** Is `cwd` inside `dir` (or `dir` itself)? */
export const inside = (cwd, dir) => Boolean(cwd && dir) && (cwd === dir || cwd.startsWith(`${dir.replace(/\/+$/, "")}/`));

/** The checkout `cwd` is in: the deepest one, since a worktree may sit inside its repo. */
export function ownerOf(cwd, paths) {
  let best = null;
  for (const p of paths) if (inside(cwd, p) && (!best || p.length > best.length)) best = p;
  return best;
}

/** The most urgent status among several (null when none). */
export const topStatus = (statuses) => statuses.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);

/** `find -printf '%T@\t%p\n'` → [{ file, mtime }] newest first, mtime in ms. */
export function parsePlanList(out) {
  return String(out ?? "").split("\n")
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab < 0) return null;
      const mtime = Math.round(Number(line.slice(0, tab)) * 1000);
      const file = line.slice(tab + 1);
      return Number.isFinite(mtime) && file.endsWith(".md") ? { file, mtime } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

/** A hook event file's content, validated: { terminal, file, at, cwd } or null. */
export function parsePlanEvent(text) {
  let e;
  try { e = JSON.parse(text); } catch { return null; }
  if (!e || typeof e !== "object") return null;
  if (typeof e.terminal !== "string" || !/^[\w./-]+$/.test(e.terminal)) return null;
  if (typeof e.file !== "string" || !e.file.startsWith("/") || !e.file.endsWith(".md")) return null;
  if (typeof e.at !== "number" || !Number.isFinite(e.at)) return null;
  return { terminal: e.terminal, file: e.file, at: e.at, cwd: typeof e.cwd === "string" ? e.cwd : "" };
}

/** The plan's first H1, else null (same as plan-viewer/lib.js: mods can't share files). */
export function planTitle(text) {
  const m = String(text ?? "").match(/^#[ \t]+(.+?)[ \t#]*$/m);
  return m ? m[1].trim() : null;
}

/** "agora", "5 min", "3 h", "2 d" (same as plan-viewer/lib.js). */
export function ago(then, now = Date.now()) {
  const m = Math.floor(Math.max(0, now - then) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** Runs `fn` over `items`, at most `n` at once; resolves when all have settled. */
export async function pool(items, n, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch { /* one failure doesn't stop the rest */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** A stable avatar color for a repo, from its path. */
export function colorOf(path, palette) {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 0x01000193);
  return palette[(h >>> 0) % palette.length];
}
