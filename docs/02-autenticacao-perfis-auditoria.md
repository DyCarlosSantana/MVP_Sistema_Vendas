# 02 · Autenticação, perfis, dispositivos e auditoria (offline-first)

> Status: **RASCUNHO v1.1 PARA CURADORIA**. Nada aqui é decisão final até o Edy aprovar.
> Continua o documento 01 (domínio de Produto e Estoque). As FKs `usuario_id` e `dispositivo_id` do ledger apontam para as tabelas definidas aqui.
> **Escopo:** login e sessão, perfis e permissões, aprovações (desconto, cancelamento, devolução), pareamento de dispositivos, auditoria, e como tudo isso se comporta **offline**.
> **Fora de escopo:** venda, caixa, financeiro (aparecem só como referência).

---

## 0. O que mudou da v1 para a v1.1

1. **Offline com limite brando [v1.1]:** as 12 h viram um limite brando. Se a queda durar mais, Gerente ou ADM estende a janela por PIN, e sem extensão o PDV segue em modo contingência. O caixa nunca trava (seção 5.2).
2. **Perfil SUPORTE [v1.1]** para o desenvolvedor, em vez de dar a ele o perfil ADM (seções 4 e 5.8).
3. **Códigos de recuperação do ADM [v1.1]**, já que só existe um ADM (seção 5.7).
4. **`dispositivo.revogar` [v1.1]** para Gerente, ADM e Suporte.
5. **Usuários iniciais [v1.1]:** 1 Vendedor, 1 ADM (o dono) e 1 Suporte (o desenvolvedor). O perfil Gerente existe, sem usuário ativo.
6. **D-21 a D-27 aprovadas [v1.1]:** o Edy concordou com as medidas de segurança.

---

## 1. Premissas herdadas

| Tema | Premissa |
|---|---|
| Perfis | Vendedor, Gerente, ADM e **Suporte [v1.1]** (permissões em tabela, não em código) |
| Descontos | Vendedor 5%, Gerente 15%, ADM sem limite, sobre o total bruto da venda |
| Dispositivos | Celular (Android na maioria), tablet e computador Windows no balcão |
| Offline | O PDV precisa vender sem internet e sincronizar depois, com idempotência |
| Stack | TypeScript + NestJS + PostgreSQL; PWA em React |
| Escala | 1 a 2 caixas; **3 usuários no começo [v1.1]**: 1 Vendedor, 1 ADM (o dono) e 1 Suporte (o desenvolvedor). O perfil Gerente existe, sem usuário ativo |

---

## 2. O problema central: autenticar sem internet

Online, autenticar é simples: o servidor confere a senha. Offline, **não há servidor para conferir**, e a loja não pode parar. Três perguntas decidem o desenho:

1. Quem pode **continuar vendendo** quando a internet cai no meio do expediente?
2. Como um Gerente **aprova um desconto** offline?
3. O que o servidor faz, **depois**, com o que foi aprovado offline?

Princípio: **o aparelho nunca é a autoridade final.** Offline, ele aplica regras com o que sabe; ao sincronizar, o **servidor revalida tudo** e o que for inválido vai para revisão, nunca é descartado em silêncio (descartar venda é perder dinheiro).

---

## 3. Modelo de dados (rascunho PostgreSQL)

