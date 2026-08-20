/* =====================================================================
   TESTES · BADGES DE PEÇA  (testes/badges.test.js)
   =====================================================================
   O bug que este arquivo existe para não deixar voltar:

     A regra "uma badge por peça" era aplicada sem segunda colocada. Cada
     critério elegia a sua campeã e, se ela já tivesse badge, o critério
     ficava SEM DONO. Como os critérios são correlacionados — a peça de maior
     média costuma ser também a com mais notas 9+ e uma das mais consensuais
     —, três ou quatro badges eram eleitas pela mesma peça e só uma era
     concedida. Em 200 edições simuladas, 👏 Favorita do público encontrava
     dono em 15% das vezes.

   O conserto foi descer a lista de candidatas até achar uma livre. O teste
   "cada critério encontra dono" é o que trava isso: ele monta justamente o
   cenário correlacionado que quebrava antes.

   A simulação no fim do arquivo é a versão barata do que foi medido à mão:
   200 edições aleatórias, e a exigência de que a média de badges
   distribuídas não caia.
   ===================================================================== */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { carregarCore } = require('./carregar-core');

const core = carregarCore();
const { badgesDoAno, statsDeVals, BADGES_DEF } = core;

/* ---------------------------------------------------------------------
   ajudantes: montar avaliações no formato que o site grava
   --------------------------------------------------------------------- */
let relogio = 1_700_000_000_000;
function voto(grid, ts) {
  return { id: 'v' + (relogio++), ts: ts ?? relogio, grid };
}
/* gera n avaliações em que a peça `chave` recebe as notas de `notas` */
function votosPara(mapa, tsBase = 1_700_000_000_000) {
  const chaves = Object.keys(mapa);
  const maior = Math.max(...chaves.map(k => mapa[k].length));
  const subs = [];
  for (let i = 0; i < maior; i++) {
    const grid = {};
    chaves.forEach(k => { if (mapa[k][i] !== undefined) grid[k] = mapa[k][i]; });
    subs.push(voto(grid, tsBase + i * 60_000));
  }
  return subs;
}
const nomes = badges => badges.map(b => b.nome).sort();
const temBadge = (out, chave, tipo) =>
  (out[chave] || []).some(b => b.nome === BADGES_DEF[tipo].nome);
/* todas as badges concedidas na edição, achatadas */
const todasAsBadges = out => Object.values(out).flat();

describe('statsDeVals', () => {
  test('conta o que cada eixo de badge usa', () => {
    const s = statsDeVals([10, 9, 8, 7, 4, 2]);
    assert.equal(s.n, 6);
    assert.equal(s.min, 2);
    assert.equal(s.max, 10);
    assert.equal(s.pos, 4);                       // notas 7+
    assert.equal(s.neg, 2);                       // notas 4-
    assert.equal(Math.round(s.p9 * 100), 33);     // 2 de 6 são 9+
    assert.ok(Math.abs(s.avg - 6.6667) < 0.001);
  });

  test('lista vazia devolve null em vez de NaN', () => {
    assert.equal(statsDeVals([]), null);
  });

  test('desvio padrão é zero quando todo mundo deu a mesma nota', () => {
    assert.equal(statsDeVals([8, 8, 8, 8]).std, 0);
  });
});

