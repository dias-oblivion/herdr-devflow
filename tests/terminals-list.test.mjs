import { test } from "node:test";
import assert from "node:assert/strict";
import { baseName, ownerOf, clean, kidStatus, duration, placeOf } from "../mods/terminals-list/lib.js";

test("placeOf names the checkout and a non-default branch", () => {
  const checkouts = ["/w/droz", "/w/droz-3228"];
  assert.equal(placeOf("/w/droz-3228/src", "feat/DZDEV-3228-x", "/h", checkouts), "droz-3228 · feat/DZDEV-3228-x");
  assert.equal(placeOf("/w/droz", "homolog", "/h", checkouts), "droz");
  assert.equal(placeOf("/h", null, "/h", checkouts), "~");
  assert.equal(placeOf("/h/Workspace", null, "/h", checkouts), "Workspace");
  assert.equal(placeOf(null, "x", "/h"), "");
});

test("ownerOf prefers the deepest checkout and ignores look-alike prefixes", () => {
  assert.equal(ownerOf("/w/droz-3228", ["/w/droz"]), null);
  assert.equal(ownerOf("/w/droz/.claude/worktrees/x/a", ["/w/droz", "/w/droz/.claude/worktrees/x"]), "/w/droz/.claude/worktrees/x");
  assert.equal(baseName("/w/a/"), "a");
});

test("clean drops an agent's status glyph but keeps brackets", () => {
  assert.equal(clean("✦  Working on it"), "Working on it");
  assert.equal(clean("⠋ - Thinking"), "Thinking");
  assert.equal(clean("[web] login"), "[web] login");
  assert.equal(clean("[ ! ] fix"), "fix");
  assert.equal(clean(null), "");
});

test("kidStatus maps error to blocked and done to idle", () => {
  const listed = new Map([["t2", "working"]]);
  assert.equal(kidStatus({ address: "t2", status: "idle" }, listed), "working");
  assert.equal(kidStatus({ address: "t3", status: "error" }, listed), "blocked");
  assert.equal(kidStatus({ address: "t4", status: "done" }, listed), "idle");
});

test("duration is short", () => {
  assert.equal(duration(30000), "<1m");
  assert.equal(duration(5 * 60000), "5m");
  assert.equal(duration(3 * 3600000), "3h");
  assert.equal(duration(2 * 86400000), "2d");
});
