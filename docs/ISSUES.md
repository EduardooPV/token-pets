# Backlog (local)

## Status da implementação (branch `feat/mvp`)

Bloqueio: o Windows desta máquina está com **Smart App Control em modo "aplicar"**, que impede o `rustc` de carregar
as DLLs de proc-macro sem assinatura (`serde_derive`, erro 4551). Por isso **nenhum código Rust foi compilado nem
testado ainda**. O front-end (TypeScript) está com `tsc` e Vitest verdes e o popup foi conferido no navegador com dados
de exemplo. Quando o Smart App Control for desligado: `cargo test`, `pnpm tauri dev` e depois os critérios de
aceite abaixo, na ordem.

| # | Código escrito | Verificado |
|---|---|---|
| 1 Base | sim (`lib.rs`, `tray.rs`, `windows.rs`, CI) | não (Rust não compila aqui) |
| 2 Codex | sim (`collectors/codex.rs`, testes) | não |
| 3 Claude local + sessões | sim (`claude_local.rs`, `sessions.rs`, `engine.rs`, testes) | não |
| 4 % exato | sim (`claude_api.rs`, calibração em `engine.rs`) | não; o endpoint nunca foi chamado de verdade |
| 5 Histórico e ritmo | sim (`store.rs`, `pace.rs`, `popup/chart.ts`) | gráfico visto com dados de exemplo; Rust não |
| 6 Sprites e motor | sim | **sim** (Vitest + inspeção visual dos 7 estados × 2 personagens + 5 fantasias) |
| 7 Popup | sim | layout visto no navegador com dados de exemplo; não no Tauri |
| 8 Pet | sim (`pet/main.ts`, `sync_pet`) | não |
| 9 Avisos e sons | sim (`alerts.rs`, `sounds.ts`) | testes Rust escritos, não executados |
| 10 Medição e instalador | `scripts/measure.ps1` escrito | nenhuma medição feita; instalador não gerado |

Diferenças em relação ao plano original:
- Sons são sintetizados com WebAudio (sem arquivos WAV).
- O pet não é clicável nem arrastável (a janela ignora o mouse por inteiro); abre-se o painel pela bandeja.
- A deduplicação de avisos fica no Rust (`alerts.rs`), não no Vitest.
- Teto da estimativa do Claude começa com valores chute (`DEFAULT_CAP_*` em `engine.rs`) e se calibra sozinho
  na primeira leitura exata.

Ordem: 1 → (2, 3 em paralelo) → 4 → 5 → 6 → 7 → 8 → 9 → 10. Marque `[x]` só depois de verificar o critério de aceite.

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
