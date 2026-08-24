-- =====================================================================
-- migracao-interseries.sql — o CETEC Interséries, do zero
-- =====================================================================
-- POR QUE ESTA MIGRAÇÃO EXISTE
--
-- O interséries é uma competição entre turmas com uma camada de apostas de
-- moeda fictícia por cima. As duas coisas são separadas de propósito: o site
-- esportivo tem que continuar fazendo sentido com as apostas desligadas
-- (`is_config.dados.ativo = false`).
--
-- Tudo aqui tem prefixo `is_`. Nada toca em tabela existente do CETECritic:
-- a única coisa compartilhada com o festival é a sessão do usuário
-- (`usuarios` / `sessoes`), lida pelo `api/interseries.js`.
--
-- COMO RODAR
--   1. Supabase → SQL Editor → cole este arquivo inteiro → Run.
--   2. O primeiro SELECT diz o que já existe (deve vir tudo `false` na
--      primeira vez). O último SELECT prova que funcionou.
--   3. É seguro rodar duas vezes: tudo é IF NOT EXISTS / OR REPLACE, e o
--      seed do `is_config` é ON CONFLICT DO NOTHING.
--
-- TRÊS DECISÕES QUE PARECEM ARBITRÁRIAS E NÃO SÃO
--
--   · Não existe coluna `saldo`. Existe `is_lancamentos`, append-only, e o
--     saldo é a soma (view `is_saldos`). O PostgREST não expõe transação —
--     um `UPDATE saldo = saldo - 100` concorrente perde lançamento em
--     silêncio e não deixa rastro. Se aparecer um UPDATE ou DELETE em
--     `is_lancamentos` no código, é bug.
--
--   · Não existe coluna de classificação. É a view `is_classificacao`,
--     somada das partidas encerradas. Número guardado e número calculado
--     sempre divergem, e quando divergem ninguém sabe qual está certo.
--
--   · `is_fases.tipo` só tem DOIS valores: 'classificatoria' e 'mata_mata'.
--     Pontos corridos é uma fase 'classificatoria' sem nenhuma linha em
--     `is_grupos`. Não invente um terceiro tipo — a view is_classificacao
--     depende desse par (ver o comentário grande antes dela).
-- =====================================================================


-- ─── Conferência de entrada ────────────────────────────────────────────
-- Roda ANTES de qualquer alteração. Na primeira execução vem tudo false.
SELECT
  to_regclass('public.is_temporadas')  IS NOT NULL AS ja_tem_temporadas,
  to_regclass('public.is_partidas')    IS NOT NULL AS ja_tem_partidas,
  to_regclass('public.is_lancamentos') IS NOT NULL AS ja_tem_lancamentos,
  to_regclass('public.rate_limite')    IS NOT NULL AS tem_rate_limite,
  to_regclass('public.usuarios')       IS NOT NULL AS tem_usuarios;
-- `tem_rate_limite` importa: sem essa tabela (migracao-seguranca.sql) o
-- limite de taxa do interséries LIBERA TUDO e só avisa no log. É de
-- propósito — migração pendente não pode derrubar o site no meio do
-- evento — mas é bom saber em qual dos dois mundos você está.


-- =====================================================================
-- 1 · COMPETIÇÃO
-- =====================================================================

-- A temporada é o guarda-chuva de um ano de interséries. `status` governa a
-- mesada: só temporada 'ativa', dentro da janela, credita ficha por dia.
CREATE TABLE IF NOT EXISTS is_temporadas (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  comeca_em   timestamptz,
  termina_em  timestamptz,
  status      text NOT NULL DEFAULT 'rascunho',  -- rascunho|ativa|encerrada
  criado_em   timestamptz NOT NULL DEFAULT now()
);

