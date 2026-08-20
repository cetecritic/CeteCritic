# 05 · Painel admin

`admin.html` — 2.234 linhas com HTML, CSS e JavaScript no mesmo arquivo.
Fala exclusivamente com `/api/content`.

---

## Como se entra

Não há login próprio. O painel lê a **mesma sessão do site**:

```js
let SESS = null;
try { SESS = JSON.parse(localStorage.getItem('cetec-sessao') || 'null'); } catch(e){}

async function post(action, extra){
  const body = Object.assign({ action, user: SESS && SESS.user, token: SESS && SESS.token }, extra);
  const r = await fetch('/api/content', { method:'POST', … });
  return r.json();
}
```

Ou seja: você entra no site normalmente e abre `/admin.html`. Se a conta tem
`admin = true`, o painel carrega. Senão, toda ação volta 403.

A primeira coisa que o painel faz é um `ping`, que devolve o papel, a versão do
build, a lista de ações permitidas e o bloco `saude`. É o jeito rápido de
conferir se o que está no ar é mesmo o build atual.

Quando algo do ambiente falta — a tabela `rate_limite`, a chave da Resend, o
`CRON_SECRET` —, o painel pinta uma **tarja no topo** com o que está faltando e
como consertar. Ela existe porque essas travas falham abertas: o site continua
servindo normalmente, só que sem a proteção, e o único sinal era uma linha de
log. Some sozinha quando está tudo certo.

`/admin.html` está no `robots.txt`, mas isso é higiene de indexação, não
segurança — a proteção real está no servidor.

---

## Os três papéis

| Papel | Território | Pode | Não pode |
|---|---|---|---|
| `admin` | tudo | — | — |
| `moderador` | **pessoas** | silenciar, suspender (máx. 30 dias), esconder nome, derrubar sessão, anonimizar, limpar rastro social, investigar votos | apagar conta, renomear, alterar nota, dar cargo, tocar no acervo ou no config |
| `historiador` | **acervo** | criar e editar edição, noite e peça; subir imagem | excluir qualquer coisa; mexer em pessoas |

O princípio por trás de cada um:

- **Moderador:** tudo o que ele faz é reversível. Suspensão tem prazo,
  anonimato se desfaz, sessão se refaz com login. O pior estrago que ele
  consegue causar se desfaz sozinho com o tempo.
- **Historiador:** pode acrescentar e corrigir, nunca subtrair. Um voluntário
  digitalizando o acervo de 2009 não deve conseguir apagar 2025 por engano.

A tabela vive em `ACOES_POR_PAPEL`, em `api/_moderacao.js`. É lá que se
concede permissão nova — e o comentário do arquivo explica cada exclusão
deliberada.

### A trava do historiador

`salvarEdicaoCompleta` substitui a edição inteira. Para quem só pode adicionar,
isso seria uma porta dos fundos: bastaria reenviar a lista sem uma peça.

Então a rota compara o envio com o banco antes de gravar:

```js
if (eu.papel !== 'admin') {
  // recusa se alguma noite existente sumiu do envio
  // recusa se alguma noite tem MENOS peças do que já tinha
  // recusa voltar uma edição publicada para "em breve"
}
```

Mensagem devolvida: *"a noite 3 tem 4 peça(s) e o envio traz 3. Como
historiador você pode adicionar e corrigir, mas não excluir."*

### Duas listas extras

- `LIMPEZAS_SO_ADMIN = { votos, showcase, amigos }` — o moderador limpa rastro
  social, não conteúdo autoral nem dado de votação.
- `ITENS_SO_ADMIN = { voto, palpite }` — mesma razão, no apagar item a item.

---

## As abas

A navegação é por âncora, e cada seção tem `data-papel` com quem a enxerga.

| Aba | Papéis | O quê |
|---|---|---|
| 🔎 Buscar | admin, historiador | busca por edição ou peça para editar direto |
| 🔧 Manutenção | admin | tira o site ou páginas específicas do ar |
| ⚙️ Configurações | admin | edição em destaque, nota máxima, cooldown, textos, VAPID |
| 🏆 Hall & avançado | admin | mínimo de avaliações, badges extras, metas de perfil |
| 📝 Curiosidades/badges | admin | curiosidades, badges manuais, linha do tempo, "neste dia" |
| 🎬 Edições | admin, historiador | **o editor principal** |
| ⏰ Agendar | admin | banner/push com data marcada |
| 🔔 Notificação | admin | mensagem para um usuário ou para todos |
| 📰 Feed | admin | post no feed social |
| 📢 Banners | admin | banners de aviso do site |
| 👥 Usuários | admin, moderador | lista + o modal completo |
| 🗑️ Excluir notas | admin | moderação de votos com filtros |

