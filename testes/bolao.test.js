/* =====================================================================
   TESTES · BOLÃO  (testes/bolao.test.js)
   =====================================================================
   Cobre as duas coisas do bolão que quebram em silêncio:

   1. a tabela de pontuação, que existe DUAS VEZES (api/db.js decide,
      assets/core.js desenha) e precisa bater;
   2. a precedência do prazo do palpite, que também existe duas vezes e
      depende de campos que costumam vir vazios.

   `fim_votacao = null` significa "votação sempre aberta", nunca "encerrada".
   Foi essa convenção, somada a "bolão ausente = ligado", que em 2026 fez o
   site anunciar "o bolão de 2017 fechou" para quinze edições de uma vez.
   Os testes do fim do arquivo existem para que ninguém reintroduza isso.
   ===================================================================== */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { carregarDb } = require('./carregar-db');
const { carregarCore } = require('./carregar-core');

const JULHO = '2026-07-10T12:00:00-03:00';   // antes da Noite 1
const AGOSTO = '2026-08-20T12:00:00-03:00';  // depois de tudo

describe('pontosBolao — a tabela de pontuação', () => {
  const { pontosBolao } = carregarDb();

  test('cravar vale 5, e o epsilon protege o arredondamento binário', () => {
    assert.equal(pontosBolao(8, 8), 5);
    /* 7.6 - 7.5 dá 0.10000000000000053 em ponto flutuante. Sem o epsilon,
       a peça cravada perderia o ponto máximo por erro de representação. */
    assert.equal(pontosBolao(7.5, 7.6), 5);
    assert.equal(pontosBolao(7.5, 7.59), 5);
  });

  test('cada faixa devolve os pontos dela, nas bordas', () => {
    const casos = [
      [0.1, 5], [0.6, 4], [1.2, 3], [1.8, 2], [3.0, 1], [3.01, 0], [10, 0]
    ];
    for (const [distancia, esperado] of casos) {
      assert.equal(pontosBolao(5, 5 + distancia), esperado, `distância ${distancia}`);
      assert.equal(pontosBolao(5, 5 - distancia), esperado, `distância -${distancia}`);
    }
  });

  test('entrada inválida vale zero, nunca NaN', () => {
    /* um NaN aqui contamina a soma inteira do placar e some sem erro */
    for (const lixo of [null, undefined, '', 'abc', NaN, Infinity, {}]) {
      assert.equal(pontosBolao(lixo, 8), 0, String(lixo));
      assert.equal(pontosBolao(8, lixo), 0, String(lixo));
    }
  });

  test('nunca passa do teto nem fica negativo', () => {
    for (let p = 0; p <= 10; p += 0.25) {
      for (let r = 0; r <= 10; r += 0.25) {
        const pts = pontosBolao(p, r);
        assert.ok(pts >= 0 && pts <= 5, `${p} vs ${r} deu ${pts}`);
      }
    }
  });
});

describe('as faixas duplicadas entre servidor e cliente', () => {
  /* Esta é a razão principal deste arquivo existir. A duplicação é
     deliberada — o navegador não faz `require` —, então o que impede as
     duas cópias de divergirem não é a linguagem, é este teste. */
  test('api/db.js e assets/core.js têm a MESMA tabela', () => {
    /* comparado como JSON de propósito: os dois vêm de contextos `vm`
       diferentes, então os objetos têm protótipos diferentes e um
       deepStrictEqual falharia mesmo com valores idênticos */
    const servidor = JSON.stringify(carregarDb().BOLAO_FAIXAS);
    const cliente = JSON.stringify(carregarCore().BOLAO_FAIXAS);
    assert.equal(
      cliente, servidor,
      'as faixas do core.js divergiram das do db.js — o site passaria a ' +
      'mostrar uma pontuação diferente da que o servidor calcula'
    );
  });

  test('as duas implementações concordam ponto a ponto', () => {
    const servidor = carregarDb().pontosBolao;
    const cliente = carregarCore().pontosBolao;
    for (let p = 0; p <= 10; p += 0.1) {
      for (let r = 0; r <= 10; r += 0.7) {
        assert.equal(cliente(p, r), servidor(p, r), `palpite ${p}, real ${r}`);
      }
    }
  });
});