```sql
-- ========== PERFIS E PERMISSÕES (dados, não código) ==========
CREATE TABLE perfil (
  id                 uuid PRIMARY KEY,
  nome               text NOT NULL UNIQUE,                -- 'VENDEDOR','GERENTE','ADM'
  limite_desconto_bp integer CHECK (limite_desconto_bp BETWEEN 0 AND 10000), -- NULL = sem limite
  ativo              boolean NOT NULL DEFAULT true
);

CREATE TABLE permissao (
  codigo    text PRIMARY KEY,                             -- 'estoque.ajustar'
  descricao text NOT NULL
);

CREATE TABLE perfil_permissao (
  perfil_id        uuid NOT NULL REFERENCES perfil(id),
  permissao_codigo text NOT NULL REFERENCES permissao(codigo),
  PRIMARY KEY (perfil_id, permissao_codigo)
);

-- ========== USUÁRIOS ==========
CREATE TABLE usuario (
  id             uuid PRIMARY KEY,
  nome           text NOT NULL,
  login          text NOT NULL,
  senha_hash     text NOT NULL,                           -- Argon2id
  pin_hash       text,                                    -- Argon2id; desbloqueio e aprovação
  perfil_id      uuid NOT NULL REFERENCES perfil(id),     -- 1 perfil por usuário no MVP
  ativo          boolean NOT NULL DEFAULT true,
  falhas_login   integer NOT NULL DEFAULT 0,
  bloqueado_ate  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz                              -- soft delete: o histórico aponta para ele
);
CREATE UNIQUE INDEX ux_usuario_login ON usuario (lower(login));

CREATE TABLE codigo_recuperacao (                         -- [v1.1] break-glass do ADM; uso único
  id          uuid PRIMARY KEY,
  usuario_id  uuid NOT NULL REFERENCES usuario(id),
  codigo_hash text NOT NULL,                              -- Argon2id
  criado_em   timestamptz NOT NULL DEFAULT now(),
  usado_em    timestamptz
);

-- ========== DISPOSITIVOS ==========
CREATE TYPE tipo_dispositivo AS ENUM ('CELULAR','TABLET','COMPUTADOR');

CREATE TABLE dispositivo (
  id              uuid PRIMARY KEY,                       -- gerado no aparelho
  nome            text NOT NULL,                          -- 'Caixa 1', 'Celular da Ana'
  tipo            tipo_dispositivo NOT NULL,
  pareado_por     uuid REFERENCES usuario(id),
  pareado_em      timestamptz NOT NULL DEFAULT now(),
  ultimo_sync_em  timestamptz,
  revogado_em     timestamptz
);

CREATE TABLE codigo_pareamento (                          -- uso único, gerado por um ADM
  id          uuid PRIMARY KEY,
  codigo_hash text NOT NULL,
  criado_por  uuid NOT NULL REFERENCES usuario(id),
  expira_em   timestamptz NOT NULL,
  usado_em    timestamptz
);

-- ========== SESSÃO ==========
CREATE TABLE sessao (
  id              uuid PRIMARY KEY,
  usuario_id      uuid NOT NULL REFERENCES usuario(id),
  dispositivo_id  uuid NOT NULL REFERENCES dispositivo(id),
  refresh_hash    text NOT NULL,                          -- nunca o token em claro
  criada_em       timestamptz NOT NULL DEFAULT now(),
  expira_em       timestamptz NOT NULL,
  revogada_em     timestamptz
);

-- ========== APROVAÇÕES (podem nascer offline) ==========
CREATE TABLE aprovacao (
  id                  uuid PRIMARY KEY,                   -- gerado no aparelho
  tipo                text NOT NULL CHECK (tipo IN ('DESCONTO','CANCELAMENTO','DEVOLUCAO','EXTENSAO_OFFLINE')),
  solicitante_id      uuid NOT NULL REFERENCES usuario(id),
  aprovador_id        uuid NOT NULL REFERENCES usuario(id),
  referencia_tipo     text NOT NULL,                      -- 'VENDA','DEVOLUCAO','DISPOSITIVO'
  referencia_id       uuid NOT NULL,
  valor_referencia    bigint,                             -- ex.: desconto aprovado em bp ou centavos; horas na EXTENSAO_OFFLINE
  dispositivo_id      uuid NOT NULL REFERENCES dispositivo(id),
  offline             boolean NOT NULL,
  ocorrido_em         timestamptz NOT NULL,
  registrado_em       timestamptz NOT NULL DEFAULT now(),
  status_validacao    text NOT NULL DEFAULT 'VALIDA'
                        CHECK (status_validacao IN ('VALIDA','EM_REVISAO','REJEITADA')),
  chave_idempotencia  text NOT NULL UNIQUE,
  CHECK (solicitante_id <> aprovador_id)                  -- ninguém aprova a si mesmo
);

-- ========== AUDITORIA (append-only) ==========
CREATE TABLE log_auditoria (
  id                  uuid PRIMARY KEY,
  ocorrido_em         timestamptz NOT NULL,
  registrado_em       timestamptz NOT NULL DEFAULT now(),
  usuario_id          uuid REFERENCES usuario(id),        -- NULL em login falho de login inexistente
  dispositivo_id      uuid REFERENCES dispositivo(id),
  acao                text NOT NULL,                      -- 'desconto.aprovado', 'preco.alterado'
  entidade_tipo       text,
  entidade_id         uuid,
  antes               jsonb,
  depois              jsonb,
  chave_idempotencia  text UNIQUE                         -- eventos nascidos offline não duplicam
);

-- Mesma regra do ledger: sem UPDATE nem DELETE
CREATE TRIGGER trg_auditoria_imutavel
  BEFORE UPDATE OR DELETE ON log_auditoria
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao_ledger();
-- (a função foi criada no documento 01; trocar a mensagem para ser genérica na migração)

-- Migração: completa as FKs do documento 01
ALTER TABLE movimento_estoque
  ADD FOREIGN KEY (usuario_id)    REFERENCES usuario(id),
  ADD FOREIGN KEY (dispositivo_id) REFERENCES dispositivo(id);
```