-- A CATEGORIA é a unidade que importa. Não é "vôlei" — é "vôlei feminino".
-- Cada uma tem regulamento, chaveamento, tabela e campeão próprios.
--
-- Todo campo de regra mora aqui como DADO, nunca como `if` no código: é o
-- que permite o futsal masculino ter 12 turmas com grupos e o handebol
-- feminino ter 4 em chave única sem uma linha de código nova.
CREATE TABLE IF NOT EXISTS is_categorias (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  temporada_id   bigint NOT NULL REFERENCES is_temporadas(id),
  modalidade     text NOT NULL,                   -- 'Futsal', 'Vôlei', …
  naipe          text NOT NULL DEFAULT 'livre',   -- masculino|feminino|misto|livre
  nome           text NOT NULL,                   -- 'Futsal masculino'
  slug           text NOT NULL,                   -- 'futsal-masculino'
  formato        text NOT NULL DEFAULT 'grupos_mata_mata',
                 -- grupos_mata_mata | pontos_corridos | mata_mata | chave_unica
  placar_tipo    text NOT NULL DEFAULT 'gols',    -- gols | sets | pontos
  permite_empate boolean NOT NULL DEFAULT true,
  pontos_vitoria int NOT NULL DEFAULT 3,
  pontos_empate  int NOT NULL DEFAULT 1,
  pontos_derrota int NOT NULL DEFAULT 0,
  desempate      text[] NOT NULL
                 DEFAULT ARRAY['pontos','vitorias','saldo','pro','confronto'],
  status         text NOT NULL DEFAULT 'inscricoes',
                 -- inscricoes | em_andamento | encerrada
  ordem          int NOT NULL DEFAULT 0,
  UNIQUE (temporada_id, slug)
);
-- O slug é a chave natural dos CSVs. É ele, e não o `nome`, que sobrevive a
-- alguém corrigir o título da categoria no meio do evento.

-- A equipe é a turma. `sigla` é a chave natural dos CSVs — curta, digitável
-- à beira da quadra, estável.
CREATE TABLE IF NOT EXISTS is_equipes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  temporada_id bigint NOT NULL REFERENCES is_temporadas(id),
  nome         text NOT NULL,        -- '3º B'
  sigla        text NOT NULL,        -- '3B'  (chave natural nos CSVs)
  turma        text,
  serie        text,
  cor          text,                 -- '#e63946' — usada só como faixa de 3px
  escudo       text,                 -- URL no Storage
  UNIQUE (temporada_id, sigla)
);
-- `cor` NUNCA vira fundo na interface: é cor escolhida por turma, sem
-- compromisso com contraste, e o site tem tema claro e escuro.

-- "o 3º B disputa o futsal misto". Separada de `is_grupo_equipes` de
-- propósito: aquela diz "e está no Grupo A", e em chave única não existe.
CREATE TABLE IF NOT EXISTS is_categoria_equipes (
  categoria_id bigint NOT NULL REFERENCES is_categorias(id) ON DELETE CASCADE,
  equipe_id    bigint NOT NULL REFERENCES is_equipes(id),
  PRIMARY KEY (categoria_id, equipe_id)
);

CREATE TABLE IF NOT EXISTS is_fases (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categoria_id bigint NOT NULL REFERENCES is_categorias(id) ON DELETE CASCADE,
  nome         text NOT NULL,        -- 'Fase de grupos', 'Semifinal'
  tipo         text NOT NULL,        -- classificatoria | mata_mata  (SÓ ESTES DOIS)
  ordem        int  NOT NULL DEFAULT 0,
  num_vagas    int                   -- 8, 4, 2 … só em mata_mata
);
-- Pontos corridos é uma fase 'classificatoria' SEM nenhuma linha em is_grupos.
-- Não invente um terceiro tipo: a view is_classificacao depende deste par.