describe('badgesDoAno — o bug dos critérios órfãos', () => {
  /* Edição desenhada para reproduzir o bug: s1e1 é a melhor em quase tudo ao
     mesmo tempo — maior média, maior fatia de notas 9+, entre as mais
     avaliadas. Antes do conserto ela levava 🥇 e os critérios seguintes
     ficavam sem dono, porque só a primeira colocada era considerada.

     O tamanho importa: com menos peças do que critérios, sobrar critério
     órfão é aritmética, não bug. Uma edição real tem ~20 peças. */
  const EDICAO_CORRELACIONADA = {
    s1e1: [10, 10, 9, 10, 9, 10],          // média e p9 no topo
    s1e2: [9, 9, 9, 9, 9, 9],              // logo atrás em tudo
    s1e3: [10, 2, 9, 3, 10, 2],            // dispersão enorme
    s1e4: [7, 7, 7, 7, 7, 7],              // desvio zero
    s1e5: Array(15).fill(7.5),             // muito mais avaliada
    s1e6: [8, 8, 9],                       // pouca gente viu, e é boa
    s1e7: [6, 6, 6, 6, 9, 9, 10, 10],      // cresceu no tempo
    s2e1: [8, 7, 8, 7, 8, 7],
    s2e2: [7, 6, 7, 6, 7, 6],
    s2e3: [6, 7, 6, 7, 6, 5],
    s2e4: [8, 8, 7, 7, 8, 7]
  };

  test('nenhum critério fica órfão numa edição correlacionada', () => {
    const out = badgesDoAno(votosPara(EDICAO_CORRELACIONADA));

    assert.ok(temBadge(out, 's1e1', 'campea'), 's1e1 deveria levar 🥇');
    /* o coração do teste: todo critério encontra dono, descendo a lista */
    const concedidas = todasAsBadges(out).map(b => b.nome);
    const criterios = ['campea', 'joiaEscondida', 'bocaABoca', 'favorita',
                       'polemica', 'consistente', 'maisAvaliada'];
    for (const tipo of criterios) {
      assert.ok(
        concedidas.includes(BADGES_DEF[tipo].nome),
        `o critério ${tipo} ficou órfão — a regra de "descer a lista" quebrou`
      );
    }
  });

  test('uma peça nunca leva duas badges automáticas', () => {
    const out = badgesDoAno(votosPara(EDICAO_CORRELACIONADA));
    for (const [chave, lista] of Object.entries(out)) {
      assert.ok(lista.length <= 1, `${chave} levou ${lista.length} badges: ${nomes(lista)}`);
    }
  });

  test('a mesma edição sempre dá o mesmo resultado, em qualquer ordem', () => {
    /* sem desempate estável, navegadores diferentes veriam badges diferentes
       conforme a ordem em que os votos chegaram da rede */
    const subs = votosPara({
      s1e1: [9, 9, 8, 9, 8, 9], s1e2: [9, 9, 8, 9, 8, 9],   // empate perfeito
      s1e3: [7, 8, 7, 8, 7, 8], s1e4: [6, 7, 6, 7, 6, 7]
    });
    const referencia = JSON.stringify(badgesDoAno(subs));
    for (let i = 0; i < 5; i++) {
      const embaralhado = subs.slice().sort(() => Math.random() - 0.5);
      assert.equal(JSON.stringify(badgesDoAno(embaralhado)), referencia);
    }
  });
});

describe('badgesDoAno — os pisos de qualidade', () => {
  test('💎 Joia escondida não é dada abaixo de 7,5 de média', () => {
    /* uma badge que se dá a qualquer coisa deixa de significar alguma coisa */
    const subs = votosPara({
      s1e1: [6, 6, 5, 6, 5, 6, 6, 5],      // muita gente viu, média baixa
      s1e2: [6, 5, 6]                      // pouca gente viu, média baixa
    });
    const out = badgesDoAno(subs);
    assert.ok(!temBadge(out, 's1e2', 'joiaEscondida'), 'não devia ter piso furado');
  });

  test('💎 é dada quando a peça pouco vista é realmente boa', () => {
    const subs = votosPara({
      s1e1: [9, 9, 10, 9, 9, 10, 9, 9],    // campeã, muita gente
      s1e2: [8, 8, 9],                     // pouca gente, média 8,3
      s1e3: [7, 7, 7, 7, 7, 7]
    });
    const out = badgesDoAno(subs);
    assert.ok(temBadge(out, 's1e2', 'joiaEscondida'));
  });

  test('🗣️ Boca a boca exige 8 votos e meio ponto de crescimento', () => {
    /* com menos de 8 votos, primeira metade contra segunda metade é
       praticamente sorteio; abaixo de 0,5 não é história, é oscilação */
    const poucos = votosPara({ s1e1: [6, 6, 7, 9], s1e2: [7, 7, 7, 7] });
    assert.ok(!temBadge(badgesDoAno(poucos), 's1e1', 'bocaABoca'), 'amostra pequena passou');

    const oscilacao = votosPara({
      s1e1: [8, 8, 8, 8, 8.2, 8.2, 8.2, 8.2],    // cresceu 0,2 apenas
      s1e2: [7, 7, 7, 7, 7, 7, 7, 7]
    });
    assert.ok(!temBadge(badgesDoAno(oscilacao), 's1e1', 'bocaABoca'), 'oscilação virou badge');

    /* s1e1 precisa ter MAIS votos que a mediana, senão ela concorre ao 💎
       (que vem antes na prioridade) e leva aquela badge em vez desta */
    const cresceuDeVerdade = votosPara({
      s1e1: [6, 6, 6, 6, 6, 6, 9, 9, 9, 10, 10, 10],   // 12 votos, subiu 3,5
      s1e2: [9.5, 9.5, 9.5, 9.5, 9.5, 9.5],
      s1e3: [9, 9, 9, 9, 9, 9],
      s1e4: [8.5, 8.5, 8.5, 8.5, 8.5, 8.5]
    });
    assert.ok(temBadge(badgesDoAno(cresceuDeVerdade), 's1e1', 'bocaABoca'));
  });

  test('peça sem carimbo de tempo não concorre ao 🗣️', () => {
    const semTs = votosPara({ s1e1: [6, 6, 6, 6, 9, 9, 10, 10] })
      .map(s => ({ ...s, ts: 0 }));
    assert.ok(!temBadge(badgesDoAno(semTs), 's1e1', 'bocaABoca'));
  });
});

