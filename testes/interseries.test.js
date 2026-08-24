/* =====================================================================
   TESTES · INTERSÉRIES  (testes/interseries.test.js)
   =====================================================================
   Cobre as funções PURAS do interséries — as que decidem alguma coisa sem
   tocar em banco, rede ou `document`. São, ao mesmo tempo, as mais fáceis
   de testar e as que quebram em silêncio.

   Três merecem ser conhecidas pelo nome:

   · "pago + sobra === bolo, sempre" — é a invariante do rateio. Se ela
     falhar uma vez, o placar da temporada inteira perde o sentido e
     ninguém consegue provar de onde sumiu a ficha.

   · "as duas cópias do desempate concordam" — `ordenarClassificacao`
     existe em api/_interseries_regras.js (o servidor semeia o chaveamento
     com ele) e em assets/interseries.js (o cliente desenha a tabela com
     ele). O que impede as duas de divergirem não é a linguagem, é este
     teste. Mesmo arranjo do BOLAO_FAIXAS.

   · "confronto direto com TRÊS empatadas não decide" — o critério pode
     ciclar (A ganha de B, B de C, C de A). O certo é marcar e passar para
     o critério seguinte, não inventar uma regra.

   Rodar:  npm test        (ou  node --test testes/interseries.test.js)
   ===================================================================== */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../api/_interseries_regras');
const { carregarInterseries, plano } = require('./carregar-interseries');

const FRONT = carregarInterseries();

/* =====================================================================
   RATEIO
   ===================================================================== */
describe('ratear — a aposta mútua', () => {
  const ap = (usuario, opcao_id, valor, id) => ({ id: id || usuario, usuario, opcao_id, valor });

  test('a tabela de aceite do brief, caso a caso', () => {
    /* bolo 1000; na vencedora A=200 e B=300 → A leva 400, B leva 600 */
    let r = R.ratear([ap('a', 1, 200), ap('b', 1, 300), ap('c', 2, 500)], 1);
    assert.equal(r.bolo, 1000);
    assert.deepEqual(r.premios.map(p => [p.usuario, p.valor]), [['a', 400], ['b', 600]]);
    assert.equal(r.sobra, 0);

    /* bolo 1000; três de 100 na vencedora → 333 cada, sobra 1 */
    r = R.ratear([ap('a', 1, 100), ap('b', 1, 100), ap('c', 1, 100), ap('d', 2, 700)], 1);
    assert.deepEqual(r.premios.map(p => p.valor), [333, 333, 333]);
    assert.equal(r.sobra, 1);

    /* ninguém acertou → estorno integral a todos, sobra 0 */
    r = R.ratear([ap('a', 1, 400), ap('b', 2, 600)], 99);
    assert.equal(r.sobra, 0);
    assert.deepEqual(r.premios.map(p => [p.usuario, p.valor, p.tipo]),
      [['a', 400, 'estorno'], ['b', 600, 'estorno']]);

    /* todos acertaram → cada um recebe o que apostou */
    r = R.ratear([ap('a', 1, 250), ap('b', 1, 750)], 1);
    assert.deepEqual(r.premios.map(p => [p.usuario, p.valor]), [['a', 250], ['b', 750]]);
    assert.equal(r.sobra, 0);

    /* só uma pessoa apostou → recebe de volta. Não há bolo alheio. */
    r = R.ratear([ap('a', 1, 130)], 1);
    assert.deepEqual(r.premios.map(p => p.valor), [130]);

    /* nenhuma aposta → liquida do mesmo jeito, sem escrever nada */
    r = R.ratear([], 1);
    assert.deepEqual(r.premios, []);
    assert.equal(r.sobra, 0);
    assert.equal(r.bolo, 0);
  });

  test('pago + sobra === bolo, SEMPRE (2000 sorteios)', () => {
    /* Esta é a invariante que sustenta o razão inteiro. Se ela falhar, a
       soma dos saldos deixa de bater com as entradas e ninguém consegue
       dizer onde a ficha sumiu. */
    let semente = 12345;
    const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;

    for(let caso = 0; caso < 2000; caso++){
      const nOpcoes = 2 + Math.floor(rnd() * 4);
      const nApostas = Math.floor(rnd() * 12);
      const apostas = [];
      for(let i = 0; i < nApostas; i++){
        apostas.push(ap('u' + i, 1 + Math.floor(rnd() * nOpcoes), 1 + Math.floor(rnd() * 5000), i));
      }
      const vencedora = 1 + Math.floor(rnd() * nOpcoes);
      const r = R.ratear(apostas, vencedora);
      const pago = r.premios.reduce((s, p) => s + p.valor, 0);
      assert.equal(pago + r.sobra, r.bolo,
        'caso ' + caso + ': pago ' + pago + ' + sobra ' + r.sobra + ' != bolo ' + r.bolo);
      assert.ok(r.sobra >= 0, 'sobra nunca é negativa');
      assert.ok(pago <= r.bolo, 'a casa NUNCA paga mais do que entrou');
      r.premios.forEach(p => assert.ok(p.valor >= 0, 'nenhum prêmio negativo'));
    }
  });

  test('a sobra vem do floor e é sempre menor que o número de ganhadores', () => {
    const r = R.ratear([
      { id: 1, usuario: 'a', opcao_id: 1, valor: 100 },
      { id: 2, usuario: 'b', opcao_id: 1, valor: 100 },
      { id: 3, usuario: 'c', opcao_id: 1, valor: 100 },
      { id: 4, usuario: 'd', opcao_id: 2, valor: 701 }
    ], 1);
    assert.ok(r.sobra < 3, 'a sobra do floor não passa do nº de ganhadores');
    assert.equal(r.premios.reduce((s, p) => s + p.valor, 0) + r.sobra, r.bolo);
  });
});

