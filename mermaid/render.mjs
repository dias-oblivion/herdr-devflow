// herdr-mermaid: draws mermaid blocks to PNG with one headless Chrome.
//
// Usage: node render.mjs <job.json>
//   job: { "theme": "dark" | "default", "out": "/abs/dir", "items": [{ "hash": "ab12", "code": "flowchart LR ..." }] }
// Prints one JSON line: [{ "hash", "file", "width", "height", "error" }], sizes in logical px.
// A block that fails to parse gets its error and doesn't stop the others.
// Already drawn blocks (<out>/<hash>.png present) are only measured.

import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { renderMermaid } from "@mermaid-js/mermaid-cli";

const SCALE = 2; // device pixels per logical px: crisp on HiDPI, halved back when shown
const WIDTH = 1200; // viewport width the layout engine gets; wide diagrams stay wide
const CHROME = process.env.HERDR_MERMAID_CHROME || "/usr/bin/google-chrome";
const HASH = /^[0-9a-f]{6,64}$/;

// PNG keeps its pixel size in the IHDR chunk, right after the 8-byte signature.
function pngSize(bytes) {
  const view = Buffer.from(bytes);
  return { width: view.readUInt32BE(16) / SCALE, height: view.readUInt32BE(20) / SCALE };
}

const exists = (path) => access(path).then(() => true, () => false);

function shortError(e) {
  const text = String(e?.message ?? e);
  // mermaid's parse errors carry the useful part first; puppeteer adds a stack after it.
  return text.split("\n")
    .filter((l) => l.trim() && !/^\s+at /.test(l) && !/mermaid-cli-intercept|^\w+\.\w+ \(/.test(l))
    .slice(0, 6).join("\n");
}

async function main() {
  const job = JSON.parse(await readFile(process.argv[2], "utf8"));
  const items = Array.isArray(job.items) ? job.items.filter((i) => HASH.test(i?.hash ?? "") && typeof i.code === "string") : [];
  await mkdir(job.out, { recursive: true });
  const results = [];
  const todo = [];
  for (const item of items) {
    const file = join(job.out, `${item.hash}.png`);
    if (await exists(file)) results.push({ hash: item.hash, file, ...pngSize(await readFile(file)), error: null });
    else todo.push({ ...item, file });
  }
  if (todo.length) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--disable-gpu"] });
    try {
      for (const item of todo) {
        try {
          const { data } = await renderMermaid(browser, item.code, "png", {
            viewport: { width: WIDTH, height: 800, deviceScaleFactor: SCALE },
            backgroundColor: "transparent",
            mermaidConfig: { theme: job.theme === "default" ? "default" : "dark", securityLevel: "strict" },
          });
          const tmp = `${item.file}.tmp`;
          await writeFile(tmp, data);
          await rename(tmp, item.file);
          results.push({ hash: item.hash, file: item.file, ...pngSize(data), error: null });
        } catch (e) {
          results.push({ hash: item.hash, file: null, width: 0, height: 0, error: shortError(e) });
        }
      }
    } finally {
      await browser.close();
    }
  }
  process.stdout.write(JSON.stringify(results) + "\n");
}

main().catch((e) => {
  process.stderr.write(`herdr-mermaid: ${shortError(e)}\n`);
  process.exit(1);
});
