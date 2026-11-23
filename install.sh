#!/bin/sh
# herdr-devflow installer. Run it again to update; every step replaces only what it owns.
#
#  - mods projects, terminals-list, plan-viewer, tabs-dev  → ~/.config/herdr-app/mods/<name>
#  - layout dev                                           → ~/.config/herdr-app/layouts/dev.json
#  - keys for the dev layout ("layout:dev" in keys.json), only the ones not taken there
#  - herdr-mermaid: mermaid-cli + the system's Google Chrome → ~/.local/share/herdr-devflow/mermaid,
#    wrapper ~/.local/bin/herdr-mermaid
#  - the ExitPlanMode hook → ~/.claude/scripts/herdr-plan-open.sh, registered in ~/.claude/settings.json
#    (a backup of settings.json is kept next to it first)
#  - the plan instruction for Claude → ~/.claude/herdr-devflow-planos.md, imported from ~/.claude/CLAUDE.md
#    (same backup rule)
#
# Needs: herdr-app, python3, jq, node >= 18 with npm, Google Chrome (or HERDR_MERMAID_CHROME).
# Usage: sh install.sh            (HERDR_APP_HOME / CLAUDE_HOME pick other homes)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
claude=${CLAUDE_HOME:-$HOME/.claude}
share=$HOME/.local/share/herdr-devflow/mermaid
bin=$HOME/.local/bin
mods="projects terminals-list plan-viewer tabs-dev"

need() { command -v "$1" >/dev/null 2>&1 || { echo "$1 não está no PATH: $2" >&2; exit 1; }; }
need herdr-app "instale o Herdr primeiro (https://herdr.dev)"
need python3 "o instalador edita JSON com ele"
need jq "o hook do plano usa jq"
[ -d "$app" ] || { echo "Não achei $app. Abra o Herdr uma vez e rode de novo." >&2; exit 1; }

# node: the newest nvm v2x when there (Herdr's exec and hooks may not load nvm), else PATH.
node=""
for n in "$HOME"/.nvm/versions/node/v2[0-9]*/bin/node; do [ -x "$n" ] && node=$n; done
[ -n "$node" ] || node=$(command -v node) || { echo "node não encontrado" >&2; exit 1; }
npm="$(dirname "$node")/npm"
[ -x "$npm" ] || npm=$(command -v npm) || { echo "npm não encontrado" >&2; exit 1; }

echo "→ testes"
"$node" --test "$here"/tests/*.test.mjs >/dev/null 2>&1 || { "$node" --test "$here"/tests/*.test.mjs; exit 1; }

echo "→ renderizador de mermaid"
mkdir -p "$share" "$bin"
if [ ! -d "$share/node_modules/@mermaid-js/mermaid-cli" ]; then
  (
    cd "$share"
    [ -f package.json ] || PATH="$(dirname "$node"):$PATH" "$npm" init -y >/dev/null
    PUPPETEER_SKIP_DOWNLOAD=1 PATH="$(dirname "$node"):$PATH" "$npm" i --no-audit --no-fund @mermaid-js/mermaid-cli >/dev/null
  )
fi
cp "$here/mermaid/render.mjs" "$share/render.mjs"
cp "$here/mermaid/herdr-mermaid" "$bin/herdr-mermaid"
chmod +x "$bin/herdr-mermaid"

echo "→ mods"
for m in $mods; do
  dest=$app/mods/$m
  if [ -L "$dest" ]; then echo "$dest é um symlink; remova antes (o Herdr não recarrega mod com link)." >&2; exit 1; fi
  mkdir -p "$dest"
  # Drop the mod's old files, keep what Herdr writes there itself, then copy the new ones.
  find "$dest" -mindepth 1 -maxdepth 1 ! -name jsconfig.json ! -name gpui-kit.d.ts ! -name herdr.d.ts -exec rm -rf {} +
  cp -R "$here/mods/$m/." "$dest/"
  herdr-app check "$dest" >/dev/null 2>&1 || { herdr-app check "$dest"; exit 1; }
  echo "  $m"
done

echo "→ layout dev"
cp "$here/layouts/dev.json" "$app/layouts/dev.json"

echo "→ teclas do layout dev"
python3 -I - "$app/keys.json" <<'PY'
import json, os, sys
path = sys.argv[1]
want = {
    "ctrl-shift-d": "projects.toggle-main",
    "ctrl-shift-m": "projects.toggle-plan",
    "ctrl-shift-t": "terminals-list.new",
    "ctrl-shift-a": "terminals-list.claude",
}
keys = json.load(open(path)) if os.path.exists(path) else {}
section = keys.setdefault("layout:dev", {})
changed = False
for key, action in want.items():
    if key in section and section[key] != action:
        print(f"  {key} já faz '{section[key]}' no layout dev; mantive")
    elif key not in section:
        section[key] = action
        changed = True
if changed:
    tmp = path + ".herdr-devflow.tmp"
    with open(tmp, "w") as f:
        f.write(json.dumps(keys, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
print("  ok")
PY

echo "→ hook do plano"
mkdir -p "$claude/scripts"
cp "$here/hooks/herdr-plan-open.sh" "$claude/scripts/herdr-plan-open.sh"
chmod +x "$claude/scripts/herdr-plan-open.sh"
python3 -I - "$claude/settings.json" "$claude/scripts/herdr-plan-open.sh" <<'PY'
import json, os, shutil, sys, time
path, command = sys.argv[1], sys.argv[2]
real = os.path.realpath(path)  # settings.json may be a symlink (shared profiles): edit its target
settings = json.load(open(real))
entries = settings.setdefault("hooks", {}).setdefault("PreToolUse", [])
if any(h.get("command") == command for e in entries for h in e.get("hooks", [])):
    print("  já registrado")
    sys.exit(0)
shutil.copy2(real, f"{real}.bak-herdr-devflow-{int(time.time())}")
entries.append({"matcher": "ExitPlanMode", "hooks": [{"type": "command", "command": command, "timeout": 10}]})
tmp = real + ".herdr-devflow.tmp"
with open(tmp, "w") as f:
    f.write(json.dumps(settings, indent=2, ensure_ascii=False) + "\n")
shutil.copymode(real, tmp)
os.replace(tmp, real)
print("  registrado (backup ao lado do settings.json)")
PY

echo "→ instrução de planos para o Claude"
cp "$here/claude/planos.md" "$claude/herdr-devflow-planos.md"
python3 -I - "$claude/CLAUDE.md" "$claude/herdr-devflow-planos.md" "$HOME" <<'PY'
import os, shutil, sys, time
path, target, home = sys.argv[1], sys.argv[2], sys.argv[3]
ref = "@" + ("~" + target[len(home):] if target.startswith(home + os.sep) else target)
real = os.path.realpath(path)
original = open(real).read() if os.path.exists(real) else ""
if ref in original.splitlines():
    print("  já importada")
    sys.exit(0)
tmp = real + ".herdr-devflow.tmp"
with open(tmp, "w") as f:
    f.write((original.rstrip("\n") + "\n\n" if original else "") + ref + "\n")
if original:
    shutil.copy2(real, f"{real}.bak-herdr-devflow-{int(time.time())}")
    shutil.copymode(real, tmp)
os.replace(tmp, real)
print("  importada no CLAUDE.md (backup ao lado)" if original else "  CLAUDE.md criado com o import")
PY

echo
echo "Pronto. Para usar: herdr-app do layout.switch --name dev   (ou ctrl-shift-l até chegar nele)"
