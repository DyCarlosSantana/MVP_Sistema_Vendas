# ADR 0001: Decisões do projeto base

Status: **proposta** (aguarda aprovação do Edy).

| # | Decisão | Motivo |
|---|---|---|
| 1 | Monorepo pnpm: `apps/api`, `apps/pdv`, `packages/shared` | Um repositório, contratos tipados entre PDV e API |
| 2 | NestJS com **Express** (padrão) | Sem ganho real do Fastify para 1 a 2 caixas; mais documentação |
| 3 | Drizzle: `0000` gerado do schema TS, `0001` escrita à mão (gatilhos, papéis, permissões); `push` proibido | Fonte única de verdade: nenhum banco existe sem os gatilhos |
| 4 | Papel `loja_app` sem `UPDATE`/`DELETE`/`TRUNCATE` no ledger, mais gatilho de comando contra `TRUNCATE` | `TRUNCATE` não dispara gatilho de linha; defesa em duas camadas |
| 5 | Testes limpam o banco com `session_replication_role = replica` (só superusuário, só em teste) | Único caminho de limpeza com o gatilho ativo; testes rodam no Postgres real |
| 6 | Banco de teste em `tmpfs` (efêmero) | Rápido e sem lixo entre execuções |
| 7 | **Sem `unplugin-swc`/`@swc/core`**: com Vitest 5 + Vite 8 o metadado de decorators é emitido nativamente; o teste `di.test.ts` verifica isso diretamente | Menos duas dependências. Se uma atualização quebrar, o teste avisa |
| 8 | TypeScript **5.9.3** (a 7.0.x existe, mas o compilador é novo; adotar após testar com NestJS/Drizzle) | Estabilidade |
| 9 | `argon2` e `dexie` **fora** do projeto base; entram com autenticação e com a fila offline | Só entra o que é usado |
| 10 | `@nestjs/cli` adicionado (build e `dev` do NestJS) | Faltava definir como a API compila e roda |
| 11 | `postgres` (driver) fica na v3.4.9; a v4 existe | Compatibilidade com Drizzle não verificada |
