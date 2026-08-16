# 01 · Arquitetura

> Este é o documento de entrada. Se você só tem quinze minutos antes de mexer
> no projeto, gaste-os aqui.

---

## 1. O problema que o projeto resolve

O CETEC Festival é um festival de teatro estudantil que acontece uma vez por
ano, ao longo de cinco noites. O site tem dois modos de vida bem diferentes:

- **Durante o festival (uma semana por ano):** é um app de votação ao vivo. O
  público dá nota a cada peça, as médias se movem em tempo real, o bolão apura,
  notificações disparam. É a semana em que tudo precisa funcionar.
- **Nos outros 51 meses… quer dizer, nas outras 51 semanas:** é um arquivo
  histórico. Quem chega quer navegar por edições antigas, ver recordes,
  procurar uma peça específica, olhar o próprio perfil.

Quase toda decisão estranha do projeto se explica por essa dupla natureza.

---

## 2. A pilha, em uma tela

| Camada | O que é | Onde mora |
|---|---|---|
| Páginas | HTML estático mínimo | raiz do repositório |
| Aplicação | Um arquivo JavaScript de 7.300 linhas | `assets/core.js` |
| Estilo | Um CSS com tema claro e escuro | `assets/estilo.css` |
| API de dados | Funções serverless Node | `api/db.js`, `api/content.js` |
| Regras compartilhadas | Módulo privado (não vira rota) | `api/_moderacao.js` |
| Push | Web Push com VAPID + cron | `api/enviar-push.js`, `api/cron-push.js` |
| Banco | Postgres + Storage | Supabase |
| Hospedagem | Estáticos + funções + cron + rewrites | Vercel |
| Offline | Service worker (PWA) | `service-worker.js` |

**Não existe etapa de build.** Sem webpack, sem Vite, sem TypeScript, sem
`node_modules` no front. O `package.json` da raiz existe só para a Vercel
instalar as dependências das funções serverless. Você edita, dá push, está no ar.

Isso é uma escolha, não uma limitação de conhecimento. O projeto é mantido por
estudantes que se revezam a cada ano; um repositório que roda com "abrir o
arquivo e editar" sobrevive a essa rotatividade. Ferramenta a mais é dívida a
mais para quem chega.

---

## 3. As três ideias centrais

### 3.1 Cada página é um casco

Abra `perfil.html`. São dezesseis linhas:

```html
<body>
<script>const BASE = ''; const PAGINA = { tipo: 'perfil', perfilUser: … };</script>
<script src="config.js"></script>
<script src="perfil.js"></script>
<script src="assets/core.js"></script>
</body>
```

A página não contém conteúdo. Ela declara **duas variáveis globais** e carrega
o `core.js`, que no final tem um `switch(PAGINA.tipo)` e chama a função da
página certa.

- `BASE` é o caminho até a raiz do site: `''` nas páginas da raiz, `'../'` no
  template de edição. Todo link e todo asset no `core.js` é montado com ele.
- `PAGINA` diz o que renderizar. Tipos válidos: `home`, `edicao`, `noite`,
  `sobre`, `abertura`, `resumo`, `monte`, `bolao`, `hall`, `perfil`, `busca`,
  `notif`, `config`, `emBreve`, `redefinir`.

**Consequência prática:** para adicionar uma página nova você cria um casco de
quinze linhas e uma função `paginaX()` no `core.js`, e registra o tipo no
dispatcher. Não há rota para configurar.

**Consequência menos agradável:** o `core.js` tem 386 KB e é baixado inteiro
em toda página, incluindo o código do Hall da Fama quando você só quer ver um
perfil. Está listado em [09 · Riscos](09-riscos-conhecidos.md) como dívida
conhecida.

### 3.2 O conteúdo vive no banco e chega como arquivo `.js`

Esta é a parte que mais surpreende quem chega.

