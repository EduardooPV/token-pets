# Backlog (local)

## Status da implementação (branch `feat/electron`)

**Mudança de stack:** o plano original usava Tauri + Rust, mas o Smart App Control do Windows desta máquina bloqueia as
DLLs de proc-macro sem assinatura (erro 4551), então o Rust não compila aqui. A implementação foi refeita em
**Electron + TypeScript** (o `electron.exe` oficial roda normalmente sob o Smart App Control). O código Tauri/Rust ficou
só no histórico da branch `feat/mvp`.

Verificado nesta máquina: `tsc` limpo, 79 testes Vitest passando (inclui testes de ponta a ponta do motor com
arquivos temporários), app rodando de verdade (`electron .` e o empacotado `release/win-unpacked`), popup lendo
dados reais e capturado por CDP, pet criado e renderizado, medição de RAM e CPU.

| # | Status | Observações |
|---|---|---|
| 1 Base | feito | bandeja, instância única, autostart (só empacotado), CI, ZIP + `scripts/install.ps1`. O instalador NSIS falha aqui (o gerador dele é um .exe sem reputação). Autostart empacotado **não testado**. |
| 2 Codex | feito | `src/core/codex.ts`; % real (69% / 94%) conferido contra o log. |
| 3 Claude local + sessões | feito | `claudeLocal.ts`, `sessions.ts`, `engine.ts`; sessão real apareceu com o título correto. Subagentes só testados com arquivos de teste. |
| 4 % exato | **parcial** | Código e testes ok, mas o token do `~/.claude/.credentials.json` está expirado e o app **não renova** por segurança ("login expirado"), então a chamada ao endpoint nunca foi feita de verdade. Sem leitura exata, a calibração do teto não acontece. |
| 5 Histórico e ritmo | feito | SQLite (`node:sqlite`), `pace.ts`; o gráfico ainda está vazio (histórico começa agora). |
| 6 Sprites e motor | feito | 7 estados × 2 personagens + 5 fantasias, conferidos visualmente; 12 fps, pausa quando oculto. |
| 7 Popup | feito | abre em ~1 s, destruído ao fechar. |
| 8 Pet | feito | janela transparente que ignora o mouse; visto via CDP, **não** conferido visualmente sobre a área de trabalho. |
| 9 Avisos e sons | feito nos testes | lógica testada em `alerts.test.ts`; toast do Windows e som **não** observados. |
| 10 Medição e instalador | parcial | Medido (dev, 1 a 2 min por modo, não 10): ver tabela abaixo. Instalador = ZIP + script. |

Consumo medido (`electron .`, GPU desligada, 12 CPUs lógicas):

| Modo | RAM privada (média) | CPU (média) |
|---|---|---|
| Só bandeja | ~59 MB (1 min; antes de desligar a GPU eram ~96 MB) | ~0,1% |
| Pet aberto (1 sessão) | ~88 MB (2 min) | ~1% |
| Popup aberto | não medido | não medido |

A meta original (≤50 MB na bandeja) não é atingida com Electron; a meta "moderada" para o pet (≤200 MB, <5% CPU) é.

Diferenças em relação ao plano original:
- Sons são sintetizados com WebAudio (sem arquivos WAV).
- O pet não é clicável nem arrastável (a janela ignora o mouse por inteiro); abre-se o painel pela bandeja.
- A deduplicação de avisos fica em `alerts.ts`, testada no Vitest.
- O teto da estimativa do Claude começa com valores chute (`DEFAULT_CAP_*` em `src/core/engine.ts`; hoje mostra
  56% / 51%) e só se calibra quando uma leitura exata chegar.

Ordem original: 1 → (2, 3 em paralelo) → 4 → 5 → 6 → 7 → 8 → 9 → 10.

## [ ] 1. Base do projeto
Scaffold Tauri 2 + TS (Vite), ícone na bandeja, instância única, autostart, CI (fmt, clippy, cargo test, tsc, vitest).
**Aceite:** instala; inicia com o Windows; ícone na bandeja; ≤50 MB de RAM ocioso.

## [ ] 2. Coletor do Codex
Leitura incremental de `token_count` e `rate_limits` em `~/.codex/sessions`.
**Aceite:** % igual ao do arquivo mais recente; zera após `resets_at` e marca "renovado"; "lido há X" correto; linha parcial ou arquivo novo sem erro.

## [ ] 3. Coletor local do Claude e detecção de sessões
Tokens por sessão e modelo, sessões ativas, subagentes com tipo (confirmar onde ficam os transcripts de subagentes).
**Aceite:** sessão real aparece em até 3 s; subagentes listados com tipo; some após 10 min parada (<90 s trabalhando, 90 s a 10 min esperando).

## [ ] 4. % exato do Claude
Consulta ao endpoint de uso a cada 5 min, chave liga/desliga, fallback para estimativa. Nunca renovar, logar, exibir ou gravar o token.
**Aceite:** % bate com o `/usage`; grep pelo token em logs e SQLite não acha nada; 401 cai para a estimativa sem travar.

## [ ] 5. Histórico e ritmo
SQLite (amostra a cada 5 min ou quando muda, retenção 30 dias) e projeção de quando o limite acaba.
**Aceite:** gráfico de 7 dias com dados reais; projeção coerente em fixture sintética.

## [ ] 6. Sprites e motor de animação
Pixel art original: 7 estados × 2 personagens + fantasias por tipo de subagente. Canvas a 12 fps, pausa quando oculto.
**Aceite:** cada estado do `State` mapeia para uma animação (teste unitário); 12 fps; pausa quando oculto.

## [ ] 7. Popup
Barras de 5h e semanal por ferramenta (exata ou estimada, com idade do dado), bonecos das sessões e gráfico. Criado ao clicar, destruído ao fechar.
**Aceite:** abre em <1 s; ao fechar, a RAM volta ao patamar ocioso.

## [ ] 8. Pet flutuante
Janela transparente, sempre no topo, com clique passando fora dos bonecos; liga/desliga no menu.
**Aceite:** não rouba foco nem clique; ≤200 MB e <5% de CPU médio em 10 min.

## [ ] 9. Avisos e sons
Toasts de 80/95% (5h e semanal, por ferramenta), reset e agente parado, com anti-spam; sons opcionais (desligados por padrão).
**Aceite:** cada aviso dispara uma única vez por evento em teste com fixture.

## [ ] 10. Desempenho e instalador
Script que mede RAM e CPU por 10 min em cada modo; instalador NSIS sem assinatura (SmartScreen vai avisar).
**Aceite:** metas do modo moderado atingidas e registradas no README.
