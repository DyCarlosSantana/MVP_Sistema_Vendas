import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  conectarApp,
  conectarDono,
  criarVariante,
  limparBanco,
  prepararPapelApp,
  type Sql,
} from './db';

describe('T-03: ledger append-only', () => {
  let dono: Sql;
  let app: Sql;
  let movimentoId: string;

  beforeAll(async () => {
    dono = conectarDono();
    await prepararPapelApp(dono);
    app = conectarApp();
  });

  afterAll(async () => {
    await app.end();
    await dono.end();
  });

  beforeEach(async () => {
    await limparBanco(dono);
    const varianteId = await criarVariante(dono);
    movimentoId = crypto.randomUUID();
    // A aplicação consegue inserir (privilégio mínimo não pode bloquear o uso normal).
    await app`INSERT INTO movimento_estoque
      (id, variante_id, tipo, quantidade, origem_tipo, usuario_id, dispositivo_id,
       chave_idempotencia, ocorrido_em)
      VALUES (${movimentoId}, ${varianteId}, 'SAIDA_VENDA', -1, 'VENDA',
       ${crypto.randomUUID()}, ${crypto.randomUUID()}, ${`k-${movimentoId}`}, now())`;
  });

  it('T-03a: o gatilho rejeita UPDATE, até para o dono do banco', async () => {
    await expect(
      dono`UPDATE movimento_estoque SET motivo = 'x' WHERE id = ${movimentoId}`,
    ).rejects.toThrow(/append-only/);
  });

  it('T-03b: o gatilho rejeita DELETE, até para o dono do banco', async () => {
    await expect(dono`DELETE FROM movimento_estoque WHERE id = ${movimentoId}`).rejects.toThrow(
      /append-only/,
    );
  });

  it('T-03c: o gatilho rejeita TRUNCATE, até para o dono do banco', async () => {
    await expect(dono`TRUNCATE movimento_estoque`).rejects.toThrow(/append-only/);
  });

  it('T-03d: a aplicação não tem permissão de UPDATE, DELETE nem TRUNCATE', async () => {
    await expect(app`UPDATE movimento_estoque SET motivo = 'x'`).rejects.toThrow(
      /permission denied/,
    );
    await expect(app`DELETE FROM movimento_estoque`).rejects.toThrow(/permission denied/);
    await expect(app`TRUNCATE movimento_estoque`).rejects.toThrow(/permission denied/);
  });

  it('T-03e: CHECK impede saída com quantidade positiva', async () => {
    const [v] = await dono`SELECT id FROM variante LIMIT 1`;
    await expect(
      app`INSERT INTO movimento_estoque
        (id, variante_id, tipo, quantidade, origem_tipo, usuario_id, dispositivo_id,
         chave_idempotencia, ocorrido_em)
        VALUES (${crypto.randomUUID()}, ${v?.id}, 'SAIDA_VENDA', 1, 'VENDA',
         ${crypto.randomUUID()}, ${crypto.randomUUID()}, ${`k-${crypto.randomUUID()}`}, now())`,
    ).rejects.toThrow(/sinal_coerente/);
  });
});
