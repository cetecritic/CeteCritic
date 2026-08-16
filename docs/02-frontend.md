# 02 · Frontend

Tudo o que o navegador executa está em três arquivos: os cascos HTML,
`assets/core.js` e `assets/estilo.css`. Este documento é o mapa do `core.js`.

---

## 1. O contrato de toda página

Antes de carregar o `core.js`, a página precisa ter definido:

```js
const BASE   = '';                                  // caminho até a raiz
const PAGINA = { tipo: 'noite', noite: 1, ano: 2026 };
```

E precisa ter carregado os dados de que aquele tipo de página depende:

| Página | Precisa carregar antes |
|---|---|
| `home` | `config.js`, `home-dados.js`, `ANO/edicao.js`, `ANO/noites/*.js` |
| `edicao`, `noite`, `sobre`, `abertura`, `monte`, `bolao` | `config.js`, `ANO/edicao.js`, `ANO/noites/*.js` |
| `hall` | `config.js`, `hall-dados.js`, `perfil.js`, Chart.js |
| `perfil` | `config.js`, `perfil.js` |
| `busca`, `notif`, `config`, `redefinir`, `emBreve` | `config.js` |

O `edicao-template.html` monta essa lista sozinho a partir da URL. As páginas
da raiz declaram na mão.

---

## 2. Os globais que o `core.js` espera

Vindos de `config.js` (gerado por `/api/content?file=config`):

| Global | O quê |
|---|---|
| `EDICAO_EM_DESTAQUE` | ano do festival atual (manda no menu e na home) |
| `EDICOES` | lista de todas as edições: `{ ano, noites, abreEm, monteAbreEm, emBreve, bolao, poster }` |
| `API_URL` | normalmente `/api/db` |
| `NOTA_MAXIMA` | teto da nota (10) |
| `ANO_VOTOS_ANTIGOS` | a que edição pertence um voto sem `year` |
| `COOLDOWN_MINUTOS` | intervalo entre envios de avaliação |
| `SLOGAN_HOME`, `RODAPE`, `EMAIL_CONTATO` | textos |
| `VAPID_PUBLIC_KEY` | chave pública do push |
| `CURIOSIDADES`, `FEED` | conteúdo da home e do feed social |

Vindos de `ANO/edicao.js` e `ANO/noites/noite-N.js`:

| Global | O quê |
|---|---|
| `EDICAO` | dados da edição: título, descrição, início, fim da votação, poster, sobre, abertura, bolão |
| `NOITES` | `NOITES[1] = { data, subtitulo, pecas: [...] }` |

E os derivados, calculados no topo do `core.js`:

```js
const ED  = (typeof EDICAO !== 'undefined') ? EDICAO : null;
const ANO = ED ? ED.ano : (PAGINA.ano ? Number(PAGINA.ano) : null);
const ND  = (typeof NOITES !== 'undefined') ? NOITES : {};
const NUM_NOITES = …;   // do EDICOES
const MAX_EPS    = …;   // maior nº de peças entre as noites
```

> Todos os acessos a globais opcionais usam `typeof X !== 'undefined'`. Isso
> não é paranoia: uma página pode legitimamente não ter carregado `HALL` ou
> `NOITES`, e um `ReferenceError` no topo do `core.js` derruba a página inteira.

---

## 3. Mapa do `core.js`

Números de linha são aproximados — use-os como bússola, não como endereço.