**Por que `limite_desconto_bp` mora no perfil:** é configuração da loja (ADM muda sem deploy), alinhada ao princípio de personalização por configuração.

---

## 4. Catálogo de permissões e matriz inicial

| Permissão | Vendedor | Gerente | ADM | Suporte |
|---|---|---|---|---|
| `venda.criar` | sim | sim | sim | não |
| `estoque.consultar` | sim | sim | sim | não |
| `caixa.abrir_fechar_proprio` | sim | sim | sim | não |
| `desconto.aplicar` (até o limite do perfil) | sim | sim | sim | não |
| `desconto.aprovar_acima_limite` | não | sim | sim | não |
| `devolucao.registrar` | sim | sim | sim | não |
| `devolucao.aprovar` | não | sim | sim | não |
| `venda.cancelar` | não | sim | sim | não |
| `compra.registrar` | não | sim | sim | não |
| `estoque.ajustar` | não | sim | sim | não |
| `custo.visualizar` | não | sim | sim | não |
| `relatorio.vendas` | não | sim | sim | não |
| `relatorio.financeiro` | não | resumo | sim | não |
| `preco.alterar` | não | não | sim | não |
| `parametro.alterar` | não | não | sim | não |
| `parametro.consultar` **[v1.1]** | não | não | sim | sim |
| `usuario.gerenciar` (criar, alterar perfil) | não | não | sim | não |
| `usuario.resetar_senha` **[v1.1]** | não | não | sim | sim, exceto ADM |
| `dispositivo.gerenciar` (parear) | não | não | sim | sim |
| `dispositivo.revogar` **[v1.1]** | não | sim | sim | sim |
| `offline.estender` **[v1.1]** | não | sim | sim | não |
| `auditoria.consultar` | não | não | sim | sim |
| `sync.diagnosticar` **[v1.1]** | não | não | sim | sim |

O **Suporte** não vende e não vê custo, estoque, clientes nem financeiro. Também não atribui o perfil ADM e não reseta a senha do ADM (a recuperação do ADM usa os códigos da seção 5.7).

`custo.visualizar` merece atenção: o Vendedor **não deve ver custo nem margem**, e isso vale também para o **cache offline** do aparelho (seção 5.4). Esconder na tela não é segurança.

**Regra de ouro de autorização:** a checagem de permissão vive no **servidor** (em NestJS, um Guard por rota). A tela só esconde botões por conforto.

---

## 5. Como funciona, online e offline

### 5.1 Login e sessão (online)
- Login com `login` + senha; senha com **Argon2id**.
- **Access token curto** (ex.: 15 min), mantido **só em memória**. **Refresh token rotativo**, guardado em cookie `httpOnly; Secure; SameSite=Strict`, com hash na tabela `sessao`.
- Bloqueio por tentativas: após N falhas, `bloqueado_ate` com espera crescente; todo evento vai para `log_auditoria`.
- Mensagem de erro **genérica** ("login ou senha inválidos"), sem revelar qual dos dois falhou.

