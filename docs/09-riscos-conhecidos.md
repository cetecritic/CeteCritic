# 09 · Riscos conhecidos

Levantamento feito em **16 de agosto de 2026**, a partir da leitura completa de
`api/db.js`, `api/content.js`, `api/_moderacao.js`, `api/enviar-push.js`,
`api/cron-push.js`, `assets/core.js`, `service-worker.js`, `admin.html` e
`vercel.json`.

Foram encontrados 23 itens. **Dezoito foram corrigidos** na mesma data e estão
na [Parte II](#parte-ii--corrigido-em-16082026), com a descrição do problema
original — para que ninguém reintroduza a mesma coisa. Os que permanecem estão
na Parte I: eram cinco, e o identificador estável da peça foi resolvido em
20/08/2026.

Revisões posteriores de áreas específicas encontraram mais quatro defeitos,
todos corrigidos e registrados no fim da Parte II.

> ⚠️ As correções dos itens 1, 7, 13 e 14 dependem de
> **`migracao-seguranca.sql`**. O código funciona sem ela (os limites
> simplesmente não travam ninguém e um aviso vai para o log), mas até rodá-la
> **a trava de votação não existe de fato**.

---

# Parte I · O que continua em aberto

## 🔵 A2 · `core.js` com 386 KB, sem minificação, em toda página

Quem abre um perfil baixa também o Hall da Fama, o Monte o Seu e o bolão.

Um `esbuild --minify` cortaria mais da metade sem mudar uma linha. **Não foi
feito de propósito:** introduz uma etapa de build, e "editar e dar push" é uma
escolha estrutural do projeto ([01 · Arquitetura](01-arquitetura.md)) que
sustenta a rotatividade anual de mantenedores. Vale discutir, não vale decidir
sozinho.

Meio-termo possível: minificar só na publicação, via um passo opcional na
Vercel, mantendo o arquivo legível no repositório.

---

## 🔵 A3 · `admin.html` com 2.234 linhas e tudo inline

HTML, CSS e JavaScript no mesmo arquivo, sem reaproveitar `estilo.css` nem
`core.js`. Funciona, mas é o arquivo mais difícil de editar do projeto.

Quebrar em `admin.css` + `admin.js` é meia hora de trabalho mecânico e muito
risco de conflito com qualquer coisa em andamento. Fica para quando não houver
nada mais urgente.

---

## 🔵 A4 · Sem lint e sem CI (os testes já existem)

**Parcialmente resolvido em 20/08/2026:** existe `testes/`, com 83 testes das
funções puras, rodando em `npm test` sem instalar nada. Cobrem pontuação do
bolão, badges de peça, papéis, identidade da peça e diagnóstico de saúde — e
travam três regressões que já aconteceram aqui.

Falta o resto da rede: nada roda automaticamente num push, não há lint, e nada
que escreve no banco é testado. Para um projeto com troca anual de mantenedores,
mesmo um punhado de testes das funções puras já mudaria a confiança de mexer:

Ainda sem teste, e todas puras: `parseLinkMusica`, `estadoBolaoDe` (a cópia do
estado do bolão no cliente) e os cálculos do Hall da Fama.

---

## 🔵 A5 · Cron com granularidade diária

Plano Hobby da Vercel: um agendamento, `0 12 * * *`. Um banner marcado para as
20:00 sai só na execução do dia seguinte.

É limitação de plano, não de código. Está documentado no painel e em
[05 · Painel admin](05-painel-admin.md). Para hora exata: disparo manual em
`enviar-push.html`, ou plano Pro com `schedule` ajustado.

---

# Parte II · Corrigido em 16/08/2026

Registrado com o problema original para que ninguém reintroduza.

---

## 🔴 1 · Não existia trava de votação no servidor

**Era:** o cooldown vivia só no `localStorage`. `apiVoto` conferia se a votação
estava aberta e se as notas eram válidas — e inseria. Sem limite por usuário,
por IP ou por sessão. Um `curl` em laço movia a média de qualquer peça para
onde quisesse. Para um site cuja função é apurar notas, era a falha mais grave
do projeto.

**Agora:** `apiVoto` aplica dois tetos independentes, **3 avaliações por 5
minutos** cada:

- `voto:u:<usuario>:<ano>` — por conta, pega o caso comum;
- `voto:ip:<hash>:<ano>` — por origem, pega o voto sem login, que não tem
  identidade nenhuma.

O contador vive na tabela `rate_limite` (janela fixa). O IP nunca é guardado
em claro: entra na chave como SHA-256 de `IP + RATE_SALT`.

Se a tabela não existir, tudo é liberado e um aviso vai para o log — o mesmo
padrão de degradação que o projeto já usa com a coluna `papel`. Uma migração
pendente não pode derrubar o site no meio do festival.

**Ajuste os números** em `VOTO_MAX_POR_JANELA` e `VOTO_JANELA_MS`, no topo do
bloco de `apiVoto`.

---

## 🔴 2 · Voto anônimo aceitava qualquer nome

**Era:** `name` vinha do cliente sem conferência, e num voto sem login é ele
que aparece na lista pública. Dava para enviar uma avaliação anônima assinada
com o nome de outra pessoa.

**Agora:** um nome que colide com uma conta existente é recusado quando não há
token que prove a identidade:

> *"esse nome pertence a uma conta do site — entre nela para avaliar com ele"*

Quem está logado continua usando o próprio nome à vontade.

**De quebra:** o `ts` do voto também vinha do cliente e era gravado como veio,
então dava para forjar a data de uma avaliação — e, com isso, o desempate de
"quem palpitou primeiro". Agora o carimbo do cliente só é aceito se estiver a
menos de 5 minutos do relógio real; fora disso vale o do servidor.

---

## 🟠 3 · Rotas GET "de admin" sem autenticação

**Era:** `identificarEquipe` só era chamado no `handlePost`. Um
`curl .../api/content?q=config` devolvia o `config_site.dados` inteiro para
qualquer pessoa — e é justamente esse o balde onde um admin naturalmente cola
uma chave, um webhook ou um texto interno.

**Agora:** `handleGet` exige credencial para todo `q.q`. As rotas `?file=`
continuam públicas de propósito: são elas que o site carrega em toda visita,
sem login.

O `admin.html` passou a mandar `user` e `token` na querystring das leituras
(é um GET, não há corpo).

---

## 🟠 4 · Teto de 1000 linhas do PostgREST

**Era:** oito consultas sem `.limit()`. O corte do PostgREST é **silencioso**:
sem erro, sem aviso, você simplesmente trabalha com menos dados do que existe.
As consequências iam de "anonimato para de funcionar" a "médias erradas".

**Agora:** todas com `.limit(LIMITE_ALTO)` (10.000) e, nas que importam,
`avisarSeTruncou()` — que grita no log da Vercel quando o resultado volta
exatamente cheio:

```
[cetecritic] ATENÇÃO: "submissions do ano 2026" voltou com 10000 linhas
(no limite). Há dados sendo ignorados — hora de paginar.
```

Cobertas: `lerPerfisMap`, feed de `submissions`, `mediasReaisDoAno`,
`placarBolao`, `?palpites=`, ranking de reputação, `listaPush`,
`enviarParaTodos`, lista de amigos em `migrarNomeUsuario`.

> Isto **não** resolve o problema de fundo, só o torna visível. Se o aviso
> aparecer no log, chegou a hora de paginar de verdade — ou de trocar a soma
> no cliente por agregação SQL.

---

## 🟠 5 · `ilike` usado direto em `DELETE`

**Era:** sete lugares. Em SQL, `_` casa com qualquer caractere em `LIKE`, e o
regex de nome de usuário aceita `_`. Existindo `joao_silva` e `joaoXsilva`,
apagar as sessões do primeiro derrubava também as do segundo, que era
deslogado sem entender por quê.

O mais irônico: o comentário em `migrarNomeUsuario` já explicava exatamente
essa armadilha para justificar o padrão correto nos `UPDATE`s — os `DELETE`s
ao lado escaparam.

**Agora:** existe `apagarPorNome(sb, tabela, coluna, nome)` em `_moderacao.js`,
que faz o certo — ler com `ilike`, conferir com `norm()`, apagar pelos valores
exatos. Os sete pontos passaram a usá-lo:

| Arquivo | Onde |
|---|---|
| `db.js` | após redefinir senha, após trocar nome, ao excluir conta |
| `content.js` | ao suspender, deslogar tudo, deletar usuário |
| `_moderacao.js` | ao renomear |

---

## 🟠 6 · `salvarEdicaoCompleta` reescrevia o histórico em silêncio

**Era:** dois problemas somados.

**a)** A rota reinsere as peças renumerando. Remover uma peça do meio fazia
todas as seguintes subirem, e cada voto já gravado passava a apontar para a
peça errada.

