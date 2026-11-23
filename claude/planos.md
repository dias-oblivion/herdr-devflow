## Planos com diagramas mermaid

O usuário lê os planos no Herdr, num painel ao lado do terminal que desenha mermaid (layout `dev`, repo `herdr-devflow`). O painel lê `~/.claude/plans` e abre sozinho quando o `ExitPlanMode` é chamado (hook `herdr-plan-open.sh`). Por isso:

- Task do Jira, ou mudança que envolva mais de um componente: depois de investigar, entre no plan mode (`EnterPlanMode`), escreva o plano no arquivo que o plan mode indicar e peça aprovação com `ExitPlanMode`. O usuário lê no painel e aprova ou pede ajuste no menu do terminal.
- O plano fica no arquivo, não no chat. No chat vai só uma linha avisando que o plano está pronto. Se o usuário pedir ajuste, edite o mesmo arquivo e chame `ExitPlanMode` de novo.
- Dúvida que muda o plano vai antes, com `AskUserQuestion`, e não no fim do arquivo.
- Todo plano leva pelo menos um `flowchart` com a arquitetura ou o fluxo da solução.
- Quando ajudam, inclua também:
  - `sequenceDiagram` para chamadas entre serviços ou camadas;
  - `erDiagram` quando o schema muda;
  - `stateDiagram-v2` para máquinas de estado.
- Diagramas pequenos (até uns 15 nós), um assunto por diagrama.
- Rótulos em português e entre aspas (`A["Fila de envio"]`).
- Sem cores ou estilos próprios: o visualizador aplica o tema.
- O diagrama complementa o texto e não o substitui: o plano tem que fazer sentido também no terminal.