describe('badgesDoAno — bordas', () => {
  test('sem avaliação nenhuma devolve objeto vazio, sem explodir', () => {
    assert.deepEqual(Object.keys(badgesDoAno([])), []);
    assert.deepEqual(Object.keys(badgesDoAno(null)), []);
  });

  test('uma peça só leva a campeã e não leva 🎯 Consistente', () => {
    /* "mais consistente" entre uma peça só não quer dizer nada */
    const out = badgesDoAno(votosPara({ s1e1: [8, 8, 9] }));
    assert.ok(temBadge(out, 's1e1', 'campea'));
    assert.ok(!temBadge(out, 's1e1', 'consistente'));
  });

  test('quando ninguém alcança o mínimo de avaliações, vale o que houver', () => {
    /* HALL.minAvaliacoes é 3; aqui todas têm 1 voto */
    const out = badgesDoAno(votosPara({ s1e1: [9], s1e2: [7] }));
    assert.ok(todasAsBadges(out).length > 0, 'edição recém-aberta ficou sem badge nenhuma');
  });

  test('nota inválida no meio da grade não contamina as outras', () => {
    const subs = votosPara({ s1e1: [9, 9, 8], s1e2: [7, 7, 7] });
    subs[0].grid.s1e3 = 'abc';
    const out = badgesDoAno(subs);
    assert.ok(temBadge(out, 's1e1', 'campea'));
  });
});

describe('badgesDoAno — a simulação que mediu o conserto', () => {
  test('em 200 edições aleatórias, a distribuição continua alta', () => {
    /* Antes do conserto: média de 4,8 badges por edição, e 👏 Favorita do
       público encontrava dono em 15% das vezes. Os pisos abaixo estão bem
       folgados de propósito — o teste existe para pegar uma REGRESSÃO
       grande, não para cravar um número que oscila com o gerador. */
    let semente = 12345;
    const rnd = () => (semente = (semente * 1664525 + 1013904223) % 4294967296) / 4294967296;

    let somaBadges = 0, comFavorita = 0;
    const EDICOES = 200;

    for (let e = 0; e < EDICOES; e++) {
      const mapa = {};
      for (let noite = 1; noite <= 5; noite++) {
        for (let peca = 1; peca <= 4; peca++) {
          const base = 5 + rnd() * 4;                       // média entre 5 e 9
          const n = 8 + Math.floor(rnd() * 20);
          mapa[`s${noite}e${peca}`] = Array.from({ length: n }, () =>
            Math.max(0, Math.min(10, Math.round((base + (rnd() - 0.5) * 3) * 2) / 2))
          );
        }
      }
      const out = badgesDoAno(votosPara(mapa));
      const concedidas = todasAsBadges(out);
      somaBadges += concedidas.length;
      if (concedidas.some(b => b.nome === BADGES_DEF.favorita.nome)) comFavorita++;
    }

    const media = somaBadges / EDICOES;
    const taxaFavorita = comFavorita / EDICOES;

    assert.ok(media >= 7, `média de badges por edição caiu para ${media.toFixed(2)} (era 8,5)`);
    assert.ok(
      taxaFavorita >= 0.9,
      `👏 Favorita encontrou dono em ${(taxaFavorita * 100).toFixed(0)}% das edições ` +
      `(era 100% depois do conserto, 15% antes) — o bug dos órfãos voltou`
    );
  });
});
