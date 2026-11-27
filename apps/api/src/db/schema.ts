import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Dinheiro em centavos inteiros. bigint em modo number cobre até ~9 quatrilhões de centavos.
const centavos = (nome: string) => bigint(nome, { mode: 'number' });
const momento = (nome: string) => timestamp(nome, { withTimezone: true });

export const categoria = pgTable('categoria', {
  id: uuid('id').primaryKey(),
  nome: text('nome').notNull().unique(),
  ativo: boolean('ativo').notNull().default(true),
});

export const produto = pgTable(
  'produto',
  {
    id: uuid('id').primaryKey(),
    categoriaId: uuid('categoria_id')
      .notNull()
      .references(() => categoria.id),
    nome: text('nome').notNull(),
    marca: text('marca'),
    descricao: text('descricao'),
    precoVendaCentavos: centavos('preco_venda_centavos').notNull(),
    ncm: char('ncm', { length: 8 }),
    cest: char('cest', { length: 7 }),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: momento('criado_em').notNull().defaultNow(),
    atualizadoEm: momento('atualizado_em').notNull().defaultNow(),
    excluidoEm: momento('excluido_em'),
  },
  (t) => [
    check('produto_preco_nao_negativo', sql`${t.precoVendaCentavos} >= 0`),
    check('produto_ncm_formato', sql`${t.ncm} ~ '^[0-9]{8}$'`),
    check('produto_cest_formato', sql`${t.cest} ~ '^[0-9]{7}$'`),
  ],
);

export const variante = pgTable(
  'variante',
  {
    id: uuid('id').primaryKey(),
    produtoId: uuid('produto_id')
      .notNull()
      .references(() => produto.id),
    sku: text('sku').notNull().unique(),
    codigoBarras: text('codigo_barras').unique(),
    chaveVariacao: text('chave_variacao').notNull(),
    precoCustoCentavos: centavos('preco_custo_centavos').notNull().default(0),
    precoVendaOverrideCentavos: centavos('preco_venda_override_centavos'),
    estoqueMinimo: integer('estoque_minimo').notNull().default(0),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: momento('criado_em').notNull().defaultNow(),
    atualizadoEm: momento('atualizado_em').notNull().defaultNow(),
    excluidoEm: momento('excluido_em'),
  },
  (t) => [
    unique('variante_produto_chave_unica').on(t.produtoId, t.chaveVariacao),
    check('variante_custo_nao_negativo', sql`${t.precoCustoCentavos} >= 0`),
    check(
      'variante_override_nao_negativo',
      sql`${t.precoVendaOverrideCentavos} IS NULL OR ${t.precoVendaOverrideCentavos} >= 0`,
    ),
    check('variante_estoque_minimo_nao_negativo', sql`${t.estoqueMinimo} >= 0`),
  ],
);

export const tipoMovimento = pgEnum('tipo_movimento', [
  'ENTRADA_COMPRA',
  'SAIDA_VENDA',
  'DEVOLUCAO_CLIENTE',
  'DEVOLUCAO_FORNECEDOR',
  'PERDA_AVARIA',
  'AJUSTE_INVENTARIO',
  'ESTORNO',
]);

// usuario_id e dispositivo_id ganham FK na migração do módulo de autenticação (documento 02).
export const movimentoEstoque = pgTable(
  'movimento_estoque',
  {
    id: uuid('id').primaryKey(),
    varianteId: uuid('variante_id')
      .notNull()
      .references(() => variante.id),
    tipo: tipoMovimento('tipo').notNull(),
    quantidade: integer('quantidade').notNull(),
    origemTipo: text('origem_tipo').notNull(),
    origemId: uuid('origem_id'),
    motivo: text('motivo'),
    estornoDeId: uuid('estorno_de_id').references((): AnyPgColumn => movimentoEstoque.id),
    usuarioId: uuid('usuario_id').notNull(),
    dispositivoId: uuid('dispositivo_id').notNull(),
    chaveIdempotencia: text('chave_idempotencia').notNull().unique(),
    ocorridoEm: momento('ocorrido_em').notNull(),
    registradoEm: momento('registrado_em').notNull().defaultNow(),
  },
  (t) => [
    index('ix_mov_variante_data').on(t.varianteId, t.registradoEm),
    check('qtd_nao_zero', sql`${t.quantidade} <> 0`),
    check(
      'sinal_coerente',
      sql`(${t.tipo} IN ('ENTRADA_COMPRA','DEVOLUCAO_CLIENTE') AND ${t.quantidade} > 0)
        OR (${t.tipo} IN ('SAIDA_VENDA','DEVOLUCAO_FORNECEDOR','PERDA_AVARIA') AND ${t.quantidade} < 0)
        OR (${t.tipo} IN ('AJUSTE_INVENTARIO','ESTORNO'))`,
    ),
    check(
      'motivo_obrigatorio',
      sql`${t.tipo} NOT IN ('AJUSTE_INVENTARIO','ESTORNO','PERDA_AVARIA') OR ${t.motivo} IS NOT NULL`,
    ),
    check('estorno_referencia', sql`(${t.tipo} = 'ESTORNO') = (${t.estornoDeId} IS NOT NULL)`),
  ],
);

// Projeção do saldo. O ledger sempre vence: saldo == SUM(movimento_estoque.quantidade).
export const estoqueSaldo = pgTable('estoque_saldo', {
  varianteId: uuid('variante_id')
    .primaryKey()
    .references(() => variante.id),
  saldo: integer('saldo').notNull().default(0),
  atualizadoEm: momento('atualizado_em').notNull().defaultNow(),
});
