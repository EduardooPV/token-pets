# Token Pets

App de bandeja do Windows que mostra quanto você já gastou dos limites de **5 horas** e **semanal** do
**Claude** e do **Codex**, com bonequinhos em pixel art: um por sessão ou subagente ativo.

## Baixar e usar

1. Abra a página de [Releases](../../releases/latest) e baixe `Token-Pets-<versão>-win.exe`.
2. Abra o arquivo. Instala só para o seu usuário (sem administrador), cria o atalho **Token Pets** no Menu
   Iniciar e começa a rodar. Sem instalar? Use o `.zip`: extraia e rode `Token Pets.exe`.
3. O Windows pode avisar "O Windows protegeu seu PC", porque o app **não é assinado digitalmente** (certificado
   custa caro para projeto aberto). Clique em **Mais informações → Executar assim mesmo**.

Requisitos: Windows 10/11 (64 bits). O app lê as pastas do Claude Code e do Codex se elas existirem; sem elas
ele abre normalmente e só não tem o que mostrar.

Na primeira vez o popup e os bonecos aparecem sozinhos. Depois o app vive na bandeja (ícone perto do relógio,
às vezes dentro do "^"). Clique no ícone para abrir o popup; clique direito para o menu (pet flutuante, sons,
% exato do Claude, iniciar com o Windows, sair).

### Os bonecos
- **Arraste** um boneco e solte: ele cai e pousa na barra de tarefas. Dá para arremessar.
- **Clique** para ver o balão (sessão, estado, tokens). **Duplo clique** abre o popup.
- Cada agente tem sua cor: a do `color:` no frontmatter do `.claude/agents/*.md` do repositório ou, sem ele,
  uma cor estável derivada do nome. A fantasia (lupa, escudo, caneta, mapa) vem do tipo do agente.
- Estados: trabalhando, esperando você, ocioso, cansado (≥ 80% do limite), exausto (≥ 95%), dormindo e
  comemorando (limite renovado). O clique passa direto pela janela em tudo que não for um boneco.

## Privacidade e segurança

O que o app **lê** (somente leitura, no seu computador):
- `~/.claude/projects/**/*.jsonl` e `~/.codex/sessions/**/*.jsonl`: só contagem de tokens, modelo, título da
  sessão, pasta e tipo do agente. O conteúdo das conversas não é usado nem guardado.
- `~/.claude/agents/*.md` e `.claude/agents/*.md` dos repositórios: apenas `name` e `color` do frontmatter.
- `~/.claude/.credentials.json`: **só** para consultar o % exato do Claude (opção ligada por padrão, desligue em
  *% exato do Claude* no menu da bandeja). O token é usado só nessa chamada, nunca é renovado, gravado,
  exibido ou registrado em log.

O que o app **envia**: uma única requisição, a cada 5 min, para `https://api.anthropic.com/api/oauth/usage`
(o mesmo dado do `/usage`), e nada mais. Sem telemetria, sem analytics, sem outros servidores. O endpoint não é
documentado e pode mudar; se falhar, o app cai para uma estimativa local rotulada como "estimado".

O que o app **guarda**: um SQLite em `%APPDATA%\token-pets` com o histórico de uso (30 dias) e as preferências.

Endurecimento do Electron: `contextIsolation` + `sandbox`, sem `nodeIntegration`, CSP restrita nas páginas,
navegação, janelas novas e permissões (câmera, localização etc.) bloqueadas, e fuses que desligam `runAsNode`,
as flags de inspeção do Node e carregamento fora do `asar`. Os releases são gerados pelo GitHub Actions a
partir deste repositório, com checksums SHA-256 e atestado de procedência (veja abaixo).

### Conferir o download
```powershell
(Get-FileHash .\Token-Pets-<versão>-win.exe -Algorithm SHA256).Hash.ToLower()   # compare com SHA256SUMS.txt
gh attestation verify .\Token-Pets-<versão>-win.exe --repo EduardooPV/token-pets
```

Para desinstalar: *Configurações → Aplicativos → Token Pets* (remove também o início automático). Os dados em
`%APPDATA%\token-pets` ficam; apague a pasta se quiser.

## Desenvolvimento

```bash
pnpm install
pnpm test        # Vitest
pnpm typecheck
pnpm app         # compila tudo e abre o app (ícone na bandeja)
pnpm dev         # só a interface no navegador, com dados de exemplo (/popup.html, /pet.html)
pnpm dist        # gera o instalador e o zip em release/
```

Medir recursos: `pwsh scripts/measure.ps1 -Minutes 10 -Label so-bandeja`.

Estrutura: `electron/` (processo principal: bandeja, janelas, IPC), `src/core/` (leitura de Claude e Codex,
sessões, histórico, avisos), `src/engine/` (sprites, animação, física e personalidades) e `src/popup`, `src/pet`
(interfaces).

### Releases
Todo push na `main` (exceto mudanças só de documentação) roda [`release.yml`](.github/workflows/release.yml):
typecheck, testes, build, gera o `.exe` (instalador NSIS) e o `.zip`, calcula os checksums, cria o atestado e
publica o release `v<MAJOR>.<MINOR>.<n da execução>`. Para mudar a versão maior ou menor, edite `version` no
`package.json`. Pull requests rodam só o [`ci.yml`](.github/workflows/ci.yml).

## Licença
[MIT](LICENSE)