| Linhas | Bloco |
|---|---|
| 1–100 | Tema (claro/escuro/auto), banner de instalação da home |
| 100–180 | PWA: `beforeinstallprompt`, registro do service worker, dica de iOS |
| 180–330 | Helpers: `posterDaEdicao`, `htmlPoster`, `esc`, cores de nota, datas |
| 330–390 | Contexto da página (`ED`, `ANO`, `ND`) e relógio do servidor |
| 346–380 | Janela do bolão no cliente (`estadoBolaoDe`) |
| 390–460 | Votos: `fetchVotos`, `postVoto`, cache SWR no `localStorage` |
| 456–550 | IndexedDB (capas do Monte o Seu) e redução de imagem |
| 548–860 | **Contas:** sessão, `apiPost`, e todas as chamadas de API |
| 862–1000 | Login com Google (Supabase Auth) |
| 1000–1400 | Menu lateral, cabeçalho, modais de login e de "Monte o Seu" |
| 1401–1640 | **Notificações:** banner animado, detecção de novidades, broadcasts |
| 1640–1870 | `montarShell` — o esqueleto de toda página |
| 1869–2160 | Auto-refresh inteligente (pausa com a aba oculta) |
| 2160–2250 | Formulário de votação e cooldown |
| 2243–2800 | **Exportação de imagem** (html2canvas) e cards de compartilhamento |
| 2756–2850 | Estatísticas e badges de peça |
| 2841–2900 | `carregarDadosEdicao` — carregador com cache por ano |
| 2848–3170 | **Página: edição** (votação e notas agregadas) |
| 3167–3450 | **Página: bolão** |
| 3452–3560 | Páginas: sobre, resumo, abertura |
| 3566–3710 | **Página: noite** |
| 3711–3990 | **Página: Monte o Seu** |
| 3989–4880 | **Página: Hall da Fama** (Chart.js) |
| 4884–5060 | "Hoje recomendamos" — sorteio determinístico do acervo |
| 5060–5350 | **Página: início** |
| 5176–5200 | Página: em breve |
| 5197–6580 | **Página: perfil** — avaliações, badges, carimbos, feed social, bolão |
| 6583–6710 | **Página: busca** |
| 6712–6810 | Página: notificações |
| 6811–7085 | Página: configurações |
| 7085–7130 | Página: redefinir senha |
| 7131–7265 | Moderação da conta (roda em toda página) |
| 7265–7290 | **Dispatcher** — o `switch(PAGINA.tipo)` |
| 7290–7350 | Onboarding de primeiro acesso |

---

## 4. `montarShell` — o esqueleto

Toda página termina chamando `montarShell(conteudoHtml)`. Ela:

1. insere a sidebar, o conteúdo e o rodapé no `<body>`;
2. anexa o modal do "Monte o Seu" e o modal de login;
3. liga o menu retrátil do celular;
4. conecta os botões de tema, notificações e conta.

Ou seja: **se `montarShell` não roda, a página fica em branco**. Se você vir
uma página vazia, procure uma exceção lançada *antes* dela — quase sempre é um
global de `config.js` que não chegou.

---

## 5. O relógio do servidor

```js
let serverTimeOffset = null;
function agora(){ return serverTimeOffset === null ? new Date() : new Date(Date.now() + serverTimeOffset); }
function horarioSincronizado(){ return serverTimeOffset !== null; }
function podeVotar(){ return horarioSincronizado() && edicaoComecou() && !votacaoEncerrada(); }
```

`fetchVotos()` recebe `serverNow` do `/api/db` e calcula o desvio. **Toda**
comparação de tempo no site usa `agora()`.

Regra a respeitar em código novo: se você escrever `new Date()` para decidir se
algo está liberado, criou um bug. Mudar o relógio do computador não pode
destravar a votação, nem a noite 3, nem o palpite do bolão.

O servidor ainda manda `votingClosed` como resposta independente — o cliente
não é a autoridade sobre isso, só reflete.

---

## 6. Votação

### O formulário

Uma grade: colunas são noites, linhas são episódios. Cada célula é um
`<input type="number">` com chave `sNeM`. Noite ainda não liberada aparece
como 🔒 e não é preenchível.

```js
formValues = { s1e1: 8.5, s1e2: 7, s2e1: 9 };
```

### O envio

```js
const submission = {
  id:   idAvaliacao(),        // crypto.randomUUID()
  ts:   Date.now(),           // o servidor descarta se for implausível
  name: (logado && !anon) ? sess.user : (anon ? 'Anônimo' : nomeDigitado),
  grid: { ...formValues },
  year: ANO,
  user: (logado && !anon) ? sess.user : ''
};
submissions.push(submission);   // pinta na hora (otimista)
await postVoto(submission);
```

Três coisas a notar:

- **`user` vazio significa avaliação anônima.** O `postVoto` só anexa o token
  quando `sub.user` bate com a sessão. Sem dono, o voto não entra no perfil.
- **A atualização é otimista:** o voto entra em `submissions` e a tela repinta
  antes de o servidor confirmar.
- **O cooldown do navegador é só conforto.** `localStorage['last-submission-ts']`
  mais `COOLDOWN_MINUTOS` evita o clique duplo. A trava que vale é a do
  servidor (3 avaliações por 5 minutos, por conta e por origem) — ver
  [03 · API](03-api.md) e [09 · Riscos, item 1](09-riscos-conhecidos.md).

### Cache dos votos (SWR)

```js
function cacheVotosKey(ano){ return 'cetec-votos-' + ano; }
```

A última resposta boa fica no `localStorage` por ano. A página pinta o cache na
hora e a rede sobrescreve quando chega. Funciona offline e mata a sensação de
"carregando…" na abertura.

---

## 7. Badges

