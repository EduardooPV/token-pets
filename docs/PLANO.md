# Token Pets: app de bandeja com agentezinhos que mostram o uso do Claude e do Codex

## Contexto
O Duds roda várias sessões, agentes e subagentes do Claude Code e do Codex ao longo do dia e não tem uma visão
rápida de quanto já gastou do limite de 5h e do semanal de cada ferramenta. O objetivo é um app do Windows
que inicia junto com o sistema, fica na bandeja, gasta pouca RAM e CPU e mostra esse uso de forma divertida:
cada sessão ou subagente ativo vira um bonequinho em pixel art com animações.

Projeto pessoal, **fora** do workspace `diagnos/`: pasta `C:\Users\Eduar\Documents\projects\token-pets`.
O repo no GitHub (`token-pets`) e as issues só serão criados quando o Duds pedir explicitamente.

## Decisões fechadas
| Tema | Decisão |
|---|---|
| Stack | Tauri 2 (Rust) + TypeScript (Vite, sem framework de UI, para ficar leve) |
| Visual | Bandeja + popup por padrão; pet flutuante opcional (liga/desliga no menu) |
| Bonecos | 1 por sessão ou subagente ativo; até ~8 visíveis, o resto agrupado em "+N" |
| Arte | Pixel art original gerada em código (sem logos da Anthropic ou da OpenAI): "claudezinho" laranja e "codexzinho" |
| % do Claude | Estimativa local sempre visível; o endpoint da conta substitui pelo número exato quando responde (chave liga/desliga, ligada por padrão) |
| Codex parado | Mostra o último % e há quanto tempo foi lido; se o horário de reset já passou, zera a barra e marca "renovado" |
| Avisos | Toast em 80% e 95% (5h e semanal, por ferramenta), aviso de reset, aviso de agente que terminou ou espera você, sons curtos (desligados por padrão) |
| Histórico | SQLite pequeno; gráfico de 7 dias e projeção de ritmo ("nesse ritmo o semanal acaba quinta 14h") |
| Recursos (moderado) | Só bandeja: ≤50 MB de RAM e ~0% de CPU. Popup ou pet aberto: ≤200 MB e <5% de CPU em média |

## Fontes de dados (conferidas nesta máquina)
- **Codex:** `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl` traz eventos `event_msg` → `token_count` com
  `rate_limits.primary` (5h: `used_percent`, `window_minutes=300`, `resets_at`), `secondary` (semanal: 10080 min)
  e `plan_type`. Tokens em `info.total_token_usage`.
- **Claude, tokens:** `~/.claude/projects/<proj>/*.jsonl`. As mensagens do assistente trazem `usage` (input,
  cache_creation, cache_read, output) e o modelo. Os subagentes aparecem nas chamadas da ferramenta Task/Agent
  (o `subagent_type` define a fantasia). Confirmar na issue 3 onde ficam os transcripts dos subagentes.
- **Claude, % do plano:** só pelo endpoint de uso da conta (o mesmo dado do `/usage`), consultado a cada 5 min
  com o token OAuth de `~/.claude/.credentials.json`.
  Regras: só leitura; **nunca renovar o token** (renovar troca o token e pode deslogar o Claude Code); nunca
  registrar em log, exibir ou gravar o token. Se receber 401 ou erro, cai para a estimativa e mostra o aviso
  "exato indisponível".
- **Sessão ativa:** arquivo modificado há menos de 90 s = trabalhando; de 90 s a 10 min = parado ou esperando
  você; mais de 10 min = some. O rótulo vem do título da sessão, quando houver, ou da pasta (`cwd`) + início do
  primeiro prompt.

## Arquitetura
- **Rust (núcleo, sempre ligado):**
  - `watcher`: crate `notify` sobre as duas pastas, com debounce de 1 s. Lê só o trecho novo de cada arquivo
    (guarda o offset de cada um); nunca reprocessa o arquivo inteiro e não faz varredura periódica.
  - `collectors/codex.rs`, `collectors/claude_local.rs`, `collectors/claude_api.rs` alimentam um `State`
    único (limites, sessões e tokens).
  - `store.rs`: rusqlite, uma amostra a cada 5 min ou quando o valor muda, retenção de 30 dias.
  - `pace.rs`: projeção de quando o limite acaba, pela regressão das últimas amostras.
  - `tray.rs`: ícone com um anel de % do maior uso e um rosto em 3 humores. Ícones PNG pré-renderizados, trocados
    só quando o estado muda. Menu: Abrir, Pet on/off, Sons, % exato do Claude on/off, Iniciar com o Windows, Sair.
  - Plugins: `autostart`, `notification`, `single-instance`.
