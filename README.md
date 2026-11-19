# herdr-devflow

Um layout do [Herdr](https://herdr.dev) (`dev`) para trabalhar com Claude Code em worktrees:

- **Projetos**: repos fixos na barra lateral, com as worktrees do git aninhadas. Uma worktree nova aparece sozinha. Clicar num repo ou numa worktree abre o **diff e os commits no centro** (github-diff), sem abrir terminal. Cada linha mostra os arquivos não commitados (●N), ↑↓ e se tem um agente trabalhando ali (girando, ou "!" quando precisa de você). O botão direito abre o menu: terminal ou Claude naquela pasta, commits, PR no GitHub, copiar caminho, remover.
- **Planos**: os planos de `~/.claude/plans`. Clicar abre o plano no painel direito.
- **Terminais**: todos os terminais abertos no Herdr, com a pasta e a branch atuais. O **+** abre um shell e o ✦ abre um Claude, os dois em `~/Workspace` (no space "Terminais").
- **Plano ao lado do terminal**: quando o Claude pede aprovação de um plano (`ExitPlanMode`), um hook avisa o Herdr e o plano abre no painel ao lado daquele terminal. Os **mermaid vêm desenhados**: clique para ampliar, "código" mostra a fonte. Você lê o plano e aprova com Enter no terminal, como sempre.

## Teclas (só no layout dev)

| Tecla | O que faz |
|---|---|
| `ctrl-shift-d` | alterna terminal e diff. Saindo do terminal, mostra o diff da worktree onde ele está |
| `ctrl-shift-m` | abre e fecha o painel do plano |
| `ctrl-shift-t` | abre um terminal novo em `~/Workspace` |
| `ctrl-shift-a` | abre um Claude novo em `~/Workspace` |
| `esc` (no diff) | volta para o terminal |

## Peças

| Pasta | O que é |
|---|---|
| `mods/projects` | barra lateral de cima: Projetos e Planos, mais a ponte do hook (abre o plano ao lado do terminal) |
| `mods/terminals-list` | barra lateral de baixo: os terminais |
| `mods/plan-viewer` | painel do plano: markdown e mermaid desenhados |
| `mods/tabs-dev` | barra de abas, cópia do `tabs-diff` com o botão "Plano" e sem memória de painel por space |
| `layouts/dev.json` | o layout: o centro é um stack `work-main` (`term` ou `diff`), e o painel `panel-body` ganhou o filho `plan` |
| `mermaid/` | `herdr-mermaid`: desenha os blocos em PNG com mermaid-cli e o Google Chrome do sistema, tudo local |
| `hooks/herdr-plan-open.sh` | hook `PreToolUse` do `ExitPlanMode`: grava `~/.local/state/herdr-devflow/plans/<terminal>.json` |

O diff no centro precisa do github-diff com o modo `follow` (repo `herdr-github-diff`).

## Instalar e atualizar

```sh
sh install.sh
herdr-app do layout.switch --name dev
```

Para rodar os testes: `node --test tests/*.test.mjs`. Para validar um mod: `herdr-app check mods/<nome>`.

## Desfazer

- Para voltar ao layout anterior, use `ctrl-shift-l` ou `herdr-app do layout.switch --name main-reviewer`.
- Hook: tire do `~/.claude/settings.json` a entrada `PreToolUse` com `matcher: "ExitPlanMode"`. Há um backup `settings.json.bak-herdr-devflow-*`.
- Teclas: apague a seção `"layout:dev"` do `~/.config/herdr-app/keys.json`.
- Arquivos: `~/.config/herdr-app/mods/{projects,terminals-list,plan-viewer,tabs-dev}`, `~/.config/herdr-app/layouts/dev.json`, `~/.config/herdr-app/plan-cache`, `~/.local/share/herdr-devflow`, `~/.local/bin/herdr-mermaid` e `~/.claude/scripts/herdr-plan-open.sh`.