CREATE TABLE IF NOT EXISTS is_grupos (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fase_id bigint NOT NULL REFERENCES is_fases(id) ON DELETE CASCADE,
  nome    text NOT NULL,             -- 'A'
  ordem   int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS is_grupo_equipes (
  grupo_id  bigint NOT NULL REFERENCES is_grupos(id) ON DELETE CASCADE,
  equipe_id bigint NOT NULL REFERENCES is_equipes(id),
  PRIMARY KEY (grupo_id, equipe_id)
);

-- A partida de mata-mata frequentemente NÃO SABE quem vai jogar nela: a
-- semifinal 1 é "vencedor da quarta 1 × vencedor da quarta 2". Por isso as
-- quatro colunas `origem_*`: `equipe_a`/`equipe_b` nascem nulos e são
-- preenchidos pelo servidor quando a partida de origem encerra.
--
-- `origem_*_tipo = 'perdedor'` existe para a DISPUTA DE 3º LUGAR, que todo
-- evento escolar tem e que quase toda modelagem esquece.
--
-- `vencedor_id` é derivado do placar quando há diferença e preenchido À MÃO
-- quando não há (pênaltis, set extra, critério de regulamento). A propagação
-- do chaveamento SEMPRE lê `vencedor_id`, nunca compara placar.
CREATE TABLE IF NOT EXISTS is_partidas (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  categoria_id     bigint NOT NULL REFERENCES is_categorias(id),
  fase_id          bigint REFERENCES is_fases(id),
  grupo_id         bigint REFERENCES is_grupos(id),
  rodada           int,
  chave_ordem      int,              -- posição no chaveamento (só desenho)
  equipe_a         bigint REFERENCES is_equipes(id),
  equipe_b         bigint REFERENCES is_equipes(id),
  origem_a_partida bigint REFERENCES is_partidas(id),
  origem_a_tipo    text,             -- vencedor | perdedor
  origem_b_partida bigint REFERENCES is_partidas(id),
  origem_b_tipo    text,
  comeca_em        timestamptz,
  local            text,
  placar_a         int,
  placar_b         int,
  vencedor_id      bigint REFERENCES is_equipes(id),
  status           text NOT NULL DEFAULT 'agendada',
                   -- agendada | ao_vivo | encerrada | cancelada | wo
  obs              text,
  corrigido_em     timestamptz,
  corrigido_por    text
);

CREATE TABLE IF NOT EXISTS is_atletas (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  temporada_id bigint NOT NULL REFERENCES is_temporadas(id),
  equipe_id    bigint NOT NULL REFERENCES is_equipes(id),
  nome         text NOT NULL,
  numero       int,
  posicao      text
);

-- A lista de `tipo` é aberta e depende da modalidade: vôlei não tem gol.
-- Fase 3 — as tabelas nascem agora porque custa zero; a tela só quando
-- houver certeza de que alguém vai anotar quem fez cada gol.
CREATE TABLE IF NOT EXISTS is_eventos_partida (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partida_id bigint NOT NULL REFERENCES is_partidas(id) ON DELETE CASCADE,
  atleta_id  bigint REFERENCES is_atletas(id),
  tipo       text NOT NULL,   -- gol|assistencia|cartao_amarelo|cartao_vermelho|ace|bloqueio|ponto
  minuto     int,
  periodo    text
);


-- =====================================================================
-- 2 · APOSTAS
-- =====================================================================

-- `escopo` diz o que o mercado resolve. `partida_id` nulo = mercado de
-- futuro (campeão da categoria, campeão geral, artilheiro).
-- Campo com dois usos — mas DOCUMENTADO, ao contrário do `alvo` da tabela
-- `carimbos`, que virou pegadinha justamente por não ter aviso.
--
-- `versao_liquidacao` é o que torna a reliquidação segura: cada rodada de
-- pagamento usa refs 'mercado:<id>:v<n>', então estornar a v0 e pagar a v1
-- não colide com nada.
CREATE TABLE IF NOT EXISTS is_mercados (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  temporada_id      bigint NOT NULL REFERENCES is_temporadas(id),
  categoria_id      bigint REFERENCES is_categorias(id),
  partida_id        bigint REFERENCES is_partidas(id),
  escopo            text NOT NULL,   -- partida | categoria | temporada
  tipo              text NOT NULL,   -- vencedor | margem | futuro | livre
  titulo            text NOT NULL,
  fecha_em          timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'aberto',
                    -- aberto | fechado | liquidado | cancelado
  opcao_vencedora   bigint,
  liquidado_em      timestamptz,
  versao_liquidacao int NOT NULL DEFAULT 0
);

-- As opções são LINHAS, não um enum no código. É o que permite um mercado
-- esquisito e divertido ("sai gol no primeiro minuto?") sem tocar em código.
CREATE TABLE IF NOT EXISTS is_opcoes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mercado_id bigint NOT NULL REFERENCES is_mercados(id) ON DELETE CASCADE,
  rotulo     text NOT NULL,
  equipe_id  bigint REFERENCES is_equipes(id),
  atleta_id  bigint REFERENCES is_atletas(id),
  ordem      int NOT NULL DEFAULT 0
);

