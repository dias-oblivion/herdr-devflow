import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWorktrees, visibleWorktrees, isAgentWorktree, countChanges, parseAheadBehind, mainCheckout,
  baseName, inside, ownerOf, topStatus, parsePlanList, parsePlanEvent, colorOf, planTitle, ago, pool,
} from "../mods/projects/lib.js";

const PORCELAIN = [
  "worktree /w/droz", "HEAD a1", "branch refs/heads/homolog", "",
  "worktree /w/droz-3228", "HEAD b2", "branch refs/heads/feat/DZDEV-3228-x", "",
  "worktree /w/droz/.claude/worktrees/agent-1f2e", "HEAD c3", "detached", "",
  "worktree /w/droz-old", "HEAD d4", "branch refs/heads/old", "prunable gitdir file points to non-existent location", "",
  "worktree /w/droz-lock", "HEAD e5", "detached", "locked", "",
].join("\n");

test("parseWorktrees reads every checkout, the first one main", () => {
  const list = parseWorktrees(PORCELAIN);
  assert.equal(list.length, 5);
  assert.deepEqual(list[0], { path: "/w/droz", head: "a1", branch: "homolog", detached: false, bare: false, prunable: false, locked: false, main: true });
  assert.equal(list[1].branch, "feat/DZDEV-3228-x");
  assert.equal(list[1].main, false);
  assert.equal(list[2].detached, true);
  assert.equal(list[3].prunable, true);
  assert.equal(list[4].locked, true);
  assert.deepEqual(parseWorktrees(""), []);
});

test("visibleWorktrees hides sub-agent sandboxes and prunable checkouts", () => {
  assert.deepEqual(visibleWorktrees(parseWorktrees(PORCELAIN)).map((w) => w.path), ["/w/droz", "/w/droz-3228", "/w/droz-lock"]);
  assert.equal(isAgentWorktree("/w/r/.claude/worktrees/agent-abc"), true);
  assert.equal(isAgentWorktree("/w/r/.claude/worktrees/minha-feature"), false);
});

test("countChanges and parseAheadBehind read git's output", () => {
  assert.equal(countChanges(" M a.js\n?? b.js\n"), 2);
  assert.equal(countChanges(""), 0);
  assert.deepEqual(parseAheadBehind("3\t1\n"), { ahead: 3, behind: 1 });
  assert.deepEqual(parseAheadBehind(""), { ahead: 0, behind: 0 });
});

test("mainCheckout names the checkout of a .git common dir", () => {
  assert.equal(mainCheckout("/w/droz/.git\n"), "/w/droz");
  assert.equal(mainCheckout("/srv/repo.git"), null);
  assert.equal(mainCheckout(""), null);
});

test("inside and ownerOf pick the deepest checkout", () => {
  assert.equal(baseName("/w/droz-3228/"), "droz-3228");
  assert.equal(inside("/w/droz/src", "/w/droz"), true);
  assert.equal(inside("/w/droz-3228", "/w/droz"), false);
  const paths = ["/w/droz", "/w/droz/.claude/worktrees/feat"];
  assert.equal(ownerOf("/w/droz/.claude/worktrees/feat/src", paths), "/w/droz/.claude/worktrees/feat");
  assert.equal(ownerOf("/w/droz/src", paths), "/w/droz");
  assert.equal(ownerOf("/elsewhere", paths), null);
});

test("topStatus picks the most urgent", () => {
  assert.equal(topStatus(["idle", "working", "blocked", "done"]), "blocked");
  assert.equal(topStatus([]), null);
});

test("parsePlanList sorts newest first and keeps only .md files", () => {
  const out = "1763400000.5\t/p/a.md\n1763500000.25\t/p/b.md\nlixo\n1763600000\t/p/c.txt\n";
  assert.deepEqual(parsePlanList(out), [{ file: "/p/b.md", mtime: 1763500000250 }, { file: "/p/a.md", mtime: 1763400000500 }]);
});

test("parsePlanEvent validates the hook's file", () => {
  const ok = JSON.stringify({ terminal: "t39", file: "/h/.claude/plans/x.md", session_id: "s", cwd: "/h", at: 1763500000000 });
  assert.deepEqual(parsePlanEvent(ok), { terminal: "t39", file: "/h/.claude/plans/x.md", at: 1763500000000, cwd: "/h" });
  assert.equal(parsePlanEvent("{"), null);
  assert.equal(parsePlanEvent(null), null);
  assert.equal(parsePlanEvent(JSON.stringify({ terminal: "t 1", file: "/x.md", at: 1 })), null);
  assert.equal(parsePlanEvent(JSON.stringify({ terminal: "t1", file: "rel.md", at: 1 })), null);
  assert.equal(parsePlanEvent(JSON.stringify({ terminal: "t1", file: "/x.md", at: "1" })), null);
});

test("colorOf is stable per path", () => {
  const palette = ["a", "b", "c"];
  assert.equal(colorOf("/w/droz", palette), colorOf("/w/droz", palette));
  assert.ok(palette.includes(colorOf("/w/x", palette)));
});

test("planTitle and ago match the plan viewer's", () => {
  assert.equal(planTitle("# Título\n"), "Título");
  assert.equal(ago(0, 90 * 60000), "1 h");
});

test("pool runs everything, at most n at once, past failures", async () => {
  let running = 0;
  let peak = 0;
  const done = [];
  await pool([1, 2, 3, 4, 5], 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setImmediate(r));
    running--;
    if (n === 3) throw new Error("falhou");
    done.push(n);
  });
  assert.equal(peak, 2);
  assert.deepEqual(done.sort(), [1, 2, 4, 5]);
});
