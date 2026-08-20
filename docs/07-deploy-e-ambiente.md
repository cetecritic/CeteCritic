# 07 · Deploy e ambiente

---

## Variáveis de ambiente

Todas na Vercel, em Settings → Environment Variables. Nenhuma vai para o
navegador — as funções serverless são o único lugar que as lê.

### Obrigatórias

| Variável | Exemplo | Sem ela |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | **nada funciona** |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | **nada funciona** |

> É a chave **secreta** (service role), não a `anon`. Ela ignora RLS e por isso
> só pode viver no servidor. Se ela vazar, todo o banco vazou: rotacione no
> Supabase imediatamente e atualize aqui.

### Push

| Variável | O quê |
|---|---|
| `VAPID_PUBLIC_KEY` | chave pública (também no `config_site.dados`) |
| `VAPID_PRIVATE_KEY` | chave privada |
| `VAPID_SUBJECT` | `mailto:cetecritic@gmail.com` |
| `PUSH_SEND_SECRET` | segredo do envio manual |
| `PUSH_SECRET` | mesmo valor — usado por `listaPush` e `criarBroadcast` |
| `CRON_SECRET` | segredo do cron |

Gere o par VAPID com `node gerar-vapid.js`.

> `PUSH_SECRET` e `PUSH_SEND_SECRET` precisam ter o **mesmo valor**. São dois
> nomes por herança: `enviar-push.js` lê o primeiro, `db.js` lê o segundo.
>
> `CRON_SECRET` é **obrigatório**. Sem ele, `/api/cron-push` responde 401 a
> todo mundo — inclusive ao cron. Isso é proposital: numa versão anterior a
> condição era `if (process.env.CRON_SECRET && …)`, e sem a variável a rota
> ficava **aberta** para qualquer um disparar os agendamentos.

### Limite de taxa (recomendada)

| Variável | O quê |
|---|---|
| `RATE_SALT` | sal do hash de IP usado pelos limites de taxa |

O IP de quem chama nunca é guardado em claro: o que vai para a tabela
`rate_limite` é um SHA-256 de `IP + RATE_SALT`. Serve para contar, não para
montar um cadastro de quem votou.

Sem a variável há um valor padrão, e tudo continua funcionando — mas defina-a
com um valor aleatório: sem sal próprio, o hash é previsível e alguém que
conheça o esquema poderia confirmar se um IP específico votou.

### E-mail (opcional)

| Variável | O quê |
|---|---|
| `RESEND_API_KEY` | chave da Resend |
| `RESEND_FROM` | `CETECritic <no-reply@seudominio>` |
| `RESET_SITE_URL` | `https://cetecritic.xyz` — base dos links de e-mail |

Sem `RESEND_API_KEY` e `RESEND_FROM`, o envio é ignorado em silêncio. Na
prática isso significa: **redefinição de senha e 2FA param de funcionar**, sem
mensagem de erro. Uma pessoa com 2FA ligado fica trancada fora da conta.

---

## Testes

```bash
npm test
```

Sem instalar nada — `node:test`, que já vem no Node 18+. Cobre as funções puras
(pontuação do bolão, badges de peça, papéis, identidade da peça, diagnóstico de
saúde). Detalhes em `testes/LEIA-ME.md`.

---

## Deploy

A Vercel publica a cada push na branch de produção. Não há build step: os
estáticos vão como estão e os arquivos de `api/` viram funções.

**Ao publicar mudanças no front, suba o `CACHE_VERSION` no
`service-worker.js`** (`cetecritic-v28` → `v29`). Sem isso, quem já visitou o
site continua com o `core.js` antigo no Cache Storage por tempo indeterminado.

O cache de imagens (`cetecritic-img-v1`) sobrevive de propósito à troca de
versão — não há por que rebaixar todas as capas a cada deploy.

### `vercel.json`

Três coisas moram aqui, e é o arquivo mais fácil de quebrar sem perceber:

