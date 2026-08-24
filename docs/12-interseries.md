# Interséries — o que foi construído, onde vai cada coisa

> Esta pasta é `_interseries/`, isolada de propósito. Os arquivos estão na
> estrutura final: `api/` vai para `api/`, `assets/` vai para `assets/`, o
> resto vai para a raiz. Mover é copiar preservando as pastas.
>
> Nada aqui sobrescreve arquivo existente sem você mandar. Os dois arquivos
> que **precisam** mudar estão em `alterar/`, já patchados, prontos para
> `diff` antes de trocar.

---

## 1 · Onde vai cada arquivo

```
_interseries/migracao-interseries.sql   →  migracao-interseries.sql   (raiz)
_interseries/api/interseries.js         →  api/interseries.js
_interseries/api/_interseries_regras.js →  api/_interseries_regras.js
_interseries/interseries-template.html  →  interseries-template.html  (raiz)
_interseries/admin-interseries.html     →  admin-interseries.html     (raiz)
_interseries/assets/interseries.js      →  assets/interseries.js
_interseries/assets/interseries.css     →  assets/interseries.css
_interseries/testes/interseries.test.js       →  testes/interseries.test.js
_interseries/testes/carregar-interseries.js   →  testes/carregar-interseries.js

_interseries/alterar/vercel.json        →  SUBSTITUI vercel.json
_interseries/alterar/service-worker.js  →  SUBSTITUI service-worker.js
```

O `_` de `api/_interseries_regras.js` **não é estilo**: arquivo que começa
com `_` não vira rota na Vercel. É como o projeto já mantém `api/_moderacao.js`
importável sem ficar exposto na web.

### O que muda nos dois arquivos existentes

`vercel.json` — dois rewrites, colocados **depois** de todas as regras que
terminam em `.js` e **antes** da regra genérica `/:ano(\d{4})/:pagina(.+\.html)`:

```diff
+    { "source": "/interseries",         "destination": "/interseries-template.html" },
+    { "source": "/interseries/:resto*", "destination": "/interseries-template.html" },
+
     { "source": "/:ano(\\d{4})/:pagina(.+\\.html)", "destination": "/edicao-template.html" },
```

`service-worker.js` — três rotas no `PRECACHE` e o `CACHE_VERSION` de
`v36` para `v37`. `/api/*` continua nunca sendo cacheado.

**Depois de trocar o `vercel.json`, confira que `/2026/edicao.js` continua
funcionando.** É o arquivo mais fácil do projeto de quebrar sem perceber.

---

## 2 · Como colocar de pé (ordem exata)

1. **Rode o SQL.** Supabase → SQL Editor → cole `migracao-interseries.sql`
   inteiro → Run. O primeiro `SELECT` diz o que já existe; o último prova
   que funcionou (esperado: `tabelas=15 views=3 indices_de_regra=2
   linhas_config=1 ativo=true`). É seguro rodar duas vezes.

2. **Conceda o primeiro papel**, trocando o nome — está na § 6 do próprio
   `.sql`:

   ```sql
   UPDATE is_config
      SET dados = jsonb_set(dados, '{equipe}',
                  coalesce(dados->'equipe','{}'::jsonb) ||
                  jsonb_build_object('SEU_USUARIO','is_admin'))
    WHERE id = 1;
   ```

   Um `admin = true` do CETECritic **não** ganha papel automaticamente —
   é a regra do brief, e ela vale inclusive para você. Depois deste
   primeiro, o resto da equipe entra pela aba **Config** do painel.

3. **Mova os arquivos**, troque `vercel.json` e `service-worker.js`, publique.

4. **Abra `/admin-interseries.html`** e olhe a aba **Diagnóstico**. Ela diz,
   em dois segundos, o que está ligado de verdade: papel, versão do build,
   interruptor, e se a tabela `rate_limite` existe. Se ela não existir, os
   limites de taxa **liberam tudo** e só avisam no log — é de propósito
   (migração pendente não pode derrubar o site no meio do evento), mas é
   melhor saber em qual dos dois mundos você está.

5. **Crie a temporada**, marque `ativa`, e vá pelas abas na ordem em que
   elas aparecem. O importador de CSV é o caminho rápido para equipes e
   partidas — uma tabela de futsal com 12 turmas tem 66 jogos só na fase de
   grupos.

