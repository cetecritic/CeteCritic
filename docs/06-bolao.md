# 06 · Bolão

Palpite a nota de cada peça **antes** da primeira noite. Conforme as notas
reais saem, o placar se forma sozinho.

É a funcionalidade mais recente e a que toca mais partes do sistema ao mesmo
tempo: banco, API, cliente, notificações, badges e perfil.

---

## 1. A linha do tempo

| Momento | O que acontece |
|---|---|
| `edicoes.monte_abre_em` | Bolão abre. Sai o aviso de abertura (banner + push). Link "🔮 Bolão" aparece no menu. |
| até a **Noite 1** | Dá pra palpitar e reajustar. Obrigatório preencher todas as peças. |
| horário da **Noite 1** | Palpites travam. Sai o aviso de fechamento (banner + push). |
| durante o festival | Placar se forma conforme as notas de cada peça saem. |
| `fim_votacao` + 1 dia | Link some do menu. A página continua acessível pela URL. |

**Prazo do palpite**, em ordem de precedência:

```
extra.bolao.fechaEm  >  data da Noite 1  >  fim_votacao
```

O último degrau é rede de segurança para edições antigas sem data de noite
cadastrada. Sem ele o palpite nunca "fecharia" e o placar daquele ano jamais
apareceria.

> Cliente e servidor precisam concordar sobre essa ordem. Ela está
> implementada duas vezes: `infoBolao()` em `api/content.js` (que manda a
> janela pronta para o cliente) e `estadoBolao()` em `api/db.js` (que decide
> de verdade). **Mudar uma sem a outra faz o site e a API discordarem sobre
> quando o palpite fecha.**

---

## 2. Pontuação

Linear, de 0 a 5 pontos por peça:

| Diferença para a média real | Pontos |
|---|---|
| ≤ 0,1 | 5 |
| ≤ 0,6 | 4 |
| ≤ 1,2 | 3 |
| ≤ 1,8 | 2 |
| ≤ 3,0 | 1 |
| > 3,0 | 0 |

A faixa de 5 é 0,1 para "cravou" valer de verdade: palpite 7,5 numa peça que
fechou 7,59 conta como exato.

```js
function pontosBolao(palpite, real){
  const d = Math.abs(Number(palpite) - Number(real));
  for(const f of BOLAO_FAIXAS){ if(d <= f.ate + 1e-9) return f.pts; }
  return 0;
}
```

O epsilon existe porque `7.6 - 7.5` dá `0.10000000000000053` em ponto
flutuante. Sem ele, a peça cravada perderia o ponto máximo por erro de
arredondamento binário.

**Desempate:** mais pontos → menor erro médio → quem palpitou primeiro.
Quem empata em pontos *e* erro divide a mesma posição, e ambos levam a badge.

**Peça sem nota** (ninguém votou nela ainda) fica fora da conta de todo mundo.

> A tabela existe em **dois lugares**: `api/db.js` (a conta que vale) e
> `assets/core.js` (só para desenhar as regras e a comparação na tela). As
> duas precisam bater. Se você mudar as faixas, mude nos dois arquivos.

---

## 3. Privacidade

Esta é a parte com mais decisão de projeto por linha.

**O servidor nunca devolve palpite de terceiro.** O endpoint `?bolao=ANO`
entrega só o ranking: nome, pontos, cravadas, erro médio. Seu palpite volta
apenas para você, com token, via `?palpites=ANO&user=…&token=…`.

**O placar só aparece depois que os palpites travam.** Enquanto dá para
palpitar, `?bolao=ANO` devolve `placar: []`. Mostrar parcial entregaria quem já
apostou o quê — e permitiria copiar a estratégia de quem está na frente.

**As médias reais também só saem depois do prazo.** No `?palpites=`, o campo
`medias` vem vazio enquanto o palpite está aberto. Seriam cola em tempo real
para quem ainda está preenchendo.

**Consequência de projeto:** sinais que dependiam de ver a grade alheia
passaram a ser calculados no servidor e chegam prontos junto do placar.
"Visionário" (quem chegou mais perto numa peça entre todos) é o exemplo — o
cliente não teria como calcular sem ver o palpite dos outros.

---

## 4. As badges do bolão

Calculadas ao vivo a partir dos palpites e das notas reais. **Nada é salvo no
banco**, então valem retroativamente para anos anteriores, sem migração.

| Badge | Critério |
|---|---|
| 🥇 Campeão do bolão {ano} | 1º lugar |
| 🥈 Vice do bolão {ano} | 2º lugar |
| 🥉 Terceiro no bolão {ano} | 3º lugar |
| Oráculo | erro < 0,05 em alguma peça |
| Aposta de risco | acertou (erro < 0,5) numa nota extrema (≤ 2 ou ≥ 9) |
| Visionário | o menor erro entre todos numa peça (mín. 3 participantes) |
| Cálculo exato | erro médio < 0,1 na noite de maior média do ano |

Só entram no catálogo os anos que **realmente tiveram bolão apurado**. Gerar as
três colocações para as quinze edições encheria o catálogo de badges mortas e
estragaria a conta do "Colecionador".

---

## 5. Onde fica cada coisa na interface

- **`/ANO/bolao.html`** — a página do ano. Regras, prazo com contador,
  formulário (quando aberto) ou placar + sua comparação (quando travado). Cada
  ano guarda o seu, então `/2024/bolao.html` continua consultável.
- **Menu lateral** — link abaixo do Hall da Fama, com selo "palpite aberto"
  enquanto dá para apostar. Aponta sempre para a edição em destaque.
