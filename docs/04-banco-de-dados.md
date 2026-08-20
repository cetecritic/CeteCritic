# 04 · Banco de dados

Postgres no Supabase, acessado só pelas funções serverless com a
`SUPABASE_SECRET_KEY`. O navegador **nunca** fala com o banco direto.

> Não existe migração versionada neste projeto. O esquema foi criado à mão no
> painel do Supabase e os arquivos `.sql` da raiz são ajustes pontuais.
> Isto é uma fragilidade conhecida — ver [09 · Riscos](09-riscos-conhecidos.md).
> Este documento é a fonte de verdade mais próxima que existe do esquema real.

---

## A chave `sNeM`

Antes das tabelas, o conceito que atravessa todas elas.

Uma apresentação é identificada por **`s<noite>e<ordem>`**:

```
s1e1  →  primeira peça da primeira noite
s2e3  →  terceira peça da segunda noite
```

Essa string é a chave em:

- `submissions.grid` — `{ "s1e1": 8.5, "s1e2": 7 }`
- `palpites.palpites` — mesmo formato
- badges de peça, médias, recordes, tudo

E ela é **posicional**, não um identificador estável. A peça não tem id
próprio: ela *é* a posição dela na grade.

> ### ⚠️ Consequência séria
>
> `salvarEdicaoCompleta` apaga as peças do ano e reinsere com
> `ordem: i + 1`. Se você **remover uma peça do meio** da lista, todas as
> seguintes sobem uma posição — e todos os votos e palpites já gravados
> passam a apontar para a peça errada.
>
> Renomear uma peça é seguro. Corrigir sinopse, turma e link é seguro.
> **Reordenar ou remover do meio reescreve o histórico em silêncio.**
>
> Desde 08/2026 o servidor **recusa** (409) tanto a remoção quanto a
> reordenação numa edição que já tem votos — a detecção usa a coluna `chave`,
> que diz quem é cada peça independentemente da posição.
>
> Se precisar remover, esvazie o título em vez de tirar a linha. Se precisar
> mesmo reordenar, use `node remanejar-pecas.js <ano>`: ele reescreve os
> `grid` e os `palpites` junto com a nova ordem, salva progresso a cada linha
> e confere a soma das notas no fim.

---

## Tabelas

Dezessete, em cinco famílias.

### Contas e sessão

#### `usuarios`
A tabela central. Chave: `usuario` (texto, o nome exibido).

| Coluna | Tipo | Notas |
|---|---|---|
| `usuario` | text (PK) | o nome como digitado; comparação é case-insensitive no código |
| `senha_hash` | text | `s2$N$r$p$<hex>` (scrypt) ou sha256 legado |
| `salt` | text | 8 chars |
| `token` | text | token legado de sessão única; hoje `sessoes` manda |
| `criado_em` | bigint | epoch ms |
| `tentativas` | int | erros de senha consecutivos |
| `lock_until` | bigint | trava após 5 erros (10 min) |
| `admin` | bool | a chave da porta do painel |
| `papel` | text | `admin` \| `moderador` \| `historiador` |
| `perfil` | jsonb | tudo o mais — ver abaixo |

> A coluna `papel` pode não existir em instalações antigas. `identificarEquipe`
> e `listarUsuarios` têm plano B para isso: sem a coluna, quem tem
> `admin = true` entra como `admin`. Não remova esse fallback sem confirmar
> que a coluna existe em produção.

#### `sessoes`
Uma linha por aparelho logado. `id`, `usuario`, `token`, `dispositivo`,
`criado_em`, `ultimo_uso`.

#### `login_codes`
Códigos de 2FA. PK é `usuario` (um código por vez). `code`, `exp`, `tentativas`.

#### `resets`
Links de redefinição. `id`, `usuario`, `token`, `exp`, `usado`.
Validade: 1 hora. **Nunca são limpos** — ver [09 · Riscos](09-riscos-conhecidos.md).

---

### Votação

