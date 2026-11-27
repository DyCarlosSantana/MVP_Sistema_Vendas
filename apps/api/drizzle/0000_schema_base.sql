CREATE TYPE "public"."tipo_movimento" AS ENUM('ENTRADA_COMPRA', 'SAIDA_VENDA', 'DEVOLUCAO_CLIENTE', 'DEVOLUCAO_FORNECEDOR', 'PERDA_AVARIA', 'AJUSTE_INVENTARIO', 'ESTORNO');--> statement-breakpoint
CREATE TABLE "categoria" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categoria_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "estoque_saldo" (
	"variante_id" uuid PRIMARY KEY NOT NULL,
	"saldo" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movimento_estoque" (
	"id" uuid PRIMARY KEY NOT NULL,
	"variante_id" uuid NOT NULL,
	"tipo" "tipo_movimento" NOT NULL,
	"quantidade" integer NOT NULL,
	"origem_tipo" text NOT NULL,
	"origem_id" uuid,
	"motivo" text,
	"estorno_de_id" uuid,
	"usuario_id" uuid NOT NULL,
	"dispositivo_id" uuid NOT NULL,
	"chave_idempotencia" text NOT NULL,
	"ocorrido_em" timestamp with time zone NOT NULL,
	"registrado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "movimento_estoque_chave_idempotencia_unique" UNIQUE("chave_idempotencia"),
	CONSTRAINT "qtd_nao_zero" CHECK ("movimento_estoque"."quantidade" <> 0),
	CONSTRAINT "sinal_coerente" CHECK (("movimento_estoque"."tipo" IN ('ENTRADA_COMPRA','DEVOLUCAO_CLIENTE') AND "movimento_estoque"."quantidade" > 0)
        OR ("movimento_estoque"."tipo" IN ('SAIDA_VENDA','DEVOLUCAO_FORNECEDOR','PERDA_AVARIA') AND "movimento_estoque"."quantidade" < 0)
        OR ("movimento_estoque"."tipo" IN ('AJUSTE_INVENTARIO','ESTORNO'))),
	CONSTRAINT "motivo_obrigatorio" CHECK ("movimento_estoque"."tipo" NOT IN ('AJUSTE_INVENTARIO','ESTORNO','PERDA_AVARIA') OR "movimento_estoque"."motivo" IS NOT NULL),
	CONSTRAINT "estorno_referencia" CHECK (("movimento_estoque"."tipo" = 'ESTORNO') = ("movimento_estoque"."estorno_de_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "produto" (
	"id" uuid PRIMARY KEY NOT NULL,
	"categoria_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"marca" text,
	"descricao" text,
	"preco_venda_centavos" bigint NOT NULL,
	"ncm" char(8),
	"cest" char(7),
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "produto_preco_nao_negativo" CHECK ("produto"."preco_venda_centavos" >= 0),
	CONSTRAINT "produto_ncm_formato" CHECK ("produto"."ncm" ~ '^[0-9]{8}$'),
	CONSTRAINT "produto_cest_formato" CHECK ("produto"."cest" ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "variante" (
	"id" uuid PRIMARY KEY NOT NULL,
	"produto_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"codigo_barras" text,
	"chave_variacao" text NOT NULL,
	"preco_custo_centavos" bigint DEFAULT 0 NOT NULL,
	"preco_venda_override_centavos" bigint,
	"estoque_minimo" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"excluido_em" timestamp with time zone,
	CONSTRAINT "variante_sku_unique" UNIQUE("sku"),
	CONSTRAINT "variante_codigo_barras_unique" UNIQUE("codigo_barras"),
	CONSTRAINT "variante_produto_chave_unica" UNIQUE("produto_id","chave_variacao"),
	CONSTRAINT "variante_custo_nao_negativo" CHECK ("variante"."preco_custo_centavos" >= 0),
	CONSTRAINT "variante_override_nao_negativo" CHECK ("variante"."preco_venda_override_centavos" IS NULL OR "variante"."preco_venda_override_centavos" >= 0),
	CONSTRAINT "variante_estoque_minimo_nao_negativo" CHECK ("variante"."estoque_minimo" >= 0)
);
--> statement-breakpoint
ALTER TABLE "estoque_saldo" ADD CONSTRAINT "estoque_saldo_variante_id_variante_id_fk" FOREIGN KEY ("variante_id") REFERENCES "public"."variante"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_variante_id_variante_id_fk" FOREIGN KEY ("variante_id") REFERENCES "public"."variante"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_estorno_de_id_movimento_estoque_id_fk" FOREIGN KEY ("estorno_de_id") REFERENCES "public"."movimento_estoque"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto" ADD CONSTRAINT "produto_categoria_id_categoria_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categoria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variante" ADD CONSTRAINT "variante_produto_id_produto_id_fk" FOREIGN KEY ("produto_id") REFERENCES "public"."produto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_mov_variante_data" ON "movimento_estoque" USING btree ("variante_id","registrado_em");