> `data-papel` esconde a seção, mas **quem barra é o servidor**. O comentário
> no topo do arquivo diz isso explicitamente para que ninguém trate a interface
> como camada de segurança.

---

## Aba Edições — o editor principal

É onde se passa a maior parte do tempo. Uma edição inteira num formulário:

**Dados da edição** — ano, ordem, nº de noites, "em breve", datas (`abre_em`,
`monte_abre_em`, `inicio`, `fim_votacao`), título, descrição, episódios por
noite, poster, mensagem de fim.

**Sobre e abertura** — títulos, banner, textos, playlist do Spotify.

**🔮 Bolão** — ligado/desligado, prazo do palpite, regras, e os textos dos dois
avisos automáticos. Tudo isso mora em `edicoes.extra.bolao`.

**🌙 Noites e peças** — por noite: data, subtítulo e a lista de peças (título,
turma, sinopse, link do YouTube com timestamp).

O botão de salvar dispara **um** `salvarEdicaoCompleta` com tudo.

### Preservação do `extra`

O painel guarda o `extra` original em `_EXTRA_EDICAO` ao carregar e faz merge
ao salvar. Sem isso, mandar só os campos do formulário apagaria qualquer chave
que o painel ainda não conhece.

> Se você adicionar um campo novo em `extra`, siga o mesmo padrão. E se
> adicionar um campo à edição, lembre de incluí-lo tanto no carregamento
> quanto no `row` de `salvarEdicaoCompleta` — esquecer o segundo faz o campo
> ser zerado a cada salvamento.

### ⚠️ Antes de mexer em peças de uma edição já votada

