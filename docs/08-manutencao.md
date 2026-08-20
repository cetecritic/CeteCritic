# 08 · Manutenção

Este é o documento operacional. Se você está assumindo o CETECritic agora, é o
que você vai abrir com mais frequência — e a **[Parte I](#parte-i--o-ciclo-anual)**
é o que responde "e agora, o que eu faço?".

> **Acabou de chegar?** Comece pelo [10 · Passagem de
> bastão](10-passagem-de-bastao.md), que explica os acessos, o vocabulário e o
> que fazer no primeiro dia. Volte aqui depois.
>
> **Algo está quebrado agora?** Vá direto para o
> [11 · Emergências](11-emergencias.md).

- **[Parte I · O ciclo anual](#parte-i--o-ciclo-anual)** — as quatro fases do ano, na ordem
- **[Parte II · Receitas avulsas](#parte-ii--receitas-avulsas)** — tarefas que não seguem o calendário
- **[Parte III · Higiene e diagnóstico](#parte-iii--higiene-e-diagnóstico)** — limpeza, cuidados, o que fazer quando quebra

---

# Parte I · O ciclo anual

O site tem um ritmo de doze meses que se repete. Entender esse ritmo é entender
quase tudo sobre por que o projeto é do jeito que é.

```
              ┌──────────────────────────────────────────────┐
              │                                              │
              ▼                                              │
   ┌─────────────────────┐                                   │
   │  FASE 1 · Festival  │  ~1 semana, julho                 │
   │  votação ao vivo    │                                   │
   └──────────┬──────────┘                                   │
              │                                              │
              ▼                                              │
   ┌─────────────────────┐                                   │
   │  FASE 2 · Encerrar  │  ~1 semana depois                 │
   │  fechar, apurar     │                                   │
   └──────────┬──────────┘                                   │
              │                                              │
              ▼                                              │
   ┌─────────────────────┐                                   │
   │  FASE 3 · Acervo    │  agosto a fevereiro               │
   │  vídeos, sinopses   │  (a fase mais longa e mais calma) │
   └──────────┬──────────┘                                   │
              │                                              │
              ▼                                              │
   ┌─────────────────────┐                                   │
   │  FASE 4 · Próxima   │  março a julho                    │
   │  criar, anunciar    │                                   │
   └──────────┬──────────┘                                   │
              │                                              │
              └──────────────────────────────────────────────┘
```

Cada fase tem uma pergunta que ela responde:

| Fase | Pergunta | Quem costuma tocar |
|---|---|---|
| 1 · Festival | "as notas estão entrando certo?" | admin de plantão |
| 2 · Encerramento | "o resultado está correto e congelado?" | admin |
| 3 · Acervo | "o que aconteceu naquele ano?" | historiador |
| 4 · Próxima edição | "o público já sabe que vem aí?" | admin |

---

## FASE 1 · A semana do festival

A única semana do ano em que o site é um app ao vivo. Cinco noites, público
votando do celular na saída do teatro.

### Véspera — a checagem que evita 90% dos sustos

Faça isto **na véspera**, não no dia. Um campo errado descoberto às 20h05 com
o teatro cheio é uma noite ruim.

**Datas**

- [ ] `fim_votacao` da edição preenchido, com **data e hora**
  > Vazio significa "votação sempre aberta" — nunca "encerrada". É a convenção
  > mais fácil de esquecer do projeto inteiro.
- [ ] Data e hora de **todas** as noites conferidas, uma a uma
  > É isso que libera cada coluna do formulário. Uma noite com data errada
  > aparece com 🔒 na hora em que o público tenta votar.
- [ ] `inicio` da edição preenchido (manda no countdown da home)
- [ ] `monte_abre_em` preenchido (abre o Monte o Seu **e o bolão**)

**Conteúdo**

- [ ] Todas as peças de todas as noites cadastradas, com título e turma
  > O bolão **exige preencher tudo**. Quem tentar palpitar antes do cadastro
  > completo recebe "falta palpitar em N peça(s)" e não consegue enviar.
- [ ] Poster no ar (abra a home numa aba anônima e confirme)
- [ ] `EDICAO_EM_DESTAQUE` apontando para o ano certo

**Infra**

- [ ] Push testado — mande um para você mesmo em `enviar-push.html`
- [ ] `CACHE_VERSION` do service worker subido, se houve deploy recente
- [ ] **Backup de `submissions` e `palpites`**: `node backup.js` (ver [Parte III](#backup))
- [ ] **A tarja do painel está limpa** — nenhuma proteção faltando
- [ ] Um segundo admin com acesso, caso você fique sem sinal no teatro

### Como conferir cada item, na prática

Marcar a caixa sem testar não vale. O que fazer, item a item:

| Item | Como confirmar de verdade |
|---|---|
| Datas das noites | Painel → 🎬 Edições → o ano. Leia **hora por hora**, uma noite de cada vez. Um `20:00` onde deveria ser `19:00` só aparece com o teatro cheio. |
| Peças cadastradas | Abra `/ANO/noite-1.html` até `/ANO/noite-5.html` numa aba anônima e conte. O bolão **exige** que todas estejam lá. |
| Pôster | Abra a home numa aba anônima. Se aparecer "Sem capa", o arquivo não subiu. |
| Edição em destaque | A home mostra o ano certo no menu e no countdown? |
| Push | `enviar-push.html`, mande para você mesmo, e **confira no celular**, não só na tela do computador. |
| Tarja do painel | Abra `/admin.html`. Nenhuma caixa vermelha ou amarela no topo. |
| Backup | Rode `node backup.js` e **abra a pasta**: `submissions.json` tem que ter conteúdo. |

> **A tarja do painel é a checagem mais barata e a mais nova.** Ela acusa
> quando a trava de votos, o e-mail (2FA e redefinição de senha) ou o cron
> estão desligados. Essas proteções **falham abertas**: o site funciona
> normalmente sem elas, e antes da tarja o único sinal era uma linha de log.
> Se ela estiver acusando algo na véspera, resolva antes da primeira noite.

### Durante as noites

**O que acontece sozinho:**

- A votação de cada noite abre no horário cadastrado. O botão só destrava
  depois que o navegador sincroniza o relógio com o servidor — mudar o relógio
  do celular não adianta.
- Uma noite ainda não liberada aparece com 🔒 e não aceita nota.
- O aviso de fechamento do bolão dispara no primeiro acesso após a hora da
  Noite 1.
- As médias se atualizam a cada 20 segundos em quem está com a página aberta.

**O que você faz:**

| Situação | Onde | Como |
|---|---|---|
| "A noite 3 começa em 30 min" | 📢 Banners | modo "uma vez por aparelho", duração 15 s |
| Aviso importante para todos | 🔔 Notificação | com push marcado |
| Peça entrou fora de ordem | 🎬 Edições | ⚠️ leia o aviso sobre `sNeM` antes |
| Voto suspeito | 🗑️ Excluir notas | prefira **anonimizar** a apagar |

**O plantão.** Combine antes quem fica de olho em cada noite, e tenha um
segundo admin alcançável por telefone. Durante a noite, o trabalho é quase todo
observação:

- Abra `/ANO/index.html` no celular e recarregue de vez em quando: as médias se
  movem sozinhas a cada 20 segundos.
- Uma noite que **não** destravou no horário é o único problema realmente
  urgente — ver [11 · Emergências, cenário 2](11-emergencias.md).
- Banner de "a noite 3 começa em 30 min": 📢 Banners, modo "uma vez por
  aparelho", duração 15 s. Não use push para isso; push é para o que a pessoa
  precisa saber mesmo sem estar com o site aberto.

**Peça que não aconteceu / ordem trocada no palco.** Resista à tentação de
consertar a grade no meio do festival. Se a noite já recebeu votos, mexer na
ordem das peças reescreve as notas — ver
[a chave `sNeM`](04-banco-de-dados.md#a-chave-snem). Anote e conserte depois,
na Fase 3, com calma e com backup.

### Se a votação não abrir

1. Confira a data da noite no painel (fuso: o site usa `-03:00`).
2. Abra o console do navegador: o `core.js` só libera com `horarioSincronizado()`.
   Se `/api/db?year=…` não respondeu, o relógio não sincronizou.
3. Teste `https://cetecritic.xyz/config.js` — se não vier JavaScript, o
   problema está antes.

---

## FASE 2 · Encerramento

A semana seguinte ao festival. Curta, mas é onde o resultado vira histórico.

### O que fecha sozinho

Quando `fim_votacao` passa:

- a votação encerra (`votingClosed`) e o formulário some;
- o placar do bolão congela no estado final;
- as badges de pódio (🥇🥈🥉) aparecem nos perfis, calculadas ao vivo;
- um dia depois, o link do bolão sai do menu lateral (a URL continua servindo).

Nada disso exige ação sua. Se não aconteceu, `fim_votacao` está vazio ou errado.

### Conferência do resultado

- [ ] Abra `/ANO/index.html` e confira as médias e as badges de peça
- [ ] Abra `/ANO/bolao.html` e confira o pódio
- [ ] Abra o Hall da Fama e veja se a edição entrou nos recordes
- [ ] Passe os olhos em 🗑️ Excluir notas, filtrando por notas 0 e 10, atrás
      de padrões estranhos

> Sobre votos suspeitos: **prefira anonimizar a apagar**. Apagar muda a média
> retroativamente, e o histórico passa a mostrar um número que nunca foi
> verdade. Anonimizar é reversível, tira o nome, e mantém a nota na conta.
>
> Se você encontrar um pico coordenado, saiba que a moderação manual é a
> ferramenta principal — leia o item 1 de
> [09 · Riscos](09-riscos-conhecidos.md) para calibrar a expectativa.

### Marcar o encerramento

- [ ] `mensagem_fim` da edição escrita (aparece na página do ano)
- [ ] Post no feed com o resultado — 📰 Feed
- [ ] Notificação de agradecimento com push — 🔔 Notificação
- [ ] **Backup definitivo** de `submissions` e `palpites` deste ano

### Congelar o bolão

Não há botão de "congelar": o placar depende das médias, e as médias param de
mudar quando a votação fecha. Se você precisar mesmo travar (por exemplo,
porque vai continuar aceitando votos por algum motivo), desmarque **Bolão
ligado** na edição — mas saiba que isso tira a página do ar para consulta.

---

## FASE 3 · Acervo — a manutenção pós-festival

De agosto a fevereiro. É a fase mais longa, mais calma, e a que dá ao site o
valor que ele tem no resto do ano. É também a fase em que o papel
**historiador** existe.

O que se faz aqui: transformar "cinco noites que aconteceram" em "cinco noites
que dá para revisitar".

### 3.1 Os vídeos

Normalmente as gravações saem semanas depois. Conforme forem publicadas:

1. Painel → 🎬 Edições → o ano → a noite → a peça
2. Cole o link do YouTube no campo correspondente

O campo aceita **qualquer** formato de link de compartilhar:

| Você cola | O sistema entende |
|---|---|
| `youtu.be/ABC123?t=1h2m3s` | vídeo `ABC123`, começando em 3723 s |
| `youtube.com/watch?v=ABC123&t=90` | vídeo `ABC123`, começando em 90 s |
| `youtube.com/live/ABC123` | vídeo `ABC123` |
| `youtube.com/playlist?list=XYZ` | playlist |
| `open.spotify.com/playlist/XYZ` | playlist do Spotify (usado na abertura) |

> **O timestamp é o detalhe que mais importa.** Se a noite inteira está numa
> gravação só, cole o link com `?t=` no minuto em que **aquela peça** começa. O
> site guarda em `youtube_inicio` e abre o vídeo no ponto certo. Sem isso, o
> visitante cai no início de uma gravação de duas horas e desiste.
>
> No YouTube: clique com o botão direito no vídeo, no instante certo →
> "Copiar URL do vídeo no tempo atual".

Salve por noite, não peça por peça — o painel manda a edição inteira a cada
salvamento.

**O fluxo que funciona**, quando chega a gravação de uma noite inteira num
vídeo só:

1. Abra a gravação no YouTube e anote em que minuto cada peça começa.
2. Para cada peça: pause no instante certo → botão direito no vídeo → **"Copiar
   URL do vídeo no tempo atual"**.
3. Cole no campo da peça correspondente no painel. O site entende qualquer
   formato de link e guarda o segundo em `youtube_inicio`.
4. Salve a noite inteira de uma vez.
5. **Confira**: abra `/ANO/noite-N.html` e clique numa peça. O vídeo tem que
   abrir no ponto certo.

> Se você fizer só uma coisa nesta fase, faça o timestamp. Uma peça sem ele
> manda o visitante para o início de uma gravação de duas horas, e ele desiste
> antes de achar. É a diferença entre ter o acervo e ter o acervo utilizável.

### 3.2 As sinopses e as turmas

O que costuma faltar depois do festival:

- **Sinopse** — duas ou três frases sobre a peça. É o que aparece no card e o
  que a busca indexa.
- **Turma** — some no card de compartilhamento e nos créditos.
- **Título correto** — durante o festival vale o nome do programa; aqui vale o
  nome definitivo.

Tudo isso é **seguro de editar** a qualquer momento, mesmo numa edição já
votada. O que não é seguro é mexer na *ordem*.

### 3.3 A regra de ouro desta fase

> ### ⚠️ Nunca reordene nem remova peças de uma edição já votada
>
> A peça não tem identificador próprio. Ela **é** a posição dela na grade:
> `s2e3` é "terceira peça da segunda noite". Essa string é a chave dos votos e
> dos palpites.
>
> `salvarEdicaoCompleta` apaga as peças do ano e reinsere renumerando
> (`ordem: i + 1`). Se você tirar uma peça do meio, todas as seguintes sobem
> uma posição — e cada nota já dada passa a apontar para a peça errada.
> Silenciosamente, sem erro nenhum.
>
> **Seguro:** título, turma, sinopse, link, timestamp, subtítulo, data da noite.
> **Perigoso:** remover do meio, reordenar, inserir no meio.
>
> **A partir de agosto/2026 o servidor recusa as duas coisas** numa edição que
> já tem votos: remoção e reordenação. A detecção usa `pecas.chave`, a
> identidade estável que diz quem é cada peça independentemente da posição — e
> a mensagem mostra o mapa do que mudaria (`s1e1 → s1e3`).
>
> **Se precisar remover:** esvazie o título em vez de tirar a linha.
>
> **Se precisar mesmo reordenar:** `node remanejar-pecas.js <ano>` escreve um
> JSON com a ordem atual; você edita e roda com `--aplicar`. Ele reescreve os
> votos e os palpites junto, exige backup das últimas 24 h e confere a soma das
> notas no fim.

### 3.4 Enriquecimento do site

Com o acervo do ano em ordem, é a hora de alimentar o que faz as pessoas
voltarem:

**Curiosidades** (📝 Curiosidades/badges) — aparecem na home ("Você sabia?") e
no Hall. Duas ou três por edição já mudam a sensação do site.

**Linha do tempo** (📝) — uma frase por ano, na home. Anos sem edição também
merecem: "sem festival por causa da pandemia" é informação.

**Neste dia na história** (📝) — dia, mês, texto e link opcional. Aparece na
home só na data. É o recurso mais barato de fazer e o que mais surpreende.

**Badges manuais** (📝) — reconhecimentos que o cálculo automático não pega:
"primeira peça com libras", "recorde de público". As nove badges automáticas
são distribuídas sozinhas a partir dos votos — ver
[02 · Frontend § 7.1](02-frontend.md).

**Sobre e abertura** da edição (🎬 Edições) — texto, banner, contexto histórico,
playlist do Spotify da abertura.

### 3.5 Digitalizar edições antigas

Esta fase também é quando se recupera o que veio antes. O fluxo é o mesmo de
criar uma edição (Fase 4), com três diferenças:

- **Marque `em_breve` como falso** desde o começo — não há expectativa a criar.
- **Deixe `fim_votacao` vazio.** Significa "votação sempre aberta", que é o que
  se quer num acervo: alguém que assistir a gravação pode dar nota.
- **Considere desmarcar "Bolão ligado".**
  > Uma edição em que ninguém tocou nessa aba nasce com o bolão **ativo** —
  > "ausente = ligado". Foi essa combinação, somada ao `fim_votacao` vazio, que
  > em 2026 fez o site anunciar "O bolão de 2017 fechou" para quinze edições de
  > uma vez. A causa está corrigida, mas uma edição antiga com bolão ligado e
  > zero palpites só cria uma página vazia no menu.

### 3.6 Checklist de fechamento da Fase 3

Antes de considerar um ano "arquivado":

- [ ] Todas as peças com título definitivo, turma e sinopse
- [ ] Vídeos com timestamp por peça
- [ ] Página "Sobre" da edição escrita
- [ ] Playlist da abertura, se houver
- [ ] Poster em boa qualidade no Storage
- [ ] Pelo menos duas curiosidades
- [ ] Uma frase na linha do tempo
- [ ] URLs do ano no `sitemap.xml`
- [ ] Uma passada de olho em `/ANO/index.html`, `/ANO/sobre.html` e uma noite

---

## FASE 4 · A próxima edição

De março a julho. Vai de "vai ter festival" a "o festival começa hoje".

### 4.1 Anunciar — o modo "em breve"

Assim que a data existir, mesmo sem programação:

1. Painel → 🎬 Edições → nova edição
2. Preencha apenas:

| Campo | Valor | Por quê |
|---|---|---|
| `ano` | 2027 | a chave de tudo |
| `ordem` | 2027 | ordenação no menu |
| `noites` | 5 | ajuste se mudar |
| **`em breve`** | ✅ **marcado** | mostra a página de expectativa |
| `abre_em` | data do anúncio | quando a edição aparece no menu |
| `titulo` | "Cetec Festival 2027" | provisório, dá pra mudar |

3. Salve.

`/2027/` já responde — nenhum arquivo criado, nenhum deploy. Quem entrar vê a
página de expectativa com contagem regressiva, e o ano aparece na linha do
tempo da home como "Em breve...".

> **`em_breve` faz mais do que trocar a página.** Ele também trava o "Monte o
> Seu" e tira a edição do bolão. É o interruptor de "existe, mas ainda não tem
> conteúdo".

### 4.2 Montar a programação

Conforme a organização define a grade:

**Noites** — data e hora de cada uma, e subtítulo se houver tema.

> A hora importa duplamente: é ela que libera a votação daquela noite **e** o
> horário da Noite 1 é o prazo padrão do palpite do bolão.

**Peças** — por noite, na **ordem de palco**: título, turma, sinopse.

> Cadastre na ordem definitiva desde o começo. Depois que a votação abre, a
> ordem vira histórico e não se mexe mais (ver 3.3).

**Datas da edição:**

| Campo | Quando |
|---|---|
| `inicio` | primeira noite — manda no countdown da home |
| `monte_abre_em` | quando abre o Monte o Seu **e o bolão** — normalmente junto com a divulgação da grade |
| `fim_votacao` | horário de encerramento, alguns dias depois da última noite |

**Poster** — upload pelo painel (comprime e sobe para o Storage sozinho).
Máx. 3 MB, formatos `webp`/`jpeg`/`png`/`gif`.

### 4.3 Configurar o bolão

Painel → 🎬 Edições → 🔮 Bolão:

| Campo | Recomendação |
|---|---|
| Bolão ligado | ✅ marcado |
| Palpite fecha em | **deixe vazio** — usa o horário da Noite 1, que é o certo |
| Regras | vazio usa a explicação padrão, que é boa |
| Aviso de abertura | escreva algo com a cara da edição, ou deixe o padrão |
| Aviso de fechamento | idem |

> O aviso de **abertura** só sai se `monte_abre_em` estiver preenchido. Sem
> hora marcada não há momento a anunciar, e a janela de 48 h engole o disparo.
> É a causa número um de "por que o push do bolão não saiu".

Os dois avisos disparam sozinhos, **uma vez cada**. Editar o texto depois de
enviado não reenvia.

### 4.4 Publicar

Quando a programação estiver completa:

1. **Desmarque `em breve`** — a edição fica navegável de verdade
2. **Troque `EDICAO_EM_DESTAQUE`** em ⚙️ Configurações para o ano novo

Isso muda de uma vez: a home, o menu lateral, o link do bolão e o pré-cache do
service worker (que lê o `config.js` sozinho e passa a guardar o ano novo).

3. **Atualize o `sitemap.xml`** com as URLs do ano

> Salve **sempre em UTF-8**, nunca em "Unicode"/UTF-16. O Bloco de Notas em
> "Unicode", ou um redirect `>` do PowerShell, gravam UTF-16 com BOM: o
> navegador até mostra o XML, mas o Google encontra bytes nulos e responde
> "não foi possível ler o sitemap". O aviso está no topo do próprio arquivo.

4. **Anuncie** — 🔔 Notificação com push + 📢 Banner + 📰 Feed

### 4.5 Passagem de bastão

> **O roteiro completo está em [10 · Passagem de
> bastão](10-passagem-de-bastao.md)**: o inventário de acessos, como confirmar
> que cada um funciona de verdade, o que a pessoa nova faz no primeiro dia e a
> checagem de quinze minutos que prova que a passagem terminou.
>
> A lista abaixo é o resumo. Se você está realmente passando o bastão, abra o
> documento 10 — a maior parte das passagens falha por acesso que ninguém
> testou, não por falta de boa vontade.

Se a equipe muda de ano para ano — e costuma mudar — este é o momento:

- [ ] Pelo menos **dois** admins ativos (nunca um só)
- [ ] Quem vai cuidar do acervo com papel `historiador`
- [ ] Quem vai moderar durante o festival com papel `moderador`
- [ ] Acesso à Vercel e ao Supabase repassado
- [ ] Quem sai teve o papel removido em 👥 Usuários

> **Não dá para rebaixar a si mesmo** — a rota recusa, justamente para o site
> nunca ficar sem ninguém com a chave. Peça a outro admin.

E a checagem que evita um festival sem push: as variáveis de ambiente ainda
estão lá? Uma chave da Resend que expirou em silêncio significa 2FA e
redefinição de senha quebrados, sem nenhuma mensagem de erro.

### 4.6 E então volta para a Fase 1

Uma semana antes da primeira noite, refaça a checagem de véspera. O ciclo
recomeça.

---

## Calendário resumido

| Quando | Fase | O essencial |
|---|---|---|
| **Julho, véspera** | 1 | checagem de datas, backup, push testado |
| **Julho, 5 noites** | 1 | banners, moderação, olho nas médias |
| **Julho, semana seguinte** | 2 | conferir resultado, `mensagem_fim`, backup |
| **Agosto–setembro** | 3 | vídeos com timestamp, sinopses, turmas |
| **Outubro–dezembro** | 3 | curiosidades, linha do tempo, edições antigas |
| **Janeiro–fevereiro** | 3 | limpeza do banco, revisão dos riscos |
| **Março** | 4 | criar a edição em "em breve" |
| **Abril–maio** | 4 | noites e peças conforme a grade sai |
| **Junho** | 4 | poster, bolão, `monte_abre_em` |
| **Julho, início** | 4 | publicar, virar o destaque, anunciar |

---

# Parte II · Receitas avulsas

## Corrigir uma peça

**Seguro a qualquer momento:** título, turma, sinopse, link do YouTube,
timestamp, subtítulo e data da noite.

**Perigoso numa edição já votada:** remover do meio, reordenar, inserir no
meio. Ver [3.3](#33-a-regra-de-ouro-desta-fase).

## Moderar uma conta

| Situação | Ação | Efeito |
|---|---|---|
| Nome ofensivo | **Forçar troca de nome** | esconde o nome agora e obriga a escolher outro |
| Comportamento ruim | **Silenciar** (horas) | bloqueia interação, não a conta |
| Caso grave | **Suspender** (dias ou permanente) | derruba todas as sessões |
| Conta invadida | **Deslogar tudo** | limpa sessões + token legado |
| Pedido de exclusão | **Excluir conta** | anonimiza votos, apaga o resto |

Anonimizar (`uma_vez`, `período`, `sempre`) é o instrumento mais leve: esconde
o nome sem punir.

Moderador tem teto de 30 dias na suspensão e não apaga conta, não renomeia e
não mexe em nota — por desenho, tudo o que ele faz é reversível.

## Dar acesso a alguém

1. A pessoa cria conta no site normalmente
2. Admin abre 👥 Usuários → busca → modal → escolhe o papel
3. A pessoa recebe notificação e abre `/admin.html`

Erro mencionando a coluna `papel` significa que o SQL dos papéis não rodou.

## Recuperar alguém trancado fora da conta

| Situação | Solução |
|---|---|
| Esqueceu a senha, tem e-mail | "Esqueci minha senha" no site |
| Esqueceu a senha, sem e-mail | admin: 👥 Usuários → preencher o e-mail → a pessoa pede o reset |
| 2FA com e-mail inacessível | admin: 👥 Usuários → desmarcar `twofa` |
| Conta do Google, quer senha | não há fluxo — crie um e-mail no perfil e use o reset |

## Trocar as chaves VAPID

Só se elas vazarem. `node gerar-vapid.js`, atualize as três variáveis na Vercel
**e** a chave pública em `config_site.dados.VAPID_PUBLIC_KEY`.

Todas as inscrições existentes se tornam inválidas. O site as recria sozinho
(`pushsubscriptionchange` no service worker e `ativarPush` no cliente detectam
chave diferente), mas conte com algumas horas de push não entregue.

---

# Parte III · Higiene e diagnóstico

## Tarefas periódicas

### A cada deploy de front
Suba o `CACHE_VERSION` no `service-worker.js`. E rode `npm test` antes.

### A cada edição nova
Atualize o `sitemap.xml` — a menos que você já tenha migrado para o sitemap
gerado (`/api/content?file=sitemap`).

### Uma vez por ano (janeiro é bom)

Limpeza do banco. Nada disso é automático hoje:

```sql
-- links de redefinição usados ou expirados
DELETE FROM resets
WHERE usado = true OR exp < (EXTRACT(EPOCH FROM now())*1000)::bigint;

-- banners antigos, PRESERVANDO os avisos automáticos do bolão
DELETE FROM broadcasts
WHERE bc_id NOT LIKE 'bolao-%'
  AND ts < (EXTRACT(EPOCH FROM now() - interval '90 days')*1000)::bigint;

-- agendamentos já processados
DELETE FROM agendados
WHERE enviado = true
  AND quando < (EXTRACT(EPOCH FROM now() - interval '90 days')*1000)::bigint;

-- notificações lidas com mais de 6 meses
DELETE FROM notificacoes
WHERE lida = true
  AND ts < (EXTRACT(EPOCH FROM now() - interval '180 days')*1000)::bigint;

-- sessões abandonadas há mais de 6 meses
DELETE FROM sessoes
WHERE ultimo_uso < (EXTRACT(EPOCH FROM now() - interval '180 days')*1000)::bigint;
```

> **Nunca** use `DELETE` em linhas `bolao-%` de `broadcasts`. Elas são a memória
> de "este aviso já saiu" — apagá-las faz o servidor recriar o banner e
> reenviar o push para toda a base.

Também em janeiro: releia [09 · Riscos](09-riscos-conhecidos.md). Vários itens
de lá pioram conforme a base cresce, e é bom saber onde você está.

## Backup

Não há rotina automatizada, mas há um script. **Antes de qualquer operação
grande** — migração, limpeza em massa, edição de acervo antigo — e ao fim de
cada festival:

```powershell
$env:SUPABASE_URL="https://xxxx.supabase.co"
$env:SUPABASE_SECRET_KEY="sb_secret_..."
node backup.js
```

Salva as 16 tabelas em `backups/AAAA-MM-DD-HHMM/`, um `.json` por tabela.
Prefira isto ao CSV do painel: `grid`, `palpites` e `perfil` são jsonb, e no
CSV viram texto escapado que você só descobre que precisa desescapar na hora de
restaurar. O script pagina de mil em mil (o corte do PostgREST é silencioso) e
avisa em letras claras se `submissions` vier vazia — o que quase sempre
significa que foi usada a chave `anon` em vez da secret.

A pasta `backups/` está no `.gitignore`: o dump traz hash de senha e e-mail de
todo mundo. Copie para fora do computador — backup no mesmo disco que o
problema não é backup.

Pelo SQL Editor, se preferir na mão:

```sql
SELECT * FROM submissions;   -- insubstituível
SELECT * FROM palpites;      -- insubstituível
SELECT * FROM usuarios;
SELECT * FROM edicoes;
SELECT * FROM noites;
SELECT * FROM pecas;
SELECT * FROM config_site;
```

Exporte como CSV pelo SQL Editor do Supabase.

`submissions` e `palpites` são a memória do festival e não existem em nenhum
outro lugar. O resto se reconstrói com trabalho; esses dois, não.

O Supabase faz backup automático no plano pago. No gratuito, a
responsabilidade é sua.

## Antes de mexer no código

1. **Leia os comentários da região.** Blocos longos registram decisão
   consciente ou armadilha já pisada. Vários dizem literalmente "ANTES era
   assim e dava tal problema".
2. **Procure duplicação intencional.** A tabela de pontuação do bolão e a
   janela de prazo existem no cliente e no servidor de propósito. Mudar um lado
   só faz os dois discordarem.
3. **Ponha `.limit()` em todo `select` novo.**
4. **Nunca use `ilike` direto em `update`/`delete`.** `_` é curinga em LIKE e
   nomes de usuário aceitam `_`.
5. **Use `agora()`, nunca `new Date()`**, para decidir se algo está liberado.
6. **Teste em aba anônima**, para tirar service worker e `localStorage` da
   equação.
7. **Suba a `versao` do `ping`** ao adicionar ações no painel.

## Quando alguma coisa quebra

> Para cenários específicos — home em branco, votação que não abre, push
> repetindo, equipe trancada fora —, vá direto para o
> [11 · Emergências](11-emergencias.md), que tem o passo a passo de cada um.

Ordem de investigação que resolve a maioria dos casos:

1. **Console do navegador.** Um `ReferenceError` no `core.js` derruba a página
   inteira, e a causa quase sempre é um global de `config.js` que não chegou.
2. **`/config.js` no navegador.** Deve vir JavaScript com
   `const EDICAO_EM_DESTAQUE = …`. Se vier HTML de erro, o problema é a função
   ou o banco.
3. **Logs da Vercel.** Functions → o log da rota.
4. **`ping` no painel.** Confirma que o build no ar é o atual.
5. **Aba anônima.** Descarta cache e service worker.
6. **SQL Editor do Supabase.** Confirma que o dado está lá.

O guia de sintomas específicos está em
[07 · Deploy — Diagnóstico](07-deploy-e-ambiente.md#diagnóstico).
