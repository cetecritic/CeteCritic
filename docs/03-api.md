# 03 · API

Duas funções serverless, um módulo compartilhado, dois utilitários de push.

| Arquivo | Rota | Papel |
|---|---|---|
| `api/db.js` | `/api/db` | Tudo que o público faz |
| `api/content.js` | `/api/content` | Conteúdo público + painel admin |
| `api/_moderacao.js` | — | Módulo compartilhado (o `_` impede virar rota) |
| `api/enviar-push.js` | `/api/enviar-push` | Envio manual de push |
| `api/cron-push.js` | `/api/cron-push` | Cron diário de agendamentos |

Convenções de todas as respostas:

- Sempre JSON (menos os `file=` de `content.js`, que devolvem JavaScript).
- Sucesso: `{ ok: true, ... }`. Erro: `{ ok: false, error: 'mensagem em português' }`.
- Exceção não tratada vira `500` com `{ ok:false, error: <mensagem> }`.
- `Content-Type` do cliente é `text/plain;charset=utf-8` de propósito: é uma
  *simple request*, então não há preflight CORS. Herança do Apps Script,
  mantida porque funciona.

---

## `/api/db` — GET

Roteado pelo **primeiro parâmetro reconhecido** na querystring. Sem nenhum
deles, cai no feed de votos.

### `?year=2026` (padrão)

O endpoint mais chamado do site.

```jsonc
{
  "serverNow": 1786845478432,      // relógio do servidor (o cliente sincroniza)
  "votingClosed": false,
  "submissions": [
    { "id": "1721…-a3f", "ts": 1721…, "name": "Maria", "grid": { "s1e1": 8.5 },
      "year": 2026, "user": "maria" }
  ]
}
```

Notas de comportamento:
- Votos com nota inválida são filtrados fora da resposta.
- Quem está em modo anônimo aparece pelo pseudônimo em **`name` e `user`**.
- Esta rota carrega `dispararAvisosBolao()` — ver [06 · Bolão](06-bolao.md).

### `?perfil=NOME[&por=…][&token=…]`

Perfil público. Se o perfil é privado, só o **dono** recebe os dados — e prova
isso mandando `por` + `token`. Para todos os outros, volta um esqueleto com
`restrito: true`.

Campos nunca devolvidos publicamente (`PERFIL_PRIVADO`): `email`, `notif`,
`oauth`, `email_verificado`, `anon_modo`, `anon_ate`, `banido`,
`silenciado_ate`, `nome_bloqueado`, `nomes_antigos`, `nota_admin`.

### `?atividade=1`

Feed público da comunidade: avaliações recentes, badges desbloqueadas,
carimbos entre perfis, contas novas. Máximo 60 eventos.

Perfis privados ficam de fora por completo; quem está anônimo aparece pelo
pseudônimo. Uma fonte que falhe não derruba as outras.

### `?reacoes=id1,id2,…[&por=…]`

Contagem de reações de vários posts numa tacada (máx. 120 ids). Sem token —
reação é informação pública.

### `?bolao=ANO`

Estado + placar. **Enquanto dá para palpitar, o placar volta vazio** — mostrar
parcial entregaria quem já apostou o quê. Nunca devolve palpite de terceiro.

### `?palpites=ANO&user=…&token=…`

O **seu** palpite, com as médias reais e os pontos por peça. Exige token. As
médias só entram depois que o palpite trava; antes seriam cola em tempo real.

### `?usuarios=1`

Lista de nomes exibíveis, sem os perfis privados. Alimenta a busca e o
"adicionar amigo".

### `?ranking=reputacao`

Ranking de karma, do maior para o menor.

### `?broadcasts=1`

Banners ativos (máx. 15). Um banner com período (`inicio`/`fim`) vale dentro do
intervalo; sem período, vale por sete dias a partir do `ts`.

### `?listaPush=<PUSH_SECRET>`

Inscrições push completas. Protegido por segredo, comparado em tempo constante.

---

## `/api/db` — POST

`body.action` escolhe a rota. **Sem `action`, cai em `voto`** — herança do
Apps Script.

### Contas

| action | Corpo | Notas |
|---|---|---|
| `registrar` | `user, senha, email?, dispositivo?` | nome 2–20 chars `[A-Za-z0-9_.\- ]`, senha ≥ 8 |
| `login` | `user, senha, dispositivo?` | pode devolver `{ need2fa:true }` |
| `login2fa` | `user, code, dispositivo?` | código de 6 dígitos, 5 min, 5 tentativas |
| `loginOAuth` | `accessToken` | pode devolver `{ precisaNome:true, sugestao }` |
| `finalizarOAuth` | `accessToken, user` | cria a conta com o nome escolhido |
| `logout` | `token` | apaga a linha em `sessoes` |
| `listarSessoes` / `revogarSessao` | `user, token[, id]` | gestão de aparelhos |
| `pedirReset` | `conta` (usuário **ou** e-mail) | resposta sempre genérica |
| `redefinirSenha` | `user, token, novaSenha` | derruba todas as sessões |
| `deletarConta` | `user, token` | anonimiza votos, apaga o resto, confere no fim |
| `trocarNome` | `user, token, novoNome` | só se o admin marcou `nome_bloqueado` |