#### `submissions`
Uma linha por avaliação enviada.

| Coluna | Tipo | Notas |
|---|---|---|
| `row_id` | PK | chave interna |
| `sub_id` | text | id gerado pelo **cliente** — não é único, não é confiável |
| `ts` | bigint | epoch ms, também do cliente |
| `name` | text | nome digitado no formulário |
| `usuario` | text | vínculo com a conta; **`null` = votou sem login** |
| `grid` | jsonb | `{ "s1e1": 8.5, … }` |
| `year` | int | a que edição pertence |
| `usuario_antigo`, `name_antigo` | text | nome removido pela moderação (reversível) |

> **`name` e `usuario` são coisas diferentes e as duas importam.** Quem vota
> logado grava o próprio nome nas duas colunas, e é o `name` que a lista
> pública mostra. Toda anonimização precisa mexer nos dois — zerar só
> `usuario` tira o voto do perfil mas deixa o nome estampado no site. Esse bug
> já existiu; os comentários em `apiDeletarConta` e `moderarPerfil` registram
> a correção.

#### `palpites`
Bolão. `id`, `usuario`, `year`, `palpites` (jsonb, mesmo formato do `grid`), `ts`.
Uma linha por pessoa por ano; reenviar faz `UPDATE`.

---

### Social

#### `carimbos`
**Duas coisas na mesma tabela**, separadas pela coluna `alvo`:

| `alvo` | Significado |
|---|---|
| `NULL` | carimbo de **perfil** (elogio formal, cooldown de 5 min) |
| preenchido | **reação a um post** do feed (`feed:<ts>` ou `sub:<id>`) |

Colunas: `id`, `profile_user` (quem recebe / autor do post), `from_user`
(quem deu), `tipo`, `ts`, `alvo`.

Toda query precisa filtrar: `.is('alvo', null)` para carimbos de perfil,
`.not('alvo','is',null)` para reações. Esquecer isso mistura os dois.

#### `reputacao`
Karma. `id`, `profile_user`, `from_user`, `valor` (`+1`/`-1`), `ts`.

O ajuste manual do admin é uma linha especial com
`from_user = '__admin__'`, guardando a **diferença** entre o total desejado e
a soma dos votos reais. Assim o número bate sem apagar o voto de ninguém.

#### `visitas`
`id`, `profile_user`, `visitor_user`, `ts`, `count` (acumulado).

#### `notificacoes`
`usuario`, `notif_id`, `tipo`, `titulo`, `corpo`, `url`, `ts`, `lida`.

> **`notif_id` não é único.** Um aviso enviado "para todos" grava a mesma
> `notif_id` em uma linha por usuário. Toda operação precisa filtrar também
> por `usuario` — apagar só por `notif_id` limpa a caixa de todo mundo. O
> código de `apagarItemUsuario` exige `alvo` justamente por isso.

---

### Avisos e push

#### `push`
Inscrições Web Push. PK: `endpoint`. `usuario`, `p256dh`, `auth`, `ts`.
Inscrições mortas (410/404) são apagadas no envio.

#### `broadcasts`
Banners do site.

| Coluna | Notas |
|---|---|
| `bc_id` | id do banner; **único** (ver `migracao-bolao.sql`) |
| `titulo`, `corpo`, `url` | conteúdo |
| `ts` | criação |
| `dur` | segundos na tela (0 = padrão, máx. 120) |
| `inicio`, `fim` | período opcional, epoch ms |
| `modo` | `uma_vez` \| `sessao` \| `sempre` |

Convenção de `bc_id`:
- `bc:<timestamp>` — banner criado à mão no painel
- `bolao-abre:<ano>` / `bolao-fecha:<ano>` — **aviso automático**

> Os ids `bolao-*` são a memória de "este aviso já saiu". Nunca faça `DELETE`
> neles: o servidor concluiria que nunca avisou, recriaria o banner e
> reenviaria o push para toda a base. O painel arquiva (fecha o `fim`) em vez
> de excluir.