Leia [04 · Banco — a chave `sNeM`](04-banco-de-dados.md#a-chave-snem).

Desde 08/2026 o servidor **recusa** o envio (409) se alguma peça mudou de
posição numa edição que já tem votos, e mostra o mapa do que mudaria. Corrigir
título, turma, sinopse, link e data continua livre. Para reordenar de verdade:
`node remanejar-pecas.js <ano>`.

---

## Aba Usuários — o modal

Clicar num usuário abre um modal com **tudo** sobre ele: conta, perfil,
reputação, badges, avaliações, palpites do bolão, destaques, carimbos dados e
recebidos, reações no feed, visitas, notificações recentes, situação de
moderação, sessões abertas, e um bloco de limpezas em massa.

Ações disponíveis a partir dele:

| Ação | Efeito |
|---|---|
| Suspender | `perfil.banido` + derruba todas as sessões + zera o token legado |
| Silenciar | `perfil.silenciado_ate` — bloqueia interação, não a conta |
| Forçar troca de nome | esconde o nome **agora** (anonimato) e obriga a escolher outro |
| Renomear | migração completa nas nove tabelas |
| Anonimizar | `uma_vez`, `período` (com dias) ou `sempre` |
| Deslogar tudo | limpa `sessoes` + zera `usuarios.token` |
| Ajustar badges | `{ forcadas, bloqueadas }` sobre o catálogo calculado |
| Ajustar reputação | linha especial `from_user = '__admin__'` com a diferença |
| Definir papel | `admin` / `moderador` / `historiador` / nenhum |
| Notificar | central 🔔 + push opcional |
| Apagar item | voto, carimbo, visita, palpite, notificação, sessão |
| Excluir conta | anonimiza votos, apaga o resto |

Duas proteções embutidas:

- **Não dá para rebaixar a si mesmo** — evita ficar sem ninguém com a chave.
- **Não dá para suspender uma conta admin** — remova o cargo primeiro.

E um detalhe do "suspender": não basta limpar `sessoes`. O token legado mora em
`usuarios.token` e continuaria valendo sozinho, então os dois são zerados.

---

## Aba Excluir notas

Investigação de votos com filtros: ano, usuário (**busca por conta e por nome
digitado**), noite, episódio e nota exata.

Para cada voto: ver a grade inteira, **anonimizar** (guarda o nome em
`usuario_antigo`/`name_antigo`, reversível), restaurar o nome, editar as notas,
ou apagar.

Prefira **anonimizar a apagar**. Apagar muda a média da peça retroativamente e
o histórico do festival passa a mostrar um número que nunca foi verdade.

---

## Aba Banners

Cria banners com título, mensagem, link, duração, modo de exibição (uma vez por
aparelho / uma vez por sessão / sempre) e período opcional.

> **Os banners `bolao-abre:` e `bolao-fecha:` são diferentes.** Eles são a
> memória de "este aviso já saiu", então o "Apagar" os **arquiva** em vez de
> excluir. Somem do site e da lista, mas a linha permanece. Se fossem
> excluídos de verdade, o servidor recriaria o banner e reenviaria o push para
> toda a base — foi exatamente esse o bug corrigido em agosto de 2026.

---

## Aba Manutenção

Tira o site — ou só algumas páginas — do ar, com uma tela explicativa no lugar.

| Campo | O quê |
|---|---|
| **Ligar o modo manutenção** | o interruptor |
| **Escopo** | o site inteiro, ou só as páginas marcadas |
| **Páginas** | início, edição, noite, bolão, monte o seu, hall, perfil, busca, notificações, configurações |
| **Título e mensagem** | o que aparece na tela; vazio usa um texto padrão |
| **Previsão de volta** | opcional — vira contagem regressiva, e a página recarrega sozinha na hora |
| **Recusar envios no servidor** | ver abaixo |

### Duas camadas, e elas fazem coisas diferentes

**A tela** é o que o visitante vê. Ela é **cortesia, não cadeado**: quem editar
o `localStorage` passa por cima e vê o site — possivelmente quebrado, que é
justamente o que a tela estava evitando. Isso é aceitável, porque o que ela
protege é a experiência de quem chega.

**A recusa de envios** (`bloquearApi`) é o cadeado de verdade. O `/api/db`
passa a recusar voto, palpite, carimbo, reação, reputação, visita, edição de
perfil, troca de nome e exclusão de conta. É conferida **no servidor**, com o
papel confirmado no banco, e não tem como burlar.

Deixe marcada sempre que a manutenção existir para proteger dado. Se algo está
errado com as notas, um voto que entra no meio do conserto é um voto que vai
ter que ser caçado depois.

**Entrar na conta, sair e recuperar senha continuam funcionando** de propósito
— senão a equipe se tranca do lado de fora.

### Como a equipe entra

Três caminhos, e nenhum depende do modo manutenção:

1. **`/admin.html` nunca é bloqueado.** O painel não carrega o `core.js`, então
   a tela de manutenção não existe para ele. A própria tela traz um link
   discreto "Sou da equipe →".
2. **Quem tem sessão de admin atravessa a tela** e navega normalmente, com uma
   tarja amarela fixa no rodapé: *"🔧 Manutenção LIGADA … só a equipe está
   vendo o site"*, com atalho para desligar.
3. **`/redefinir-senha.html` nunca é bloqueada** — é o caminho de volta de quem
   perdeu o acesso.

> A tarja existe porque manutenção esquecida ligada é um clássico. Se você é
> admin e o site parece normal, olhe o rodapé antes de concluir que está tudo
> certo para os outros.

### Se o painel também estiver fora do ar

O modo manutenção mora em `config_site.dados.manutencao`. Se por algum motivo
nem o painel abrir, desligue direto no SQL Editor do Supabase:

```sql
UPDATE config_site
SET dados = jsonb_set(dados, '{manutencao,ativo}', 'false')
WHERE id = 1;
```

---

## Aba Agendar

Banner ou push com data e hora marcadas, gravado em `agendados` e processado
por `/api/cron-push`.

> No plano Hobby da Vercel o cron roda **uma vez por dia** (`0 12 * * *`). Um
> agendamento sai na próxima execução após a data marcada. Se precisar de hora
> exata, use o disparo manual em `enviar-push.html` ou suba para o plano Pro e
> ajuste o `schedule` no `vercel.json`.

---

## Dando acesso a alguém

1. A pessoa cria conta no site normalmente.
2. Um admin abre **👥 Usuários**, busca a conta, abre o modal.
3. Em "Conta", escolhe o papel.
4. A pessoa recebe notificação e abre `/admin.html`.

Se der erro mencionando a coluna `papel`, o SQL dos papéis não rodou no
Supabase — o painel devolve essa dica na própria mensagem.

---

## Fazendo uma manutenção segura

- **Suba a `versao` do `ping`** ao adicionar ações. É o que permite descobrir
  em dois segundos se o build no ar é o atual, em vez de adivinhar por que uma
  ação nova responde "ação desconhecida".
- **Registre em `ACOES_CONHECIDAS`** — é o que o `ping` anuncia.
- **Decida o papel em `ACOES_POR_PAPEL`.** Omitir significa "só admin", que é
  o padrão seguro.
- **Nunca confie no `data-papel`** para proteger nada.