6. **Rode os testes**: `npm test`. São 51, todos puros, sem banco.

---

## 3 · Onde o brief não fechava, e o que eu fiz

Estas são as decisões que valem sua revisão. Nenhuma foi tomada em silêncio.

### 3.1 ⚠️ O índice único do razão **não pode** ser parcial (corrigido)

O brief escreve, na § 4:

```sql
CREATE UNIQUE INDEX is_lanc_ref_unico
  ON is_lancamentos (usuario, tipo, ref) WHERE ref IS NOT NULL;
```

e, na § 6.2, manda a liquidação usar:

```js
.upsert(linhas, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true })
```

**As duas metades não fecham.** Com o predicado parcial, o Postgres não
consegue inferir o índice a partir de `ON CONFLICT (usuario, tipo, ref)` —
a inferência com índice parcial exige repetir o predicado na cláusula, e o
PostgREST não tem como mandar isso. Verificado em Postgres 16:

```
ERROR: there is no unique or exclusion constraint matching
       the ON CONFLICT specification
```

Isso quebraria **a mesada e a liquidação inteiras** — as duas coisas cuja
idempotência é a razão de o índice existir.

E o predicado é redundante: num índice único comum, `NULL` é distinto de
`NULL`, então linhas com `ref IS NULL` (o `ajuste` manual) continuam
coexistindo sem ele. Também verificado.

**Fiz sem o `WHERE`.** Mesma semântica, e o upsert passa a funcionar. O
`.sql` carrega essa explicação inteira, para ninguém "consertar" de volta.

### 3.2 `is_apostas` ganhou uma coluna `versao`

O brief manda o reajuste de aposta usar as refs `aposta:<id>:v<n>` e
`aposta:<id>:v<n>:cancel`. Esse `<n>` precisa morar em algum lugar: a linha
da aposta é reaproveitada no reajuste (é uma aposta por mercado, por
pessoa), então sem um contador a segunda troca reescreveria a mesma ref da
primeira — e o índice único a engoliria **em silêncio**, deixando um débito
não cobrado. Um `int NOT NULL DEFAULT 0` resolve.

### 3.3 Onde moram os papéis do interséries

O brief define os três papéis (`is_admin`, `is_esportes`, `is_apostas`) mas
não diz onde eles ficam — e `usuarios.papel` é dos três papéis do festival,
com a lista fixa em `api/_moderacao.js`, que este trabalho não podia tocar.
O doc 10 § 13 lista isso como decisão em aberto.

**Escolhi `is_config.dados.equipe`**, um mapa `{ "usuario": "is_papel" }`,
editado pela aba Config do painel. Sem tabela nova, sem tocar em `usuarios`,
com a mesma concorrência otimista (`_versao`) do `config_site`. O primeiro
papel sai por SQL (§ 2 acima) justamente para "conceder é ato explícito"
continuar sendo verdade.

**Se você preferir outro lugar**, o único ponto a mexer é `papelIS()` em
`api/_interseries_regras.js`.

### 3.4 Placar por turma: de onde vem a turma de cada pessoa

O contrato da API pede `?placar=1&por=turma`, mas nada no CETECritic diz a
que turma um usuário pertence — não existe esse campo. O doc 10 § 13 lista
"placar por turma" como aberto e aposta que é o recurso mais valioso da
lista, e eu concordo: é ele que gera a rivalidade, que é o ponto do evento.

**Fiz um mapa `is_config.dados.turmas`** (`usuario=SIGLA`, uma linha por
pessoa), com uma caixa de texto na aba Config — dá para colar direto de uma
planilha. Quem não estiver no mapa aparece só no placar individual, nunca
somado à turma errada.

Alternativa que vale considerar depois: deixar a própria pessoa escolher a
turma uma vez, na primeira aposta. Não fiz porque isso pede uma ação nova na
API, e ação nova não estava na lista do brief.

### 3.5 A liquidação automática cobre só o mercado de **vencedor**

O brief diz que `salvarResultado` faz `liquidarMercadosDaPartida(partida_id)`
sem qualificar. Implementei assim: **liquida sozinho o que dá para liquidar
sozinho, e devolve a lista do que precisa de gente.**