O site nasceu com arquivos estáticos de verdade: `config.js`, `2026/edicao.js`,
`2026/noites/noite-1.js`, e um Google Apps Script fazendo as vezes de API. Cada
edição nova era uma pasta comitada à mão.

Hoje o conteúdo mora no Supabase. Mas em vez de reescrever o front para
consumir JSON, `/api/content` **gera os mesmos arquivos `.js` sob demanda**, e
o `vercel.json` faz o roteamento:

```jsonc
{ "source": "/config.js",              "destination": "/api/content?file=config" },
{ "source": "/:ano(\\d{4})/edicao.js", "destination": "/api/content?file=edicao&ano=:ano" }
```

Quando o navegador pede `/2026/edicao.js`, a função lê a tabela `edicoes` e
responde com JavaScript de verdade:

```js
/* gerado por /api/content (edicao 2026) */
const EDICAO = { ano: 2026, titulo: "Verissimos", … };
const NOITES = {};
```

O `core.js` faz `const ED = (typeof EDICAO !== 'undefined') ? EDICAO : null` e
segue a vida. Ele nunca soube que houve migração.

**Por que assim?** Porque permitiu mover todo o conteúdo para o banco e ganhar
um painel de administração sem reescrever as 7.000 linhas do front. A camada de
compatibilidade custou umas 60 linhas em `content.js`.

**O preço:** essas respostas passam por uma função serverless e um banco. Se o
Supabase engasgar, `config.js` falha — e como o `index.html` usa
`EDICAO_EM_DESTAQUE` num `document.write`, a home inteira fica em branco.
Está em [09 · Riscos](09-riscos-conhecidos.md).

### 3.3 Uma edição nova não precisa de deploy

O `vercel.json` manda qualquer `/ANO/*.html` para o `edicao-template.html`:

```jsonc
{ "source": "/:ano(\\d{4})/:pagina(.+\\.html)", "destination": "/edicao-template.html" },
{ "source": "/:ano(\\d{4})",                    "destination": "/edicao-template.html" }
```

O template lê a própria URL e monta o `PAGINA`:

```js
var _parts = location.pathname.split('/').filter(Boolean);  // ['2027','noite-3.html']
var _ano = _parts[0];
var _f = (_parts[1] || 'index.html').replace('.html', '');
if(/^noite-\d+$/.test(_f)) PAGINA = { tipo:'noite', noite: Number(_f.split('-')[1]), ano: Number(_ano) };
```

Cadastre 2027 no painel e `/2027/`, `/2027/sobre.html`, `/2027/noite-4.html`,
`/2027/bolao.html` estão todos no ar. Nenhum arquivo criado, nenhum deploy.

---

## 4. O ciclo de vida de um request

Vale seguir uma visita inteira à home, porque quase tudo do projeto aparece nela.

```
1.  GET /                       → Vercel serve index.html (estático)
2.  GET /config.js              → rewrite → /api/content?file=config
                                   lê config_site + edicoes → devolve JS
                                   define EDICAO_EM_DESTAQUE, EDICOES, API_URL…
3.  GET /home-dados.js          → rewrite → /api/content?file=home
4.  document.write injeta:
    GET /2026/edicao.js         → rewrite → /api/content?file=edicao&ano=2026
    GET /2026/noites/noite-1.js → rewrite → /api/content?file=noites&ano=2026&noite=1
    … (uma por noite)
5.  GET /assets/core.js         → estático; roda e chama paginaHome()
6.  paginaHome() monta o HTML e dispara em paralelo:
    GET /api/db?year=2026       → votos + serverNow + votingClosed
    GET /api/db?broadcasts=1    → banners de aviso
    POST /api/db {meuPerfil}    → se houver sessão
7.  window.load                 → registra o service worker
                                   (que pré-cacheia tudo para a próxima visita)
```

Três detalhes importantes desse fluxo:

**O relógio vem do servidor.** `GET /api/db?year=…` devolve `serverNow`, e o
`core.js` guarda a diferença em `serverTimeOffset`. Toda decisão de tempo usa
`agora()`, nunca `new Date()` direto. Motivo: mudar o relógio do computador não
pode liberar a votação antes da hora. `podeVotar()` exige explicitamente
`horarioSincronizado()`.

**Os votos são pintados antes da rede responder.** O `core.js` guarda a última
resposta boa no `localStorage` por ano (`cetec-votos-2026`) e pinta a tela na
hora, revalidando por cima quando a rede chega. Isso **não** afeta a trava de
horário — o cache pinta notas, não libera votação.

**O feed é o gatilho dos avisos automáticos do bolão.** `GET /api/db?year=…` é
a rota que todo visitante chama o tempo todo, então ela carrega no lombo um
`dispararAvisosBolao()`, limitado a uma verificação por minuto por instância. É
um cron feito de tráfego, e existe porque o cron real da Vercel no plano Hobby
roda uma vez por dia — grosso demais para um bolão que abre num horário marcado.

---

## 5. Os dois back-ends, e por que são dois

| | `api/db.js` | `api/content.js` |
|---|---|---|
| Quem chama | O site, o tempo todo | O painel admin, e o site para ler conteúdo |
| Autenticação | Token de sessão do usuário | `admin = true` + papel |
| Roteamento | `POST` por `body.action` | Cadeia de `if (action === …)` |
| Escreve | Votos, palpites, perfis, carimbos | Edições, noites, peças, config, moderação |
| Tamanho | ~1.670 linhas | ~1.320 linhas |

A separação é por **quem manda**, não por assunto. `db.js` responde a coisas
que o público faz; `content.js` responde a coisas que a equipe faz — mais o
conteúdo público, que é leitura do que a equipe escreveu.

`api/_moderacao.js` existe porque as duas precisam das mesmas regras (o que é
um nome válido, o que significa estar banido, quem pode fazer o quê). O
underscore no nome não é estilo: **arquivos que começam com `_` não viram rota
na Vercel**, então o módulo é importável sem ser exposto na web.

Detalhe de contrato que vale saber: `db.js` mantém de propósito o mesmo formato
de resposta do Google Apps Script que ele substituiu. `POST` roteado por
`action`, `GET` por querystring, JSON com as mesmas chaves. Foi o que permitiu
trocar o back-end inteiro sem tocar no `core.js`.

---

## 6. Onde cada estado mora

Saber isso evita a maior parte dos bugs de "mas eu mudei e não apareceu".

### No servidor (Supabase)
Votos, palpites, contas, sessões, perfis, carimbos, reputação, visitas,
notificações, inscrições push, banners, agendamentos, e todo o conteúdo
(edições, noites, peças, config do site).

### No navegador — `localStorage`
| Chave | O quê |
|---|---|
| `cetec-sessao` | `{ user, token, admin }` — a sessão |
| `cetec-votos-<ano>` | cache SWR dos votos daquele ano |
| `cetec-tema` | `claro` / `escuro` / `auto` |
| `custom-grid-<ano>`, `custom-*` | o "Monte o Seu" — **só existe neste aparelho** |
| `last-submission-ts` | cooldown entre envios de avaliação |
| `cetec-broadcasts-vistos` | banners já mostrados |
| `cetec-badges-<user>` | badges já notificadas |
| `cc_onboarded` | tela de boas-vindas já vista |
| `cetec-pwa-dispensado`, `cetec-banner-home` | banners de instalação |

### No navegador — `IndexedDB`
Base `cetecritic`, store `posters`: as capas que a pessoa envia no "Monte o
Seu". Ficam aqui porque base64 de imagem estourava a cota do `localStorage`.

### No navegador — `Cache Storage` (service worker)
- `cetecritic-v27` — HTML, CSS, JS, imagens do próprio site
- `cetecritic-img-v1` — imagens de outro domínio (capas no Supabase Storage)