**Cron** — `{ "path": "/api/cron-push", "schedule": "0 12 * * *" }`

**Rewrites** — a ordem importa. As regras de arquivo `.js` vêm antes das de
`.html`, e a regra genérica `/:ano(\d{4})/:pagina(.+\.html)` vem por último.
Inverter faz `/2026/edicao.js` cair no template de edição.

**Headers** — cache curto no `sitemap.xml`.

> Existe um rewrite de `/sitemap.xml` para `/api/content?file=sitemap`, que
> monta o sitemap a partir do banco. Ele fica **dormindo** enquanto o arquivo
> `sitemap.xml` existir no repositório: na Vercel os rewrites só valem depois
> da checagem do sistema de arquivos. Para ativar o sitemap automático,
> `git rm sitemap.xml`.

---

## Primeira instalação

1. **Supabase:** crie o projeto e as tabelas de
   [04 · Banco](04-banco-de-dados.md). Crie o bucket **`conteudo`** e marque
   como público.
2. **Vercel:** importe o repositório e configure as variáveis acima.
3. **VAPID:** `node gerar-vapid.js`, guarde o par nas variáveis e ponha a
   chave pública também em `config_site.dados.VAPID_PUBLIC_KEY`.
4. **Config inicial:** insira a linha `id = 1` em `config_site` com pelo menos
   `EDICAO_EM_DESTAQUE` e `API_URL`.
5. **Primeiro admin:** crie sua conta no site e, no SQL Editor:
   ```sql
   UPDATE usuarios SET admin = true, papel = 'admin' WHERE usuario = 'seunome';
   ```
6. **Migrações:** rode `migracao-bolao.sql` e `migracao-seguranca.sql`.
7. **Conteúdo:** se estiver vindo dos arquivos `.js` antigos, rode
   `migrar-conteudo.js` e `subir-imagens.js` (ver abaixo).

---

## Scripts de uso único

Rodam **localmente**, na raiz do projeto, com as variáveis exportadas.

### `migrar-conteudo.js`

Lê `config.js` e, para cada ano, `ANO/edicao.js` e `ANO/noites/noite-N.js`, e
insere tudo nas tabelas de conteúdo. Usa `upsert`, então pode rodar de novo sem
duplicar.

```bash
SUPABASE_URL=… SUPABASE_SECRET_KEY=… node migrar-conteudo.js
```

```powershell
$env:SUPABASE_URL="…"; $env:SUPABASE_SECRET_KEY="…"; node migrar-conteudo.js
```

### `subir-imagens.js`

Comprime os posters e banners de cada ano para WebP (máx. 1400px de largura),
sobe para o Storage e atualiza as edições com as URLs. Precisa de `sharp`
(`npm install sharp`).

### `gerar-vapid.js`

Gera o par de chaves do Web Push.

### `migrar-peca-chave.js`

Preenche `pecas.chave` no acervo existente, depois de rodar
`migracao-peca-chave.sql`. Sem argumento faz um ensaio; `--aplicar` grava. Só
toca em peça **sem** chave — chave atribuída é chave congelada, então rodar de
novo é inofensivo.

### `remanejar-pecas.js`

O único jeito seguro de reordenar peças de uma edição já votada. `node
remanejar-pecas.js 2026` escreve um JSON com a ordem atual; você edita e roda
com `--aplicar`, e ele reescreve os votos e os palpites junto. Exige backup das
últimas 24 h, salva progresso a cada linha (cair no meio e rodar de novo
continua de onde parou, sem aplicar o mapa duas vezes) e confere a soma das
notas no fim.

Estes dois e o `backup.js` não usam `npm install`: falam direto com o
PostgREST pelo `fetch` do Node 18+.

> Trocar o par VAPID invalida **todas** as inscrições existentes. O
> `pushsubscriptionchange` do service worker refaz a inscrição sozinho, e o
> `ativarPush` do cliente detecta chave diferente e recria — mas conte com
> algumas horas de push não entregue enquanto os aparelhos se atualizam.