- **Página da edição** — um convite compacto com o estado atual.
- **Perfil → aba Bolão** — pontos e colocação por ano. Clicar expande a
  comparação peça a peça (só no próprio perfil).
- **Hall → Badges** — as badges de pódio aparecem na vitrine.

---

## 6. Os avisos automáticos

Dois avisos disparam sozinhos, **uma vez cada**: abertura e fechamento. Cada um
é banner no site **e** push nos aparelhos.

### Quem dispara

Não é o cron. O cron da Vercel no plano Hobby roda uma vez por dia — grosso
demais para um bolão que abre num horário marcado.

Quem dispara é **o próprio tráfego do site**: `GET /api/db?year=…` chama
`dispararAvisosBolao()`, limitado a uma verificação por minuto por instância.

### Como o "uma vez só" é garantido

Por um `bc_id` determinístico:

```
bolao-abre:2026
bolao-fecha:2026
```

Antes de enviar, o servidor confere se a linha já existe. Grava o broadcast
**antes** do push, então uma segunda instância que entre junto encontra a linha
e desiste. O índice único em `broadcasts(bc_id)` (ver `migracao-bolao.sql`)
fecha a janela de corrida de vez.

### A janela de 48 horas

```js
const AVISO_JANELA_MS = 48 * 60 * 60 * 1000;
if(estado.palpiteFechado && momentoRecente(estado.fechaPalpiteEm)) { … }
```

Um aviso atrasado mais de 48 horas simplesmente não sai.

Isso existe porque a trava anterior não segurava nada. Ela dependia de
`estado.encerrado`, que por sua vez depende de `fim_votacao` — e as edições
históricas têm esse campo **vazio**, que o resto do código lê como "votação
sempre aberta". Sem `fim_votacao` não há `encerrado`, então cada edição do
acervo passava batido; e como a Noite 1 de 2017 já passou, `palpiteFechado` era
`true`. O site publicou "O bolão de 2017 fechou", "de 2018 fechou", "de 2019
fechou"… um banner e um push para cada ano do acervo.

A janela resolve pela raiz e não depende de nenhum campo estar preenchido.

### ⚠️ A linha do broadcast é a memória

`avisarUmaVez` usa a existência da linha como registro de "já avisei". Excluí-la
de verdade faz o servidor concluir que nunca avisou: ele recria o banner **e
reenvia o push para toda a base**.

Por isso `deletarBanner` **arquiva** os ids `bolao-*` (fecha o campo `fim`) em
vez de excluir. Se um dia surgir outro aviso automático, ele precisa do mesmo
tratamento.

### Um efeito colateral esperado

O aviso de **abertura** só sai se a edição tiver `monte_abre_em` preenchido.
Sem hora marcada, o bolão nasce aberto e não há momento a anunciar — a janela
devolve `false` de propósito.

Para ter o aviso de abertura: preencha **"Monte o Seu abre em"** na edição.

---

## 7. Configurando o bolão de uma edição

Painel → aba **Edições** → seção **🔮 Bolão**:

| Campo | Efeito |
|---|---|
| **Bolão ligado** | desmarcar tira a edição do bolão por completo |
| **Palpite fecha em** | vazio usa o horário da Noite 1 |
| **Regras** | vazio usa a explicação padrão |
| **Aviso de abertura** | título e texto do banner e do push |
| **Aviso de fechamento** | idem |

Tudo vai para `edicoes.extra.bolao`.

> **"Ausente = ligado".** Uma edição em que ninguém tocou nessa aba tem o bolão
> **ativo**. Foi essa combinação — bolão implicitamente ligado + `fim_votacao`
> vazio — que gerou os avisos das quinze edições históricas. Se você adicionar
> uma edição antiga ao acervo, considere desmarcar "Bolão ligado".

Editar o texto de um aviso já enviado **não** o reenvia.

---

## 8. Checklist do dia

1. `migracao-bolao.sql` rodado (índice único em `broadcasts(bc_id)`).
2. `monte_abre_em` preenchido — é o gatilho da abertura.
3. Data e hora da **Noite 1** preenchidas — é o prazo do palpite.
4. Todas as peças de todas as noites cadastradas: o palpite exige preencher
   tudo, e quem chegar antes do cadastro completo não consegue enviar.
5. Textos dos avisos revisados (ou vazios, para usar o padrão).
6. Abra `/2024/bolao.html` e `/2025/bolao.html`. Se houver palpites gravados,
   o placar aparece com a pontuação atual e o campeão deve bater com quem você
   lembra. É o teste possível antes do dia.

---

## 9. Referência rápida do código

| O quê | Onde |
|---|---|
| Faixas de pontuação (autoridade) | `api/db.js` → `BOLAO_FAIXAS` |
| Faixas (cópia para exibição) | `assets/core.js` → `BOLAO_FAIXAS` |
| Estado do bolão (servidor) | `api/db.js` → `estadoBolao(year)` |
| Estado do bolão (cliente) | `assets/core.js` → `estadoBolaoDe(cfgEd)` |
| Janela publicada ao cliente | `api/content.js` → `infoBolao(e, dataNoite1)` |
| Cálculo do placar | `api/db.js` → `placarBolao(year)` |
| Médias reais | `api/db.js` → `mediasReaisDoAno(year)` |
| Avisos automáticos | `api/db.js` → `dispararAvisosBolao()`, `avisarUmaVez()` |
| Página do bolão | `assets/core.js` → `paginaBolao()` |
| Config no painel | `admin.html` → seção `🔮 Bolão` |
