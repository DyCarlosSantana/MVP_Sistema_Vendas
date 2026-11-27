import postgres from 'postgres';

const ownerUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/loja_test';
const appUrl =
  process.env.TEST_APP_DATABASE_URL ?? 'postgres://loja_app:loja_app@localhost:5433/loja_test';

const opts = { max: 1, onnotice: () => {} };

/** Conexão do dono do banco (superusuário no banco de teste). */
export const conectarDono = () => postgres(ownerUrl, opts);
/** Conexão da aplicação: o papel loja_app, com privilégios mínimos. */
export const conectarApp = () => postgres(appUrl, opts);

export type Sql = ReturnType<typeof postgres>;

/** Dá login ao papel da aplicação. A senha de teste nunca é usada fora daqui. */
export async function prepararPapelApp(dono: Sql) {
  await dono.unsafe("ALTER ROLE loja_app LOGIN PASSWORD 'loja_app'");
}

/**
 * Limpeza entre testes. O TRUNCATE do ledger é bloqueado pelo gatilho, até para o dono,
 * então usamos session_replication_role = replica (só superusuário) dentro de uma transação.
 * Esse caminho existe apenas em teste.
 */
export async function limparBanco(dono: Sql) {
  await dono.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`TRUNCATE movimento_estoque, estoque_saldo, variante, produto, categoria CASCADE`;
  });
}

/** Cria categoria > produto > variante e devolve o id da variante. */
export async function criarVariante(dono: Sql): Promise<string> {
  const categoriaId = crypto.randomUUID();
  const produtoId = crypto.randomUUID();
  const varianteId = crypto.randomUUID();
  await dono`INSERT INTO categoria (id, nome) VALUES (${categoriaId}, ${`cat-${categoriaId}`})`;
  await dono`INSERT INTO produto (id, categoria_id, nome, preco_venda_centavos)
             VALUES (${produtoId}, ${categoriaId}, 'Tênis Runner X', 19990)`;
  await dono`INSERT INTO variante (id, produto_id, sku, chave_variacao)
             VALUES (${varianteId}, ${produtoId}, ${`sku-${varianteId}`}, 'numeracao=38')`;
  return varianteId;
}