/* =====================================================================
   REFS DE IDEMPOTÊNCIA
   ===================================================================== */
describe('REF — as chaves determinísticas', () => {
  test('a mesma entrada dá sempre a mesma chave', () => {
    assert.equal(R.REF.mesada('Maria', '2026-09-14'), R.REF.mesada('maria', '2026-09-14'));
    assert.equal(R.REF.mercado(12, 0), 'mercado:12:v0');
    assert.equal(R.REF.mercado(12, 1), 'mercado:12:v1');
  });

  test('chaves de propósitos diferentes NUNCA colidem', () => {
    /* Se `cancelar` e `estornar` dividissem a chave, cancelar um mercado
       depois de liquidado não escreveria nada — o índice único engoliria a
       linha — e ninguém receberia de volta. */
    const chaves = [
      R.REF.inicial('ana'), R.REF.mesada('ana', '2026-09-14'),
      R.REF.apostaDebito(7, 0), R.REF.apostaDebito(7, 1), R.REF.apostaEstorno(7, 0),
      R.REF.mercado(7, 0), R.REF.mercadoEstorno(7, 0), R.REF.sobra(7, 0),
      R.REF.mercadoCancelado(7)
    ];
    assert.equal(new Set(chaves).size, chaves.length, 'há duas refs iguais: ' + chaves.join(' | '));
  });

  test('reajustar a aposta muda a ref do débito — senão o segundo débito some', () => {
    assert.notEqual(R.REF.apostaDebito(7, 0), R.REF.apostaDebito(7, 1));
  });
});

/* =====================================================================
   RELÓGIO DO EVENTO
   ===================================================================== */
describe('o dia do evento é sempre em -03:00', () => {
  test('a virada do dia acontece às 00:00 de Brasília, não de UTC', () => {
    /* 2026-09-15T02:00:00Z ainda é DIA 14 no fuso do evento. Sem isso, a
       mesada viraria às 21h para quem estivesse com a aba aberta. */
    assert.equal(R.dataEvento(Date.parse('2026-09-15T02:00:00Z')), '2026-09-14');
    assert.equal(R.dataEvento(Date.parse('2026-09-15T03:00:00Z')), '2026-09-15');
    assert.equal(R.dataEvento(Date.parse('2026-09-14T23:59:00-03:00')), '2026-09-14');
    assert.equal(R.dataEvento(Date.parse('2026-09-15T00:01:00-03:00')), '2026-09-15');
  });

  test('inicioDoDiaEvento é o inverso de dataEvento', () => {
    for(const dia of ['2026-01-01', '2026-09-14', '2026-12-31']){
      assert.equal(R.dataEvento(R.inicioDoDiaEvento(dia)), dia);
    }
  });

  test('entrada inválida devolve null em vez de NaN', () => {
    assert.equal(R.dataEvento('abacaxi'), null);
    assert.equal(R.inicioDoDiaEvento('14/09/2026'), null);
  });
});