-- ACRÉSCIMO AO BRIEF (11 · § 4): a FK de `opcao_vencedora` não estava lá.
-- Ela não impede o erro que realmente dói (apontar para a opção de OUTRO
-- mercado — isso é conferido no código, em liquidarMercado), mas impede id
-- inexistente e impede apagar a opção vencedora de um mercado já liquidado.
-- Se atrapalhar, `ALTER TABLE is_mercados DROP CONSTRAINT is_mercados_opcao_vencedora_fk;`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'is_mercados_opcao_vencedora_fk') THEN
    ALTER TABLE is_mercados
      ADD CONSTRAINT is_mercados_opcao_vencedora_fk
      FOREIGN KEY (opcao_vencedora) REFERENCES is_opcoes(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS is_apostas (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario    text NOT NULL,
  mercado_id bigint NOT NULL REFERENCES is_mercados(id),
  opcao_id   bigint NOT NULL REFERENCES is_opcoes(id),
  valor      int  NOT NULL CHECK (valor > 0),
  versao     int  NOT NULL DEFAULT 0,
  ts         timestamptz NOT NULL DEFAULT now()
);
-- ACRÉSCIMO AO BRIEF: a coluna `versao`.
-- O brief (11 · § 5.2) manda o reajuste de aposta usar as refs
-- `aposta:<id>:v<n>` e `aposta:<id>:v<n>:cancel`. Esse `<n>` precisa morar
-- em algum lugar: a linha da aposta é reaproveitada no reajuste (é uma
-- aposta por mercado, por pessoa), então sem um contador a segunda troca
-- reescreveria a mesma ref da primeira — e o índice único a engoliria em
-- silêncio, deixando um débito não cobrado. Um inteiro resolve.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='is_apostas' AND column_name='versao') THEN
    ALTER TABLE is_apostas ADD COLUMN versao int NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- O LIVRO-RAZÃO. A tabela mais importante do interséries.
--
-- APPEND-ONLY. Nunca sofre UPDATE nem DELETE. Corrigir não destrói:
-- placar digitado errado vira um `estorno` e uma nova liquidação, e o
-- extrato do usuário conta a história inteira sem ninguém abrir chamado.
--
-- `ref` é a chave determinística de idempotência. Formatos em uso:
--     inicial:<usuario>                 crédito de entrada, uma vez por conta
--     mesada:<usuario>:<AAAA-MM-DD>     uma por dia, em -03:00
--     aposta:<aposta_id>:v<n>           débito da aposta (n sobe a cada reajuste)
--     aposta:<aposta_id>:v<n>:cancel    estorno do débito acima
--     mercado:<id>:v<versao>            prêmio (ou estorno de "ninguém acertou")
--     mercado:<id>:v<versao>:estorno    desfazimento da versão, na reliquidação
--     sobra:mercado:<id>:v<versao>      resto do arredondamento, conta __sistema__
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS is_lancamentos (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario text NOT NULL,
  tipo    text NOT NULL,   -- mesada|aposta|premio|estorno|sobra|ajuste
  valor   bigint NOT NULL, -- com sinal
  ref     text,            -- chave determinística de idempotência
  motivo  text,
  ts      timestamptz NOT NULL DEFAULT now()
);

-- Linha única, jsonb, mesmo padrão do `config_site` do festival.
CREATE TABLE IF NOT EXISTS is_config (
  id    int PRIMARY KEY DEFAULT 1,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (id = 1)
);