**b)** O `DELETE` acontecia antes dos `INSERT`s, sem transação e sem checagem
de erro. Se a função caísse no meio, a edição ficava sem noites e sem peças —
e a resposta ainda era `ok: true`.

**Agora, para (a):** o servidor recusa com **409** qualquer envio que reduza a
contagem de peças de uma edição **que já tem votos** — para todo mundo,
inclusive admin. A mensagem explica a saída:

> *"Esta edição JÁ TEM VOTOS: remover uma peça renumera as seguintes e faz as
> notas apontarem para a peça errada. Para corrigir o texto de uma peça que
> não aconteceu, esvazie o título em vez de tirá-la da lista."*

Escape consciente: `body.confirmarRemanejamento === true`, para quando as
chaves já tiverem sido remanejadas em SQL na mão.

**Agora, para (b):** as linhas são montadas e validadas **em memória primeiro**;
só então vêm o delete e duas escritas em lote. A janela destrutiva caiu para
alguns milissegundos, e qualquer erro é devolvido com instrução clara em vez
de engolido.

> A **reordenação** sem mudança de contagem continuou passando até 20/08/2026,
> quando a coluna `pecas.chave` passou a permitir detectá-la — ver a entrada do
> identificador da peça mais abaixo.

---

## 🟡 7 · Nenhuma rota tinha limite de taxa

