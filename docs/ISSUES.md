# Backlog (local)

Ordem: 1 → (2, 3 em paralelo) → 4 → 5 → 6 → 7 → 8 → 9 → 10. Marque `[x]` ao concluir.

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
