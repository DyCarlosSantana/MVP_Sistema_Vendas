-- Integridade do ledger. Escrita à mão: o schema TypeScript do Drizzle não expressa triggers.
-- Regra: NUNCA editar este arquivo depois de aplicado; mudanças vão em uma nova migração.

-- Papel da aplicação. Sem login aqui; quem faz o deploy define senha com ALTER ROLE ... LOGIN PASSWORD.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'loja_app') THEN
    CREATE ROLE loja_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint

CREATE FUNCTION bloqueia_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tabela % e append-only (% bloqueado); corrija com um movimento de ESTORNO', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER trg_movimento_estoque_imutavel
  BEFORE UPDATE OR DELETE ON movimento_estoque
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();
--> statement-breakpoint

-- Linha a linha não dispara em TRUNCATE; este gatilho de comando fecha a brecha.
CREATE TRIGGER trg_movimento_estoque_sem_truncate
  BEFORE TRUNCATE ON movimento_estoque
  FOR EACH STATEMENT EXECUTE FUNCTION bloqueia_alteracao();
--> statement-breakpoint

-- Menor privilégio: a aplicação só lê e insere no ledger.
GRANT USAGE ON SCHEMA public TO loja_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON categoria, produto, variante TO loja_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON movimento_estoque TO loja_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON estoque_saldo TO loja_app;