Existem **três** sistemas de badge no projeto, e confundi-los é fácil.

### 7.1 Badges de peça (automáticas)

São **nove no total**, e a distinção importa: oito são distribuídas por
`badgesDoAno(subs)` a partir dos votos daquela edição, e a ⭐ é atribuída por
fora, na página da noite, porque ela compara o acervo inteiro.

**Tudo o mais é relativo à própria edição** — a mediana que separa "pouca
gente viu", a comparação de dispersão, o crescimento no tempo. A única exceção
é a ⭐, que por definição compara o acervo inteiro e é atribuída fora desta
função.

| # | Badge | Critério | Eixo que mede | Piso |
|---|---|---|---|---|
| 1 | 🥇 Campeã do ano | maior média da edição | topo da média | — |
| — | ⭐ Melhor da história | maior média entre todas as edições | topo absoluto | — |
| 2 | 💎 Joia escondida | melhor média **entre as peças menos avaliadas da edição** | alcance invertido | média ≥ 7,5 |
| 3 | 🗣️ Boca a boca | a média **subiu** entre a primeira e a segunda metade dos votos | o tempo | média ≥ 7 |
| 4 | 👏 Favorita do público | maior % de notas 9+ | pico de entusiasmo | — |
| 5 | 🔥 Polêmica | maior desvio padrão | dispersão pra cima | — |
| 6 | 🎯 Consistente | menor desvio padrão | dispersão pra baixo | — |
| 7 | 📊 Mais avaliada | mais votos recebidos | alcance | — |
| 8 | 📈 Bem recebida | consolação: melhor saldo de elogios (7+) sobre críticas (4−) | saldo | — |

A coluna **#** é a ordem de prioridade em `CRITERIOS`, e ela **não** é a ordem
em que as badges aparecem no Hall — a vitrine ordena por prestígio, que é como
o público lê a lista.

**Toda badge é positiva, por decisão de projeto.** Nenhuma aponta a pior peça
do ano: são estudantes que subiram no palco, e o site existe para celebrar o
festival. 🔥 Polêmica é o limite — e ela diz "dividiu opinião", que numa mostra
de teatro é elogio.

**Cada uma mede um eixo diferente**, e isso não é estética: dois critérios que
medem quase a mesma coisa se atropelam e um deles nunca encontra dono. Foi
exatamente o que aconteceu até agosto de 2026 — ver a caixa abaixo.

**Piso de qualidade.** As badges que *afirmam* que a peça é boa só são
concedidas acima de uma média mínima. Num ano em que a melhor abertura tirou
5,0, ninguém leva 🎬 — badge que se dá a qualquer coisa deixa de significar
alguma coisa.

**Uma badge por peça, e nenhum critério fica órfão.** Cada critério ordena
todas as candidatas e **desce a lista** até achar uma que ainda não tenha
badge. A campeã de média leva 🥇; a segunda colocada em notas 9+ leva 👏 se a
primeira já estiver ocupada. A ⭐ da história e as badges manuais do painel
entram por fora e não contam no limite.

**Raras primeiro.** A ordem de prioridade põe 💎 e 🗣️ logo depois da 🥇, e isso
foi medido, não escolhido por gosto. Um critério raro colocado no fim quase
nunca chega a alguém: a peça que cresceu no boca a boca costuma ser boa
também, então já foi levada por 🥇 ou 👏 antes de o 🗣️ ter vez. Em 400 edições
simuladas, mover as duas para o começo levou 💎 de 84% para 97% das edições e
🗣️ de 54% para 72% — sem custo relevante para as outras.

> Houve uma nona badge automática, **🤝 Unânime** (a menor nota que a peça
> recebeu foi a mais alta da edição). Media um eixo próprio — o piso, em vez do
> topo ou da dispersão — mas foi removida para o catálogo fechar em nove.
> Se um dia fizer falta, é um objeto em `BADGES_DEF` e um critério
> `{ tipo:'unanime', entre: elig, por: s => s.min, maior: true, minimo: 7 }`
> em `CRITERIOS`.

**O 🗣️ é o critério mais ruidoso do conjunto**, e por isso tem dois pisos
próprios: `BOCA_MIN_VOTOS` (8) e `BOCA_MIN_DELTA` (0,5). Com menos de oito
votos, primeira metade contra segunda metade é praticamente sorteio; um ganho
menor que meio ponto não é história, é oscilação. Peça sem carimbo de tempo
nos votos simplesmente não concorre.

