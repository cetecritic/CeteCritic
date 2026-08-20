# Testes

```bash
npm test
```

Só isso. **Não precisa instalar nada** — os testes usam o `node:test`, que vem
no Node desde a versão 18. Nenhuma dependência nova entrou no `package.json`,
não há etapa de build, e nada aqui roda na Vercel: é uma pasta que só existe
para quem está com o repositório aberto.

Para rodar um arquivo só:

```bash
node --test testes/badges.test.js
```

---

## O que está coberto

São as funções **puras** do projeto — as que decidem alguma coisa sem tocar em
banco, rede ou `document`. Foram escolhidas por serem, ao mesmo tempo, as mais
fáceis de testar e as que quebram em silêncio.

| Arquivo | Cobre | Por que importa |
|---|---|---|
| `bolao.test.js` | `pontosBolao`, `estadoBolao` | a tabela de pontuação existe em dois arquivos; a precedência do prazo também |
| `badges.test.js` | `statsDeVals`, `badgesDoAno` | o bug dos critérios órfãos custou 6 das 9 badges de cada edição |
| `moderacao.test.js` | `podeExecutar`, `estadoConta`, `validarNome`, `norm` | é a tabela de permissões que separa moderador de historiador de admin |
| `pecas.test.js` | `gerarChave`, `planoDeRemanejamento`, `aplicarRemanejamento` | é o que impede a reordenação de reescrever o histórico de votos |
| `saude.test.js` | `diagnosticoSaude` | as travas que falham abertas precisam de alguém que perceba |

Três testes valem ser conhecidos pelo nome, porque são os que pegam
regressões que **já aconteceram** neste projeto:

- **"api/db.js e assets/core.js têm a MESMA tabela"** — as faixas de pontuação
  do bolão são duplicadas de propósito (o navegador não faz `require`). O que
  impede as duas cópias de divergirem não é a linguagem, é este teste.
- **"nenhum critério fica órfão numa edição correlacionada"** — reproduz o
  cenário em que uma mesma peça vencia três critérios e dois ficavam sem dono.
- **"fim_votacao vazio NÃO significa encerrado"** — a convenção que fez o site
  anunciar "o bolão de 2017 fechou" para quinze edições, com push para toda a
  base.
- **"a chave NÃO acompanha a turma"** — se a identidade da peça fosse derivada
  de um campo editável, corrigir a turma na fase de acervo reescreveria o
  histórico exatamente como a reordenação fazia.

---

## Como isto funciona sem mexer no código de produção

O `core.js` é um script de navegador e o `db.js` é uma função serverless.
Nenhum dos dois exporta as funções internas, e adaptá-los para o teste seria
deixar o teste mandar no código.

Em vez disso, cada um é executado dentro de um `vm` com o ambiente falsificado:

- **`carregar-core.js`** roda o `core.js` com um DOM de mentira (um Proxy que
  aceita qualquer chamada) e um `localStorage` em memória. O `core.js` não
  chega a montar página nenhuma: o bloco final dele testa se `EDICOES` existe
  e, sem esse global, cai na tela de erro em vez de chamar o dispatcher.
- **`carregar-db.js`** roda o `db.js` com um `require` falso, um cliente
  Supabase de mentira alimentado por fixture, e — quando o teste pede — o
  relógio congelado num instante fixo.

Os dois arquivos originais seguem **exatamente** como estão no repositório.

### Duas coisas que você vai precisar saber ao mexer aqui

**Constante nova que o teste precisa ler.** `function` de topo vira global e
sai de graça; `const` e `let` de topo não. Os carregadores resolvem isso com um
epílogo que copia nomes escolhidos a dedo — acrescente o nome na lista
`CONSTANTES_EXPOSTAS` (ou `FUNCOES_EXPOSTAS`, no `carregar-db.js`). Nunca
acrescente um `module.exports` ou um `window.X =` no `core.js` só por causa do
teste.

**Método de Supabase não implementado.** O banco falso implementa só o que o
`db.js` usa hoje. Se uma consulta nova usar algo que falta, o teste quebra
apontando para o `carregar-db.js`, e é lá que se conserta.

---

## O que NÃO está coberto

Vale ser explícito, para ninguém confundir "os testes passaram" com "está tudo
certo":

- nada que escreve no banco (`apiVoto`, `salvarEdicaoCompleta`, a migração de
  nome) — precisaria de um Postgres de verdade;
- o `admin.html` inteiro;
- qualquer coisa de interface, PWA, service worker ou push;
- a trava de taxa, que depende da tabela `rate_limite`.

O que estes testes garantem é que as **regras** continuam sendo as mesmas.
Antes de publicar, continue testando em aba anônima.