/* =====================================================================
   VALIDAÇÃO DA APOSTA
   ===================================================================== */
describe('validarValorAposta — tudo conferido no servidor', () => {
  const cfg = { aposta_minima: 10, teto_percentual: 25 };

  test('o teto é percentual do saldo e é arredondado para baixo', () => {
    assert.equal(R.tetoDaAposta(1000, 25), 250);
    assert.equal(R.tetoDaAposta(999, 25), 249);
    assert.equal(R.validarValorAposta(250, 1000, cfg), null);
    assert.match(R.validarValorAposta(251, 1000, cfg), /25%/);
  });

  test('recusa o que não é ficha inteira e positiva', () => {
    assert.match(R.validarValorAposta(10.5, 1000, cfg), /inteiro/);
    assert.match(R.validarValorAposta(-50, 1000, cfg), /positivo/);
    assert.match(R.validarValorAposta(0, 1000, cfg), /positivo/);
    assert.match(R.validarValorAposta('abc', 1000, cfg), /inteiro/);
    assert.match(R.validarValorAposta(5, 1000, cfg), /mínima/);
  });

  test('saldo zerado não deixa apostar nada — não existe recarga', () => {
    assert.ok(R.validarValorAposta(10, 0, cfg));
  });
});

/* =====================================================================
   DESEMPATE
   ===================================================================== */
describe('ordenarClassificacao', () => {
  const linha = (id, o) => Object.assign({ equipe_id: id }, R.LINHA_ZERO, o);

  test('ordena por pontos, depois vitórias, depois saldo', () => {
    const t = [
      linha(1, { pontos: 6, vitorias: 2, saldo: 1 }),
      linha(2, { pontos: 9, vitorias: 3, saldo: 5 }),
      linha(3, { pontos: 6, vitorias: 2, saldo: 4 })
    ];
    const ord = R.ordenarClassificacao(t, ['pontos','vitorias','saldo'], {});
    assert.deepEqual(ord.map(l => l.equipe_id), [2, 3, 1]);
    assert.deepEqual(ord.map(l => l.posicao), [1, 2, 3]);
  });

  test('confronto direto decide entre DUAS empatadas', () => {
    const t = [linha(1, { pontos: 3 }), linha(2, { pontos: 3 })];
    const ctx = { partidas: [
      { status: 'encerrada', equipe_a: 2, equipe_b: 1, placar_a: 3, placar_b: 0 }
    ], pontos_vitoria: 3, pontos_empate: 1, pontos_derrota: 0 };
    assert.deepEqual(R.ordenarClassificacao(t, ['pontos','confronto'], ctx).map(l => l.equipe_id), [2, 1]);
  });

  test('com TRÊS empatadas o confronto não decide: marca e passa adiante', () => {
    /* triângulo: 1 ganha de 2, 2 de 3, 3 de 1. Não existe ordem correta
       por confronto — inventar uma seria pior do que admitir. */
    const t = [linha(1, { pontos: 3, saldo: 1 }), linha(2, { pontos: 3, saldo: 3 }), linha(3, { pontos: 3, saldo: 2 })];
    const ctx = { partidas: [
      { status: 'encerrada', equipe_a: 1, equipe_b: 2, placar_a: 1, placar_b: 0 },
      { status: 'encerrada', equipe_a: 2, equipe_b: 3, placar_a: 1, placar_b: 0 },
      { status: 'encerrada', equipe_a: 3, equipe_b: 1, placar_a: 1, placar_b: 0 }
    ] };
    const ord = R.ordenarClassificacao(t, ['pontos','confronto','saldo'], ctx);
    assert.ok(ord.every(l => l.confrontoInconclusivo), 'as três precisam ficar marcadas (asterisco na tela)');
    assert.deepEqual(ord.map(l => l.equipe_id), [2, 3, 1], 'o critério seguinte (saldo) é que decide');
  });

  test('empate total cai no desempate determinístico, nunca em sorteio aleatório', () => {
    const t = [linha(9, {}), linha(3, {}), linha(5, {})];
    const a = R.ordenarClassificacao(t, ['pontos'], {}).map(l => l.equipe_id);
    const b = R.ordenarClassificacao(t.slice().reverse(), ['pontos'], {}).map(l => l.equipe_id);
    assert.deepEqual(a, b, 'a ordem não pode depender da ordem de entrada');
    assert.deepEqual(a, [3, 5, 9]);
  });

  test('não muda o array recebido', () => {
    const t = [linha(1, { pontos: 3 }), linha(2, { pontos: 9 })];
    R.ordenarClassificacao(t, ['pontos'], {});
    assert.deepEqual(t.map(l => l.equipe_id), [1, 2]);
    assert.equal(t[0].posicao, undefined);
  });
});