> #### O bug que existia aqui até 08/2026
>
> A regra "uma badge por peça" era aplicada assim: cada critério elegia a sua
> campeã e, se ela já tivesse badge, **aquele critério simplesmente ficava sem
> dono**. Não havia segunda colocada.
>
> Como os critérios são correlacionados — a peça de maior média costuma ser
> também a com mais notas 9+ e uma das mais consensuais —, três ou quatro
> badges eram eleitas pela mesma peça, a primeira ficava com ela, e as outras
> não iam para ninguém.
>
> Numa simulação de 200 edições, 👏 **Favorita do público encontrava dono em
> 15% das vezes**. 🎯 Consistente em 81%, 📊 Mais avaliada em 80%. A média era
> de 4,8 badges distribuídas por edição.
>
> Com a descida na lista, as seis antigas passaram a 100%, e a média subiu
> para 8,5 de 9.

Só entram peças com pelo menos `HALL.minAvaliacoes` votos (padrão 3) — a menos
que nenhuma alcance o mínimo, aí vale o que houver.

> **Ao adicionar uma badge nova:** acrescente em `BADGES_DEF` (a vitrine do
> Hall se monta sozinha a partir dele) e em `CRITERIOS` dentro de
> `badgesDoAno`. Pergunte-se qual **eixo novo** ela mede — se a resposta for
> "quase o mesmo que outra", ela vai viver órfã. E ponha `minimo` se ela
> afirmar qualidade.

### 7.2 Badges de usuário (perfil)

`catalogoBadges(ctx)` monta a lista a partir do histórico da pessoa: quantas
edições avaliou, se avaliou de madrugada, se deu nota máxima e mínima na mesma
noite, se completou uma ficha inteira, colocação no bolão, e assim por diante.
A badge 🧷 Colecionador conta as outras.

O Hall da Fama mostra o mesmo catálogo com `catalogoBadgesPublico()` — tudo
bloqueado de propósito, porque ali a lista responde "o que dá pra ganhar", não
"o que fulano ganhou".

### 7.3 Exceções do admin

`perfil.admin_badges = { forcadas: [...], bloqueadas: [...] }`, aplicado por
cima do catálogo na renderização. Nada é gravado como badge no banco.

Detalhe pensado: o Colecionador é calculado **antes** dessas exceções, então
uma badge dada à mão não destrava outra em cascata.

---

## 7.4 "Hoje recomendamos"

Uma peça por dia na home, **igual para todo mundo** e sorteada de **todo o
acervo**, não só da edição em cartaz.

O sorteio é uma permutação determinística: `_embaralharComSemente(candidatos,
ano)` embaralha a lista inteira com um PRNG semeado (mulberry32) e o dia do ano
escolhe a posição. Isso dá três propriedades ao mesmo tempo:

- **todo mundo vê a mesma peça no mesmo dia** — nada depende de `Math.random()`
  nem do relógio local;
- **cada peça aparece uma vez antes de qualquer repetição** — o ciclo tem o
  tamanho do acervo, não de um punhado;
- **dias seguidos não caem em peças vizinhas**, e a ordem muda a cada ano.

A estatística sai dos votos que a home já carregou (nenhuma requisição extra).
Só a edição sorteada tem os dados de acervo carregados, via
`carregarDadosEdicao`, que já cacheia por ano.

Preferências, em ordem: peças com nota ≥ 7 (afrouxa se sobrarem menos de dez),
e entre as candidatas do dia, uma que **tenha gravação** — o convite é "assista
e deixe a sua nota", e mandar a pessoa para uma peça sem vídeo é beco sem saída.

> Cuidado ao mexer: qualquer coisa que introduza `Math.random()` ou dependa da
> ordem em que as respostas da rede chegaram quebra a promessa de "igual para
> todo mundo". Por isso os candidatos são ordenados por `(ano, chave)` antes do
> embaralhamento.

---

## 8. Notificações no cliente

Três canais convivem:

| Canal | O quê | Onde |
|---|---|---|
| **Push** | notificação do sistema operacional | service worker, evento `push` |
| **Central 🔔** | lista persistente por usuário | tabela `notificacoes` |
| **Broadcast** | banner animado no topo do site | tabela `broadcasts` |

O `core.js` também **detecta novidades sozinho** e cria notificações para o
próprio usuário: badge nova, noite liberada, votação encerrando, edição nova,
resultado do bolão. Compara o estado atual com o que estava no `localStorage`
e chama `apiCriarNotif`, que não duplica pelo id.

Os broadcasts têm três modos:

- `uma_vez` — uma vez por aparelho (guardado em `cetec-broadcasts-vistos`)
- `sessao` — uma vez por sessão (`sessionStorage`)
- `sempre` — toda visita

