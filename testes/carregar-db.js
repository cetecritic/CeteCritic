/* =====================================================================
   CARREGADOR DO api/db.js PARA TESTE (testes/carregar-db.js)
   =====================================================================
   O db.js é uma função serverless: `module.exports` é o handler, e as funções
   internas (pontosBolao, estadoBolao, ...) não saem de lá. Ele também abre um
   cliente Supabase na carga do módulo, o que exigiria `npm install` e
   variáveis de ambiente só para rodar um teste.

   Em vez de mexer no db.js para acomodar o teste — o que seria deixar o teste
   mandar no código de produção —, este carregador executa o arquivo dentro de
   um `vm` com:

     - um `require` falso, que devolve um Supabase de mentira e um push de
       mentira, e delega ./_moderacao para o módulo de verdade;
     - um banco em memória, alimentado por fixture, que responde às cadeias
       `sb.from(t).select(...).eq(...).limit(...)`.

   Nada aqui toca em rede, em disco ou em variável de ambiente.

   O db.js segue exatamente como está no repositório. Se um dia ele passar a
   usar um método do Supabase que o falso não implementa, o teste quebra com
   "método não implementado" e o conserto é AQUI.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAMINHO_DB = path.join(__dirname, '..', 'api', 'db.js');

/* constantes de topo do db.js que os testes leem */
const CONSTANTES_EXPOSTAS = [
  'BOLAO_FAIXAS', 'BOLAO_PONTOS_MAX', 'MAX_RATING', 'MAX_TENTATIVAS',
  'VOTO_MAX_POR_JANELA', 'VOTO_JANELA_MS', 'LIMITE_ALTO'
];

/* funções internas do db.js que os testes chamam */
const FUNCOES_EXPOSTAS = [
  'pontosBolao', 'estadoBolao', 'mediasReaisDoAno', 'placarBolao',
  'dataNoite1', 'asObj', 'hasInvalidRating'
];

/* ---------------------------------------------------------------------
   BANCO DE MENTIRA

   Implementa só o que o db.js usa: from().select().eq().in().is().not()
   .order().limit(), com o resultado no formato { data, error }. O objeto é
   "thenable", então `await` numa cadeia inacabada também funciona — é assim
   que o db.js escreve as consultas.
   --------------------------------------------------------------------- */
function bancoFalso(fixture = {}) {
  const tabelas = JSON.parse(JSON.stringify(fixture));

  function consulta(tabela) {
    const filtros = [];
    let limite = Infinity;

    const executar = () => {
      let linhas = (tabelas[tabela] || []).slice();
      for (const f of filtros) {
        linhas = linhas.filter(l => {
          const v = l[f.col];
          if (f.op === 'eq')  return String(v) === String(f.val);
          if (f.op === 'in')  return f.val.map(String).includes(String(v));
          if (f.op === 'is')  return f.val === null ? (v === null || v === undefined) : v === f.val;
          if (f.op === 'not') return !(f.val === null ? (v === null || v === undefined) : v === f.val);
          if (f.op === 'gte') return Number(v) >= Number(f.val);
          if (f.op === 'lte') return Number(v) <= Number(f.val);
          if (f.op === 'ilike') return String(v).toLowerCase() === String(f.val).toLowerCase();
          return true;
        });
      }
      return { data: linhas.slice(0, limite), error: null, count: linhas.length };
    };

    const api = {
      select() { return api; },
      eq(col, val)  { filtros.push({ op: 'eq', col, val }); return api; },
      in(col, val)  { filtros.push({ op: 'in', col, val }); return api; },
      is(col, val)  { filtros.push({ op: 'is', col, val }); return api; },
      not(col, _op, val) { filtros.push({ op: 'not', col, val }); return api; },
      gte(col, val) { filtros.push({ op: 'gte', col, val }); return api; },
      lte(col, val) { filtros.push({ op: 'lte', col, val }); return api; },
      ilike(col, val) { filtros.push({ op: 'ilike', col, val }); return api; },
      order() { return api; },
      limit(n) { limite = n; return api; },
      maybeSingle() { const r = executar(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
      single()      { const r = executar(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
      /* escritas: aceitas e ignoradas — nenhum teste desta suíte grava */
      insert() { return api; }, update() { return api; },
      upsert() { return api; }, delete() { return api; },
      then(ok, err) { return Promise.resolve(executar()).then(ok, err); }
    };
    return api;
  }

  return { from: tabela => consulta(tabela), _tabelas: tabelas };
}

/* Relógio congelado para o sandbox: `new Date()` e `Date.now()` passam a
   devolver sempre o mesmo instante, e todo o resto do Date continua igual.
   Sem isto, qualquer teste de janela de tempo passaria hoje e falharia em
   julho — que é justamente quando ninguém quer descobrir isso. */
function dataCongelada(instante) {
  const t = new Date(instante).getTime();
  class DataFixa extends Date {
    constructor(...args) { super(...(args.length ? args : [t])); }
    static now() { return t; }
  }
  return DataFixa;
}

/* Carrega o db.js e devolve { ...funcoes, ...constantes, banco }.
   `fixture` é um objeto { nomeDaTabela: [linhas] }.
   `agora` (opcional) congela o relógio do sandbox naquele instante. */
function carregarDb(fixture = {}, agora = null) {
  const codigo = fs.readFileSync(CAMINHO_DB, 'utf8');
  const banco = bancoFalso(fixture);

  const requireFalso = (nome) => {
    if (nome === '@supabase/supabase-js') return { createClient: () => banco };
    if (nome === './enviar-push') return { enviarParaTodos: async () => ({ ok: true, enviados: 0 }) };
    if (nome === 'crypto') return require('crypto');
    if (nome.startsWith('./')) return require(path.join(__dirname, '..', 'api', nome));
    return require(nome);
  };

  const epilogo = `
;(function(){
  var alvo = {};
  ${[...CONSTANTES_EXPOSTAS, ...FUNCOES_EXPOSTAS].map(n =>
    `try{ if(typeof ${n} !== 'undefined') alvo.${n} = ${n}; }catch(e){}`
  ).join('\n  ')}
  module.exports.__interno = alvo;
})();`;

  const sandbox = {
    require: requireFalso,
    module: { exports: {} },
    process: { env: { SUPABASE_URL: 'http://teste.local', SUPABASE_SECRET_KEY: 'chave-de-teste' } },
    console: { log() {}, warn() {}, error() {}, info() {} },
    Buffer, URL, TextEncoder, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval
  };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  if (agora) sandbox.Date = dataCongelada(agora);

  vm.createContext(sandbox);
  vm.runInContext(codigo + epilogo, sandbox, { filename: 'api/db.js' });

  const interno = sandbox.module.exports.__interno || {};
  const faltando = [...CONSTANTES_EXPOSTAS, ...FUNCOES_EXPOSTAS].filter(n => !(n in interno));

  return { ...interno, banco, handler: sandbox.module.exports, faltando };
}

module.exports = { carregarDb, bancoFalso };
