/* =====================================================================
   TESTES · DIAGNÓSTICO DE SAÚDE  (testes/saude.test.js)
   =====================================================================
   `diagnosticoSaude()` responde ao `ping` do painel e existe por um motivo
   específico: as travas deste projeto degradam com elegância. Sem a tabela
   `rate_limite` os limites de voto liberam tudo; sem a chave da Resend o 2FA
   e a redefinição de senha param. Nos dois casos o site continua servindo
   normalmente, e o único sinal é uma linha de log.

   Essa degradação é o comportamento certo — uma migração pendente não pode
   derrubar o site no meio do festival. O que faltava era um lugar onde a
   ausência aparecesse.

   Estes testes garantem as duas metades disso: que a falta é detectada, e
   que a presença não gera alarme falso (alarme que toca sempre vira
   paisagem).
   ===================================================================== */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { carregarContent } = require('./carregar-content');

const AMBIENTE_COMPLETO = {
  RESEND_API_KEY: 're_123', RESEND_FROM: 'CETECritic <no-reply@cetecritic.xyz>',
  VAPID_PUBLIC_KEY: 'pub-abc', VAPID_PRIVATE_KEY: 'priv-abc', VAPID_SUBJECT: 'mailto:x@y.z',
  CRON_SECRET: 'segredo', RATE_SALT: 'sal-aleatorio'
};
const BANCO_COMPLETO = {
  rate_limite: [{ chave: 'x' }],
  usuarios: [{ usuario: 'ana', papel: 'admin' }],
  config_site: [{ id: 1, dados: { VAPID_PUBLIC_KEY: 'pub-abc' } }]
};

describe('diagnosticoSaude — ambiente completo', () => {
  test('não acusa nada quando está tudo no lugar', async () => {
    const { diagnosticoSaude } = carregarContent(BANCO_COMPLETO, AMBIENTE_COMPLETO);
    const s = await diagnosticoSaude();
    assert.equal(s.tudoOk, true, 'alarme falso: ' + JSON.stringify(s));
  });
});

describe('diagnosticoSaude — o que falha aberto', () => {
  test('tabela rate_limite ausente é acusada', async () => {
    /* migracao-seguranca.sql não rodou: a trava de votação do servidor
       simplesmente não existe, e nada no site indica isso */
    const { diagnosticoSaude } = carregarContent(
      BANCO_COMPLETO, AMBIENTE_COMPLETO, ['rate_limite']
    );
    const s = await diagnosticoSaude();
    assert.equal(s.rateLimite, false);
    assert.equal(s.tudoOk, false);
  });

  test('coluna papel ausente é acusada', async () => {
    const { diagnosticoSaude } = carregarContent(
      BANCO_COMPLETO, AMBIENTE_COMPLETO, ['usuarios']
    );
    const s = await diagnosticoSaude();
    assert.equal(s.colunaPapel, false);
  });

  test('e-mail sem configuração é acusado', async () => {
    /* o caso mais cruel: o envio é ignorado em silêncio, então uma pessoa
       com 2FA ligado fica trancada fora da conta sem mensagem nenhuma */
    const env = { ...AMBIENTE_COMPLETO }; delete env.RESEND_API_KEY;
    const { diagnosticoSaude } = carregarContent(BANCO_COMPLETO, env);
    const s = await diagnosticoSaude();
    assert.equal(s.email, false);

    const env2 = { ...AMBIENTE_COMPLETO }; delete env2.RESEND_FROM;
    assert.equal((await carregarContent(BANCO_COMPLETO, env2).diagnosticoSaude()).email, false);
  });

  test('CRON_SECRET ausente é acusado', async () => {
    const env = { ...AMBIENTE_COMPLETO }; delete env.CRON_SECRET;
    const s = await carregarContent(BANCO_COMPLETO, env).diagnosticoSaude();
    assert.equal(s.cron, false);
  });

  test('RATE_SALT no padrão é acusado', async () => {
    const env = { ...AMBIENTE_COMPLETO }; delete env.RATE_SALT;
    const s = await carregarContent(BANCO_COMPLETO, env).diagnosticoSaude();
    assert.equal(s.rateSalt, false);
  });

  test('chave VAPID divergente do config_site é acusada', async () => {
    /* se a pública da Vercel e a do config_site não baterem, as inscrições
       existentes são inválidas e o push simplesmente não chega */
    const banco = {
      ...BANCO_COMPLETO,
      config_site: [{ id: 1, dados: { VAPID_PUBLIC_KEY: 'pub-ANTIGA' } }]
    };
    const s = await carregarContent(banco, AMBIENTE_COMPLETO).diagnosticoSaude();
    assert.equal(s.push, true, 'as variáveis existem');
    assert.equal(s.vapidConfere, false, 'mas não batem com o config_site');
    assert.equal(s.tudoOk, false);
  });

  test('config_site vazio não passa como se estivesse certo', async () => {
    const banco = { ...BANCO_COMPLETO, config_site: [] };
    const s = await carregarContent(banco, AMBIENTE_COMPLETO).diagnosticoSaude();
    assert.equal(s.vapidConfere, false);
  });
});

describe('diagnosticoSaude — não pode derrubar o painel', () => {
  test('com tudo faltando, ainda devolve resposta em vez de explodir', async () => {
    /* se este diagnóstico lançar exceção, ele derruba o `ping` — e o ping é
       justamente como a equipe descobre o que está errado */
    const { diagnosticoSaude } = carregarContent(
      {}, {}, ['rate_limite', 'usuarios', 'config_site']
    );
    const s = await diagnosticoSaude();
    assert.equal(s.tudoOk, false);
    for (const chave of ['rateLimite', 'colunaPapel', 'email', 'push', 'vapidConfere', 'cron', 'rateSalt']) {
      assert.equal(typeof s[chave], 'boolean', chave);
    }
  });

  test('nenhum segredo vaza na resposta', async () => {
    /* o ping é liberado para moderador e historiador também */
    const s = await carregarContent(BANCO_COMPLETO, AMBIENTE_COMPLETO).diagnosticoSaude();
    const texto = JSON.stringify(s);
    for (const segredo of Object.values(AMBIENTE_COMPLETO)) {
      assert.ok(!texto.includes(segredo), 'vazou: ' + segredo);
    }
  });
});
