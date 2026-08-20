/* =====================================================================
   TESTES · MODERAÇÃO E PAPÉIS  (testes/moderacao.test.js)
   =====================================================================
   `api/_moderacao.js` é o único módulo do projeto que já exporta tudo, então
   aqui não há sandbox: é `require` direto.

   O que estes testes protegem:

     podeExecutar   — a tabela de permissões É a autoridade. A interface
                      esconde botões por papel, mas esconder botão não é
                      segurança. Se esta função afrouxar, um moderador passa
                      a mexer no acervo e um historiador a apagar contas.

     estadoConta    — a regra de expiração de banimento e silêncio, num
                      lugar só. `banido.ate` ausente significa PERMANENTE:
                      se alguém inverter isso, todo banimento permanente do
                      site vira "expirado" de uma vez.

     validarNome    — a fronteira do que entra em `usuarios.usuario`. O `_`
                      é aceito de propósito, e é exatamente por isso que o
                      projeto proíbe `ilike` em UPDATE/DELETE.
   ===================================================================== */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const mod = require('../api/_moderacao');
const {
  podeExecutar, estadoConta, mensagemBloqueio, validarNome, norm,
  PAPEIS, REFERENCIAS, MAX_DIAS_BAN_MODERADOR, LIMPEZAS_SO_ADMIN, ITENS_SO_ADMIN
} = mod;

const AGORA = Date.now();
const DIA = 24 * 60 * 60 * 1000;

describe('podeExecutar — a fronteira entre os papéis', () => {
  test('admin pode tudo, inclusive uma ação que ainda não existe', () => {
    assert.equal(podeExecutar('admin', 'salvarEdicaoCompleta'), true);
    assert.equal(podeExecutar('admin', 'deletarUsuario'), true);
    assert.equal(podeExecutar('admin', 'acaoInventadaAmanha'), true);
  });

  test('moderador cuida de PESSOAS e só delas', () => {
    for (const acao of ['listarUsuarios', 'definirSilencio', 'definirBanimento',
                        'forcarTrocaNome', 'deslogarTudo', 'anonimizarUsuario',
                        'listarVotos']) {
      assert.equal(podeExecutar('moderador', acao), true, acao);
    }
    /* acervo, config e ações irreversíveis ficam de fora */
    for (const acao of ['salvarEdicaoCompleta', 'salvarConfig', 'deletarEdicao',
                        'deletarUsuario', 'renomearUsuario', 'definirPapel',
                        'tornarAdmin', 'editarVoto', 'deletarVotos',
                        'anonimizarVoto', 'uploadImagem']) {
      assert.equal(podeExecutar('moderador', acao), false, acao);
    }
  });

  test('historiador cuida do ACERVO e só dele', () => {
    for (const acao of ['salvarEdicaoCompleta', 'uploadImagem', 'parseLink']) {
      assert.equal(podeExecutar('historiador', acao), true, acao);
    }
    for (const acao of ['deletarEdicao', 'listarUsuarios', 'definirBanimento',
                        'salvarConfig', 'deletarUsuario', 'definirPapel']) {
      assert.equal(podeExecutar('historiador', acao), false, acao);
    }
  });

  test('sem papel, nada é permitido', () => {
    /* o padrão seguro: omitir uma ação da tabela significa "só admin" */
    for (const papel of [undefined, null, '', 'visitante', 'ADMIN', 'Admin']) {
      assert.equal(podeExecutar(papel, 'listarUsuarios'), false, String(papel));
      assert.equal(podeExecutar(papel, 'salvarEdicaoCompleta'), false, String(papel));
    }
  });

  test('ping é liberado para todo papel da equipe', () => {
    /* é o diagnóstico que diz qual build está no ar — negá-lo a um papel
       deixa essa pessoa sem como investigar nada */
    for (const papel of PAPEIS) assert.equal(podeExecutar(papel, 'ping'), true, papel);
  });

  test('as listas de exceção continuam cobrindo dado de votação', () => {
    assert.equal(LIMPEZAS_SO_ADMIN.votos, 1);
    assert.equal(ITENS_SO_ADMIN.voto, 1);
    assert.equal(ITENS_SO_ADMIN.palpite, 1);
    assert.equal(MAX_DIAS_BAN_MODERADOR, 30);
  });
});

