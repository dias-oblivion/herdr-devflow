// Pure helpers for terminals-list. No herdr imports: `node --test` runs them as they are.

/** How urgent an agent status is (as the shipped agents list ranks them). */
export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

/** Branches not worth repeating after a folder's name. */
const DEFAULT_BRANCHES = new Set(["main", "master", "homolog", "develop"]);

export const baseName = (path) => String(path ?? "").replace(/\/+$/, "").split("/").pop();

const inside = (cwd, dir) => cwd === dir || cwd.startsWith(`${dir.replace(/\/+$/, "")}/`);

/** The checkout `cwd` is in: the deepest one, since a worktree may sit inside its repo. */
export function ownerOf(cwd, paths) {
  let best = null;
  for (const p of paths) if (cwd && p && inside(cwd, p) && (!best || p.length > best.length)) best = p;
  return best;
}

/**
 * Drops what an agent puts before its title: a status glyph or spinner and the separator after it,
 * and Codex's "[ ! ] " mark; keeps a leading bracket or quote (same rule as the agents mod).
 */
export const clean = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

/** A sub-agent without a pane: its raw word, error counting as blocked, never done. */
export function kidStatus(k, listed) {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
}

/** "<1m", "5m", "3h", "2d". */
export function duration(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/**
 * Where a terminal is, said short: the checkout it's in (else its folder, "~" at home) and the
 * branch when it isn't a default one: "droz-3228 · feat/DZDEV-3228-x".
 */
export function placeOf(cwd, branch, home, checkouts = []) {
  if (!cwd) return "";
  const owner = ownerOf(cwd, checkouts);
  const where = owner ? baseName(owner) : cwd === home ? "~" : baseName(cwd);
  return branch && !DEFAULT_BRANCHES.has(branch) ? `${where} · ${branch}` : where;
}