describe('estadoBolao — precedência do prazo do palpite', () => {
  /* extra.bolao.fechaEm  >  data da Noite 1  >  fim_votacao */
  const edicao = (extra, campos = {}) => ({
    edicoes: [{
      ano: 2026, em_breve: false,
      monte_abre_em: '2026-06-01T00:00:00-03:00',
      fim_votacao: '2026-07-20T23:59:00-03:00',
      extra, ...campos
    }],
    noites: [{ ano: 2026, noite: 1, data: '2026-07-14T20:00:00-03:00' }]
  });

  test('o campo do painel ganha da Noite 1', async () => {
    const db = carregarDb(edicao({ bolao: { fechaEm: '2026-07-12T18:00:00-03:00' } }), JULHO);
    const e = await db.estadoBolao(2026);
    assert.equal(e.fechaPalpiteEm, new Date('2026-07-12T18:00:00-03:00').toISOString());
  });

  test('sem campo no painel, vale o horário da Noite 1', async () => {
    const db = carregarDb(edicao({}), JULHO);
    const e = await db.estadoBolao(2026);
    assert.equal(e.fechaPalpiteEm, new Date('2026-07-14T20:00:00-03:00').toISOString());
  });

  test('sem Noite 1 cadastrada, cai no fim_votacao — a rede de segurança', async () => {
    /* sem este degrau o palpite nunca fecharia e o placar daquele ano jamais
       apareceria, que é o caso das edições antigas do acervo */
    const fixture = edicao({});
    fixture.noites = [];
    const db = carregarDb(fixture, JULHO);
    const e = await db.estadoBolao(2026);
    assert.equal(e.fechaPalpiteEm, new Date('2026-07-20T23:59:00-03:00').toISOString());
  });

  test('antes do prazo o palpite está aberto; depois, fechado', async () => {
    const antes = await carregarDb(edicao({}), JULHO).estadoBolao(2026);
    assert.equal(antes.aberto, true);
    assert.equal(antes.palpiteFechado, false);

    const depois = await carregarDb(edicao({}), AGOSTO).estadoBolao(2026);
    assert.equal(depois.aberto, false);
    assert.equal(depois.palpiteFechado, true);
  });

  test('antes de monte_abre_em o bolão ainda não liberou', async () => {
    const db = carregarDb(edicao({}), '2026-05-01T12:00:00-03:00');
    const e = await db.estadoBolao(2026);
    assert.equal(e.liberado, false);
    assert.equal(e.aberto, false);
  });
});

describe('estadoBolao — os campos que costumam vir vazios', () => {
  test('bolão ausente do extra significa LIGADO', async () => {
    /* "ausente = ligado" é a convenção do projeto. Se alguém inverter isso
       para "ausente = desligado", toda edição em que ninguém tocou na aba
       some do bolão sem aviso. */
    const db = carregarDb({
      edicoes: [{ ano: 2026, em_breve: false, extra: {}, fim_votacao: null, monte_abre_em: null }],
      noites: [{ ano: 2026, noite: 1, data: '2026-07-14T20:00:00-03:00' }]
    }, JULHO);
    const e = await db.estadoBolao(2026);
    assert.equal(e.ativo, true);
  });

  test('ativo:false no painel desliga, e a edição continua EXISTINDO', async () => {
    /* `existe` reflete a linha, não o bolão. Quando os dois eram a mesma
       coisa, quem tentava palpitar num bolão desligado recebia "essa edição
       não existe" e a mensagem certa ficava inalcançável. */
    const db = carregarDb({
      edicoes: [{ ano: 2026, em_breve: false, extra: { bolao: { ativo: false } } }],
      noites: []
    }, JULHO);
    const e = await db.estadoBolao(2026);
    assert.equal(e.existe, true);
    assert.equal(e.ativo, false);
  });

  test('edição "em breve" fica fora do bolão', async () => {
    const db = carregarDb({
      edicoes: [{ ano: 2027, em_breve: true, extra: {} }], noites: []
    }, JULHO);
    const e = await db.estadoBolao(2027);
    assert.equal(e.ativo, false);
  });

  test('ano que não existe no banco devolve existe:false', async () => {
    const db = carregarDb({ edicoes: [], noites: [] }, JULHO);
    const e = await db.estadoBolao(1999);
    assert.equal(e.existe, false);
  });

  test('fim_votacao vazio NÃO significa encerrado', async () => {
    /* A regressão mais cara do projeto mora aqui. `fim_votacao = null` quer
       dizer "votação sempre aberta"; as edições históricas têm esse campo
       vazio. Uma trava que dependesse dele não seguraria nada — e não
       segurou: o site publicou "o bolão de 2017 fechou" para o acervo
       inteiro, com push para toda a base. */
    const db = carregarDb({
      edicoes: [{ ano: 2017, em_breve: false, extra: {}, fim_votacao: null, monte_abre_em: null }],
      noites: [{ ano: 2017, noite: 1, data: '2017-07-14T20:00:00-03:00' }]
    }, AGOSTO);
    const e = await db.estadoBolao(2017);

    assert.equal(e.encerrado, false, 'sem fim_votacao a edição não encerra');
    assert.equal(e.somePorFimEm, null);
    /* o palpite, esse sim, está fechado — a Noite 1 de 2017 passou há anos.
       É a combinação "palpite fechado + nunca encerrado" que fazia o aviso
       automático disparar; quem segura hoje é a janela de 48 h. */
    assert.equal(e.palpiteFechado, true);
  });
});