describe('mesclarClassificacao — a segunda armadilha da view', () => {
  test('equipe que ainda não jogou aparece ZERADA, não some', () => {
    /* is_classificacao é um GROUP BY, e GROUP BY não inventa linha. Sem o
       merge a tabela nasce vazia no primeiro dia — parece bug e não é. */
    const linhas = [{ equipe_id: 1, jogos: 2, pontos: 6, vitorias: 2, empates: 0, derrotas: 0,
                      pontos_pro: 5, pontos_contra: 1, saldo: 4 }];
    const tabela = R.mesclarClassificacao([1, 2, 3], linhas);
    assert.equal(tabela.length, 3);
    assert.equal(tabela[1].jogos, 0);
    assert.equal(tabela[2].pontos, 0);
    assert.equal(tabela[0].pontos, 6);
  });
});

/* =====================================================================
   ⚠️ AS DUAS CÓPIAS DO DESEMPATE
   =====================================================================
   `ordenarClassificacao` é duplicada de propósito: o navegador não faz
   `require`, e as duas pontas precisam da mesma ordem. Este teste é o
   único mecanismo que impede as cópias de divergirem.
   ===================================================================== */
describe('api/_interseries_regras.js e assets/interseries.js têm o MESMO desempate', () => {
  test('mesmos critérios registrados nos dois lados', () => {
    assert.deepEqual(Object.keys(R.CRITERIOS_IS).sort(), Object.keys(FRONT.CRITERIOS_IS).sort());
  });

  test('300 tabelas sorteadas dão exatamente a mesma ordem nos dois', () => {
    let semente = 987654;
    const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;

    for(let caso = 0; caso < 300; caso++){
      const n = 2 + Math.floor(rnd() * 6);
      const linhas = [];
      for(let i = 1; i <= n; i++){
        const v = Math.floor(rnd() * 4), e = Math.floor(rnd() * 3), d = Math.floor(rnd() * 3);
        const pro = Math.floor(rnd() * 12), contra = Math.floor(rnd() * 12);
        linhas.push({ equipe_id: i, jogos: v + e + d, vitorias: v, empates: e, derrotas: d,
                      pontos_pro: pro, pontos_contra: contra, saldo: pro - contra,
                      pontos: v * 3 + e });
      }
      /* algumas partidas para o confronto direto ter o que ler */
      const partidas = [];
      for(let k = 0; k < n; k++){
        const a = 1 + Math.floor(rnd() * n), b = 1 + Math.floor(rnd() * n);
        if(a === b) continue;
        partidas.push({ status: 'encerrada', equipe_a: a, equipe_b: b,
                        placar_a: Math.floor(rnd() * 4), placar_b: Math.floor(rnd() * 4) });
      }
      const criterios = ['pontos','vitorias','confronto','saldo','pro'];
      const ctx = { partidas, pontos_vitoria: 3, pontos_empate: 1, pontos_derrota: 0 };

      const servidor = R.ordenarClassificacao(linhas, criterios, ctx).map(l => l.equipe_id);
      /* `plano()` porque o valor atravessou o vm — ver carregar-interseries.js */
      const cliente  = plano(FRONT.ordenarClassificacao(linhas, criterios, ctx).map(l => l.equipe_id));
      assert.deepEqual(cliente, servidor, 'as cópias divergiram no caso ' + caso);
    }
  });

  test('a marcação de confronto inconclusivo também é a mesma', () => {
    const linha = id => Object.assign({ equipe_id: id }, R.LINHA_ZERO, { pontos: 3 });
    const t = [linha(1), linha(2), linha(3)];
    const ctx = { partidas: [] };
    const s = R.ordenarClassificacao(t, ['pontos','confronto'], ctx).map(l => !!l.confrontoInconclusivo);
    const c = plano(FRONT.ordenarClassificacao(t, ['pontos','confronto'], ctx).map(l => !!l.confrontoInconclusivo));
    assert.deepEqual(c, s);
    assert.deepEqual(s, [true, true, true]);
  });
});