---

## Migrações SQL

Ficam na raiz, com nome descritivo, e são **manuais**: rode no SQL Editor do
Supabase.

| Arquivo | O quê |
|---|---|
| `migracao-bolao.sql` | índice único em `broadcasts(bc_id)` |
| `migracao-peca-chave.sql` | coluna `pecas.chave` + índice único por ano |
| `limpeza-avisos-bolao.sql` | arquiva os avisos de bolão dos anos antigos |
| `migracao-seguranca.sql` | tabela `rate_limite`, nome único sem diferenciar maiúsculas, índices de leitura, versão do config |

> **`migracao-seguranca.sql` é a que sustenta a trava de votação do servidor.**
> O código degrada com elegância se ela não rodou — os limites simplesmente não
> travam ninguém e um aviso vai para o log — mas até rodá-la, a trava não
> existe de fato.

Convenções que o projeto adota e vale manter:

- Comece com um `SELECT` de conferência.
- Use `IF NOT EXISTS` no que der.
- Termine com um `SELECT` que prova que funcionou.
- Comente **por que** a migração existe, não só o que ela faz.

> Não há controle de versão de esquema. Ninguém sabe, olhando o banco, quais
> migrações já rodaram. Está em [09 · Riscos](09-riscos-conhecidos.md).

---

## Diagnóstico

### A home aparece em branco

Quase sempre `/config.js` falhou. Abra `https://cetecritic.xyz/config.js`
direto: deve vir JavaScript com `const EDICAO_EM_DESTAQUE = …`.

- HTML de erro → a função caiu. Veja os logs da Vercel.
- `EDICAO_EM_DESTAQUE = null` → falta a linha `id = 1` em `config_site`.
- 500 → `SUPABASE_URL` ou `SUPABASE_SECRET_KEY` erradas.

Desde 08/2026 a home não fica mais literalmente em branco nesse caso: o
`core.js` percebe que `EDICOES` não chegou e mostra uma tela de erro com botão
de recarregar. Se você está vendo essa tela, o problema é exatamente este —
`/config.js` não respondeu.

### Uma alteração do painel não aparece no site

1. Os arquivos de dados têm `Cache-Control: max-age=30` — espere meio minuto.
2. O service worker usa **network-first** para eles, então um reload normal
   basta. Se persistir, teste numa aba anônima para descartar o Cache Storage.
3. Confirme que salvou: `GET /api/content?q=edicao&ano=2026&user=…&token=…`
   (as rotas `?q=` exigem credencial desde 08/2026).

### Push não chega

1. `enviar-push.html` mostra quantas inscrições responderam.
2. Confira as três variáveis VAPID.
3. Chave pública em `config_site` diferente da variável → inscrições
   inválidas. Precisam bater.
4. iOS só entrega push se o site estiver **instalado** na tela inicial.

### Um agendamento não disparou

O cron roda uma vez por dia às 12:00 UTC. Um agendamento para as 20:00 sai só
na execução do dia seguinte. Confira `agendados.enviado` e chame a rota na mão:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://cetecritic.xyz/api/cron-push
```

### Uma ação do painel responde "ação desconhecida"

O build no ar é antigo. Use o `ping`: ele devolve `versao` e a lista de ações
que aquele build conhece.

---

## Backup

Não há rotina automatizada. O mínimo recomendado, **antes de qualquer operação
grande** (migração, limpeza em massa, edição de acervo antigo):

```sql
-- no SQL Editor, exporte o resultado como CSV
SELECT * FROM submissions;
SELECT * FROM palpites;
SELECT * FROM usuarios;
SELECT * FROM config_site;
```

`submissions` e `palpites` são insubstituíveis: são a memória do festival e
não existem em nenhum outro lugar. O resto se reconstrói.

O Supabase tem backup automático no plano pago; no gratuito, a
responsabilidade é sua.