O mercado de `vencedor` tem o conjunto de opções exatamente `{Equipe A,
Empate?, Equipe B}`, e `is_opcoes.equipe_id` diz sem ambiguidade qual é
qual — resolve sozinho, e resolve por `vencedor_id` (pênaltis contam).

`margem` e `livre` **não** resolvem sozinhos, e isso é decisão, não
preguiça: a faixa ("A por 1–2", "2–1 A") mora no **rótulo**, que é texto
livre editável pelo painel. Um resolvedor que lê rótulo erra calado no dia
em que alguém escrever "A por 1-2" com hífen simples. Eles vão para a fila
de liquidação, com prévia do rateio — e a prévia mostra `pago + sobra =
bolo` **antes** de gravar, com o botão bloqueado se a conta não fechar.

Pelo mesmo motivo, **importar `resultados.csv` não liquida mercado nenhum**:
importar 60 resultados de uma vez e pagar 60 mercados sem ninguém olhar é
exatamente como se perde a confiança de todo mundo ao mesmo tempo.

### 3.6 Acréscimos pequenos ao DDL

- **FK em `is_mercados.opcao_vencedora`** → `is_opcoes(id)`. Não impede o
  erro que dói (apontar para a opção de outro mercado — isso é conferido no
  código), mas impede id inexistente e impede apagar a opção vencedora de um
  mercado liquidado.
- **RLS ligado** em todas as tabelas `is_*`, sem policy nenhuma. O servidor
  usa a `SUPABASE_SECRET_KEY` (service role), que **ignora RLS** — nada
  muda no comportamento da API. O que isso faz é fechar a porta da `anon
  key`, e estas tabelas guardam saldo de ficha e aposta de gente
  identificada. Desfazer é uma linha por tabela, e está escrito no `.sql`.
- **Oito índices a mais**, todos de consultas que a API faz em toda carga de
  tela (`is_partidas(fase_id)`, `is_opcoes(mercado_id)`, etc.).

### 3.7 As cópias declaradas

Você escolheu **copiar** em vez de extrair `assets/comum.js`, então:

- `assets/interseries.js` começa com um bloco **EMPRESTADO DO core.js**,
  nomeando cada função copiada e a seção de origem: tema, sessão, `agora()`,
  `intervaloVisivel`, `esc`, registro do service worker.
- `api/interseries.js` reescreve `verificarToken` e `barreiraModeracao` do
  `api/db.js` (que não exporta nada — é uma função serverless, não um
  módulo), também com o aviso no topo.
- `ordenarClassificacao` existe nos **dois lados** (o servidor precisa dela
  para semear o chaveamento; o cliente, para desenhar a tabela). O que
  impede as cópias de divergirem é o teste
  *"api/_interseries_regras.js e assets/interseries.js têm o MESMO
  desempate"* — 300 tabelas sorteadas comparadas linha a linha. É o mesmo
  arranjo do `BOLAO_FAIXAS`.

**Se um dia extrair o `comum.js`**, os blocos a apagar estão todos marcados.

### 3.8 O painel carrega o bundle do site

`admin-interseries.html` faz `<script src="/assets/interseries.js">` para
reusar `agora()`, `apiIS()`, `esc()`, `lerCsv()` e a leitura da sessão —
uma cópia só, não duas. O bundle só se auto-inicializa se a página definir
`PAGINA`, e o painel não define. É a mesma guarda que o `core.js` usa com
`EDICOES`, e é o que torna o parser de CSV testável.

---

## 4 · O que ficou de fora, e por quê

- **Etapa 12 (push da apuração do dia).** Precisa de decisão de produto
  sobre frequência e de uma chamada ao `enviar-push.js`, que é território do
  festival. Todo o resto das Fases 1 e 2 está pronto.
- **Página `/interseries/atleta/:id`.** As tabelas existem, a view
  `is_artilharia` existe, a aba Artilharia funciona; a página individual do
  atleta cai na página da equipe por enquanto. É Fase 3 e depende de alguém
  anotar quem fez cada gol — aba de artilharia vazia é pior do que não ter
  aba.
- **Fallback offline do service worker para `/interseries/*`.** Hoje uma
  navegação offline sem cache cai no `/index.html` do festival, que é o
  comportamento atual do SW para qualquer rota. Mandá-la para o
  `interseries-template.html` exigiria editar o `fetch handler` — mais do
  que "acrescentar ao PRECACHE e subir a versão", que era o que o brief
  autorizava. Fica como melhoria opcional de uma linha.

