/* =====================================================================
   CARREGADOR DO assets/interseries.js PARA TESTE
   (testes/carregar-interseries.js)
   =====================================================================
   O interseries.js é um script de navegador: não tem `module.exports`, e a
   primeira linha executável já mexe no `navigator`. Para testar as funções
   puras que moram nele sem tocar em nada do arquivo original, ele é
   executado aqui dentro de um `vm` com um DOM falso.

   É o mesmo arranjo do carregar-core.js, e pela mesma razão: o teste não
   manda no código de produção. Nunca acrescente `module.exports` nem
   `window.X =` no interseries.js só por causa do teste.

   Por que o bundle não tenta montar página nenhuma: o bloco final dele
   testa `typeof PAGINA !== 'undefined'`, e este sandbox não define PAGINA
   — exatamente como o admin-interseries.html, que carrega o mesmo arquivo
   para reusar as funções.

   `const` e `let` de topo vivem no escopo léxico do script e não aparecem
   no sandbox; o epílogo abaixo copia os nomes escolhidos a dedo. Para
   expor uma constante nova, acrescente o nome em CONSTANTES_EXPOSTAS.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CAMINHO = path.join(__dirname, '..', 'assets', 'interseries.js');

const CONSTANTES_EXPOSTAS = ['CRITERIOS_IS', 'IS_API', 'IS_FILTRO_KEY', 'TEMA_KEY', 'SESSAO_KEY', 'DIAS'];

function stub(nome){
  const alvo = function(){};
  alvo.__stub = nome;
  return new Proxy(alvo, {
    get(_, prop){
      if(prop === Symbol.toPrimitive) return () => '';
      if(prop === 'toString') return () => '';
      if(prop === 'length') return 0;
      if(prop === 'then') return undefined;            // não finge ser Promise
      if(prop === Symbol.iterator) return function*(){};
      return stub(nome + '.' + String(prop));
    },
    set(){ return true; },
    has(){ return true; },
    apply(){ return stub(nome + '()'); },
    construct(){ return stub('new ' + nome); }
  });
}

function memoriaLocal(){
  const m = new Map();
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: i => Array.from(m.keys())[i] ?? null,
    get length(){ return m.size; }
  };
}

function carregarInterseries(globais = {}){
  const codigo = fs.readFileSync(CAMINHO, 'utf8');

  const sandbox = {
    /* PAGINA fica de FORA de propósito: é a ausência dela que impede o
       bundle de tentar montar a página (ver o bloco BOOT do arquivo). */
    console: { log(){}, warn(){}, error(){}, info(){} },
    setTimeout(){ return 0; }, clearTimeout(){},
    setInterval(){ return 0; }, clearInterval(){},
    requestAnimationFrame(){ return 0; },
    fetch: () => Promise.reject(new Error('rede desligada no teste')),
    localStorage: memoriaLocal(),
    sessionStorage: memoriaLocal(),
    document: stub('document'),
    navigator: {},                       // sem serviceWorker: o registro é pulado
    location: { pathname: '/interseries/', href: 'http://localhost/interseries/', search: '', hash: '' },
    ...globais
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window.matchMedia = () => ({
    matches: false, addEventListener(){}, removeEventListener(){}, addListener(){}
  });
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};

  const epilogo = `
;(function(){
  var alvo = {};
  ${CONSTANTES_EXPOSTAS.map(n =>
    `try{ if(typeof ${n} !== 'undefined') alvo.${n} = ${n}; }catch(e){}`
  ).join('\n  ')}
  globalThis.__const = alvo;
})();`;

  vm.createContext(sandbox);
  vm.runInContext(codigo + epilogo, sandbox, { filename: 'assets/interseries.js' });

  Object.assign(sandbox, sandbox.__const || {});
  return sandbox;
}

/* ---------------------------------------------------------------------
   plano() — a ponte entre os dois "realms"

   Um array criado DENTRO do vm tem outro Array.prototype. `assert.deepEqual`
   (que é o strict) compara também o protótipo, então comparar um array
   vindo do bundle com um array literal do teste falha com a mensagem
   enigmática:

       Values have same structure but are not reference-equal

   Ou seja: a estrutura está certa e o teste quebra mesmo assim. Passar o
   valor por aqui achata isso para intrínsecos deste realm.

   Use `plano(x)` em TODO valor que atravessou o vm — arrays e objetos.
   Números e strings não precisam.
   --------------------------------------------------------------------- */
function plano(v){ return JSON.parse(JSON.stringify(v)); }

module.exports = { carregarInterseries, plano };
