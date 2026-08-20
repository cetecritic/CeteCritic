/* =====================================================================
   CARREGADOR DO api/content.js PARA TESTE (testes/carregar-content.js)
   =====================================================================
   Mesma ideia do carregar-db.js: o content.js é uma função serverless que
   abre um cliente Supabase na carga do módulo. Aqui ele roda dentro de um
   `vm`, com o banco falso do carregar-db.js e as variáveis de ambiente que
   o teste quiser simular.

   O content.js segue exatamente como está no repositório.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { bancoFalso } = require('./carregar-db');

const CAMINHO = path.join(__dirname, '..', 'api', 'content.js');

const FUNCOES_EXPOSTAS = ['diagnosticoSaude', 'infoBolao', 'podeExecutar'];
const CONSTANTES_EXPOSTAS = ['ACOES_CONHECIDAS'];

/* `fixture` alimenta o banco; `env` simula as variáveis da Vercel.
   `tabelasComErro` marca tabelas que devem responder erro, para simular
   uma migração que não rodou. */
function carregarContent(fixture = {}, env = {}, tabelasComErro = []) {
  const codigo = fs.readFileSync(CAMINHO, 'utf8');
  const banco = bancoFalso(fixture);

  const from = banco.from.bind(banco);
  banco.from = (tabela) => {
    if (tabelasComErro.includes(tabela)) {
      const erro = { data: null, error: { message: `relation "${tabela}" does not exist` } };
      const api = new Proxy({}, {
        get: (_, p) => (p === 'then'
          ? (ok, err) => Promise.resolve(erro).then(ok, err)
          : () => api)
      });
      return api;
    }
    return from(tabela);
  };

  const requireFalso = (nome) => {
    if (nome === '@supabase/supabase-js') return { createClient: () => banco };
    if (nome === 'web-push') return { setVapidDetails() {}, sendNotification: async () => ({}) };
    if (nome === './enviar-push') return { enviarParaTodos: async () => ({ ok: true }) };
    if (nome.startsWith('./')) return require(path.join(__dirname, '..', 'api', nome));
    return require(nome);
  };

  const epilogo = `
;(function(){
  var alvo = {};
  ${[...FUNCOES_EXPOSTAS, ...CONSTANTES_EXPOSTAS].map(n =>
    `try{ if(typeof ${n} !== 'undefined') alvo.${n} = ${n}; }catch(e){}`
  ).join('\n  ')}
  module.exports.__interno = alvo;
})();`;

  const sandbox = {
    require: requireFalso,
    module: { exports: {} },
    process: {
      env: {
        SUPABASE_URL: 'http://teste.local',
        SUPABASE_SECRET_KEY: 'chave-de-teste',
        ...env
      }
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
    Buffer, URL, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => Promise.reject(new Error('rede desligada'))
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(codigo + epilogo, sandbox, { filename: 'api/content.js' });

  return { ...(sandbox.module.exports.__interno || {}), banco };
}

module.exports = { carregarContent };