/* =====================================================================
   PAPÉIS
   ===================================================================== */
describe('podeExecutarIS — a separação que não é hierarquia, é território', () => {
  test('quem digita o placar NÃO mexe em ficha, e vice-versa', () => {
    /* É a única trava técnica contra o conflito de interesse do apurador. */
    assert.equal(R.podeExecutarIS('is_esportes', 'salvarResultado'), true);
    assert.equal(R.podeExecutarIS('is_esportes', 'liquidarMercado'), false);
    assert.equal(R.podeExecutarIS('is_esportes', 'ajustarFichas'), false);

    assert.equal(R.podeExecutarIS('is_apostas', 'liquidarMercado'), true);
    assert.equal(R.podeExecutarIS('is_apostas', 'salvarResultado'), false);
    assert.equal(R.podeExecutarIS('is_apostas', 'importarCsv'), false);

    assert.equal(R.podeExecutarIS('is_admin', 'salvarResultado'), true);
    assert.equal(R.podeExecutarIS('is_admin', 'liquidarMercado'), true);
  });

  test('a config fica só com o admin — lá moram mesada, teto e o interruptor', () => {
    assert.equal(R.podeExecutarIS('is_esportes', 'salvarConfigIS'), false);
    assert.equal(R.podeExecutarIS('is_apostas', 'salvarConfigIS'), false);
    assert.equal(R.podeExecutarIS('is_admin', 'salvarConfigIS'), true);
  });

  test('ação nova sem papel declarado cai no padrão SEGURO (só is_admin)', () => {
    assert.equal(R.podeExecutarIS('is_esportes', 'acaoQueNinguemRegistrou'), false);
    assert.equal(R.podeExecutarIS('is_apostas', 'acaoQueNinguemRegistrou'), false);
    assert.equal(R.podeExecutarIS('is_admin', 'acaoQueNinguemRegistrou'), true);
  });

  test('toda ação da tabela de papéis existe em ACOES_CONHECIDAS_IS', () => {
    /* Se uma some daqui, o `ping` deixa de anunciá-la e o painel esconde
       um botão que o servidor aceitaria — ou o contrário. */
    for(const papel of Object.keys(R.ACOES_POR_PAPEL_IS)){
      for(const acao of Object.keys(R.ACOES_POR_PAPEL_IS[papel])){
        assert.ok(R.ACOES_CONHECIDAS_IS[acao], 'ação "' + acao + '" (papel ' + papel + ') não está em ACOES_CONHECIDAS_IS');
      }
    }
  });

  test('papelIS: admin do CETECritic NÃO ganha papel automaticamente', () => {
    assert.equal(R.papelIS({}, 'maria'), null);
    assert.equal(R.papelIS({ equipe: {} }, 'maria'), null);
    assert.equal(R.papelIS({ equipe: { Maria: 'is_admin' } }, 'maria'), 'is_admin');
    assert.equal(R.papelIS({ equipe: { maria: 'papel_inventado' } }, 'maria'), null);
  });
});

/* =====================================================================
   MATA-MATA
   ===================================================================== */