describe('estadoConta — banimento e silêncio', () => {
  test('banimento sem `ate` é PERMANENTE', () => {
    /* a inversão desta regra libertaria, de uma vez, todo mundo que foi
       suspenso permanentemente */
    const e = estadoConta({ banido: { ts: AGORA, motivo: 'spam', por: 'admin' } });
    assert.equal(e.banido, true);
    assert.equal(e.banidoAte, null);
    assert.equal(e.banidoMotivo, 'spam');
  });

  test('banimento com prazo futuro vale; com prazo vencido, não', () => {
    assert.equal(estadoConta({ banido: { ate: AGORA + DIA } }).banido, true);
    assert.equal(estadoConta({ banido: { ate: AGORA - DIA } }).banido, false);
  });

  test('silêncio expira sozinho', () => {
    assert.equal(estadoConta({ silenciado_ate: AGORA + 3600_000 }).silenciado, true);
    assert.equal(estadoConta({ silenciado_ate: AGORA - 3600_000 }).silenciado, false);
    assert.equal(estadoConta({ silenciado_ate: 0 }).silenciado, false);
  });

  test('silenciado não é banido — são punições diferentes', () => {
    /* silenciar bloqueia interação, não a conta: editar o próprio perfil e
       ler notificações continuam liberados de propósito */
    const e = estadoConta({ silenciado_ate: AGORA + DIA });
    assert.equal(e.silenciado, true);
    assert.equal(e.banido, false);
  });

  test('perfil vazio, nulo ou lixo não vira conta banida', () => {
    for (const p of [null, undefined, {}, '', 'texto', 0, []]) {
      const e = estadoConta(p);
      assert.equal(e.banido, false, String(p));
      assert.equal(e.silenciado, false, String(p));
      assert.equal(e.precisaTrocarNome, false, String(p));
    }
  });

  test('nome bloqueado é sinalizado separadamente', () => {
    const e = estadoConta({ nome_bloqueado: { ts: AGORA, motivo: 'ofensivo', nomeAntigo: 'x' } });
    assert.equal(e.precisaTrocarNome, true);
    assert.equal(e.nomeBloqueadoMotivo, 'ofensivo');
    assert.equal(e.banido, false);
  });
});

describe('mensagemBloqueio', () => {
  test('conta liberada não gera mensagem', () => {
    assert.equal(mensagemBloqueio(estadoConta({})), null);
  });

  test('a mensagem diz se é permanente ou até quando', () => {
    const permanente = mensagemBloqueio(estadoConta({ banido: { motivo: 'spam' } }));
    assert.match(permanente, /permanentemente/);
    assert.match(permanente, /spam/);

    const comPrazo = mensagemBloqueio(estadoConta({ banido: { ate: AGORA + DIA } }));
    assert.match(comPrazo, /até/);
  });
});

describe('validarNome — a fronteira do nome de usuário', () => {
  test('aceita os nomes que o site promete aceitar', () => {
    for (const n of ['ana', 'Maria Silva', 'joao_silva', 'jose.santos',
                     'ana-luiza', 'user123', 'ab', 'x'.repeat(20)]) {
      assert.equal(validarNome(n), null, n);
    }
  });

  test('o `_` é aceito — e é por isso que `ilike` é proibido em UPDATE/DELETE', () => {
    /* Em LIKE, `_` casa com qualquer caractere. Com `joao_silva` sendo um
       nome válido, um DELETE com ilike apagaria também `joaoXsilva`.
       Se um dia este teste falhar porque o `_` deixou de ser aceito, a
       proibição do ilike continua valendo para os nomes já cadastrados. */
    assert.equal(validarNome('joao_silva'), null);
    assert.equal(validarNome('joaoXsilva'), null);
  });

  test('recusa nome curto, longo e com caractere de fora', () => {
    assert.match(validarNome('a'), /2 a 20/);
    assert.match(validarNome('x'.repeat(21)), /2 a 20/);
    for (const n of ['ana@casa', 'maria/silva', '<script>', 'nome#1', 'a\\b']) {
      assert.ok(validarNome(n), `deveria recusar: ${n}`);
    }
  });

  test('recusa vazio e não-texto sem explodir', () => {
    for (const n of ['', '   ', null, undefined, 0, {}, []]) {
      assert.ok(validarNome(n), String(n));
    }
  });
});

describe('REFERENCIAS — o mapa da renomeação', () => {
  test('as nove tabelas com nome de usuário continuam listadas', () => {
    /* Criar uma tabela nova com nome de usuário e esquecer de acrescentá-la
       aqui deixa rastro órfão a cada renomeação. Este teste não descobre a
       tabela nova sozinho — ele existe para que mexer nesta lista seja uma
       decisão, e não um descuido. */
    const esperadas = ['submissions', 'palpites', 'notificacoes', 'sessoes',
                       'push', 'resets', 'carimbos', 'visitas', 'reputacao'];
    const listadas = REFERENCIAS.map(r => r.tabela).sort();
    assert.deepEqual(listadas, esperadas.slice().sort());
  });

  test('as tabelas de duas colunas trazem as duas', () => {
    const porNome = Object.fromEntries(REFERENCIAS.map(r => [r.tabela, r.colunas]));
    assert.deepEqual(porNome.carimbos, ['profile_user', 'from_user']);
    assert.deepEqual(porNome.visitas, ['profile_user', 'visitor_user']);
    assert.deepEqual(porNome.reputacao, ['profile_user', 'from_user']);
  });
});

describe('norm — comparação de nomes', () => {
  test('não diferencia maiúsculas nem espaço nas pontas', () => {
    /* é a comparação que o projeto usa para conferir identidade depois de
       ler com ilike */
    assert.equal(norm('Joao'), norm('joao'));
    assert.equal(norm(' joao '), norm('joao'));
    assert.notEqual(norm('joao_silva'), norm('joaoXsilva'));
  });
});
