# 11 · Emergências

> Documento de consulta rápida para quando algo está errado **agora**. Cada
> cenário tem: o sintoma, como confirmar a causa, o que fazer e — igualmente
> importante — **o que não fazer**.
>
> Como no [10 · Passagem de bastão](10-passagem-de-bastao.md), as caixas
> **`Para quem programa`** trazem o detalhe técnico e podem ser puladas.

---

## Regra zero

**Respire. Quase nada aqui é irreversível — a menos que você apague alguma
coisa.**

Os dados do festival (`submissions` e `palpites`) são a única coisa no projeto
que não se reconstrói. Todo o resto — código, configuração, conteúdo — dá para
refazer.

Portanto, na dúvida, nesta ordem:

1. **Não apague nada.**
2. Se dá para **esconder** em vez de apagar, esconda (modo manutenção,
   anonimizar, arquivar).
3. Se for mexer em dados, **rode `node backup.js` antes**.
4. Se estiver sozinho e inseguro, ligue para o outro admin. É para isso que a
   regra dos dois existe.

---

## Os cinco primeiros minutos

Quando alguém avisa "o site está estranho", faça esta sequência antes de
qualquer diagnóstico. Ela separa "o site caiu" de "o navegador daquela pessoa
está com cache velho", que são problemas completamente diferentes.

1. **Abra o site numa aba anônima.** Se funciona na anônima, o problema é
   cache/service worker do visitante, não o site.
2. **Abra `https://cetecritic.xyz/config.js`.** Tem que vir JavaScript,
   começando com algo como `const EDICAO_EM_DESTAQUE = 2026;`. Se vier HTML de
   erro ou nada, o problema está no servidor ou no banco.
3. **Abra `/admin.html`.** Ele não usa o mesmo carregamento do site, então
   costuma abrir mesmo quando o site está quebrado. Olhe a tarja de ambiente.
4. **Abra o painel da Vercel → Deployments.** O último deploy está verde?
5. **Abra o Supabase.** O projeto está ativo, ou pausado por inatividade?

Com essas cinco respostas, você já sabe em qual seção abaixo entrar.

---

## 1 · A home está em branco

**Sintoma:** a página inicial abre vazia, ou mostra uma tela de erro com botão
"Tentar de novo".

**Causa quase certa:** `/config.js` falhou. Ele é gerado por uma função que lê
o banco, e o site inteiro depende dos globais que ele define.

**Confirme:** abra `https://cetecritic.xyz/config.js` direto.

| O que você vê | O que significa | O que fazer |
|---|---|---|
| JavaScript normal | o config está bom, o problema é outro | vá para o cenário 2 |
| HTML de erro | a função serverless caiu | Vercel → Functions → veja o log |
| `EDICAO_EM_DESTAQUE = null` | falta a linha de configuração no banco | Supabase: confira `config_site` com `id = 1` |
| Erro 500 | as credenciais do banco estão erradas | Vercel → Settings → Environment Variables |
| Nada / tempo esgotado | Supabase fora do ar ou pausado | vá para o cenário 9 |

**Não faça:** não republique o site achando que resolve. Se o banco não
responde, o deploy novo vai falhar igual.

> `Para quem programa`
>
> Desde 08/2026 a home não fica mais literalmente em branco: o `index.html`
> tem o bloco em `try/catch` e o `core.js` detecta que `EDICOES` não chegou e
> monta uma tela de erro com a marca do site. Se você está vendo essa tela, o
> diagnóstico já está feito — é `/config.js`.

---

## 2 · A votação não abre no horário

**Sintoma:** é a hora da noite começar, o público está tentando votar e a
coluna aparece com 🔒.

**Esta é a emergência mais provável do festival.** Trabalhe rápido, mas na
ordem.

**Confirme, em trinta segundos:**

1. Painel → 🎬 Edições → o ano → a noite. **A data e a hora estão certas?**
   O site trabalha no fuso `-03:00`.
2. A edição está com **`em breve` desmarcado**?
3. O `inicio` da edição está preenchido?

**A causa mais comum é data ou hora errada na noite.** Corrija no painel e
salve; a liberação é imediata, sem deploy.

**Se as datas estão certas e mesmo assim não abre:** o problema é o relógio.
O site só libera a votação depois de sincronizar a hora com o servidor —
justamente para que mudar o relógio do celular não destrave nada.

- Confirme que `/api/db?year=2026` responde (abra no navegador; deve vir JSON
  com `serverNow`).
- Se não responde, é o mesmo problema do cenário 1: função ou banco.

**Não faça:** não mande o público "mudar o relógio do celular" — não funciona,
por desenho. E não mexa na ordem das peças no meio do festival para
"consertar" a grade; anote e conserte em agosto.

---

## 3 · Uma peça entrou fora de ordem no palco

**Sintoma:** a ordem real das apresentações não bateu com o cadastro, ou uma
peça não aconteceu.

