/* =====================================================================
   CARREGADOR DO core.js PARA TESTE (testes/carregar-core.js)
   =====================================================================
   O core.js é um script de navegador: não tem `module.exports`, e a primeira
   linha executável já mexe no `document`. Para testar as funções puras que
   moram nele sem tocar em nada do arquivo original, ele é executado aqui
   dentro de um `vm` com um DOM falso.

   O DOM falso é um Proxy universal: qualquer propriedade devolve outro stub,
   qualquer chamada é um no-op que devolve um stub. Não simula o navegador —
   só evita que o core.js exploda antes de definir as funções.

   Por que o core.js não chega a montar página nenhuma: o bloco final dele
   testa `typeof EDICOES === 'undefined'` e, sem esse global, cai na tela de
   erro em vez de chamar o dispatcher. Aqui isso é o caminho desejado.

   Se um dia o core.js passar a exigir alguma API de navegador que o stub não
   cobre, o sintoma é um erro na carga — acrescente o stub aqui, nunca um
   `if (typeof window...)` no core.js só por causa do teste.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAMINHO_CORE = path.join(__dirname, '..', 'assets', 'core.js');

/* constantes de topo do core.js que os testes leem (ver o epílogo abaixo) */
const CONSTANTES_EXPOSTAS = ['BOLAO_FAIXAS', 'BADGES_DEF', 'TEMA_KEY'];

/* stub que aceita qualquer coisa: leitura, escrita, chamada e `new` */
function stub(nome) {
  const alvo = function () {};
  alvo.__stub = nome;
  return new Proxy(alvo, {
    get(_, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString') return () => '';
      if (prop === 'length') return 0;
      if (prop === 'then') return undefined;          // não finge ser Promise
      if (prop === Symbol.iterator) return function* () {};
      return stub(nome + '.' + String(prop));
    },
    set() { return true; },
    has() { return true; },
    apply() { return stub(nome + '()'); },
    construct() { return stub('new ' + nome); }
  });
}

/* localStorage de mentira, com estado de verdade — algumas funções do core.js
   leem e escrevem nele, e um stub cego mascararia comportamento */
function memoriaLocal() {
  const m = new Map();
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; }
  };
}

/* Carrega o core.js e devolve o objeto global do sandbox, de onde se pega
   qualquer função ou constante declarada no topo do arquivo.
   `globais` injeta o que o core.js espera das páginas (BASE, PAGINA) e do
   config.js (NOTA_MAXIMA, HALL, ...). */
function carregarCore(globais = {}) {
  const codigo = fs.readFileSync(CAMINHO_CORE, 'utf8');

  const sandbox = {
    /* contrato de toda página — ver 02-frontend.md §1 */
    BASE: '',
    PAGINA: { tipo: 'home' },

    /* o que o config.js normalmente define */
    NOTA_MAXIMA: 10,
    COOLDOWN_MINUTOS: 5,
    ANO_VOTOS_ANTIGOS: 2019,
    HALL: { minAvaliacoes: 3 },
    /* EDICOES fica de fora de propósito: é a ausência dele que faz o core.js
       parar na tela de erro em vez de tentar montar a página */

    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout() { return 0; },
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    requestAnimationFrame() { return 0; },
    fetch: () => Promise.reject(new Error('rede desligada no teste')),
    localStorage: memoriaLocal(),
    sessionStorage: memoriaLocal(),
    document: stub('document'),
    navigator: stub('navigator'),
    location: { pathname: '/', href: 'http://localhost/', search: '', hash: '' },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
    indexedDB: stub('indexedDB'),
    Chart: stub('Chart'),
    html2canvas: stub('html2canvas'),

    ...globais
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}
  });
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};

  /* `function` de topo vira propriedade do global e sai de graça, mas `const`
     e `let` de topo vivem no escopo léxico do script e não aparecem no
     sandbox. Este epílogo roda no MESMO escopo (é o mesmo texto de script) e
     copia as constantes que os testes precisam ler. Acrescentar um nome aqui
     é a forma de expor uma constante nova — nunca mexa no core.js por isso. */
  const epilogo = `
;(function(){
  var alvo = {};
  ${CONSTANTES_EXPOSTAS.map(n =>
    `try{ if(typeof ${n} !== 'undefined') alvo.${n} = ${n}; }catch(e){}`
  ).join('\n  ')}
  globalThis.__const = alvo;
})();`;

  vm.createContext(sandbox);
  vm.runInContext(codigo + epilogo, sandbox, { filename: 'assets/core.js' });

  Object.assign(sandbox, sandbox.__const || {});
  return sandbox;
}

module.exports = { carregarCore };