No máximo três banners por visita, com 800 ms entre eles.

---

## 9. Exportação de imagem

O bloco em torno da linha 2243 gera os cards de compartilhamento (story de
peça, de noite, de edição, do Monte o Seu) com `html2canvas`.

Dois problemas do html2canvas estão resolvidos ali, e o comentário no código
explica cada um. Não "simplifique" esse trecho sem ler: animações CSS ativas e
elementos com `position` herdado renderizam errado no clone, e é por isso que
existe `neutralizarAnimacoes(clonedDoc, rootId)`.

O html2canvas é carregado por CDN e **só** no `edicao-template.html`. Se você
usar exportação numa página da raiz, precisa incluir a tag lá também.

---

## 10. Capas (posters)

O caminho de uma capa é resolvido num lugar só:

```js
posterDaEdicao(ano, valorConhecido)
```

O valor vem do banco e pode ser:
- URL absoluta (Supabase Storage) → usada como está;
- nome de arquivo solto (`poster.jpg`, legado) → vira `/ANO/arquivo`;
- vazio → devolve `''` e quem chama mostra o placeholder.

O `<img>` é montado por `htmlPoster(url, alt)`, que instala um `onerror` com
**nova tentativa**: até três recargas com espera crescente antes de desistir e
mostrar "Sem capa". Isso existe porque a capa mora em outro domínio, fora do
alcance do service worker do site, e um soluço de rede numa primeira visita
deixava o card permanentemente sem capa.

O service worker complementa: imagens de outro domínio vão para o cache
`cetecritic-img-v1` (cache-first), e as capas de todas as edições são
pré-cacheadas na instalação.

---

## 11. Service worker

`service-worker.js`, três estratégias:

| O quê | Estratégia | Por quê |
|---|---|---|
| `config.js`, `ANO/edicao.js`, `ANO/noites/*.js` | **network-first** | mudam quando o admin edita; um reload normal precisa mostrar a mudança |
| HTML, CSS, JS, imagens do site | **stale-while-revalidate** | abertura instantânea, atualiza por baixo |
| Imagens de outro domínio (capas) | **cache-first** | capa nova ganha URL nova; não há o que invalidar |
| `/api/*`, `/_vercel/*` | **nunca cacheia** | dados sempre frescos |

Dois caches:
- `cetecritic-v27` — do site; **suba o número a cada publicação relevante**;
- `cetecritic-img-v1` — imagens externas; sobrevive à troca de versão de
  propósito, para não rebaixar todas as capas a cada deploy.

O service worker faz `importScripts('/config.js')` para saber qual é a edição
em destaque e pré-cachear as páginas e as capas certas sozinho.

Ele é registrado no evento `load`, não durante o parse — o que significa que
na **primeira** visita ele não controla a página. Só a partir da segunda.

---

## 12. Temas

`estilo.css` define tudo em variáveis CSS no `:root`, e o tema claro é um
bloco `:root[data-theme="light"]` que as redefine.

```js
const TEMA_KEY = 'cetec-tema';                     // 'claro' | 'escuro' | 'auto'
document.documentElement.dataset.theme = 'light' | 'dark';
```

O tema é aplicado **na primeira linha executável** do `core.js`, antes de
qualquer render, para reduzir o flash. No modo `auto` há um listener de
`prefers-color-scheme` que acompanha o sistema em tempo real.

---

## 13. Auto-refresh

O site inteiro se atualiza a cada 20 segundos. O envelope em torno da linha
1869 pula o trabalho enquanto a aba está oculta e dispara **uma** atualização
imediata quando ela volta a aparecer.

Isso não é otimização de vaidade: sem ele, uma aba esquecida aberta a semana
inteira do festival bate na API 4.300 vezes por dia.

---

## 14. Adicionando uma página nova

1. Crie o casco (copie `busca.html`) e defina `PAGINA.tipo = 'novoTipo'`.
2. Escreva `function paginaNovoTipo()` no `core.js`, terminando em `montarShell(...)`.
3. Registre no dispatcher no fim do arquivo:
   ```js
   case 'novoTipo': paginaNovoTipo(); break;
   ```
4. Se a página for de um ano (`/2026/algo.html`), **não crie arquivo** — só
   adicione o reconhecimento no `edicao-template.html`.
5. Adicione ao `PRECACHE` do service worker e suba o `CACHE_VERSION`.
6. Se a página deve ser indexada, acrescente ao `sitemap.xml` (que é manual —
   ver [09 · Riscos](09-riscos-conhecidos.md)).