**A resposta é: não conserte agora.**

As notas são gravadas por posição (`s2e3` = terceira peça da segunda noite).
Mexer na ordem de uma noite que já recebeu votos faz cada nota apontar para a
peça errada.

**O que fazer durante o festival:** anote no papel o que aconteceu de
diferente. Só isso.

**O que fazer depois, com calma:**

- Peça que **não aconteceu**: esvazie o **título** dela em vez de tirá-la da
  lista. A posição continua existindo e as notas continuam coerentes.
- Ordem realmente trocada: `node remanejar-pecas.js <ano>`, que reescreve os
  votos junto com a nova ordem. Faça backup antes; o script cobra.

> Desde agosto de 2026 o painel **recusa** o envio se você tentar reordenar uma
> edição que já tem votos, e mostra o mapa do que mudaria. Se você recebeu essa
> mensagem, o sistema está te protegendo — leia antes de procurar como
> contornar.

---

## 4 · Notas suspeitas ou um pico coordenado

**Sintoma:** uma peça saltou de média em pouco tempo, ou aparecem muitas notas
0 e 10 seguidas.

**Investigue primeiro:** painel → 🗑️ Excluir notas. Filtre por ano, por nota
exata (0 e 10) e por noite. Veja a grade inteira de cada avaliação suspeita —
padrões coordenados costumam ter grades idênticas ou horários muito próximos.

**Aja com a ferramenta mais leve que resolva:**

| Situação | Ação |
|---|---|
| Nome ofensivo na lista pública | **Anonimizar o voto** (reversível) |
| Conta se comportando mal | **Silenciar** — bloqueia interação, não a conta |
| Caso grave | **Suspender** — derruba todas as sessões |
| Fraude clara e comprovada | apagar, **em último caso** |

**Prefira anonimizar a apagar.** Apagar muda a média retroativamente, e o
histórico passa a mostrar um número que nunca foi verdade. Anonimizar tira o
nome, mantém a nota na conta e dá para desfazer.

**Se o volume for grande:** ligue o modo manutenção com **"Recusar envios no
servidor"** marcado enquanto investiga. É o cadeado de verdade — o servidor
passa a recusar voto, palpite, carimbo e reação. Um voto que entra no meio do
conserto é um voto que você vai ter que caçar depois.

> `Para quem programa`
>
> Existem dois tetos de taxa em `apiVoto`: 3 avaliações por 5 minutos por
> conta, e o mesmo por origem (IP com hash). Eles dependem da tabela
> `rate_limite` existir — se a tarja do painel disser que o limite está
> desligado, a proteção não está lá. Ajuste os números em
> `VOTO_MAX_POR_JANELA` e `VOTO_JANELA_MS`.

---

## 5 · O push não chegou

**Sintoma:** você mandou uma notificação com push e ninguém recebeu.

**Confirme na ordem:**

1. `enviar-push.html` mostra quantas inscrições responderam. Zero significa que
   não há inscrições ou que as chaves estão erradas.
2. A tarja do painel acusa `push` ou `vapidConfere`? Se acusa `vapidConfere`, a
   chave pública da Vercel não bate com a do banco, e **todas as inscrições
   viraram inválidas**.
3. iOS só entrega push se a pessoa tiver **instalado o site na tela inicial**.
   Isso não é bug.

**Caso específico — o push do bolão não saiu.** A causa número um é
`monte_abre_em` vazio na edição. Sem hora marcada, não existe momento de
abertura a anunciar, e o aviso não sai de propósito.

---

## 6 · O push saiu errado — ou saiu várias vezes

**Este é o pesadelo, então tem seção própria.**

**Se você mandou um push com erro de texto:** não há como recolher. Mande um
segundo, curto, corrigindo. Não vale mandar três.

**Se o mesmo aviso do bolão está saindo repetidamente:** alguém apagou a linha
do broadcast cujo id começa com `bolao-`. Essa linha é a única memória de "este
aviso já saiu". Sem ela, o servidor conclui que nunca avisou, recria o banner e
reenvia o push para toda a base.

**O que fazer:** pare a sangria arquivando o aviso em vez de apagá-lo. O painel
já faz isso pelo botão "Apagar" nesses ids específicos (ele arquiva, fechando o
campo `fim`). Se precisar no SQL, **feche o `fim`, nunca dê `DELETE`**.

**Não faça:** nunca rode `DELETE FROM broadcasts WHERE bc_id LIKE 'bolao-%'`.
A limpeza anual de banners exclui esses ids de propósito.

---

## 7 · Você (ou a equipe) se trancou fora

**Sintoma:** ninguém consegue entrar no painel.

**Três caminhos de volta, e nenhum depende do modo manutenção:**

1. **`/admin.html` nunca é bloqueado** pelo modo manutenção — ele não carrega o
   `core.js`, então a tela de manutenção não existe para ele.
2. **`/redefinir-senha.html` nunca é bloqueada** — é o caminho de volta de quem
   perdeu o acesso.