### Conteúdo do usuário

| action | Corpo | Notas |
|---|---|---|
| `voto` | `id, ts, name, grid, year, user?, token?` | sem `user`/token = anônimo |
| `apagarAvaliacao` | `user, token, id` | posse conferida no servidor |
| `palpite` | `user, token, year, palpites` | **exige preencher todas as peças** |
| `perfil` | `user, token, perfil` | campos protegidos são recopiados do banco |
| `visita` | `user, token, alvo` | acumula contador, notifica 1× por dia |
| `carimbo` | `user, token, alvo, tipo` | cooldown de 5 min por perfil |
| `reagir` | `user, token, postId, tipo?, autor?` | `tipo: null` remove a reação |
| `reputacao` | `user, token, alvo, valor` | `1`, `-1` ou `0` |
| `consumirAnonUmaVez` | `user, token` | desliga o anonimato "de uma vez" |

Carimbos válidos: `curtida`, `joia`, `critico`, `parceiro`, `lenda`,
`concordo`, `discordo`, `palmas`, `polemico`.

### Notificações e push

`listarNotificacoes`, `contarNotifNaoLidas`, `marcarNotifLidas`, `criarNotif`,
`salvarPush`, `removerPush`, `removerPushMorto` (segredo), `criarBroadcast`
(segredo).

---

## Segurança do `/api/db`

Vale entender três funções, porque elas carregam quase toda a política.

### `verificarToken(usuario, token)`

Valida a sessão **e o direito de usá-la**. Confere `sessoes`, cai no token
legado em `usuarios.token`, e por fim recusa se a conta estiver suspensa.

A checagem de banimento mora aqui, no ponto por onde toda ação autenticada
passa. Antes ela existia só no login, e quem já tinha sessão aberta continuava
agindo mesmo suspenso.

### `barreiraModeracao(usuario, nivel)`

Dois níveis:

- `'login'` — bloqueia só conta **suspensa**;
- `'interagir'` — bloqueia suspensa **e silenciada**.

Editar o próprio perfil e ler notificações continuam liberados para quem está
só silenciado: a punição é sobre interação, não sobre a conta.

### `sanitizarPerfil(cfg, antigo)`

Filtra o objeto `perfil` que o cliente manda. Os campos de `PERFIL_SO_SERVIDOR`
são **sempre recopiados do banco**:

```
oauth, anon_modo, anon_ate, email_verificado,
banido, silenciado_ate, nome_bloqueado, nomes_antigos, admin_badges, nota_admin
```

Sem isso, qualquer usuário logado se desbaniria sozinho mandando
`perfil: { banido: null }`.

---

## `/api/content` — GET

### Geração de JavaScript (público)

| Rota | Devolve |
|---|---|
| `?file=config` | `EDICAO_EM_DESTAQUE`, `EDICOES`, `API_URL`, `CURIOSIDADES`, `FEED`, `VAPID_PUBLIC_KEY`… |
| `?file=edicao&ano=2026` | `const EDICAO = {…}; const NOITES = {};` |
| `?file=noites&ano=2026[&noite=1]` | `NOITES[1] = {…};` |
| `?file=hall` | `const HALL = {…};` |
| `?file=perfil` | `const PERFIL = {…};` |
| `?file=home` | `const HOME_DADOS = {…};` |

`Content-Type: application/javascript`, `Cache-Control: public, max-age=30`.

### Leitura para o painel (JSON)

| Rota | Devolve |
|---|---|
| `?q=config` | o objeto `config_site.dados` inteiro |
| `?q=edicoes` | todas as linhas de `edicoes` |
| `?q=edicao&ano=2026` | edição + noites + peças |
| `?q=indice` | índice de busca do painel |

> ⚠️ **Estas quatro rotas não verificam autenticação.** Ver
> [09 · Riscos, item 3](09-riscos-conhecidos.md).

---

## `/api/content` — POST (painel)

Todo POST passa por dois portões, nesta ordem:

```js
const eu = await identificarEquipe(body.user, body.token);
if (!eu) return 403;                              // token válido + admin = true
if (!podeExecutar(eu.papel, action)) return 403;  // o papel permite ESTA ação
```