-- Seed. `ON CONFLICT DO NOTHING` para esta migração poder rodar de novo sem
-- desfazer o que a equipe já ajustou no painel.
--
-- `_versao` existe para concorrência otimista: o UPDATE filtra por
-- `dados->>'_versao'` e devolve 409 se alguém salvou no meio. Sem isso, dois
-- admins salvando ao mesmo tempo perdem alteração em silêncio.
INSERT INTO is_config (id, dados) VALUES (1, '{
  "ativo": true,
  "temporada_atual": null,
  "saldo_inicial": 1000,
  "mesada_diaria": 250,
  "teto_percentual": 25,
  "aposta_minima": 10,
  "refresh_ms": { "padrao": 20000, "ao_vivo": 10000, "ocioso": 60000 },
  "_versao": 1
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
-- `temporada_atual` nasce null de propósito: quem define é o painel, depois
-- de criar a primeira temporada. Um id chutado aqui daria "temporada não
-- encontrada" numa tela em branco, que é pior do que "nenhuma temporada".


-- =====================================================================
-- 3 · ÍNDICES QUE NÃO SÃO OPCIONAIS
-- =====================================================================
-- Os dois primeiros não são performance: são a REGRA DE NEGÓCIO.
-- `is_lanc_ref_unico` é o que faz mesada e liquidação serem idempotentes —
-- a garantia é o índice, nunca uma verificação prévia em memória (duas abas
-- abertas quebram qualquer checagem). `is_aposta_unica` é "uma aposta por
-- mercado, por pessoa", que simplifica tela, liquidação e explicação.
-- ⚠️ CORREÇÃO DO BRIEF, e ela é obrigatória. LEIA ANTES DE "CONSERTAR" DE VOLTA.
--
-- O brief (11 · § 4) escreve este índice com `WHERE ref IS NOT NULL`. Com o
-- predicado parcial, o Postgres NÃO consegue inferir o índice a partir de
-- `ON CONFLICT (usuario, tipo, ref)` — a inferência com índice parcial exige
-- repetir o predicado na cláusula, e o PostgREST não tem como mandar isso.
-- O erro exato, verificado em Postgres 16:
--
--     ERROR: there is no unique or exclusion constraint matching the
--            ON CONFLICT specification
--
-- Ou seja: o índice parcial quebra o `.upsert({ onConflict:'usuario,tipo,ref',
-- ignoreDuplicates:true })` que o PRÓPRIO brief prescreve na § 6.2 para a
-- liquidação idempotente. As duas metades do documento não fecham.
--
-- E o predicado é redundante: num índice único comum, NULL é distinto de
-- NULL, então linhas com `ref IS NULL` (o `ajuste` manual, por exemplo)
-- continuam podendo coexistir aos montes sem ele. Verificado também.
--
-- Logo: sem o WHERE. Mesma semântica, e o upsert passa a funcionar.
DO $$
BEGIN
  /* se um banco já recebeu a versão parcial, troca pela boa */
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'is_lanc_ref_unico'
                AND indexdef LIKE '%WHERE%') THEN
    DROP INDEX is_lanc_ref_unico;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS is_lanc_ref_unico
  ON is_lancamentos (usuario, tipo, ref);

CREATE UNIQUE INDEX IF NOT EXISTS is_aposta_unica
  ON is_apostas (usuario, mercado_id);

CREATE INDEX IF NOT EXISTS is_partidas_agenda ON is_partidas (comeca_em);
CREATE INDEX IF NOT EXISTS is_partidas_cat    ON is_partidas (categoria_id, status);
CREATE INDEX IF NOT EXISTS is_mercados_fecha  ON is_mercados (fecha_em, status);
CREATE INDEX IF NOT EXISTS is_lanc_usuario    ON is_lancamentos (usuario);

-- ACRÉSCIMOS AO BRIEF: consultas que a API faz em toda carga de tela.
CREATE INDEX IF NOT EXISTS is_partidas_fase   ON is_partidas (fase_id);
CREATE INDEX IF NOT EXISTS is_partidas_origem_a ON is_partidas (origem_a_partida);
CREATE INDEX IF NOT EXISTS is_partidas_origem_b ON is_partidas (origem_b_partida);
CREATE INDEX IF NOT EXISTS is_mercados_partida ON is_mercados (partida_id);
CREATE INDEX IF NOT EXISTS is_opcoes_mercado  ON is_opcoes (mercado_id);
CREATE INDEX IF NOT EXISTS is_apostas_mercado ON is_apostas (mercado_id);
CREATE INDEX IF NOT EXISTS is_eventos_partida_idx ON is_eventos_partida (partida_id);
CREATE INDEX IF NOT EXISTS is_categorias_temporada ON is_categorias (temporada_id, ordem);


-- =====================================================================
-- 4 · AS TRÊS VIEWS
-- =====================================================================

