# Token Pets

App de bandeja do Windows (Tauri 2 + TypeScript) que mostra o uso de Claude e Codex (limites de 5h e semanal)
com bonequinhos em pixel art, um por sessão ou subagente ativo.

Status: funcionando na branch `feat/electron` (Electron + TypeScript). Veja o quadro em [docs/ISSUES.md](docs/ISSUES.md).
Não usa Rust/Tauri porque o Smart App Control do Windows bloqueava a compilação.

## Desenvolvimento

```bash
pnpm install
pnpm test        # Vitest (79 testes)
pnpm typecheck
pnpm app         # compila tudo e abre o app (ícone na bandeja)
pnpm dist        # gera release/Token-Pets-<versão>-win.zip e release/win-unpacked
pnpm dev         # só a interface no navegador, com dados de exemplo (/popup.html, /pet.html)
```

Instalar para o seu usuário (sem admin) depois de `pnpm dist`: `pwsh scripts/install.ps1`.
Medir recursos: `pwsh scripts/measure.ps1 -Minutes 10 -Label so-bandeja`.

- Plano completo e decisões: [docs/PLANO.md](docs/PLANO.md)
- Backlog de issues e critérios de aceite: [docs/ISSUES.md](docs/ISSUES.md)

Projeto pessoal, local (sem repo no GitHub por enquanto).