### Ações

**Diagnóstico** — `ping` (devolve papel, versão do build e ações permitidas)

**Usuários** — `listarUsuarios`, `usuarioDetalhe`, `salvarUsuarioAdmin`,
`renomearUsuario`, `deletarUsuario`, `definirPapel` / `tornarAdmin`

**Moderação** — `definirBanimento`, `definirSilencio`, `deslogarTudo`,
`forcarTrocaNome`, `cancelarTrocaNome`, `anonimizarUsuario`,
`removerAnonimato`, `moderarPerfil`, `apagarItemUsuario`, `ajustarBadges`,
`lerReputacao`, `ajustarReputacao`, `notificarUsuario`

**Votos** — `listarVotos`, `deletarVotos`, `editarVoto`, `anonimizarVoto`,
`restaurarNomeVoto`

**Conteúdo** — `salvarConfig`, `salvarEdicaoCompleta`, `deletarEdicao`,
`uploadImagem`, `parseLink`, `postarFeed`

**Avisos** — `enviarNotif`, `criarBanner`, `deletarBanner`, `listarBanners`,
`agendar`, `listarAgendados`, `cancelarAgendado`

### Três ações que merecem atenção

**`salvarEdicaoCompleta`** substitui a edição inteira: apaga `noites` e `pecas`
do ano e reinsere o que veio no corpo. Não é transacional, e renumera `ordem`
sequencialmente. Leia o aviso sobre a chave `sNeM` em
[04 · Banco](04-banco-de-dados.md#a-chave-snem) antes de mexer.

Para quem não é admin, a rota compara o envio com o que existe e **recusa
qualquer payload que encolha o acervo** — é a trava anti-exclusão do
historiador.

**`uploadImagem`** aceita só `image/webp|jpeg|png|gif`, no máximo 3 MB, e
colapsa `..` no nome do arquivo. As duas coisas são deliberadas: sem a
whitelist, um `data:` URL com `image/svg+xml` subia para o bucket público e era
servido de volta com esse tipo — e SVG aceita `<script>` dentro, virando XSS
hospedado no próprio domínio.

**`deletarBanner`** faz duas coisas diferentes. Ids `bolao-abre:` e
`bolao-fecha:` são **arquivados** (fecha o campo `fim`), porque a linha do
broadcast é a única memória de "este aviso já saiu"; apagá-la faria o servidor
recriar o banner e reenviar o push. Qualquer outro id é excluído normalmente.

---

## `/api/enviar-push` e `/api/cron-push`

**`POST /api/enviar-push`** com `{ secret, title, body, url }` envia para
**todas** as inscrições e grava um broadcast. A página `enviar-push.html` é a
interface disso. Inscrições mortas (410/404) são removidas automaticamente.

`enviarParaTodos({ …, semBroadcast: true })` manda só o push — usado por quem
já gravou o próprio broadcast com id determinístico.

**`GET /api/cron-push`** roda pelo cron da Vercel (`0 12 * * *`) e processa a
tabela `agendados`. Exige `Authorization: Bearer <CRON_SECRET>`, comparado em
tempo constante.

> No plano Hobby o cron roda **uma vez por dia**, então um agendamento sai na
> próxima execução após a data marcada. Granularidade diária, não horária. No
> Pro, ajuste o `schedule` no `vercel.json`.

---

## Adicionando um endpoint

**Em `db.js`:** escreva `async function apiAlgo(body)` devolvendo um objeto, e
registre no mapa `rotas` de `handlePost`. Comece com `verificarToken` se a ação
exige login e com `barreiraModeracao(user, 'interagir')` se ela afeta terceiros.

**Em `content.js`:** adicione um `if (action === 'algo')` em `handlePost`,
registre em `ACOES_CONHECIDAS`, **suba o número da `versao` no `ping`**, e
decida em `ACOES_POR_PAPEL` (`_moderacao.js`) se moderador ou historiador
podem chamá-la. Por padrão, só admin.

Duas regras que o projeto já aprendeu na prática:

- **Sempre ponha `.limit()`** em `select`. Sem ele o PostgREST corta em 1000
  linhas silenciosamente, e o código passa a trabalhar com dados incompletos
  sem nenhum erro. Isso já causou bug real aqui —
  ver [09 · Riscos, item 4](09-riscos-conhecidos.md).
- **Nunca use `ilike` direto em `update`/`delete`.** `_` é curinga em LIKE e
  nomes de usuário aceitam `_`, então `joao_silva` também casa com `joaoXsilva`.
  O padrão correto é: ler com `ilike`, conferir com `norm()`, escrever nos
  valores exatos observados.