3. **O SQL Editor do Supabase** resolve qualquer caso:

```sql
UPDATE usuarios SET admin = true, papel = 'admin' WHERE usuario = 'seunome';
```

**Se a redefinição de senha não chega por e-mail:** a chave da Resend
provavelmente expirou. O envio é ignorado **em silêncio**, sem mensagem de
erro. Confira a tarja do painel e as variáveis `RESEND_API_KEY` e
`RESEND_FROM` na Vercel.

**Se alguém está com 2FA e perdeu o e-mail:** outro admin abre 👥 Usuários e
desmarca `twofa` na conta dela.

---

## 8 · O modo manutenção ficou ligado e ninguém percebeu

**Sintoma:** o público diz que o site está fora do ar, mas para você está
normal.

**É porque está normal para você.** Quem tem sessão de admin atravessa a tela
de manutenção. Existe uma **tarja amarela fixa no rodapé** avisando, com atalho
para desligar.

**Regra:** se você é admin e o site parece normal, **olhe o rodapé** antes de
concluir que está tudo certo para os outros.

**Se nem o painel abrir**, desligue direto no SQL Editor:

```sql
UPDATE config_site
SET dados = jsonb_set(dados, '{manutencao,ativo}', 'false')
WHERE id = 1;
```

---

## 9 · O Supabase está fora do ar (ou pausado)

**Sintoma:** tudo falha ao mesmo tempo — site, painel, `/config.js`.

**Confirme:** abra o painel do Supabase. No plano gratuito, **projetos sem uso
são pausados por inatividade** — e "sem uso" é exatamente o estado do site em
fevereiro. Se estiver pausado, há um botão para retomar; leva alguns minutos.

**Se estiver ativo mas lento:** veja o status do Supabase e espere. Enquanto
isso, ligue o modo manutenção com uma mensagem honesta e uma previsão de
volta — a tela vira contagem regressiva e recarrega sozinha na hora marcada.

**Não faça:** não troque as credenciais achando que é isso. E não migre nada
sob pressão.

---

## 10 · Vazou a chave secreta do banco

**Sintoma:** a `SUPABASE_SECRET_KEY` foi para o repositório, para um print, ou
para uma conversa.

**Trate como urgência real:** essa chave ignora todas as regras de acesso do
banco. Quem a tem, tem tudo.

1. **Rotacione no Supabase agora** (Settings → API → gerar nova chave).
2. **Atualize na Vercel** em Settings → Environment Variables.
3. **Republique** para as funções pegarem o valor novo.
4. **Confira** que o site voltou: abra `/config.js`.
5. Se a chave foi para o Git, saiba que **apagar o arquivo não basta** — ela
   continua no histórico. Rotacionar é o que resolve.

---

## 11 · Uma alteração do painel não aparece no site

Quase sempre não é bug. Na ordem:

1. Os arquivos de dados têm cache de **30 segundos**. Espere meio minuto.
2. Recarregue a página normalmente. Se persistir, **teste numa aba anônima**
   para descartar o service worker.
3. Confirme que salvou mesmo: o painel avisa em caso de erro, inclusive quando
   dois admins salvaram a configuração ao mesmo tempo (aí ele diz que o que
   você digitou **não** foi gravado — e não foi).

**Se você mexeu no código e não aparece:** você esqueceu de subir o
`CACHE_VERSION` no `service-worker.js`.

---

## 12 · Uma ação do painel responde "ação desconhecida"

O build que está no ar é antigo. O `ping` do painel devolve a `versao` e a
lista de ações que aquele build conhece — é o jeito de confirmar em dois
segundos, em vez de adivinhar.

Confira na Vercel se o último deploy realmente concluiu.

---

## Cartão de bolso

| Situação | Primeira coisa a fazer |
|---|---|
| Site em branco | abrir `/config.js` |
| Votação não abre | conferir data **e hora** da noite no painel |
| Peça fora de ordem | **anotar e não mexer** até agosto |
| Notas suspeitas | 🗑️ Excluir notas → **anonimizar**, não apagar |
| Push não chega | `enviar-push.html` + tarja do painel |
| Push repetindo | **não** apagar banner `bolao-*` — arquivar |
| Trancado fora | SQL: `UPDATE usuarios SET admin = true...` |
| Site "fora do ar" só para os outros | olhar o **rodapé**: manutenção ligada |
| Tudo falhando junto | Supabase pausado por inatividade |
| Chave vazou | rotacionar no Supabase → atualizar Vercel → republicar |
| Vai mexer em dados | **`node backup.js` antes** |

---

## Depois que passar

Toda emergência é candidata natural a virar item de
[09 · Riscos](09-riscos-conhecidos.md) — especialmente as consertadas às
pressas durante o festival.

Escreva o que aconteceu, o que você fez e o que faltou saber. O valor daquele
documento não está na lista do que falta: está no registro do que já deu errado.