-- ⚠️ LEIA ISTO ANTES DE SIMPLIFICAR A is_classificacao.
--
-- O join com is_fases e o filtro tipo='classificatoria' NÃO são decoração.
-- Partida de mata-mata tem grupo_id nulo; partida de pontos corridos também.
-- Sem o filtro, as duas caem no mesmo balde e uma final vencida por 5x0
-- entra na classificação como se fosse mais uma rodada.
--
-- Testado: numa simulação com três jogos de pontos corridos e uma final, o
-- líder aparecia com 3 jogos / 8 gols pró / 6 pontos onde o certo era
-- 2 jogos / 3 gols / 3 pontos. Plausível o bastante para ninguém desconfiar
-- olhando a tela — que é a pior espécie de bug que este projeto conhece.
--
-- SEGUNDA ARMADILHA, e a correção dela é de quem LÊ esta view: equipe que
-- ainda não jogou NÃO APARECE aqui. Um GROUP BY não inventa linhas. No
-- começo da competição a tabela nasceria vazia, o que parece bug e não é.
-- Monte a tabela a partir de is_grupo_equipes (ou is_categoria_equipes, em
-- chave única) e faça o merge, zerando quem não tiver linha.
CREATE OR REPLACE VIEW is_classificacao AS
WITH lados AS (
  SELECT p.categoria_id, p.grupo_id, p.equipe_a AS equipe_id,
         p.placar_a AS pro, p.placar_b AS contra
    FROM is_partidas p
    JOIN is_fases   f ON f.id = p.fase_id
   WHERE p.status = 'encerrada' AND f.tipo = 'classificatoria'
     AND p.equipe_a IS NOT NULL AND p.equipe_b IS NOT NULL
     AND p.placar_a IS NOT NULL AND p.placar_b IS NOT NULL
  UNION ALL
  SELECT p.categoria_id, p.grupo_id, p.equipe_b, p.placar_b, p.placar_a
    FROM is_partidas p
    JOIN is_fases   f ON f.id = p.fase_id
   WHERE p.status = 'encerrada' AND f.tipo = 'classificatoria'
     AND p.equipe_a IS NOT NULL AND p.equipe_b IS NOT NULL
     AND p.placar_a IS NOT NULL AND p.placar_b IS NOT NULL
)
SELECT l.categoria_id, l.grupo_id, l.equipe_id,
       count(*)::int                                  AS jogos,
       count(*) FILTER (WHERE l.pro > l.contra)::int   AS vitorias,
       count(*) FILTER (WHERE l.pro = l.contra)::int   AS empates,
       count(*) FILTER (WHERE l.pro < l.contra)::int   AS derrotas,
       coalesce(sum(l.pro), 0)::int                    AS pontos_pro,
       coalesce(sum(l.contra), 0)::int                 AS pontos_contra,
       coalesce(sum(l.pro) - sum(l.contra), 0)::int    AS saldo,
       (count(*) FILTER (WHERE l.pro > l.contra) * c.pontos_vitoria
      + count(*) FILTER (WHERE l.pro = l.contra) * c.pontos_empate
      + count(*) FILTER (WHERE l.pro < l.contra) * c.pontos_derrota)::int
                                                       AS pontos
  FROM lados l
  JOIN is_categorias c ON c.id = l.categoria_id
 GROUP BY l.categoria_id, l.grupo_id, l.equipe_id,
          c.pontos_vitoria, c.pontos_empate, c.pontos_derrota;

-- O saldo de fichas. Existe porque o PostgREST não faz GROUP BY e o placar
-- precisa exatamente disso. Lida como se fosse tabela — e sempre com
-- .limit() explícito no cliente, pelo motivo de sempre.
CREATE OR REPLACE VIEW is_saldos AS
SELECT usuario, sum(valor)::bigint AS saldo,
       count(*) AS lancamentos, max(ts) AS ultimo_ts
  FROM is_lancamentos GROUP BY usuario;

CREATE OR REPLACE VIEW is_artilharia AS
SELECT p.categoria_id, e.atleta_id, a.equipe_id, count(*)::int AS gols
  FROM is_eventos_partida e
  JOIN is_atletas  a ON a.id = e.atleta_id
  JOIN is_partidas p ON p.id = e.partida_id
 WHERE e.tipo = 'gol'
 GROUP BY p.categoria_id, e.atleta_id, a.equipe_id;


