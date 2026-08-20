<div align="center">

# CETECritic

**O Cetec Festival na palma da sua mão.**

Vote nas peças, acompanhe as médias ao vivo, compare edições e explore mais de
30 anos de história do maior festival de teatro estudantil do Rio Grande do Sul.

[**cetecritic.xyz**](https://cetecritic.xyz)

<sub>
JavaScript puro · sem build · sem framework<br>
Vercel Functions · Supabase · PWA offline
</sub>

</div>

---

## O que é isto

O CETEC Festival acontece uma vez por ano. Durante cinco noites, turmas do
colégio sobem ao palco, e por muito tempo a memória disso viveu só em cadernos,
grupos de WhatsApp e na cabeça de quem estava lá.

O CETECritic é o arquivo digital desse festival — e, durante a semana em que
ele acontece, o lugar onde o público dá as notas.

- **Vote** em cada apresentação, noite por noite, e veja a média se formar ao vivo.
- **Explore** o acervo: cada edição tem página, cada noite tem suas peças, cada peça tem sua nota.
- **Compare** anos no Hall da Fama, com gráficos e recordes de todas as edições.
- **Aposte** no bolão: palpite a nota de cada peça antes da primeira noite e dispute o pódio.
- **Monte o seu** festival ideal e compartilhe como imagem.
- **Colecione** badges, carimbos e reputação num perfil que é seu.

Tudo funciona sem conta. Criar uma é opcional — serve para guardar suas
avaliações, ganhar badges e entrar no bolão.

---

## Como isso é construído

Não há bundler, transpilador, `node_modules` no front nem etapa de build.
Você edita um arquivo, dá push, e a Vercel publica.

```
Navegador                     Vercel                      Supabase
─────────                     ──────                      ────────
index.html  ──┐
hall.html   ──┼── rewrite ──> /api/content ─────────────>  Postgres
perfil.html ──┘               (gera config.js,            (edicoes, noites,
/2026/*.html                   edicao.js, noite-N.js)      pecas, config_site)
     │
     └─ assets/core.js ────>  /api/db ─────────────────>  Postgres
        (o site inteiro)      (contas, votos, bolão,      (usuarios, submissions,
                               perfis, notificações)       palpites, carimbos…)
                                    │
                              /api/enviar-push ────────>  Web Push (VAPID)
                              /api/cron-push (diário)
```

Três ideias sustentam o projeto:

**1. Cada página HTML é um casco de 15 linhas.** Ela declara o que é
(`PAGINA = { tipo: 'noite', ano: 2026 }`) e carrega `assets/core.js`, que
contém o site inteiro. O roteamento é por variável global, não por URL.

**2. O conteúdo vive no banco, mas chega como arquivo `.js`.** O site nasceu
com arquivos estáticos e um Google Apps Script. Hoje o conteúdo está no
Supabase e `/api/content` *gera esses mesmos arquivos sob demanda*, servidos
pelos rewrites do `vercel.json`. O `core.js` continua consumindo os mesmos
globais e nunca soube da mudança.

**3. Uma edição nova não precisa de deploy.** O `edicao-template.html` descobre
ano e tipo de página pela própria URL. Cadastre 2027 no painel e
`/2027/noite-3.html` já está no ar.

---

## Rodando localmente

```bash
git clone <este-repo> && cd CeteCritic-main
npm install            # só as dependências das funções (@supabase, web-push, sharp)
npx vercel dev         # sobe o site + as funções em /api
```

Você precisa de um projeto Supabase e das variáveis de ambiente num `.env.local`.
A lista completa, com o que cada uma faz e o que acontece se faltar, está em
**[docs/07-deploy-e-ambiente.md](docs/07-deploy-e-ambiente.md)**.

Sem as variáveis o site sobe, mas `/api/content` devolve erro e a home fica em
branco — é o sintoma mais comum de ambiente mal configurado.

---

## Documentação

Comece pelo primeiro; os outros são consulta.

| Documento | Para quê |
|---|---|
| [01 · Arquitetura](docs/01-arquitetura.md) | O mapa completo. **Leia este antes de mexer em qualquer coisa.** |
| [02 · Frontend](docs/02-frontend.md) | `core.js` por dentro: dispatcher, páginas, estado, PWA, temas |
| [03 · API](docs/03-api.md) | Todas as rotas de `/api/db` e `/api/content`, com contrato |
| [04 · Banco de dados](docs/04-banco-de-dados.md) | As 17 tabelas, o JSON do perfil, as chaves `sNeM` |
| [05 · Painel admin](docs/05-painel-admin.md) | O painel, os três papéis, o modelo de permissão |
| [06 · Bolão](docs/06-bolao.md) | A linha do tempo, a pontuação, a privacidade |
| [07 · Deploy e ambiente](docs/07-deploy-e-ambiente.md) | Variáveis, migrações, Storage, cron |
| [08 · Manutenção](docs/08-manutencao.md) | Receitas: abrir uma edição, virar o ano, o dia do festival |
| [09 · Riscos conhecidos](docs/09-riscos-conhecidos.md) | O que está frágil hoje, em ordem de gravidade |

---

## Mapa dos arquivos

```
├── index.html, hall.html, perfil.html, busca.html…   cascos de página
├── edicao-template.html         serve QUALQUER /ANO/*.html via rewrite
├── admin.html                   painel completo (HTML+CSS+JS num arquivo só)
├── assets/
│   ├── core.js                  o site inteiro — 7.300 linhas
│   └── estilo.css               tema claro e escuro, 1.500 linhas
├── api/
│   ├── db.js                    contas, votos, bolão, perfis, notificações
│   ├── content.js               conteúdo público + todas as ações do painel
│   ├── _moderacao.js            regras compartilhadas pelos dois (papéis, banimento)
│   ├── enviar-push.js           Web Push via VAPID
│   └── cron-push.js             processa agendamentos (cron da Vercel)
├── service-worker.js            PWA: offline, cache, push
├── vercel.json                  rewrites e cron — é aqui que a mágica das URLs mora
├── migracao-bolao.sql           migrações pontuais
└── docs/                        esta documentação
```

---

## Convenções que valem saber de cara

- **Tudo em português.** Código, comentários, nomes de função, mensagens de erro.
  Uma variável chamada `palpiteFechado` é o padrão, não a exceção.
- **Comentários explicam o *porquê*, não o *quê*.** Quando você achar um bloco
  longo de comentário, ele quase sempre registra uma decisão consciente ou uma
  armadilha já pisada. Leia antes de "simplificar".
- **Uma peça é identificada por `sNeM`** — `s2e3` é a terceira peça da segunda
  noite. Essa chave está nas notas, nos palpites e nas badges. Nunca renumere
  peças sem ler o [aviso em docs/04](docs/04-banco-de-dados.md#a-chave-snem).
- **O servidor é a autoridade.** A interface esconde botões por papel, mas quem
  barra de verdade é `podeExecutar` em cada ação.

---

<div align="center">
<sub>

Este site não é filiado nem mantém relação oficial com nenhuma mantida da FUCS.

</sub>
</div>