### 5.2 Offline: desbloqueio por PIN (proposta)
- O login completo (senha) **exige internet**. Ao logar online em um aparelho, o PWA guarda um **verificador local do PIN** daquele usuário.
- Sem internet, o usuário que já logou naquele aparelho **desbloqueia com PIN** e continua vendendo, dentro de limites:
  - **janela offline de `offline_max_horas` (12 h) [v1.1]**. É um **limite brando**, não um muro: o offline é uma precaução, mas se durar mais a loja não para. A 1 h do fim, o PDV avisa. Ao fim da janela, um Gerente ou ADM presente digita o PIN e **estende a janela** em blocos de 12 h (`offline.estender`); cada extensão vira uma `aprovacao` do tipo `EXTENSAO_OFFLINE` e entra na auditoria. **Sem extensão, o PDV não bloqueia:** segue vendendo em **modo contingência**, e toda operação desse período fica marcada para revisão do ADM (a marca é definida no módulo PDV);
  - máximo de tentativas de PIN (`pin_tentativas_max`, proposta: 5); estourou, só volta online;
  - **só** usuários que já logaram naquele aparelho.
- **Trade-off honesto:** PIN de 4 a 6 dígitos é fraco contra quem rouba o aparelho e ataca offline. Mitigações: validade curta, revogação do dispositivo ao reconectar (seção 5.5), dados locais mínimos (5.4) e armazenamento do verificador com derivação lenta.

### 5.3 Aprovação de Gerente offline (ex.: Vendedor quer dar 6%)
1. O Vendedor tenta aplicar 6%; o PDV vê que passa do limite do perfil (5%).
2. O Gerente ou o ADM digita o **PIN no mesmo aparelho**. O PDV valida contra o verificador local e grava uma `aprovacao` com `offline = true`, `aprovador_id`, `valor_referencia` e `chave_idempotencia`.
3. Ao sincronizar, o servidor **revalida**:
   - o aprovador tinha `desconto.aprovar_acima_limite` e estava ativo;
   - o aparelho estava pareado e não revogado;
   - o desconto aprovado cobre o desconto aplicado;
   - solicitante ≠ aprovador.
4. Se algo falhar: a venda **é registrada** (o cliente já saiu com a mercadoria), mas a aprovação fica `EM_REVISAO` e o caso aparece para o ADM. Nunca se descarta a venda.

> Risco declarado: a aprovação offline é **confiança + auditoria**, não prova criptográfica. Para uma loja com 1 a 2 caixas, é proporcional; se o risco crescer, vale assinar a aprovação no aparelho.

### 5.4 O que o aparelho guarda localmente
- Catálogo e preços de venda, formas de pagamento, lista de usuários ativos (nome, perfil, verificador de PIN).
- **Não guarda custo nem margem** para quem não tem `custo.visualizar`.
- Nunca guarda senha nem hash de senha.

### 5.5 Pareamento e revogação de dispositivos
- Um **ADM (ou o Suporte) gera um código de uso único**, com expiração curta; o aparelho novo o usa para se registrar e receber seu `dispositivo.id`.
- Se um celular é perdido: o Gerente, o ADM ou o Suporte **revoga** o dispositivo, com a permissão `dispositivo.revogar` [v1.1]. Ao tentar sincronizar, as operações dele **não são aplicadas automaticamente**: vão para revisão do ADM, porque podem ser legítimas (vendas feitas antes da perda) ou não.
- Usuário desativado: sessões revogadas na hora; operações offline dele são revalidadas na sincronização.

### 5.6 Permissão mudou enquanto o aparelho estava offline
Vale a permissão **no momento em que o servidor processa**, com a data da operação (`ocorrido_em`) registrada para a revisão. Se uma venda offline usou uma permissão que já foi revogada, ela entra no relatório de divergência, junto com o saldo negativo do documento 01.

### 5.7 Recuperação da conta do ADM **[v1.1]**
Só existe um ADM (o dono). Se ele esquecer a senha:
1. Na criação da conta, o sistema gera **8 códigos de recuperação de uso único**, mostrados **uma única vez**. O dono os guarda fora do sistema (papel, em local seguro).
2. Um código permite definir nova senha; o uso invalida o código e entra na auditoria.
3. Sem códigos: procedimento de emergência feito pelo desenvolvedor direto na infraestrutura, **registrado por escrito** e comunicado ao dono. É honesto assim: quem administra o servidor sempre consegue alcançar o banco, então formalizamos em vez de fingir que não existe.

