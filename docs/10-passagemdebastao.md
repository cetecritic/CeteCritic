# 10 · Passagem de bastão

> Este documento é para quem **acabou de receber as chaves**. Se você abriu o
> repositório hoje pela primeira vez e não sabe por onde começar, começou no
> lugar certo.
>
> Ele é escrito em duas camadas. O texto principal não assume que você
> programa: se você sabe usar um computador, consegue seguir. As caixas
> marcadas **`Para quem programa`** trazem o detalhe técnico e podem ser
> puladas sem prejuízo.

**Índice**

- [Parte I · O primeiro dia](#parte-i--o-primeiro-dia)
- [Parte II · Os acessos, um por um](#parte-ii--os-acessos-um-por-um)
- [Parte III · O vocabulário mínimo](#parte-iii--o-vocabulário-mínimo)
- [Parte IV · O protocolo de troca](#parte-iv--o-protocolo-de-troca)
- [Parte V · Seu primeiro mês, conforme o mês](#parte-v--seu-primeiro-mês-conforme-o-mês)
- [Parte VI · Se a pessoa anterior sumiu](#parte-vi--se-a-pessoa-anterior-sumiu)

---

# Parte I · O primeiro dia

## 1.1 O que é isto que você recebeu

O CETECritic é o site do CETEC Festival, o festival de teatro estudantil que
acontece uma vez por ano, ao longo de cinco noites. O site faz duas coisas
muito diferentes:

- **Durante o festival (uma semana por ano):** o público dá nota a cada peça
  pelo celular, as médias se movem ao vivo, o bolão apura, notificações
  disparam. É a semana em que tudo precisa funcionar.
- **Nas outras 51 semanas:** é um arquivo histórico. Trinta e poucos anos de
  festival, com vídeos, sinopses, recordes e perfis.

Guarde isso, porque **quase toda decisão estranha do projeto se explica por
essa dupla natureza**. Um site que fica no ar sozinho o ano inteiro e vira um
aplicativo ao vivo em julho.

Hoje o acervo tem cerca de **155 peças** cadastradas, de 2017 a 2026, e cerca
de **336 avaliações** gravadas. Esses números vão crescer; use-os como ordem de
grandeza para saber se algo está muito errado.

## 1.2 Os cinco lugares onde o site vive

Você vai precisar entender que o site não mora em um lugar só. São cinco, e
cada um faz uma coisa:

| Lugar | O que é | O que você faz lá |
|---|---|---|
| **O site** (`cetecritic.xyz`) | o que o público vê | conferir se está tudo certo |
| **O painel** (`cetecritic.xyz/admin.html`) | a administração | **90% do seu trabalho** |
| **Vercel** | onde o site está hospedado | ver erros, mexer em configurações secretas |
| **Supabase** | onde os dados moram | consultar e corrigir dados direto, em último caso |
| **O repositório** (GitHub) | onde o código mora | só se você for mexer no código |

> **A boa notícia:** se você não programa, **o painel resolve quase tudo**.
> Cadastrar edição, noite e peça, subir pôster, mandar aviso, moderar conta,
> ligar o modo manutenção — tudo isso é o painel. Vercel e Supabase são para
> quando algo quebra, e o [11 · Emergências](11-emergencias.md) explica cada
> caso.

## 1.3 As primeiras duas horas

Faça nesta ordem. Não pule, e não tente adiantar trabalho antes de terminar.

### Passo 1 — Entre no site como visitante

Abra `https://cetecritic.xyz` numa aba anônima. Navegue: veja a edição em
destaque, entre numa noite, abra o Hall da Fama, abra um perfil.

Você está aprendendo o que o público vê. Se você não conhece a cara normal do
site, não vai reconhecer quando ela estiver errada.

### Passo 2 — Crie a sua conta

No site mesmo, crie uma conta comum, com um nome de usuário que seja
reconhecível como seu. Guarde a senha num gerenciador.

> **Importante:** a identidade do site é o **nome de usuário**, não o e-mail.
> Escolha um nome que a equipe vá reconhecer.

### Passo 3 — Peça o papel de admin

Um administrador atual precisa abrir o painel → aba **👥 Usuários** → buscar a
sua conta → abrir o modal → em "Conta", escolher o papel.

Existem três papéis, e vale saber qual você recebeu:

| Papel | Território | Princípio |
|---|---|---|
| `admin` | tudo | — |
| `moderador` | **pessoas** | tudo o que faz é reversível |
| `historiador` | **acervo** | pode criar e corrigir, não pode excluir |

### Passo 4 — Abra o painel e leia o topo

Abra `https://cetecritic.xyz/admin.html`. Se a sua conta tem papel, o painel
carrega.

Olhe duas coisas antes de qualquer outra:

1. **O título** diz o seu papel ("Painel — Administrador").
2. **A tarja de ambiente**, se aparecer. É uma caixa vermelha ou amarela no
   topo dizendo que algo do ambiente está faltando — a tabela de limite de
   votos, a chave de e-mail, o segredo do cron.

> A tarja existe porque essas proteções **falham abertas**: quando faltam, o
> site continua funcionando normalmente, só que sem a proteção. Se ela estiver
> lá no seu primeiro dia, **anote e resolva antes do festival**. Não é urgente
> em outubro; é urgentíssimo em julho.

### Passo 5 — Passeie pelo painel sem salvar nada

Abra cada aba e leia. Não clique em salvar, não clique em excluir. Só olhe:

- 🔎 Buscar · 🎬 Edições · 👥 Usuários · 📢 Banners · 🔔 Notificação
- ⚙️ Configurações · 🏆 Hall & avançado · 📝 Curiosidades/badges
- ⏰ Agendar · 📰 Feed · 🗑️ Excluir notas · 🔧 Manutenção

### Passo 6 — Leia dois documentos

- [01 · Arquitetura](01-arquitetura.md) — quinze minutos, e explica por que o
  projeto é do jeito que é.
- [08 · Manutenção](08-manutencao.md) — o ciclo do ano, que é o seu calendário.

Pronto. Você já sabe mais do que o suficiente para não quebrar nada.

## 1.4 O que NÃO fazer na primeira semana

Esta lista é curta de propósito. Cada item aqui já causou problema real.

**Não reordene nem remova peças de uma edição que já tem votos.**
As notas são gravadas por posição. Desde agosto de 2026 o servidor recusa e
explica, mas entenda o motivo antes de contornar. Ver
[04 · Banco](04-banco-de-dados.md#a-chave-snem).

**Não apague votos.** Apagar muda a média retroativamente, e o histórico do
festival passa a mostrar um número que nunca foi verdade. Prefira
**anonimizar**, que é reversível.

**Não apague banners cujo id começa com `bolao-`.** Aquela linha é a memória de
"este aviso já saiu". Apagá-la faz o servidor concluir que nunca avisou,
recriar o banner e **reenviar o push para toda a base**. O painel já protege
isso, mas não faça no SQL.

**Não rode `DELETE` no SQL Editor do Supabase.** Nem para "limpar". Se achar
que precisa, pergunte a alguém e faça backup antes.

**Não troque as chaves VAPID** sem necessidade: invalida todas as inscrições de
push que existem.

**Não deixe o modo manutenção ligado e vá embora.** Existe uma tarja amarela no
rodapé avisando; olhe antes de fechar o computador.

**Não mexa em nada na véspera ou durante o festival** que não seja
estritamente necessário. A hora de consertar o acervo é agosto, não julho.

---

# Parte II · Os acessos, um por um

Esta é a parte que mais costuma falhar numa passagem de bastão: a pessoa recebe
o papel de admin no site e acha que recebeu tudo. Não recebeu. São seis acessos
distintos, e faltando qualquer um deles você fica sem conseguir resolver uma
classe inteira de problema.

## 2.1 Inventário — preencha e mantenha

> **Esta tabela precisa ser preenchida pela equipe atual.** Ela é o coração da
> passagem de bastão, e o motivo de este documento existir. Mantenha-a no
> repositório, mas **nunca escreva senhas aqui** — só quem tem e onde a
> credencial está guardada.

| Acesso | Para quê | Quem tem hoje | Onde está guardado | Confirmado em |
|---|---|---|---|---|
| Conta no site com papel | painel administrativo | | | |
| GitHub — repositório | o código | | | |
| Vercel | hospedagem, variáveis, logs | | | |
| Supabase | banco de dados e imagens | | | |
| E-mail `cetecritic@gmail.com` | recuperação de tudo o mais | | | |
| Registrador do domínio `cetecritic.xyz` | o endereço | | | |
| Resend | envio de e-mail (2FA, senha) | | | |

## 2.2 Como confirmar que cada acesso funciona de verdade

Ter a senha não é ter o acesso. Confirme cada um, na prática, no dia em que
receber:

**Conta com papel** — abra `/admin.html`. O painel carrega e o título mostra
seu papel. Se disser que sua conta não faz parte da equipe, o papel não foi
dado.

**GitHub** — consegue abrir o repositório e ver a lista de arquivos. Se for
mexer no código, confirme que consegue fazer push na branch de produção.

**Vercel** — consegue abrir o projeto, ver a aba **Deployments** e a aba
**Settings → Environment Variables**. Ver as variáveis é o que importa: é onde
moram os segredos.

**Supabase** — consegue abrir o **Table Editor** e ver a tabela `submissions`,
e abrir o **SQL Editor**. Rode um `SELECT count(*) FROM submissions;` só para
confirmar que responde.

**E-mail** — consegue entrar na caixa. Este é o acesso mais subestimado: é por
ele que se recupera Vercel, Supabase e domínio. Quem perde o e-mail perde tudo
o resto em cascata.

**Domínio** — consegue entrar no registrador e ver o `cetecritic.xyz`. Se o
domínio expirar, o site some, e nenhuma das outras contas resolve isso.

**Resend** — consegue entrar e ver que a chave de API está ativa. Uma chave
expirada significa 2FA e redefinição de senha quebrados **sem nenhuma mensagem
de erro** — o envio é ignorado em silêncio.

> `Para quem programa`
>
> A confirmação mais rápida do estado do ambiente é o `ping` do painel, que
> desde 08/2026 devolve um bloco `saude` com sete booleanos: `rateLimite`,
> `colunaPapel`, `email`, `push`, `vapidConfere`, `cron`, `rateSalt`. A tarja
> do painel é a leitura visual disso. Nenhum segredo sai na resposta, só o
> "está configurado ou não".

## 2.3 A regra dos dois

**Nunca deve existir apenas um administrador.** Se a única pessoa com acesso
some, viaja, perde o celular ou simplesmente para de responder, o site fica sem
dono — e recuperar depende de conseguir a caixa de e-mail, que pode estar
igualmente perdida.

O código ajuda: **não dá para rebaixar a si mesmo**, justamente para que
ninguém tire o próprio acesso e deixe o site órfão. Mas isso não protege contra
"só existia uma pessoa desde o começo".

Duas pessoas com acesso completo é o mínimo. Três é confortável.

---

# Parte III · O vocabulário mínimo

Os termos que aparecem em toda conversa sobre o projeto. Leia uma vez; volte
quando precisar.

**Edição** — um ano do festival. `2026` é uma edição. Cada uma tem noites,
peças, pôster, datas e textos próprios.

**Noite** — uma das (normalmente cinco) noites de uma edição. Tem data, hora e
subtítulo. **A hora importa duas vezes:** é ela que libera a votação daquela
noite, e a hora da Noite 1 é o prazo padrão do palpite do bolão.

**Peça** — uma apresentação. Tem título, turma, sinopse e link do vídeo.

**`sNeM`** — a forma como o site identifica uma peça pela posição: `s2e3` é "a
terceira peça da segunda noite". É a chave com que as notas são gravadas.
Por isso mexer na ordem é perigoso.

**`chave`** — desde agosto de 2026, a identidade **estável** da peça
(`A3.2025`). Ela não muda quando a peça muda de lugar, e é o que permite o
sistema perceber que uma reordenação aconteceria.

**Grid** — o conjunto de notas de uma avaliação: `{ "s1e1": 8.5, "s1e2": 7 }`.

**Avaliação (ou voto)** — uma pessoa mandando notas. Pode ser anônima.

**Bolão** — palpitar a nota de cada peça antes da primeira noite. O placar se
forma sozinho conforme as notas reais saem.

**Badge** — um selo. Existem três sistemas diferentes: badges de peça
(automáticas, calculadas dos votos), badges de usuário (perfil) e badges
manuais (o painel dá na mão).

**Broadcast / banner** — o aviso animado no topo do site.

**Push** — a notificação que aparece no celular, fora do navegador.

**Papel** — `admin`, `moderador` ou `historiador`.

**Migração** — um arquivo `.sql` que muda a estrutura do banco. Neste projeto
elas são **manuais**: alguém precisa rodar no SQL Editor do Supabase. Nada
avisa se uma migração não rodou, exceto a tarja de saúde do painel.

**Modo manutenção** — tira o site (ou páginas específicas) do ar, com uma tela
explicativa no lugar.

> `Para quem programa`
>
> **Service worker** — o arquivo que faz o site funcionar offline e carregar
> instantâneo. Guarda cópias no navegador de quem já visitou. Consequência
> prática: **ao publicar mudança no front, suba o `CACHE_VERSION`**, senão
> quem já visitou continua com a versão antiga por tempo indeterminado.
>
> **Rewrite** — regra no `vercel.json` que faz uma URL responder com outro
> arquivo. É o que permite criar a edição 2027 no painel e `/2027/` funcionar
> na hora, sem criar arquivo nenhum e sem deploy.

---

# Parte IV · O protocolo de troca

A equipe muda de ano para ano, e é aí que projetos assim morrem — não por bug,
por ninguém saber mais onde ficava o quê. Este é o roteiro.

## 4.1 Para quem está saindo

Faça isto **antes** de perder o interesse, não depois. A passagem de bastão de
quem já saiu mentalmente é a que dá errado.

- [ ] **Preencha o inventário da [Parte II](#21-inventário--preencha-e-mantenha)**
      com quem tem o quê e onde está guardado.
- [ ] **Dê o papel à pessoa nova** no painel, em 👥 Usuários, e confirme com
      ela que o `/admin.html` abriu.
- [ ] **Passe os acessos um por um**, e peça que ela **confirme cada um na
      prática** ([2.2](#22-como-confirmar-que-cada-acesso-funciona-de-verdade)).
      Não basta mandar a senha.
- [ ] **Rode um backup** (`node backup.js`) e mostre a ela onde ficou.
- [ ] **Conte o que está pendente.** O que você deixou pela metade, o que
      quebrou e você contornou, o que nunca teve tempo de fazer. Escreva em
      [09 · Riscos](09-riscos-conhecidos.md) se for estrutural.
- [ ] **Faça uma edição juntos.** Corrija a sinopse de uma peça com ela
      dividindo a tela. Vale mais que uma hora de explicação.
- [ ] **Só então** peça a outro admin que remova o seu papel — depois de
      confirmar que existem **pelo menos dois** administradores ativos.

> Não remova o próprio papel antes de a pessoa nova ter o dela funcionando.
> E lembre: a rota recusa rebaixar a si mesmo, então esse último passo depende
> de outra pessoa.

## 4.2 Para quem está chegando

- [ ] Faça a [Parte I](#parte-i--o-primeiro-dia) inteira.
- [ ] Confirme **todos** os acessos da [Parte II](#22-como-confirmar-que-cada-acesso-funciona-de-verdade),
      um por um, no mesmo dia.
- [ ] Rode `node backup.js` você mesmo, uma vez, e guarde a pasta fora do
      computador. Backup que você nunca rodou é backup que você não tem.
- [ ] Leia [09 · Riscos](09-riscos-conhecidos.md) inteiro. É onde está o
      registro do que já deu errado.
- [ ] Descubra em que fase do ano você está e vá para a
      [Parte V](#parte-v--seu-primeiro-mês-conforme-o-mês).
- [ ] Marque no seu calendário: **revisão de janeiro** e **checagem de véspera
      em julho**. São as duas datas que o projeto depende de alguém lembrar.

## 4.3 A checagem de quinze minutos que prova que a passagem funcionou

Faça isto com a pessoa nova, do computador **dela**, com as contas **dela**.
Se qualquer passo falhar, a passagem não terminou.

1. Abrir `/admin.html` e ver o painel carregar com o papel certo.
2. Abrir a aba 🎬 Edições, carregar a edição atual e **salvar sem mudar nada**.
   (Prova que ela consegue escrever, não só ler.)
3. Corrigir a sinopse de uma peça qualquer e conferir no site que mudou.
4. Criar um banner de teste em 📢 Banners, ver no site, e apagá-lo.
5. Mandar uma notificação de teste para a própria conta, com push marcado.
6. Abrir a Vercel e encontrar o log da última execução de `/api/db`.
7. Abrir o Supabase e rodar `SELECT count(*) FROM submissions;`.
8. Rodar `node backup.js` até o fim.

Oito passos. Se todos passarem, ela consegue tocar o site sozinha.

---

# Parte V · Seu primeiro mês, conforme o mês

O que fazer depende de quando você chegou. Encontre-se no calendário.

## Cheguei entre agosto e fevereiro — a fase de acervo

A melhor época possível para chegar. Não há pressa, nada está ao vivo, e o
trabalho é justamente o que ensina o sistema.

**Seu primeiro projeto:** pegue a edição do ano passado e complete-a.

1. Cole os links do YouTube de cada peça — **com o timestamp**, no minuto em
   que aquela peça começa. Sem isso, o visitante cai no início de uma gravação
   de duas horas e desiste.
2. Escreva as sinopses que faltam. Duas ou três frases.
3. Confirme as turmas e os títulos definitivos.
4. Escreva duas curiosidades e uma frase na linha do tempo.

É trabalho seguro: título, turma, sinopse, link e timestamp podem ser editados
a qualquer momento, mesmo numa edição já votada. **O que não é seguro é mexer
na ordem.**

Em **janeiro**, faça a revisão anual: releia [09 · Riscos](09-riscos-conhecidos.md)
e rode a limpeza de banco descrita em [08 · Manutenção](08-manutencao.md).

## Cheguei entre março e junho — a fase de preparação

Você vai montar a próxima edição. Siga a Fase 4 de
[08 · Manutenção](08-manutencao.md) na ordem, sem pular:

1. Criar a edição em "em breve" assim que houver data.
2. Cadastrar noites com **data e hora** conforme a grade sai.
3. Cadastrar peças **na ordem de palco definitiva** — depois que a votação
   abre, a ordem vira histórico.
4. Pôster, bolão, `monte_abre_em`.
5. Publicar: desmarcar "em breve" e trocar a edição em destaque.

## Cheguei em julho — você chegou na pior hora

Não é ideal, mas dá. Regras:

- **Não faça nada estrutural.** Nada de migração, nada de mexer em acervo
  antigo, nada de deploy que não seja urgente.
- **Faça a checagem de véspera** da Fase 1 de [08 · Manutenção](08-manutencao.md).
  Ela pega 90% dos sustos.
- **Tenha o [11 · Emergências](11-emergencias.md) aberto** durante as noites.
- **Combine quem é o plantão** de cada noite, e garanta um segundo admin
  alcançável por telefone.

---

# Parte VI · Se a pessoa anterior sumiu

Acontece: o estudante se formou, trocou de número, e ninguém tem acesso a nada.
A ordem de recuperação é esta, e cada degrau depende do anterior.

**1. A caixa de e-mail é a chave-mestra.** Se você tem acesso ao
`cetecritic@gmail.com` (ou ao e-mail que o inventário indicar), consegue
recuperar Vercel, Supabase, Resend e o registrador do domínio por
"esqueci a senha". Comece por aqui.

**2. Sem o e-mail, mas com o Supabase:** você consegue se tornar admin do site
na mão, pelo SQL Editor:

```sql
UPDATE usuarios SET admin = true, papel = 'admin' WHERE usuario = 'seunome';
```

Isso te devolve o painel, que é 90% do trabalho — mas não te devolve a Vercel
nem as variáveis de ambiente.

**3. Sem o Supabase, mas com a Vercel:** as variáveis `SUPABASE_URL` e
`SUPABASE_SECRET_KEY` estão em Settings → Environment Variables. Com elas você
fala com o banco direto, inclusive pelo `backup.js`.

**4. Sem nada disso, mas com o domínio:** dá para apontar o domínio para uma
hospedagem nova. Você perde os dados, mas mantém o endereço.

**5. Sem absolutamente nada:** o site continua no ar sozinho e ninguém consegue
mudá-lo. Não há saída técnica. Este é exatamente o cenário que o inventário da
[Parte II](#21-inventário--preencha-e-mantenha) e a regra dos dois existem para
evitar — e é o motivo de este documento pedir tanto que você os preencha hoje,
não depois.

> **Antes de fechar este documento:** se o inventário da Parte II ainda estiver
> vazio, preencha-o agora. Leva dez minutos e é a única coisa aqui que ninguém
> além de vocês pode fazer.