- **UI (WebView2, criada sob demanda):**
  - O popup é criado ao clicar e **destruído ao fechar**, para liberar a RAM do WebView.
  - Pet: janela transparente, sempre no topo, acima da barra de tarefas, que deixa o clique passar fora dos
    bonecos.
  - Motor de sprites em `<canvas>`, limitado a 12 fps, que pausa quando a janela não está visível
    (`visibilitychange`).
  - Estados de animação: ocioso, trabalhando, esperando você, cansado (≥80%), exausto (≥95%), dormindo (fora de
    uso) e comemorando (reset). Fantasias por tipo de subagente: lupa (code-reviewer), escudo (security-probe),
    caneta (copywriter), mapa (codebase-explorer) e um genérico para os demais.
  - Sons: WAVs curtos, tocados só com a janela visível.

## Issues (rascunho; criar no GitHub só com pedido explícito)
1. **Base do projeto:** scaffold do Tauri 2 + TS, ícone na bandeja, instância única, autostart, CI (fmt, clippy,
   cargo test, tsc, vitest). *Aceite:* instala, inicia com o Windows, ícone na bandeja, ≤50 MB ocioso.
2. **Coletor do Codex:** leitura incremental do `token_count` e dos `rate_limits`. *Aceite:* % igual ao do
   arquivo mais recente; zera após `resets_at`; "lido há X" correto; linha parcial ou arquivo novo sem erro.
3. **Coletor local do Claude e detecção de sessões:** tokens por sessão e modelo, sessões ativas e subagentes
   com tipo. *Aceite:* uma sessão real aparece em até 3 s; subagentes listados com tipo; some após 10 min parada.
4. **% exato do Claude:** consulta ao endpoint a cada 5 min, chave liga/desliga, fallback. *Aceite:* % bate com
   o `/usage`; o token nunca aparece em log ou arquivo (grep nos logs e no SQLite); com 401 cai para a estimativa
   sem travar.
5. **Histórico e ritmo:** SQLite, retenção e projeção. *Aceite:* gráfico de 7 dias com dados reais; projeção
   coerente em fixture sintética.
6. **Sprites e motor de animação:** pixel art dos 7 estados × 2 personagens + fantasias. *Aceite:* cada estado
   do `State` mapeia para uma animação (teste unitário); 12 fps; pausa quando oculto.
7. **Popup:** barras de 5h e semanal por ferramenta (exata ou estimada, com a idade do dado), bonecos das sessões
   e gráfico. *Aceite:* abre em menos de 1 s; ao fechar, a RAM volta ao patamar ocioso.
8. **Pet flutuante:** janela transparente que deixa o clique passar e bonecos andando. *Aceite:* não rouba foco
   nem clique; ≤200 MB e <5% de CPU médio em 10 min.
9. **Avisos e sons:** toasts de 80/95%, reset e agente parado, com anti-spam (1 aviso por limiar por janela) e
   sons opcionais. *Aceite:* cada aviso dispara uma única vez por evento em teste com fixture.
10. **Desempenho e instalador:** script que mede RAM e CPU (Working Set + CPU via PowerShell) por 10 min em cada
    modo; instalador NSIS sem assinatura (o SmartScreen vai avisar). *Aceite:* metas do modo moderado atingidas
    e registradas no README.

Ordem: 1 → (2, 3 em paralelo) → 4 → 5 → 6 → 7 → 8 → 9 → 10.

## Testes e verificação
- **Rust:** testes unitários dos parsers com fixtures JSONL sanitizadas (sem tokens nem conteúdo real), cobrindo
  linha parcial, arquivo novo no meio da leitura, `resets_at` vencido, JSON inválido e pasta inexistente.
- **TS:** Vitest para o mapeamento de estado para animação, a formatação das barras e o anti-spam dos avisos.
- **Manual ponta a ponta:** abrir uma sessão do Claude e outra do Codex, conferir os bonecos e os % contra o
  `/usage` e o Codex, reiniciar o Windows e conferir o autostart.
- **Segurança:** grep pelo token em logs, no SQLite e no bundle; o app não lê nenhum `.env`; a única saída de
  rede permitida é para api.anthropic.com.

## Riscos
- O endpoint de uso do Claude não é documentado e pode mudar. Nesse caso o app continua funcionando só com a
  estimativa.
- O formato dos JSONL do Claude e do Codex pode mudar entre versões. Os parsers toleram campos novos ou
  ausentes e registram o aviso no log.
- A estimativa local do Claude é imprecisa, porque o limite é medido em custo por modelo, não em tokens. Por isso
  ela é sempre rotulada como "estimado".