Por que o Suporte não reseta a senha do ADM: seria entregar a ele o controle da conta mais poderosa.

### 5.8 Conta do desenvolvedor (Suporte) **[v1.1]**
- **Login próprio**, nunca compartilhado com o ADM.
- Perfil **SUPORTE**: gerencia dispositivos, vê auditoria e diagnóstico de sincronização, redefine senha de Vendedor e Gerente, lê parâmetros. **Não** vende, não vê custo, estoque, clientes nem financeiro, não altera preços ou parâmetros e não atribui perfil ADM.
- Tudo que o Suporte faz entra na auditoria, visível ao ADM.
- Dados de produção (inclui dados pessoais de clientes) só com autorização do dono. Em desenvolvimento e homologação, **dados fictícios**, como já prevê a instrução do projeto. Quem acessa dados em nome da loja tende a ser tratado como operador na LGPD; vale registrar isso por escrito com o dono.

---

## 6. Auditoria

Eventos obrigatórios (da instrução do projeto): cancelamento, desconto, ajuste de estoque, alteração de preço. Acrescento:

- login ok, falha e bloqueio;
- aprovação (online ou offline) e sua revalidação;
- alteração de perfil, permissão ou parâmetro;
- pareamento e revogação de dispositivo;
- acesso a relatório financeiro e consulta ao log.

Regras: `log_auditoria` é **append-only** (mesmo trigger do ledger); **nunca** registra senha, PIN ou token; `antes/depois` guardam só o necessário (LGPD: coletar o mínimo); eventos nascidos offline carregam `chave_idempotencia`.

---

## 7. Parâmetros (tabela, não código)

| Chave | Proposta inicial |
|---|---|
| `offline_max_horas` | 12 (limite brando; extensão em blocos de 12 h) |
| `pin_tentativas_max` | 5 |
| `sessao_access_minutos` | 15 |
| `sessao_refresh_dias` | 7 |
| `login_tentativas_max` | 5 (espera crescente) |
| `senha_tamanho_minimo` | 8 |
| `pareamento_expira_minutos` | 10 |

---

## 8. Casos de teste

| # | Dado | Quando | Então |
|---|---|---|---|
| T-A01 | Vendedor | Chama a rota de ajuste de estoque | 403; evento em `log_auditoria`; a tela escondida não conta, o teste é na API |
| T-A02 | Vendedor com limite 5% | Aplica 5,00% e depois 5,01% | 5,00% passa; 5,01% exige aprovação |
| T-A03 | Aprovação offline do Gerente, depois sincroniza | Servidor revalida | Venda aceita; aprovação `VALIDA`; evento auditado |
| T-A04 | Aprovação offline cujo aprovador não tem permissão | Sincroniza | Venda **registrada**; aprovação `EM_REVISAO`; aparece para o ADM |
| T-A05 | Solicitante = aprovador | Tenta gravar | Rejeitado pelo CHECK |
| T-A06 | 5 PINs errados offline | Tenta o sexto | Bloqueado até voltar online |
| T-A07 **[v1.1]** | Passou de `offline_max_horas`, sem extensão | Vende | Venda aceita em **modo contingência**, marcada para revisão; o PDV nunca trava |
| T-A08 | Dispositivo revogado | Sincroniza vendas | Operações vão para revisão, não são aplicadas nem apagadas |
| T-A09 | Usuário desativado | Usa refresh token | Sessão revogada; nova emissão negada |
| T-A10 | Qualquer resposta da API ou log | Inspeciona | Nenhuma senha, PIN, hash ou token aparece |
| T-A11 | Login falho 5 vezes | Tenta de novo | Bloqueio temporário; mensagem genérica |
| T-A12 | Cache offline de um Vendedor | Inspeciona o IndexedDB | Sem custo nem margem |
| T-A13 | `UPDATE` ou `DELETE` em `log_auditoria` | Tenta | Banco rejeita |
| T-A14 | Mesma aprovação enviada 3x | Sincroniza | 1 registro (idempotência) |
| T-A15 **[v1.1]** | Passou de `offline_max_horas`; Gerente ou ADM digita o PIN | Estende | Janela +12 h; `aprovacao` EXTENSAO_OFFLINE gravada e auditada |
| T-A16 **[v1.1]** | Usuário Suporte | Tenta criar venda ou ver custo | 403 |
| T-A17 **[v1.1]** | Usuário Suporte | Tenta atribuir perfil ADM ou resetar a senha do ADM | Rejeitado; tentativa auditada |
| T-A18 **[v1.1]** | Código de recuperação do ADM usado duas vezes | Tenta o segundo uso | Rejeitado; o primeiro uso consta na auditoria |

