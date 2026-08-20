/* =====================================================================
   TESTES · IDENTIDADE DA PEÇA  (testes/pecas.test.js)
   =====================================================================
   Cobre `api/_pecas.js`, o módulo que existe para consertar o pecado
   original do projeto: a peça não tinha id, ela ERA a posição dela.

   O teste mais importante do arquivo é "a chave NÃO acompanha a turma".
   Se ela acompanhasse, teríamos trocado "a peça é a posição dela" por "a
   peça é o texto da turma dela" — e turma é campo editável, digitado à mão,
   que a fase de acervo existe justamente para corrigir. O formato legível
   (`A3.2025`) não dá garantia nenhuma; o congelamento dá.
   ===================================================================== */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  chavePosicional, slugTurma, gerarChave, planoDeRemanejamento, aplicarRemanejamento
} = require('../api/_pecas');

describe('slugTurma', () => {
  test('mantém o código legível da turma', () => {
    assert.equal(slugTurma('A3'), 'A3');
    assert.equal(slugTurma('O1'), 'O1');
  });

  test('tira acento, espaço e pontuação — mas não confunde turmas diferentes', () => {
    /* "S1" e "S1 Santa Fé" são turmas distintas e existem no acervo real;
       elas não podem colidir sem necessidade */
    assert.equal(slugTurma('S1 Santa Fé'), 'S1SANTAFE');
    assert.notEqual(slugTurma('S1'), slugTurma('S1 Santa Fé'));
    assert.equal(slugTurma('G33 (CETEC Santa Fé)'), 'G33CETECSANTAF');
  });

  test('turma vazia ou ausente não gera chave vazia', () => {
    for (const v of ['', '   ', null, undefined, '???']) {
      assert.equal(slugTurma(v), 'PECA', String(v));
    }
  });
});

describe('gerarChave', () => {
  test('o formato é turma.ano', () => {
    assert.equal(gerarChave('A3', 2025, new Set()), 'A3.2025');
    assert.equal(gerarChave('O1', 2026, new Set()), 'O1.2026');
  });

  test('duas peças da mesma turma no mesmo ano ganham sufixo', () => {
    /* aconteceu quatro vezes em 2023 no acervo real */
    const usadas = new Set();
    assert.equal(gerarChave('S1', 2023, usadas), 'S1.2023');
    assert.equal(gerarChave('S1', 2023, usadas), 'S1.2023-2');
    assert.equal(gerarChave('S1', 2023, usadas), 'S1.2023-3');
  });

  test('a mesma turma em anos diferentes não colide', () => {
    const usadas = new Set();
    assert.notEqual(gerarChave('A3', 2025, usadas), gerarChave('A3', 2026, usadas));
  });

  test('respeita chave já reservada, venha de onde vier', () => {
    const usadas = new Set(['A3.2025']);
    assert.equal(gerarChave('A3', 2025, usadas), 'A3.2025-2');
  });
});

describe('planoDeRemanejamento — detectar que a peça mudou de lugar', () => {
  const grade = (...chaves) => chaves.map((chave, i) => ({ chave, noite: 1, ordem: i + 1 }));

  test('grade intocada não gera remanejamento', () => {
    const p = planoDeRemanejamento(grade('A', 'B', 'C'), grade('A', 'B', 'C'));
    assert.equal(p.movidas, 0);
    assert.deepEqual(p.mapa, {});
  });

  test('editar título e turma não conta como mudar de lugar', () => {
    /* corrigir texto é seguro a qualquer momento — é o trabalho da Fase 3 */
    const antes = [{ chave: 'A', noite: 1, ordem: 1, titulo: 'errado', turma: 'A3' }];
    const depois = [{ chave: 'A', noite: 1, ordem: 1, titulo: 'certo', turma: '3A' }];
    assert.equal(planoDeRemanejamento(antes, depois).movidas, 0);
  });

  test('a chave NÃO acompanha a turma — o ponto do módulo inteiro', () => {
    /* Se a chave fosse derivada da turma, corrigir "A3" para "3A" em outubro
       reescreveria o histórico exatamente como a reordenação fazia. A chave
       é atribuída uma vez e carregada para sempre. */
    const antes = [{ chave: 'A3.2025', noite: 1, ordem: 1, turma: 'A3' }];
    const depois = [{ chave: 'A3.2025', noite: 1, ordem: 1, turma: 'Turma A3 - Manhã' }];
    const p = planoDeRemanejamento(antes, depois);
    assert.equal(p.movidas, 0);
    assert.deepEqual(p.sumiram, []);
    assert.deepEqual(p.novas, []);
  });

  test('trocar duas peças de lugar é detectado', () => {
    const p = planoDeRemanejamento(grade('A', 'B', 'C'), grade('B', 'A', 'C'));
    assert.equal(p.movidas, 2);
    assert.deepEqual(p.mapa, { s1e1: 's1e2', s1e2: 's1e1' });
  });

  test('remover do meio empurra todas as seguintes — o bug original', () => {
    /* era exatamente isto que acontecia em silêncio: sem B, o C que estava
       em s1e3 passa a ocupar s1e2, e toda nota de s1e2 vira nota de C */
    const p = planoDeRemanejamento(grade('A', 'B', 'C', 'D'), grade('A', 'C', 'D'));
    assert.deepEqual(p.sumiram, ['B']);
    assert.deepEqual(p.mapa, { s1e3: 's1e2', s1e4: 's1e3' });
  });

  test('peça nova no fim não move ninguém', () => {
    const p = planoDeRemanejamento(grade('A', 'B'), grade('A', 'B', 'C'));
    assert.equal(p.movidas, 0);
    assert.deepEqual(p.novas, ['C']);
  });

  test('peça que troca de noite é movimento', () => {
    const antes = [{ chave: 'A', noite: 1, ordem: 1 }];
    const depois = [{ chave: 'A', noite: 2, ordem: 1 }];
    assert.deepEqual(planoDeRemanejamento(antes, depois).mapa, { s1e1: 's2e1' });
  });
});

