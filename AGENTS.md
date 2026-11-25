# AGENTS.md: ERP/MVP para loja de varejo

> Arquivo de contexto para ferramentas de código com IA (Cursor, Antigravity e similares). **Rascunho para curadoria do Edy.**
> Confirme na documentação de cada ferramenta qual arquivo de regras ela lê (nome e pasta) e copie ou ligue este conteúdo para lá.

## Projeto

Sistema de gestão (ERP) para **uma loja real de varejo** (calçados, cosméticos e roupas), 1 loja física, 1 a 2 caixas, regime MEI. Opera com cliente e dinheiro de verdade. Estratégia: MVP pequeno e correto, evoluindo por módulos.

Fontes de verdade (ler antes de implementar):
- `docs/01-modelagem-dominio-produto-estoque-v4.md`: domínio de Produto, Variante, Estoque (ledger), Compras, desconto e devolução.
- `docs/02-autenticacao-perfis-auditoria.md`: login, perfis, permissões, dispositivos, aprovações e auditoria, inclusive offline.
- `docs/adr/`: decisões aprovadas.

## Stack

- Back-end: **TypeScript + NestJS**, PostgreSQL, acesso a dados SQL-first (Drizzle ou Kysely), migrações versionadas.
- Front-end: **React SPA (Vite) como PWA** responsivo (celular Android, tablet, computador Windows), offline-first.
- Validação compartilhada (ex.: Zod) entre PWA e servidor, em `packages/shared`.
- Infra: Docker desde o início. Versões exatas são fixadas no setup do projeto.
- Estrutura sugerida: `apps/api`, `apps/pdv`, `packages/shared`, `docs/`, `docs/adr/`.

## Regras inegociáveis

**Dinheiro**
- Valores em **centavos inteiros** (`bigint` no banco). Nunca `float`.
- Percentuais em **pontos-base** (10% = 1000). Arredondamento **meio para cima, em inteiros**: `(base * bp + 5000) / 10000`.
- Desconto da venda toda é **rateado proporcionalmente** entre os itens e a soma é exata (a sobra de centavos vai para o item de maior valor).

**Estoque**
- `movimento_estoque` é **append-only**: nunca `UPDATE` nem `DELETE`. Correção é um movimento de `ESTORNO` com motivo.
- O saldo **nunca é editado diretamente**. A projeção `estoque_saldo` é atualizada **na mesma transação** do movimento.
- Invariante: `estoque_saldo.saldo == SUM(movimento_estoque.quantidade)`.
- **Saldo negativo é permitido** (a venda não trava), com alerta no PDV e relatório de divergência.

**Idempotência e offline**
- Toda operação que nasce no cliente tem `id` UUID e `chave_idempotencia` gerados **no aparelho**.
- Gravação com `INSERT ... ON CONFLICT (chave_idempotencia) DO NOTHING`. Reenvio é no-op.
- O servidor **revalida tudo** na sincronização. O que for inválido vai para **revisão**, **nunca é descartado em silêncio** (descartar venda é perder dinheiro).
- Resposta de sincronização é **por item** (`criado`, `duplicado`, `rejeitado`); o PDV só remove da fila o que foi confirmado.

**Autenticação e autorização**
- Checagem de permissão **no servidor** (Guards). Esconder botão na tela não é segurança.
- Senha e PIN com **Argon2id**. Nunca registrar senha, PIN, hash ou token em log ou resposta.
- Cache offline respeita permissões: **sem custo nem margem** para quem não tem `custo.visualizar`.
- Perfis e limites de desconto vêm de **tabelas**, não de constantes no código.

**Configuração**
- Nada de regra de negócio hardcoded: limites de desconto, `offline_max_horas`, `prazo_troca_dias` etc. ficam em tabela de parâmetros.

**Dados**
- IDs UUID (preferência v7), imutáveis. Soft delete (`excluido_em`) onde há histórico.

## Fora do MVP (não implementar sem pedido explícito)

Emissão fiscal (NFC-e/NF-e), integração TEF, consignado, vale-crédito, venda para CNPJ, impressão a partir do celular, e-commerce/marketplace, multi-loja.

## Como trabalhar

1. **Teste primeiro.** Os casos dos documentos (T-01 a T-22 e T-A01 a T-A18) são o contrato. Cada um vira teste automatizado com o **mesmo ID no nome**. Mostre o teste falhando antes de implementar.
2. Testes de banco rodam contra **PostgreSQL real** (container), porque as garantias do ledger vivem no banco (trigger, CHECK, UNIQUE).
3. Pronto só com: teste, tratamento de erro, log e validação de um usuário real.
4. PRs pequenos, commits descritivos, uma mudança por vez.
5. Migrações versionadas; nunca alterar migração já aplicada.
6. Não adicionar dependência nova sem perguntar.

## Modo de trabalho com o Edy (ele está aprendendo)

- Antes de implementar, descreva o plano em poucas linhas e espere confirmação quando a mudança for grande.
- Explique decisões não óbvias em poucas frases, sem sermão.
- **Não altere `docs/` nem ADRs sem pedir.**
- Se o pedido conflitar com uma regra destes documentos, **avise** em vez de seguir em silêncio.
- Em dúvida de negócio (regra fiscal, política de loja), pergunte; não presuma.

## Comandos

A preencher no setup do projeto (instalar, subir Docker, rodar migrações, rodar testes).
