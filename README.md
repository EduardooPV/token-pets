# Token Pets

App de bandeja do Windows (Tauri 2 + TypeScript) que mostra o uso de Claude e Codex (limites de 5h e semanal)
com bonequinhos em pixel art, um por sessão ou subagente ativo.

Status: código escrito na branch `feat/mvp`, **Rust ainda não compilado** (Smart App Control bloqueia as
proc-macros nesta máquina). Veja o quadro de status em [docs/ISSUES.md](docs/ISSUES.md).

## Desenvolvimento

```bash
pnpm install
pnpm test          # Vitest
pnpm typecheck
pnpm tauri dev     # app completo (precisa de Rust + Visual C++ Build Tools)
pnpm tauri build   # instalador NSIS em src-tauri/target/release/bundle
pnpm dev           # só a interface no navegador, com dados de exemplo (/popup.html, /pet.html)
```

No Windows, rode o `cargo` pelo PowerShell (o `link.exe` do Git Bash atrapalha o linker do MSVC).
Medição de recursos: `pwsh scripts/measure.ps1 -Minutes 10 -Label so-bandeja`.

- Plano completo e decisões: [docs/PLANO.md](docs/PLANO.md)
- Backlog de issues e critérios de aceite: [docs/ISSUES.md](docs/ISSUES.md)

Projeto pessoal, local (sem repo no GitHub por enquanto).
