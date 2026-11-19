// Pure helpers for plan-viewer. No herdr imports: `node --test` runs them as they are.

// An opening fence: up to 3 spaces, ``` or ~~~ (3+), then the info string's first word.
const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;

/**
 * Splits a plan into markdown text and mermaid diagrams, in order:
 * [{ kind: "md", text }, { kind: "mermaid", code }]. Other fenced blocks stay in the
 * text (a ```mermaid inside a ````md block too); an unclosed fence runs to the end.
 */
export function splitPlan(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let md = [];
  const flush = () => {
    const joined = md.join("\n");
    if (joined.trim()) out.push({ kind: "md", text: joined });
    md = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(OPEN);
    if (!open) { md.push(lines[i]); continue; }
    const fence = open[1];
    const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (open[2].toLowerCase() === "mermaid") {
      flush();
      const code = lines.slice(i + 1, end).join("\n").trim();
      if (code) out.push({ kind: "mermaid", code });
    } else {
      md.push(...lines.slice(i, end + 1));
    }
    i = end;
  }
  flush();
  return out;
}

/** 16 hex chars from two 32-bit FNV-style mixes: a cache key, not a security hash. */
export function hashText(s) {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The cache key of a diagram drawn in a theme ("dark" | "default"). */
export const diagramHash = (code, theme) => hashText(`${theme}\n${code}`);

/** The plan's first H1, else null. */
export function planTitle(text) {
  const m = String(text ?? "").match(/^#[ \t]+(.+?)[ \t#]*$/m);
  return m ? m[1].trim() : null;
}

/** "agora", "5 min", "3 h", "2 d": how long since `then` (ms), at `now`. */
export function ago(then, now = Date.now()) {
  const m = Math.floor(Math.max(0, now - then) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** A diagram's size on screen: its own size, shrunk to fit `room` px wide. */
export function fitSize(width, height, room) {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0 };
  const w = Math.max(1, Math.min(width, room > 0 ? room : width));
  return { width: Math.round(w), height: Math.round((height * w) / width) };
}