---

## 5 · Critérios de aceite (§ 11 do brief)

### Verificado de verdade, aqui

| Critério | Como |
|---|---|
| Rateio: as 6 linhas da tabela de aceite | teste, caso a caso |
| `pago + sobra === bolo` **sempre** | teste com 2.000 sorteios |
| A casa nunca paga mais do que entrou | mesmo teste |
| Mata-mata empatado sem vencedor **recusa** | teste de `vencedorEPerdedor` + a recusa em `salvarResultado` |
| Categoria sem partida mostra tabela **com zeros** | teste de `mesclarClassificacao` |
| A view não deixa mata-mata poluir a classificação | **Postgres 16 local**: 3 jogos de pontos corridos + 1 final 5×0 → líder com 2 jogos / 3 gols / 3 pts, que é o certo (sem o filtro daria 3 / 8 / 6) |
| **A economia fecha** | **Postgres 16 local**: mesada → aposta → reajuste → cancelamento → liquidação → correção → reliquidação, com `saldos = entradas − em_jogo` conferido em cada etapa |
| Idempotência da mesada e da liquidação | mesma simulação, rodada duas vezes: saldos idênticos |
| CSV do Excel brasileiro (`;`, UTF-8 com BOM) | teste do parser |
| Data ambígua recusada | teste (`09/14/2026` → erro; `14/09/2026` → aceita) |
| Papéis: quem digita placar não mexe em ficha | teste da tabela de permissões |
| Vôlei (`permite_empate=false`) sem opção "Empate" | teste de `modelosDeOpcoes` |
| Nenhuma cor literal no `interseries.css` | varredura no arquivo |
| Nenhum `UPDATE`/`DELETE` em `is_lancamentos` | varredura no `api/interseries.js` |
| Todo `select` com `.limit()` | varredura |
| `CACHE_VERSION` subido, `versao` do `ping` definida | v37, e `VERSAO_IS = 1` |
| `vercel.json` continua JSON válido | parseado após o patch |

### Falta você conferir, com o site no ar

Estes dependem de banco real e de navegador, e nenhuma quantidade de teste
local substitui:

- [ ] `/2026/edicao.js` e o resto do CETECritic continuam funcionando
- [ ] Tema claro e escuro em todas as telas do interséries
- [ ] Chaveamento rolando na horizontal no celular, sem encolher os cards
- [ ] Aba oculta não dispara requisição
- [ ] Adiantar o relógio do computador não libera aposta nenhuma
- [ ] Reajustar aposta deixa **exatamente um** débito vivo
- [ ] Usuário banido ou silenciado no CETECritic não consegue apostar
- [ ] Resultado da quarta preenche a semifinal sozinho; perdedor da semi cai
      na disputa de 3º
- [ ] Reimportar o mesmo CSV resulta em "ignorar" para tudo
- [ ] Falha de rede na carga mostra tela de erro com botão, nunca página
      branca

Para o último: desligue a rede no DevTools e recarregue `/interseries/`.

---

## 6 · Anti-objetivos respeitados

Vale registrar o que **não** foi feito, mesmo quando parecia mais fácil:

- Nenhuma etapa de build, bundler ou TypeScript.
- Nenhum framework de front, nenhuma biblioteca por CDN — nem de CSV, nem de
  chaveamento. O chaveamento é CSS Grid com conectores em pseudo-elementos.
- Nenhum saldo, classificação ou pontuação guardado em coluna.
- Nenhum caminho de transferência de fichas entre contas.
- Nenhum caminho de recarga fora da mesada fixa.
- Nenhum caso novo no `switch(PAGINA.tipo)` do `core.js`, nenhuma ação no
  `db.js`, nenhuma aba no `admin.html`.
- Nenhum `Math.random()` em resultado que precisa ser igual para todo mundo:
  o sorteio de grupos usa semente, e a semente fica registrada em
  `is_config.dados.sorteios` para o sorteio poder ser repetido e conferido.
- Nada apagado para "corrigir": corrigir placar é estorno + reliquidação;
  cancelar mercado é estorno; importar CSV nunca subtrai.