describe('vencedorEPerdedor', () => {
  test('deriva do placar quando há diferença', () => {
    const r = R.vencedorEPerdedor({ equipe_a: 1, equipe_b: 2, placar_a: 3, placar_b: 1 });
    assert.deepEqual([r.vencedor, r.perdedor, r.indefinido], [1, 2, false]);
  });

  test('vencedor_id manda — é assim que os pênaltis contam', () => {
    const r = R.vencedorEPerdedor({ equipe_a: 1, equipe_b: 2, placar_a: 2, placar_b: 2, vencedor_id: 2 });
    assert.deepEqual([r.vencedor, r.perdedor], [2, 1]);
  });

  test('empate SEM vencedor_id é indefinido — falhar é melhor que adivinhar', () => {
    const r = R.vencedorEPerdedor({ equipe_a: 1, equipe_b: 2, placar_a: 2, placar_b: 2 });
    assert.equal(r.indefinido, true);
    assert.equal(r.empate, true);
  });

  test('sem placar nenhum também é indefinido', () => {
    assert.equal(R.vencedorEPerdedor({ equipe_a: 1, equipe_b: 2 }).indefinido, true);
    assert.equal(R.vencedorEPerdedor(null).indefinido, true);
  });
});

describe('ordemDeSementes — as cabeças em metades opostas', () => {
  test('a 1ª e a 2ª só se encontram na final', () => {
    assert.deepEqual(R.ordemDeSementes(2), [1, 2]);
    assert.deepEqual(R.ordemDeSementes(4), [1, 4, 2, 3]);
    assert.deepEqual(R.ordemDeSementes(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });

  test('toda semente entra exatamente uma vez', () => {
    for(const n of [2, 4, 8, 16, 32]){
      const o = R.ordemDeSementes(n);
      assert.equal(o.length, n);
      assert.deepEqual(o.slice().sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});

describe('rodadasDoCirculo — o turno de todos contra todos', () => {
  test('cada par se enfrenta uma vez só', () => {
    for(const n of [2, 3, 4, 5, 6, 12]){
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const rodadas = R.rodadasDoCirculo(ids);
      const vistos = new Set();
      let total = 0;
      rodadas.forEach(r => r.forEach(([a, b]) => {
        total++;
        const chave = [a, b].sort((x, y) => x - y).join('-');
        assert.ok(!vistos.has(chave), 'par repetido com ' + n + ' equipes: ' + chave);
        vistos.add(chave);
      }));
      assert.equal(total, n * (n - 1) / 2, 'com ' + n + ' equipes faltam jogos');
    }
  });

  test('número ímpar de equipes gera folga, não jogo contra ninguém', () => {
    const rodadas = R.rodadasDoCirculo([1, 2, 3]);
    rodadas.forEach(r => r.forEach(([a, b]) => {
      assert.ok(a && b, 'não pode existir partida com lado vazio');
      assert.notEqual(a, b);
    }));
  });

  test('menos de duas equipes não gera rodada nenhuma', () => {
    assert.deepEqual(R.rodadasDoCirculo([1]), []);
    assert.deepEqual(R.rodadasDoCirculo([]), []);
  });
});

/* =====================================================================
   MERCADOS
   ===================================================================== */
describe('modelosDeOpcoes', () => {
  test('vôlei (permite_empate = false) NÃO ganha a opção Empate', () => {
    const v = R.modelosDeOpcoes('vencedor', { permite_empate: false, placar_tipo: 'sets' }, '1º B', '2º B');
    assert.equal(v.length, 2);
    assert.ok(!v.some(o => /empate/i.test(o.rotulo)));
  });

  test('futsal ganha as três opções', () => {
    const f = R.modelosDeOpcoes('vencedor', { permite_empate: true, placar_tipo: 'gols' }, '3º B', '1º A');
    assert.deepEqual(f.map(o => o.lado), ['a', null, 'b']);
  });

  test('a margem muda com o tipo de placar', () => {
    assert.equal(R.modelosDeOpcoes('margem', { placar_tipo: 'sets', permite_empate: false }, 'A', 'B').length, 4);
    assert.equal(R.modelosDeOpcoes('margem', { placar_tipo: 'pontos', permite_empate: false }, 'A', 'B').length, 4);
    assert.equal(R.modelosDeOpcoes('margem', { placar_tipo: 'gols', permite_empate: true }, 'A', 'B').length, 5);
  });

  test('tipo desconhecido devolve lista vazia em vez de inventar opção', () => {
    assert.deepEqual(R.modelosDeOpcoes('futuro', {}, 'A', 'B'), []);
  });
});

/* =====================================================================
   CSV  (o parser mora no bundle do front; ver carregar-interseries.js)
   ===================================================================== */
describe('lerCsv — o arquivo que sai do Excel brasileiro', () => {
  test('come o BOM, detecta o ";" e normaliza o cabeçalho', () => {
    /* O Excel salva UTF-8 COM BOM. Sem comer o BOM, a primeira coluna do
       cabeçalho nunca casa com nada — e o importador acusa "sigla é
       obrigatória" em TODAS as linhas de um arquivo perfeito. */
    const r = plano(FRONT.lerCsv('﻿Sigla;Nome da Equipe;Série\n3B;3º B;3\n'));
    assert.deepEqual(r.colunas, ['sigla', 'nome_da_equipe', 'serie']);
    assert.equal(r.separador, ';');
    assert.deepEqual(r.linhas, [{ sigla: '3B', nome_da_equipe: '3º B', serie: '3' }]);
  });

  test('vírgula também funciona, e o separador é escolhido pelo que aparece mais', () => {
    const r = FRONT.lerCsv('equipe,nome\n3B,Terceiro B\n');
    assert.equal(r.separador, ',');
    assert.equal(r.linhas[0].nome, 'Terceiro B');
  });

  test('campo entre aspas guarda separador, quebra de linha e aspas duplicadas', () => {
    const r = FRONT.lerCsv('a;b\n"tem ; dentro";"linha1\nlinha2"\n"aspas ""assim""";fim\n');
    assert.equal(r.linhas[0].a, 'tem ; dentro');
    assert.equal(r.linhas[0].b, 'linha1\nlinha2');
    assert.equal(r.linhas[1].a, 'aspas "assim"');
  });

  test('linhas totalmente vazias somem; \\r\\n do Windows não vira sujeira', () => {
    const r = FRONT.lerCsv('a;b\r\n1;2\r\n\r\n\r\n3;4\r\n');
    assert.equal(r.linhas.length, 2);
    assert.equal(r.linhas[1].b, '4');
  });

  test('cabeçalho é case-insensitive e sem acento', () => {
    const r = plano(FRONT.lerCsv('EQUIPE A;Equipe B;PLACAR_A\nx;y;1\n'));
    assert.deepEqual(r.colunas, ['equipe_a', 'equipe_b', 'placar_a']);
  });

  test('arquivo vazio não explode', () => {
    assert.deepEqual(plano(FRONT.lerCsv('').linhas), []);
    assert.deepEqual(plano(FRONT.lerCsv(null).linhas), []);
  });
});

describe('normalizarData — recusar é melhor do que chutar', () => {
  test('aceita o formato oficial e o brasileiro', () => {
    assert.equal(FRONT.normalizarData('2026-09-14').data, '2026-09-14');
    assert.equal(FRONT.normalizarData('14/09/2026').data, '2026-09-14');
    assert.equal(FRONT.normalizarData('1/9/2026').data, '2026-09-01');
  });

  test('RECUSA o formato americano em vez de remarcar o jogo em silêncio', () => {
    assert.match(FRONT.normalizarData('09/14/2026').erro, /americano/);
  });

  test('recusa lixo com mensagem, nunca com NaN', () => {
    assert.ok(FRONT.normalizarData('').erro);
    assert.ok(FRONT.normalizarData('quinta que vem').erro);
    assert.ok(FRONT.normalizarData('45/01/2026').erro);
  });
});

/* =====================================================================
   CONFIG
   ===================================================================== */
describe('configComPadrao', () => {
  test('chave ausente cai no padrão em vez de virar undefined', () => {
    const c = R.configComPadrao({});
    assert.equal(c.saldo_inicial, 1000);
    assert.equal(c.mesada_diaria, 250);
    assert.equal(c.refresh_ms.ao_vivo, 10000);
  });

  test('número que veio como texto de formulário vira número', () => {
    const c = R.configComPadrao({ teto_percentual: '30', aposta_minima: '5' });
    assert.equal(c.teto_percentual, 30);
    assert.equal(c.aposta_minima, 5);
  });

  test('ativo ausente = LIGADO; só `false` explícito desliga', () => {
    assert.equal(R.configComPadrao({}).ativo, true);
    assert.equal(R.configComPadrao({ ativo: false }).ativo, false);
    assert.equal(R.configComPadrao({ ativo: true }).ativo, true);
  });
});
