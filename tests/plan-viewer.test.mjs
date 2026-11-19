import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPlan, hashText, diagramHash, planTitle, ago, fitSize } from "../mods/plan-viewer/lib.js";

test("splitPlan keeps text and diagrams in order", () => {
  const plan = "# Plano\n\nintro\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nfim";
  assert.deepEqual(splitPlan(plan), [
    { kind: "md", text: "# Plano\n\nintro\n" },
    { kind: "mermaid", code: "flowchart LR\n  A --> B" },
    { kind: "md", text: "\nfim" },
  ]);
});

test("splitPlan leaves other fenced blocks in the text", () => {
  const plan = "a\n```js\nconst x = 1;\n```\nb";
  assert.deepEqual(splitPlan(plan), [{ kind: "md", text: plan }]);
});

test("splitPlan ignores a mermaid fence inside a longer fence", () => {
  const plan = "````md\n```mermaid\nflowchart LR\n```\n````";
  assert.deepEqual(splitPlan(plan), [{ kind: "md", text: plan }]);
});

test("splitPlan handles tildes, CRLF and an unclosed fence", () => {
  assert.deepEqual(splitPlan("x\r\n~~~mermaid\r\ngraph TD\r\n~~~\r\n"), [
    { kind: "md", text: "x" },
    { kind: "mermaid", code: "graph TD" },
  ]);
  assert.deepEqual(splitPlan("```mermaid\nsequenceDiagram\n  A->>B: oi"), [
    { kind: "mermaid", code: "sequenceDiagram\n  A->>B: oi" },
  ]);
});

test("splitPlan drops empty diagrams and empty input", () => {
  assert.deepEqual(splitPlan("```mermaid\n\n```"), []);
  assert.deepEqual(splitPlan(""), []);
  assert.deepEqual(splitPlan(undefined), []);
});

test("hashText is stable, 16 hex chars, and sensitive to content", () => {
  assert.match(hashText("abc"), /^[0-9a-f]{16}$/);
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abd"));
  assert.notEqual(diagramHash("graph TD", "dark"), diagramHash("graph TD", "default"));
});

test("planTitle takes the first H1", () => {
  assert.equal(planTitle("intro\n# Título do plano ##\n## sub"), "Título do plano");
  assert.equal(planTitle("## só subtítulo"), null);
});

test("ago speaks in minutes, hours and days", () => {
  const now = 10 * 86400000;
  assert.equal(ago(now - 20000, now), "agora");
  assert.equal(ago(now - 5 * 60000, now), "5 min");
  assert.equal(ago(now - 3 * 3600000, now), "3 h");
  assert.equal(ago(now - 2 * 86400000, now), "2 d");
  assert.equal(ago(now + 5000, now), "agora");
});

test("fitSize shrinks to the room and keeps the aspect", () => {
  assert.deepEqual(fitSize(400, 200, 1000), { width: 400, height: 200 });
  assert.deepEqual(fitSize(400, 200, 200), { width: 200, height: 100 });
  assert.deepEqual(fitSize(0, 200, 200), { width: 0, height: 0 });
  assert.deepEqual(fitSize(400, 200, 0), { width: 400, height: 200 });
});