#### `agendados`
Fila do cron. `id`, `tipo`, `titulo`, `corpo`, `url`, `dur`, `push` (bool),
`quando`, `enviado`, `criado_em`.

---

### Conteúdo

#### `edicoes`
Uma linha por ano.

| Coluna | Notas |
|---|---|
| `ano` | PK |
| `ordem` | ordenação no menu (padrão: o próprio ano) |
| `noites` | quantas noites (padrão 5) |
| `em_breve` | edição anunciada mas sem conteúdo |
| `abre_em` | quando a edição aparece |
| `monte_abre_em` | quando abrem o "Monte o Seu" **e o bolão** |
| `titulo`, `descricao` | textos |
| `episodios_por_noite` | padrão quando a noite não tem peças cadastradas |
| `inicio` | início da edição (vale para o countdown) |
| `fim_votacao` | **`null` significa "votação sempre aberta"** |
| `poster` | URL do Storage ou nome de arquivo legado |
| `mensagem_fim` | texto de encerramento |
| `sobre`, `abertura`, `extra` | jsonb |

> `fim_votacao = null` ler-se "sempre aberta", não "encerrada". É uma
> convenção fácil de esquecer e já causou bug: uma trava de segurança do bolão
> dependia desse campo e não segurava nada nas edições históricas, que o têm
> vazio. Toda lógica nova que dependa dele precisa tratar o `null`
> explicitamente.

`edicoes.extra` guarda o bolão:

```jsonc
{
  "bolao": {
    "ativo": true,              // ausente = LIGADO
    "fechaEm": "2026-07-14T20:00:00-03:00",
    "regras": "texto livre",
    "textos": { "abreTitulo": "", "abreCorpo": "", "fechaTitulo": "", "fechaCorpo": "" }
  }
}
```

#### `noites`
`ano`, `noite`, `data`, `subtitulo`. A `data` da noite 1 é o prazo padrão do
palpite do bolão.

#### `pecas`
`ano`, `noite`, `ordem`, `chave`, `titulo`, `turma`, `sinopse`, `youtube`,
`youtube_inicio`. `ordem` + `noite` formam a chave `sNeM` — releia o aviso do
topo deste documento.

`chave` é a identidade estável da peça (`A3.2025`, `S1.2023-2`), única por ano.
É **atribuída uma vez, na criação, e nunca recalculada**: se ela fosse derivada
do campo `turma`, corrigir a turma na fase de acervo reescreveria o histórico
exatamente como a reordenação fazia. Gerada por `gerarChave` em `api/_pecas.js`
e preenchida no acervo existente por `migrar-peca-chave.js`.

#### `config_site`
**Uma linha só**, `id = 1`, com `dados` (jsonb) guardando o site inteiro:

```jsonc
{
  "EDICAO_EM_DESTAQUE": 2026,
  "API_URL": "/api/db",
  "NOTA_MAXIMA": 10,
  "COOLDOWN_MINUTOS": 5,
  "SLOGAN_HOME": "…", "RODAPE": "…", "EMAIL_CONTATO": "…",
  "VAPID_PUBLIC_KEY": "…",
  "curiosidades": [ { "texto": "…" } ],
  "feed": [ { "autor": "CETECritic", "emoji": "📣", "texto": "…", "ts": … } ],
  "HALL": { "minAvaliacoes": 3, "badgesExtras": [ … ] },
  "PERFIL": { "badgesPreview": 3, "metas": { … } },
  "HOME_DADOS": { "nesteDia": [ … ], "linhaDoTempo": { "2019": "…" } }
}
```

> Tudo aqui é **read-modify-write** sem controle de concorrência. Dois admins
> salvando ao mesmo tempo: um perde a alteração, sem aviso.

---

## O jsonb `usuarios.perfil`

O objeto mais rico do sistema. Agrupado por quem pode escrever.

### O usuário escreve