---

## 9. Decisões (ADRs rascunho)

| ID | Decisão | Alternativa | Status |
|---|---|---|---|
| D-21 | Perfis e permissões em tabela; `limite_desconto_bp` no perfil | Perfis fixos em código | **Aprovada [v1.1]** |
| D-22 | Access token curto em memória + refresh rotativo em cookie httpOnly | JWT longo no `localStorage` | **Aprovada [v1.1]** |
| D-23 | Login completo online; offline só **desbloqueio por PIN** de quem já logou no aparelho, com janela de 12 h como **limite brando** (extensão por Gerente/ADM; sem extensão, modo contingência com revisão) | Login offline completo; corte duro após 12 h | **Aprovada [v1.1]** |
| D-24 | Aprovação offline registrada, revalidada no servidor; falha = revisão, nunca descarte | Bloquear a venda sem aprovação online | **Aprovada [v1.1]** |
| D-25 | Dispositivos pareados por código de uso único e revogáveis; operações de aparelho revogado vão para revisão | Aparelhos anônimos | **Aprovada [v1.1]** |
| D-26 | Auditoria append-only, com idempotência para eventos offline | Log de aplicação em arquivo | **Aprovada [v1.1]** |
| D-27 | Cache offline respeita permissões (sem custo/margem para Vendedor) | Cache igual para todos | **Aprovada [v1.1]** |
| D-28 **[v1.1]** | Perfil SUPORTE para o desenvolvedor, com permissões mínimas e tudo auditado | Dar perfil ADM ao desenvolvedor | Proposta |
| D-29 **[v1.1]** | Códigos de recuperação de uso único para o ADM; emergência manual documentada | Suporte reseta a senha do ADM | Proposta |
| D-30 **[v1.1]** | `dispositivo.revogar` para Gerente, ADM e Suporte | Só ADM revoga | **Aprovada** |

---

## 10. Perguntas

**Respondidas [v1.1]**
- **Q-A1:** o offline é uma precaução; manter 12 h, mas o sistema precisa atender se durar mais. As 12 h viraram limite brando (seção 5.2).
- **Q-A2:** PIN e demais medidas de segurança aprovados.
- **Q-A3:** 3 usuários: 1 Vendedor, 1 ADM (o dono) e 1 Suporte (o desenvolvedor).
- **Q-A4:** o dono é o único ADM. Daí os códigos de recuperação (5.7) e a conta SUPORTE (5.8).
- **Q-A5:** Gerente e ADM aprovam cancelamento e devolução (confirmado).
- **Q-A6:** Gerente ou ADM revogam dispositivo (`dispositivo.revogar`).

**Respondidas pelo dono [v1.1]**
- **Q-A7:** conta de Suporte do desenvolvedor autorizada, com acesso a dados reais só quando o dono liberar.
- **Q-A8:** cancelamento, devolução e desconto acima de 5% são aprovados pelo **Gerente**. O ADM também tem essas permissões. Quem ocupa o perfil Gerente o dono ainda indica; até lá, o ADM (dono) aprova.

---

## 11. Próximos passos

1. Sem pendências de negócio que bloqueiem o código (falta só o dono indicar quem será o Gerente).
2. Registrar as ADRs dos documentos 01 e 02 em `docs/adr/`.
3. Arquivo de contexto para Cursor/Antigravity: rascunho (`AGENTS.md`) enviado para curadoria.
4. Subir o projeto base: repositório, Docker, Postgres, migrações e o módulo de autenticação, escrevendo primeiro os testes T-A01 a T-A18.
5. Primeiro módulo de negócio: Produtos + Estoque (ledger), a partir dos testes T-01 a T-22 do documento 01.
