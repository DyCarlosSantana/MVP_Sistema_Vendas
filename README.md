# Loja ERP

MVP/ERP para uma loja de varejo. Regras e decisões em [`AGENTS.md`](AGENTS.md) e [`docs/`](docs/).

## Começando

Pré-requisitos: Node 22.12+ (ver `.node-version`), pnpm 10, Docker.

```
pnpm install
pnpm test:db        # prova que banco, migrações e testes funcionam
```

Para rodar API e PDV: copie `.env.example` para `.env`, suba `docker compose up -d postgres`,
rode `pnpm --filter @loja/api db:migrate` e depois `pnpm --filter @loja/api dev`.