-- =====================================================================
-- 5 · RLS — ACRÉSCIMO AO BRIEF, e é seguro
-- =====================================================================
-- O servidor fala com o banco pela SUPABASE_SECRET_KEY (service role), que
-- IGNORA RLS: nada abaixo muda uma vírgula do comportamento do
-- api/interseries.js. O que isto faz é fechar a porta da `anon key` — e
-- estas tabelas guardam saldo de ficha e aposta de gente identificada.
--
-- Ligar RLS sem criar policy nenhuma = ninguém além do servidor lê ou
-- escreve. É o estado desejado: o navegador NUNCA fala com o banco direto
-- neste projeto.
--
-- Se algum dia isso atrapalhar, o desfazimento é uma linha por tabela:
--     ALTER TABLE is_xxx DISABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'is_temporadas','is_categorias','is_equipes','is_categoria_equipes',
    'is_fases','is_grupos','is_grupo_equipes','is_partidas','is_atletas',
    'is_eventos_partida','is_mercados','is_opcoes','is_apostas',
    'is_lancamentos','is_config'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;


-- =====================================================================
-- 6 · O PRIMEIRO is_admin — RODE ISTO, TROCANDO O NOME
-- =====================================================================
-- Os papéis do interséries vivem em `is_config.dados.equipe`, um mapa
-- { "usuario": "is_papel" }. Ficam aqui, e não em `usuarios.papel`, por
-- duas razões: aquela coluna é dos TRÊS PAPÉIS DO FESTIVAL e mexer nela
-- seria mexer no api/_moderacao.js (que este trabalho combinou não tocar),
-- e a equipe do interséries provavelmente não é a mesma do festival.
--
-- Um `admin = true` do CETECritic NÃO vira is_admin sozinho: conceder é ato
-- explícito. Por isso o PRIMEIRO papel sai daqui, na mão — depois dele, o
-- resto da equipe se cadastra pela aba Config do painel.
--
-- Troque 'SEU_USUARIO' pelo seu nome de usuário do CETECritic e rode:
--
--     UPDATE is_config
--        SET dados = jsonb_set(dados, '{equipe}',
--                    coalesce(dados->'equipe','{}'::jsonb) ||
--                    jsonb_build_object('SEU_USUARIO','is_admin'))
--      WHERE id = 1;
--
-- Confira com:
--     SELECT dados->'equipe' FROM is_config WHERE id = 1;
--
-- Papéis válidos: is_admin (tudo) · is_esportes (competição, resultados,
-- CSV) · is_apostas (mercados, liquidação, fichas).
-- Separar os dois últimos é de propósito: quem digita o placar decide quem
-- ganha fichas.


-- =====================================================================
-- 7 · PROVA DE QUE FUNCIONOU
-- =====================================================================
-- 15 tabelas, 3 views, 2 índices únicos, 1 linha de config.
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'is\_%'
      AND table_type = 'BASE TABLE')                            AS tabelas,
  (SELECT count(*) FROM information_schema.views
    WHERE table_schema = 'public' AND table_name LIKE 'is\_%')   AS views,
  (SELECT count(*) FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('is_lanc_ref_unico','is_aposta_unica'))  AS indices_de_regra,
  (SELECT count(*) FROM is_config)                              AS linhas_config,
  (SELECT dados->>'ativo' FROM is_config WHERE id = 1)          AS interseries_ativo;
-- Esperado:  tabelas=15  views=3  indices_de_regra=2  linhas_config=1  ativo=true

-- A economia fecha? Rode isto depois de cada dia de jogo.
-- A identidade é: saldos = entradas - em_jogo, porque em todo mercado já
-- resolvido `prêmios + sobra == bolo` (liquidado) ou `estornos == bolo`
-- (cancelado / ninguém acertou). Só o mercado ainda aberto tem ficha
-- debitada sem contrapartida.
SELECT
  (SELECT coalesce(sum(valor),0) FROM is_lancamentos)                    AS saldos,
  (SELECT coalesce(sum(valor),0) FROM is_lancamentos
     WHERE tipo IN ('mesada','ajuste'))                                  AS entradas,
  (SELECT coalesce(sum(a.valor),0) FROM is_apostas a
     JOIN is_mercados m ON m.id = a.mercado_id
    WHERE m.status IN ('aberto','fechado'))                              AS em_jogo;
-- deve valer:  saldos = entradas - em_jogo
-- (num banco recém-migrado os três são 0, e 0 = 0 - 0.)