describe('aplicarRemanejamento — reescrever as notas', () => {
  test('a rotação não aplica o mapa duas vezes na mesma nota', () => {
    /* a armadilha clássica de renomear chaves no lugar: s1e1→s1e2 e depois
       s1e2→s1e3 levaria a nota original de s1e1 até s1e3 */
    const mapa = { s1e1: 's1e2', s1e2: 's1e3', s1e3: 's1e1' };
    const { grid } = aplicarRemanejamento({ s1e1: 10, s1e2: 5, s1e3: 1 }, mapa);
    assert.deepEqual(grid, { s1e2: 10, s1e3: 5, s1e1: 1 });
  });

  test('nenhuma nota some e nenhuma nota nasce', () => {
    const mapa = { s1e1: 's1e2', s1e2: 's1e1' };
    const original = { s1e1: 8, s1e2: 6, s2e1: 9, s3e4: 7 };
    const { grid } = aplicarRemanejamento(original, mapa);
    assert.equal(Object.keys(grid).length, Object.keys(original).length);
    assert.deepEqual(
      Object.values(grid).sort(), Object.values(original).sort(),
      'o conjunto de notas tem que ser o mesmo, só em outras posições'
    );
  });

  test('chave fora do mapa fica como está, inclusive órfã', () => {
    /* nota de peça que não existe mais é preservada de propósito: perder
       nota em silêncio é o que este módulo existe para impedir */
    const { grid } = aplicarRemanejamento({ s1e1: 8, s9e9: 3 }, { s1e1: 's1e2' });
    assert.deepEqual(grid, { s1e2: 8, s9e9: 3 });
  });

  test('colisão é denunciada em vez de sobrescrever em silêncio', () => {
    const { conflitos } = aplicarRemanejamento({ s1e1: 8, s1e2: 6 }, { s1e1: 's1e2' });
    assert.deepEqual(conflitos, ['s1e2']);
  });

  test('grid vazio, nulo ou lixo não explode', () => {
    for (const g of [null, undefined, {}, 'texto', 42]) {
      assert.deepEqual(aplicarRemanejamento(g, { s1e1: 's1e2' }).grid, {}, String(g));
    }
  });
});

describe('ida e volta: reordenar e desfazer devolve o original', () => {
  test('aplicar o plano e o plano inverso restaura as notas', () => {
    const antes = [{ chave: 'A', noite: 1, ordem: 1 }, { chave: 'B', noite: 1, ordem: 2 }, { chave: 'C', noite: 1, ordem: 3 }];
    const depois = [{ chave: 'C', noite: 1, ordem: 1 }, { chave: 'A', noite: 1, ordem: 2 }, { chave: 'B', noite: 1, ordem: 3 }];
    const original = { s1e1: 9, s1e2: 4, s1e3: 7 };

    const ida = planoDeRemanejamento(antes, depois);
    const volta = planoDeRemanejamento(depois, antes);

    const meio = aplicarRemanejamento(original, ida.mapa).grid;
    const fim = aplicarRemanejamento(meio, volta.mapa).grid;
    assert.deepEqual(fim, original);
  });
});

describe('chavePosicional', () => {
  test('monta o sNeM de sempre', () => {
    assert.equal(chavePosicional(2, 3), 's2e3');
    assert.equal(chavePosicional('1', '1'), 's1e1');
  });
});