| Chave | O quê |
|---|---|
| `email` | e-mail informado |
| `twofa` | 2FA ligado |
| `privado` | perfil restrito |
| `anonimo` | modo anônimo |
| `pseudo` | pseudônimo exibido quando anônimo |
| `amigos` | array de nomes (máx. 500) |
| `edicoesFav`, `destaques`, `showcase` | vitrine do perfil |
| `notif` | preferências por tipo (`{ badges: false }`) |

> `edicoesFav` é o nome que o `core.js` lê em `renderFavs`. Não renomeie.

### Só o servidor escreve

| Chave | O quê |
|---|---|
| `oauth` | `{ supabase_uid, provider, semSenha }` |
| `email_verificado` | e-mail **provado** (reset aberto ou 2FA usado) |
| `anon_modo` | `uma_vez` \| `periodo` \| `sempre` |
| `anon_ate` | expiração do anonimato por período |

### Só o admin escreve

| Chave | O quê |
|---|---|
| `banido` | `{ ts, motivo, por, ate? }` — **sem `ate` = permanente** |
| `silenciado_ate` | epoch ms |
| `nome_bloqueado` | `{ ts, motivo, nomeAntigo, por }` |
| `nomes_antigos` | histórico de renomeações (máx. 10) |
| `admin_badges` | `{ forcadas: [], bloqueadas: [] }` |
| `nota_admin` | anotação interna |

A separação é imposta por `PERFIL_SO_SERVIDOR` em `db.js`: esses campos são
sempre recopiados do banco ao salvar o perfil. Sem isso, qualquer usuário
logado se desbaniria sozinho.

E `PERFIL_PRIVADO` controla o que **sai** numa resposta pública. `nomes_antigos`
está lá por um motivo específico: ele guarda justamente o nome que a moderação
escondeu.

---

## Renomear uma conta

`migrarNomeUsuario()` em `_moderacao.js`. Nove tabelas guardam nome de usuário:

```
submissions.usuario      palpites.usuario       notificacoes.usuario
sessoes.usuario          push.usuario           resets.usuario
carimbos.profile_user + from_user
visitas.profile_user  + visitor_user
reputacao.profile_user + from_user
```

Mais `login_codes` (apagado em vez de migrado) e a lista `amigos` no perfil de
terceiros.

> **Criou uma tabela nova com nome de usuário? Acrescente ao array
> `REFERENCIAS`.** Senão a conta renomeada deixa rastro órfão.

A migração **não é atômica** — o PostgREST não expõe transação. A ordem foi
escolhida para que uma falha no meio deixe um estado recuperável, nunca
destrutivo:

1. cria a linha nova (as duas coexistem por um instante)
2. repõe as referências
3. só então apaga a antiga
4. conserta a lista de amigos de terceiros

Se morrer entre 1 e 3, nenhum dado sumiu e dá para rodar de novo.

---

## O teto de 1000 linhas

O PostgREST corta o resultado em 1000 linhas por padrão, **em silêncio**. Sem
erro, sem aviso: você simplesmente recebe menos dados do que existe.

Isso já causou bug aqui — o comentário em `apiDeletarConta` registra o
episódio: um `select('*')` sem filtro não trazia as linhas do usuário, a FK
barrava o delete final, o erro era ignorado e a função devolvia `ok: true` com
a conta ainda no banco.

**Regra:** todo `select` ou tem filtro que garanta poucas linhas, ou tem
`.limit()` explícito. Vários `select` do projeto ainda não seguem isso — a
lista está em [09 · Riscos, item 4](09-riscos-conhecidos.md).

---

## Storage

Bucket **`conteudo`**, público. Caminho: `<pasta>/<timestamp>_<nome>`.

Guarda posters de edição e banners da página "sobre", subidos pelo painel
(`uploadImagem`) ou pelo script `subir-imagens.js`.

Formatos aceitos: `webp`, `jpeg`, `png`, `gif`. Máx. 3 MB. SVG é recusado de
propósito — aceita `<script>` dentro e viraria XSS no próprio domínio.