**Era:** `pedirReset` disparava e-mail a cada chamada (um laço queimava a cota
da Resend e transformava o site em ferramenta de spam contra a caixa da
vítima); `login` tinha trava por conta mas não por origem; `registrar`
permitia criação de contas em massa.

**Agora:**

| Rota | Teto | Janela |
|---|---|---|
| `voto` (conta) | 3 | 5 min |
| `voto` (origem) | 3 | 5 min |
| `registrar` (origem) | 5 | 1 h |
| `login` (origem) | 30 | 10 min |
| `pedirReset` (origem) | 5 | 1 h |
| `pedirReset` (conta) | 3 | 1 h |

O teto por conta em `pedirReset` devolve a **mesma mensagem genérica** do
sucesso — dizer "você pediu demais" confirmaria que a conta existe.

---

## 🟡 8 · Bolão desligado respondia "essa edição não existe"

**Era:** `estadoBolao` devolvia `existe: false` mesmo com a linha presente. Como
`apiPalpite` testa `existe` antes de `ativo`, a mensagem certa ("o bolão desta
edição está desativado") ficava na linha seguinte, inalcançável.

**Agora:** `existe` reflete a linha, não o bolão. Uma linha.

---

## 🟡 9 · Ano da edição atual fixado no código

**Era:** `const CURRENT_EDITION_YEAR = 2026`, usado como `year` padrão do voto e
do palpite. Todo o resto do sistema descobria a edição atual pelo banco; só
este ponto não. No ano em que 2027 virasse destaque e alguém esquecesse de
trocar, um voto sem `year` explícito ia parar em 2026.

**Agora:** `anoEmDestaque()` lê `EDICAO_EM_DESTAQUE` de `config_site`, com o
mesmo cache de 30 s que `fimVotacaoMap()` já usava. O fallback existe só para
o banco não responder — melhor um ano provavelmente certo do que `NaN` no meio
de uma votação.

---

## 🟡 10 · `config_site` sem controle de concorrência

**Era:** toda a configuração é uma linha de jsonb, e salvar é
ler-alterar-regravar. Dois admins salvando ao mesmo tempo — coisa nada rara na
véspera do festival — e um perdia a alteração, sem aviso.

**Agora:** concorrência otimista com a versão dentro do próprio jsonb
(`dados._versao`), então **não houve migração de esquema**. O filtro
`dados->>_versao` vai no `UPDATE` e o Postgres resolve a corrida.

- **`salvarConfig`** devolve **409** e o painel avisa: *"alguém salvou a
  configuração enquanto você editava… o que você digitou NÃO foi gravado"*.
- **`postarFeed`**, que é ler-alterar-regravar dentro do servidor, faz até três
  retentativas relendo antes de desistir.

De quebra, o painel deixou de atualizar o `CFG` local quando a gravação falha —
antes ele passava a exibir um estado que não estava no banco.

---

## 🟡 11 · Notificação de amizade sequencial

**Era:** um `await acharUsuario(a)` dentro do `for`, ou seja, uma ida ao banco
por amigo, em série. Como `amigos` aceita até 500 entradas, adicionar muitos de
uma vez virava centenas de consultas sequenciais dentro de um request com
timeout.

**Agora:** o `pmap`, que já é carregado logo acima, responde quem existe sem
custo nenhum. As notificações vão em paralelo, com teto de 30 — uma importação
em massa não vira enxurrada na caixa de ninguém.

---

## 🟡 12 · Suposições contraditórias sobre a coluna `id` de `notificacoes`

**Era:** `criarNotif` fazia `select('id')` assumindo que a coluna existe;
`apiMarcarNotifLidas` comentava que ela pode não existir. Se não existisse, o
`select` falhava, `data` vinha indefinido, a checagem de duplicata não
acontecia — e as notificações **duplicavam**.

**Agora:** `criarNotif` seleciona `notif_id`, que existe com certeza, e loga o
erro em vez de engoli-lo.

---

## 🟡 13 · Tabelas que cresciam sem retenção

**Era:** `resets`, `broadcasts`, `agendados`, `notificacoes` e `sessoes` nunca
eram limpas. `resets` guardava tokens de redefinição usados e expirados para
sempre.

**Agora:** `/api/cron-push` faz faxina depois de processar os agendamentos:

| Tabela | Retenção |
|---|---|
| `resets` | usados ou expirados |
| `broadcasts` | 90 dias — **exceto `bolao-%`** |
| `agendados` | 90 dias após enviados |
| `notificacoes` | 180 dias, só as lidas |
| `sessoes` | 180 dias sem uso |
| `rate_limite` | janelas vencidas há mais de 1 dia |

A limpeza mora aqui porque o plano Hobby permite **um** agendamento. Cada passo
é isolado: um erro numa tabela não impede as outras, e nada disso roda antes
dos agendamentos, que são o que importa.

> As linhas `bolao-%` de `broadcasts` ficam de fora de propósito: são a memória
> de "este aviso já saiu".

---

## 🟡 14 · Corrida no cadastro de nome

**Era:** `acharUsuario()` (case-insensitive) e só depois `insert`. A rede de
segurança era a constraint da tabela — que, sendo case-sensitive, deixava
passar `Joao` e `joao` como contas distintas.

**Agora:** `migracao-seguranca.sql` cria
`CREATE UNIQUE INDEX ... ON usuarios (lower(usuario))`. O `apiRegistrar` já
tratava o erro de inserção devolvendo "esse usuário já existe".

> A migração traz um `SELECT` de conferência antes: se já houver contas em
> conflito, a criação do índice falha e é preciso renomear uma delas primeiro.

---

## 🔵 15 · Imagens pesadas

**Era:** 1,47 MB de logos, todas no `PRECACHE` do service worker — ou seja,
baixadas na primeira visita de todo mundo. `favicon.png` tinha 347 KB e
713×645 px para ser exibido a 32 px.

**Agora:** 164 KB no total, **−89%**.

| Arquivo | Antes | Depois | O que mudou |
|---|---|---|---|
| `favicon.png` | 347 KB | 7 KB | 713×645 → 192 px (tamanho de ícone PWA) |
| `logo-rodape.png` | 502 KB | 5 KB | 2400×645 → 300 px (usado a ~100 px) |
| `LogoText.png` | 139 KB | 6 KB | 1634×314 → 600 px |
| `icon.jpg` | 169 KB | 24 KB | 2048² → 512² (o que o manifest declara) |
| `logo.png` | 347 KB | 122 KB | **dimensões preservadas** — só compressão |

`logo.png` manteve 713×645 de propósito: é o `og:image`, o preview que aparece
no WhatsApp e no Instagram. `icon.jpg` parou em 512 px porque é o que o
`manifest.webmanifest` promete — abaixo disso a instalação no Android ficaria
com ícone e splash borrados.

---

## 🔵 16 · `sitemap.xml` manual

**Era:** uma edição criada no painel ficava navegável na hora, mas invisível
para o Google até alguém editar o XML à mão. E ninguém lembra.

**Agora:** existe `/api/content?file=sitemap`, que monta o sitemap a partir de
`edicoes` — home, hall, busca, e para cada edição a página do ano, sobre,
abertura e uma entrada por noite. Edições "em breve" viram a página de
expectativa.

O rewrite já está no `vercel.json`, mas **a rota está dormindo**: na Vercel os
rewrites só valem depois da checagem do sistema de arquivos, então enquanto
`sitemap.xml` existir é ele quem responde.

**Para ativar:** `git rm sitemap.xml`.

---

## 🔵 17 · Home em branco quando `config.js` falha

**Era:** `index.html` usava `EDICAO_EM_DESTAQUE` num `document.write`. Se o
global não existisse, o `ReferenceError` fazia o parser abandonar o bloco
inteiro — inclusive a tag do `core.js`, que nem chegava a ser inserida.
Resultado: página branca, sem uma pista sequer para quem está do outro lado.

**Agora, duas defesas:**

1. O bloco do `index.html` está em `try/catch`, então o `core.js` **sempre**
   carrega.
2. O `core.js` verifica se `EDICOES` chegou. Se não, mostra uma tela de erro
   com a marca do site, explicação honesta, botão "Tentar de novo" e o e-mail
   de contato. E um `try/catch` em volta do dispatcher faz o mesmo para
   qualquer outra falha de renderização, registrando o erro no console.

---

## 🔵 18 · `Math.random()` no id do voto

**Era:** `Date.now() + '-' + Math.random().toString(36).slice(2,7)` — cinco
caracteres de aleatoriedade, num id que não é único no banco e que vira o id do
post reagível no feed social. Uma colisão juntaria as reações de duas
avaliações diferentes.

**Agora:** `crypto.randomUUID()`, com fallback mais robusto para contexto sem
HTTPS (dev local por IP).

---

## ✅ Corrigido em 20/08/2026 — o identificador da peça (era A1)

**Era:** a peça não tinha identificador. Ela **era** a posição dela na grade:
`s2e3` significa "terceira peça da segunda noite", e essa string é a chave dos
votos em `submissions.grid` e dos palpites. Como `salvarEdicaoCompleta`
reinsere as peças renumerando (`ordem: i + 1`), **reordenar** fazia cada nota
já dada apontar para a peça errada — em silêncio, sem erro, sem log. A trava
de agosto pegava só a remoção, porque ali a contagem encolhia; a reordenação
mantém o mesmo tamanho e os mesmos `sNeM`, e passava batido.

**Agora:** a coluna `pecas.chave` (`A3.2025`, `S1.2023-2`) dá identidade
estável à peça, única por ano, **atribuída uma vez e nunca recalculada**.

O congelamento é o ponto, não o formato: se a chave fosse derivada do campo
`turma`, teríamos trocado "a peça é a posição dela" por "a peça é o texto da
turma dela" — e `turma` é campo editável, digitado à mão, que a fase de acervo
existe para corrigir. Alguém escreveria "3A" onde estava "A3" em outubro e
reescreveria o histórico do mesmo jeito.

`salvarEdicaoCompleta` compara a posição de cada chave antes e depois do envio
e devolve **409** com o mapa do que mudaria, quando o ano já tem votos. Para
reordenar de verdade existe `remanejar-pecas.js`, que roda fora do serverless
(reescrever centenas de votos sem transação, com timeout da Vercel por perto,
não é lugar para isso), exige backup recente, salva progresso a cada linha para
não aplicar o mapa duas vezes numa retomada, e confere a soma das notas no fim.

**O que deliberadamente NÃO foi feito:** trocar o `sNeM` por `chave` dentro dos
`grid`. Dezoito lugares do `core.js` montam essa string, e reescrever todos, no
caminho de dado mais sensível do site, era risco desproporcional ao ganho. Os
votos continuam gravados por posição; o que acabou foi o silêncio.

Validado contra o acervo real antes de subir: 155 peças geram 155 chaves
únicas, os quatro sufixos caem exatamente nas quatro turmas repetidas de 2023,
e uma reordenação simulada sobre os 307 votos de 2026 preservou a soma das
notas com zero conflitos.

---

## ✅ Corrigido em 20/08/2026 — travas que falhavam sem avisar

**Era:** a tabela `rate_limite`, a coluna `papel`, a chave da Resend, o
`CRON_SECRET`. Faltando qualquer uma, o site continua servindo normalmente e a
proteção simplesmente não existe: os limites de voto liberam tudo, o 2FA e a
redefinição de senha param em silêncio, nenhum agendamento sai. O único sinal
era uma linha no log da Vercel — que ninguém lê durante o festival.

Degradar assim é o comportamento certo (uma migração pendente não pode derrubar
o site no meio das cinco noites). O que faltava era um lugar onde a ausência
aparecesse.

**Agora:** o `ping` devolve um bloco `saude` com sete verificações e o painel
pinta uma tarja no topo, com a dica do conserto em vez do nome da variável.
Some sozinha quando está tudo certo — alarme que toca sempre vira paisagem.

---

## ✅ Corrigido depois, ao revisar áreas específicas

**Badges de peça não eram distribuídas.** A regra "uma badge por peça" era
aplicada sem segunda colocada: cada critério elegia a sua campeã e, se ela já
tivesse badge, o critério ficava sem dono. Como os critérios são
correlacionados (a peça de maior média costuma ser também a com mais notas 9+),
três ou quatro badges eram eleitas pela mesma peça e só uma era concedida.

Em simulação de 200 edições, 👏 Favorita do público encontrava dono em **15%**
das vezes; a média era de 4,8 badges por edição. Agora cada critério desce a
lista de candidatas até achar uma livre — as seis antigas passaram a 100% e a
média subiu para 8,5 de 9 (duas badges novas entraram na mesma revisão).
Ver [02 · Frontend § 7.1](02-frontend.md).

**"Hoje recomendamos" mostrava sempre as mesmas peças.** O conjunto vinha só da
edição em destaque, era filtrado por "tem badge" (no máximo seis peças, e com o
bug acima, três) e a escolha era `diaAno % pool.length` — ciclo de cinco dias,
para sempre. Agora o sorteio é uma permutação determinística do acervo inteiro:
ciclo de 225 dias em vez de 5, e muda a cada ano.
Ver [02 · Frontend § 7.4](02-frontend.md).

**Gráfico "% de notas 9+" removido do Hall.** Virou um recorte pobre do "Cada
nota, edição por edição", que mostra a mesma informação inteira. O campo `p9`
por ano, que só existia para alimentá-lo, saiu junto. O `p9` **por peça**
continua no `statsDeVals` e sustenta a badge 👏.

**`.chk` usado em 14 lugares do painel sem nunca ter sido definido no CSS.**
Como todo `label` do `admin.html` é `display:block`, a caixinha caía numa linha
e o texto na seguinte.

---

## ✅ Também corrigido em 16/08 (fora da lista original)

**Avisos de bolão de anos antigos.** `dispararAvisosBolao` anunciava "O bolão de
2017 fechou" para cada edição do acervo. A trava dependia de
`estado.encerrado`, que depende de `fim_votacao` — vazio nas edições
históricas. Corrigido com uma janela de 48 h que não depende de nenhum campo
estar preenchido.

**"Apagar" de banner automático não colava.** `deletarBanner` fazia `DELETE`, e
a linha do broadcast é a única memória de "este aviso já saiu". Apagá-la fazia
o servidor recriar o banner **e reenviar o push para toda a base** a cada
clique. Agora ids `bolao-*` são arquivados em vez de excluídos.

**Capa da home sumindo no primeiro acesso.** O `onerror` do poster era
definitivo. Agora há até três tentativas com espera crescente, e o service
worker cacheia imagens de outro domínio. De quebra, o `PRECACHE` pedia
`/ANO/poster.jpg`, caminho que deixou de existir quando os posters foram para o
Storage — o 404 era engolido e a capa nunca era pré-cacheada.

---

# Parte III · Como manter esta lista viva

Revise em **janeiro**, na fase de acervo, quando não há pressa. O que olhar:

1. **Os avisos de truncamento no log da Vercel.** Se `avisarSeTruncou`
   apareceu, o item 4 voltou — e agora com dados sendo ignorados de verdade.
2. **O tamanho de `submissions` e `usuarios`.** Vários itens desta lista pioram
   com a base crescendo.
3. **Se algum ano ainda tem peça sem `chave`.** Peça sem chave não é protegida
   pela trava de reordenação — rode `node migrar-peca-chave.js`.
4. **Se apareceu item novo.** Toda correção feita às pressas durante o festival
   é candidata natural.

Ao corrigir um item, mova-o para a Parte II **com a descrição do problema
original**. O valor deste documento não está na lista do que falta — está no
registro do que já deu errado.