> **Armadilha conhecida:** o "Monte o Seu" e o cooldown de votação vivem
> **só** no aparelho. Trocar de celular perde o Monte o Seu; limpar o
> `localStorage` zera o cooldown. O segundo é um problema de integridade e
> está documentado em [09 · Riscos](09-riscos-conhecidos.md).

---

## 7. Autenticação, em resumo

Três formas de entrar, uma única forma de continuar.

```
usuário + senha ──┐
                  ├──> criarSessao() ──> token opaco ──> tabela `sessoes`
código 2FA     ───┤                                       (uma linha por aparelho)
                  │
Google (OAuth) ───┘
```

- **Senha:** `scrypt` (N=16384, r=8, p=1), formato `s2$N$r$p$<hex>`. Contas
  antigas em `sha256` são migradas de forma transparente no próximo login
  correto. Cinco erros travam a conta por dez minutos. A mensagem de erro é
  sempre a mesma ("usuário ou senha incorretos") e um usuário inexistente
  paga o mesmo custo de CPU de um real — as duas coisas evitam enumeração
  de contas.
- **2FA:** opcional, por e-mail (Resend), código de seis dígitos válido por
  cinco minutos. Usar o código **prova** o e-mail (`email_verificado`).
- **Google:** o Supabase Auth entra só como provador de identidade. O
  navegador faz o OAuth, manda o `access_token` para `/api/db`, o servidor
  valida e emite um token **nosso**. Nada a jusante sabe que existe OAuth.

O ponto sutil: a identidade do site é o **nome de usuário**, não o e-mail.
Por isso quem entra pelo Google sem ter conta recebe `{ precisaNome: true }` e
escolhe um nome antes de existir na tabela `usuarios`.

E um ataque que o código bloqueia de propósito: ligar uma conta antiga ao
Google só acontece se aquele e-mail **já tiver sido provado do nosso lado**.
Sem essa checagem, eu criaria uma conta com o seu e-mail nas configurações e
esperaria você entrar pelo Google — o sistema ligaria o seu Google à minha
conta, e eu, que sei a senha, veria tudo que você faz. Os comentários em
`apiLoginOAuth` registram isso.

---

## 8. O modelo de permissão

Três papéis, e um princípio por trás de cada um:

| Papel | Território | Princípio |
|---|---|---|
| `admin` | tudo | — |
| `moderador` | **pessoas** | tudo o que faz é reversível |
| `historiador` | **acervo** | pode criar e corrigir, não pode excluir |

A tabela de permissões é `ACOES_POR_PAPEL` em `api/_moderacao.js`, e a
autoridade é a função `podeExecutar(papel, acao)`, chamada em `content.js`
**antes de qualquer ação**:

```js
if (!podeExecutar(eu.papel, action)) {
  res.status(403).json({ ok:false, error:'seu papel não permite esta ação' });
  return;
}
```

O painel esconde botões por papel, mas isso é conforto de interface. Esconder
botão não impede ninguém de chamar a API na mão — e o código diz isso em
comentário, para que ninguém confunda os dois.

A trava do historiador merece nota: `salvarEdicaoCompleta` substitui a edição
inteira, o que seria uma porta dos fundos (bastaria mandar a lista sem uma peça
para apagá-la). Então a rota compara o envio com o que já existe e **recusa
qualquer payload que encolha o acervo**.

Detalhes em [05 · Painel admin](05-painel-admin.md).

---

## 9. O que ler depois

- Vai mexer na interface ou numa página? → [02 · Frontend](02-frontend.md)
- Vai criar ou mudar um endpoint? → [03 · API](03-api.md)
- Vai mexer em dados ou escrever SQL? → [04 · Banco](04-banco-de-dados.md)
- Vai administrar o site durante o festival? → [08 · Manutenção](08-manutencao.md)
- Vai avaliar se o projeto aguenta crescer? → [09 · Riscos](09-riscos-conhecidos.md)
