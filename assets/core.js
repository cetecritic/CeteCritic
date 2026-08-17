/* =====================================================================
   CETECRITIC — LÓGICA COMPARTILHADA (assets/core.js)
   =====================================================================
   Você normalmente NÃO precisa mexer aqui.
   O que muda ano a ano fica em: config.js, ANO/edicao.js, ANO/noites/*.js

   Cada página define antes de carregar este arquivo:
     const BASE   = '../';                        // caminho até a raiz do site
     const PAGINA = { tipo:'noite', noite: 1 };   // o que renderizar
   Tipos: 'edicao' | 'sobre' | 'abertura' | 'noite' | 'monte'
   ===================================================================== */

/* ---------------------- TEMA (claro / escuro / automático) ----------------------
   Preferência guardada por dispositivo (localStorage). Aplicada o quanto antes
   para reduzir o "flash". 'auto' segue o tema do sistema. */
const TEMA_KEY = 'cetec-tema';
function temaPref(){ return localStorage.getItem(TEMA_KEY) || 'escuro'; }   // padrão: escuro (visual atual)
function aplicarTema(t){
  let efetivo = t;
  if(t === 'auto') efetivo = window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro';
  document.documentElement.dataset.theme = (efetivo === 'claro') ? 'light' : 'dark';
}
aplicarTema(temaPref());
/* se estiver em 'auto', acompanha mudanças do sistema em tempo real */
try{
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if(temaPref() === 'auto') aplicarTema('auto');
  });
}catch(e){}

/* ---------------------- Banner "adicionar à tela inicial" (só na home) ----------------------
   Preferência local (por aparelho), ligada por padrão. Pode ser desligada em
   Configurações > Aparência. Diferente do banner genérico de PWA logo abaixo:
   este é fixo da home e reaparece a cada visita (só o toggle desliga de vez). */
const BANNER_HOME_KEY = 'cetec-banner-home';
function bannerHomeAtivo(){ return localStorage.getItem(BANNER_HOME_KEY) !== '0'; } // padrão: ligado
function setBannerHomeAtivo(v){ try{ localStorage.setItem(BANNER_HOME_KEY, v ? '1' : '0'); }catch(e){} }

/* HTML do banner "adicionar à tela inicial". Reaproveitado na home (some com
   o toggle e com o X) e nas configurações (fica permanente, sem X). */
function htmlBannerInstalar(id, comFechar){
  return `
    <div class="home-install-banner" id="${id}">
      <img class="hib-icon" src="./assets/icon.jpg" alt="" onerror="this.remove()">
      <div class="hib-txt">
        <b>Tenha o CetecFestival na palma da sua mão</b>
        <span class="hib-sub">Instalar o CETECritic. </b> Adicione à tela inicial e use como um app.</span>
      </div>
      <div class="hib-actions">
        <button class="hib-add" type="button" id="${id}Add">Adicionar</button>
        ${comFechar ? `<button class="hib-x" type="button" id="${id}X" aria-label="Fechar">✕</button>` : ''}
      </div>
    </div>`;
}
function wireBannerInstalar(id, comFechar){
  const el = document.getElementById(id);
  const add = document.getElementById(id + 'Add');
  const x = comFechar ? document.getElementById(id + 'X') : null;
  if(add) add.addEventListener('click', async () => {
    const usouPrompt = (typeof window.instalarPWA === 'function') && await window.instalarPWA();
    if(!usouPrompt){
      if(typeof window.pwaEhIOS === 'function' && window.pwaEhIOS()){
        alert('No iPhone: toque em Compartilhar 📤 e depois em "Adicionar à Tela de Início".');
      } else {
        alert('Abra o menu do seu navegador e escolha "Instalar app" ou "Adicionar à tela inicial".');
      }
    }
  });
  if(x) x.addEventListener('click', () => { if(el) el.remove(); });
}

/* ---------------------- Vercel Analytics ----------------------
   Site estático não precisa do pacote npm: o script oficial é servido
   pelo próprio Vercel em /_vercel/insights/script.js. Como o core.js
   roda em toda página, isso cobre o site inteiro. Fora do Vercel
   (teste local) o script só dá 404 silencioso, sem quebrar nada. */
(function(){
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();

/* ---------------------- PWA: instalar + service worker ----------------------
   Registra o service worker (cache offline / abertura instantânea) e mostra
   um banner próprio de "Adicionar à tela inicial", fechável no X. No iOS não
   existe API de instalação: mostramos só uma dica curta. O "fechei" fica
   guardado no localStorage para não repetir. Tudo com caminhos absolutos
   (/...), então funciona igual nas páginas da raiz e nas de cada ano. */
(function(){
  if(!document.querySelector('link[rel="manifest"]')){
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/manifest.webmanifest'; document.head.appendChild(l);
  }
  if(!document.querySelector('meta[name="theme-color"]')){
    const m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#0e0f12'; document.head.appendChild(m);
  }
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
    });
  }

  const DISMISS_KEY = 'cetec-pwa-dispensado';
  const jaDispensou = () => localStorage.getItem(DISMISS_KEY) === '1';
  const marcarDispensa = () => { try{ localStorage.setItem(DISMISS_KEY, '1'); }catch(e){} };
  const estaInstalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function estiloBanner(){
    if(document.getElementById('pwaBannerCss')) return;
    const s = document.createElement('style'); s.id = 'pwaBannerCss';
    s.textContent = `
      .pwa-banner{position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:520px;margin:0 auto;
        background:#17181c;border:1px solid #2a2c33;border-radius:14px;padding:12px 14px;
        display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);
        font-family:'Inter',system-ui,sans-serif;color:#eceef2;animation:pwaUp .25s ease}
      @keyframes pwaUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
      .pwa-banner img{width:38px;height:38px;border-radius:9px;flex:0 0 auto;object-fit:cover}
      .pwa-banner .pwa-txt{flex:1;font-size:13px;line-height:1.35}
      .pwa-banner .pwa-txt b{display:block;font-size:14px;margin-bottom:2px}
      .pwa-banner .pwa-inst{background:#31b96e;color:#0b0c0f;border:0;border-radius:9px;padding:8px 14px;font-weight:800;cursor:pointer;font-size:13px}
      .pwa-banner .pwa-x{background:transparent;border:0;color:#9aa0aa;font-size:20px;cursor:pointer;line-height:1;padding:2px 6px}`;
    document.head.appendChild(s);
  }

  /* Android/Chrome: banner com botão "Instalar" de verdade */
  let promptEvt = null;
  window.addEventListener('beforeinstallprompt', ev => {
    ev.preventDefault();
    promptEvt = ev;
    if(jaDispensou() || estaInstalado() || !document.body) return;
    estiloBanner();
    document.body.appendChild(b);
    b.querySelector('.pwa-inst').addEventListener('click', async () => {
      b.remove();
      if(promptEvt){ promptEvt.prompt(); try{ await promptEvt.userChoice; }catch(e){} promptEvt = null; }
    });
    b.querySelector('.pwa-x').addEventListener('click', () => { marcarDispensa(); b.remove(); });
  });
  window.addEventListener('appinstalled', marcarDispensa);

  /* Exposto pra outros banners da própria página (ex.: o banner de "adicionar
     à tela inicial" da home) poderem reaproveitar esse fluxo sem duplicar lógica. */
  window.instalarPWA = async function(){
    if(promptEvt){
      const evt = promptEvt; promptEvt = null;
      evt.prompt();
      try{ await evt.userChoice; }catch(e){}
      return true;
    }
    return false;
  };
  window.pwaEstaInstalado = estaInstalado;
  window.pwaEhIOS = function(){
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  };

  /* iOS (Safari): sem API de instalação — só uma dica curta, uma vez */
  const ua = navigator.userAgent || '';
  const ehIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  const ehSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if(ehIOS && ehSafari && !estaInstalado() && !jaDispensou()){
    window.addEventListener('load', () => setTimeout(() => {
      if(jaDispensou() || estaInstalado() || !document.body) return;
      estiloBanner();
      const b = document.createElement('div');
      b.className = 'pwa-banner';
      b.innerHTML = `<img src="/assets/favicon.png" alt="" onerror="this.remove()">
        <div class="pwa-txt"><b>Adicionar à Tela de Início</b>Abra o menu <b style="display:inline">Compartilhar</b> do Safari e escolha "Adicionar à Tela de Início".</div>
        <button class="pwa-x" type="button" aria-label="Fechar">✕</button>`;
      document.body.appendChild(b);
      b.querySelector('.pwa-x').addEventListener('click', () => { marcarDispensa(); b.remove(); });
    }, 2500));
  }
})();

/* ---------------------- utilidades ---------------------- */
function esc(str){ const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }
/* resolve caminho de imagem: URL absoluta (http) ou caminho absoluto (/) fica
   como está; nome de arquivo simples é relativo à pasta dada (ex.: '2026/'). */
function urlRecurso(v, base){
  v = String(v || '');
  if(/^https?:\/\//i.test(v) || v.charAt(0) === '/') return v;
  return (base || '') + v;
}
/* Poster de uma edição, resolvido de um jeito só para o site inteiro.

   O valor vem do banco (via EDICOES, do config gerado pela API) e pode ser:
     - URL absoluta (Supabase Storage) -> usada como está
     - nome de arquivo solto ("poster.jpg", legado) -> vira /ANO/arquivo
     - vazio -> devolve '' e quem chama mostra o placeholder

   Existe porque perfil, busca e home montavam "ANO/poster.jpg" na mão. Isso
   funcionava enquanto a imagem morava na pasta do ano; quando os posters
   foram para o bucket, essas telas passaram a apontar para arquivo que não
   existe mais — e, pior, prefixavam "/2026/" numa URL https:// completa. */
function posterDaEdicao(ano, valorConhecido){
  let p = String(valorConhecido || '').trim();
  if(!p){
    const e = (typeof EDICOES !== 'undefined' && Array.isArray(EDICOES))
      ? EDICOES.find(x => Number(x.ano) === Number(ano)) : null;
    p = (e && e.poster) ? String(e.poster).trim() : '';
  }
  if(!p) return '';
  return urlRecurso(p, `${BASE}${ano}/`);
}

/* ---------------------- <img> do poster, com nova tentativa ----------------------
   O poster mora no Supabase Storage — OUTRO domínio, portanto fora do alcance
   do service worker, que só cacheia o próprio site. Numa primeira visita a
   imagem não está em cache nenhum e depende inteiramente da rede daquele
   instante.

   O onerror antigo (`classList.remove('has-image')`) era DEFINITIVO: um único
   soluço de rede, um cold start do Storage, e o card da home ficava com o
   placeholder "Sem capa" até a pessoa recarregar a página na mão. Era esse o
   sintoma de "às vezes a capa não aparece no primeiro acesso" — o segundo
   acesso funcionava porque aí a imagem já estava no cache HTTP do navegador.

   Agora a falha é tratada como o que ela quase sempre é: temporária. Tentamos
   de novo algumas vezes, com espera crescente, e só depois disso desistimos e
   mostramos o placeholder. A última tentativa leva um parâmetro novo na URL
   para escapar de uma eventual resposta ruim que tenha ficado em cache. */
const POSTER_TENTATIVAS = 3;
function posterFalhou(img){
  const n = Number(img.dataset.tentativa || 0) + 1;
  img.dataset.tentativa = n;
  const url = img.dataset.poster || img.getAttribute('src') || '';
  if(n > POSTER_TENTATIVAS || !url){
    const box = img.closest('.poster-box') || img.closest('.sc-poster-wrap');
    if(box){ box.classList.remove('has-image'); box.classList.add('sem-poster'); }
    img.remove();
    return;
  }
  /* tira o src antes de repor: reatribuir o MESMO valor não dispara request nova */
  img.removeAttribute('src');
  const alvo = (n === POSTER_TENTATIVAS)
    ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'cc=' + Date.now()
    : url;
  setTimeout(() => { img.src = alvo; }, 400 * n);
}
/* o onerror é atributo inline (HTML montado como string), então precisa ser global */
window.posterFalhou = posterFalhou;

/* markup do <img> de poster — um lugar só, para todas as telas tratarem a
   falha do mesmo jeito. `url` vem do posterDaEdicao(); vazio devolve '' e
   quem chama mostra o placeholder. */
function htmlPoster(url, alt){
  if(!url) return '';
  return `<img src="${esc(url)}" alt="${esc(alt || '')}" decoding="async"`
       + ` data-poster="${esc(url)}" onerror="posterFalhou(this)">`;
}

/* Turmas que se apresentaram numa noite, sem repetir e na ordem de palco.
   Vira o texto de apoio dos cards de compartilhamento — antes ali ficava a
   frase genérica "turmas que se apresentaram na noite N do festival", que
   não dizia quais eram. */
function turmasDaNoite(n){
  const fonte = (typeof ND !== 'undefined' && ND) ? ND : {};
  const pecas = (fonte[n] && Array.isArray(fonte[n].pecas)) ? fonte[n].pecas : [];
  const vistas = [];
  pecas.forEach(p => {
    const t = String((p && p.turma) || '').trim();
    if(t && vistas.indexOf(t) < 0) vistas.push(t);
  });
  return vistas;
}
/* tema/mostra da edição — o "sobre.titulo" do ano */
function temaDaEdicao(ed){
  const e = ed || ((typeof ED !== 'undefined') ? ED : null);
  const t = (e && e.sobre && e.sobre.titulo) ? String(e.sobre.titulo).trim() : '';
  return t;
}

function media(arr){ return (!arr || !arr.length) ? null : arr.reduce((a,b)=>a+b,0)/arr.length; }

function corDaNota(r){
  if(r === null || r === undefined || r === '' || isNaN(r)) return null;
  const v = Math.round(parseFloat(r) * 10) / 10;
  if(v >= 9.0) return '#188a53';
  if(v >= 8.0) return '#31b96e';
  if(v >= 7.0) return '#f3ca4d';
  if(v >= 6.0) return '#e48135';
  return '#d93c3c';
}

function formatDuracao(ms){
  if(ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const days  = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins  = Math.floor((totalSec % 3600) / 60);
  const secs  = totalSec % 60;
  const pad = n => String(n).padStart(2, '0');
  return days > 0 ? `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}` : `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function tempoAtras(ts){
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if(mins < 1) return 'agora mesmo';
  if(mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if(hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs/24)}d`;
}

/* ---------------------- contexto da página ---------------------- */
const ED  = (typeof EDICAO !== 'undefined') ? EDICAO : null;
/* ANO vem do edicao.js do ano; na página compartilhada "Em breve" (que não
   carrega nenhum edicao.js) o ano chega pela URL, em PAGINA.ano */
const ANO = ED ? ED.ano : ((typeof PAGINA !== 'undefined' && PAGINA.ano) ? Number(PAGINA.ano) : null);
const CFG_EDICAO = ANO ? (EDICOES.find(e => e.ano === ANO) || { noites: 5 }) : null;
const NUM_NOITES = CFG_EDICAO ? CFG_EDICAO.noites : 5;
const EPS = (ED && ED.episodiosPorNoite) ? ED.episodiosPorNoite : 3;
const ND  = (typeof NOITES !== 'undefined') ? NOITES : {};

/* o nº de episódios pode variar por noite: vale o tamanho da lista de peças
   do noites/noite-N.js; noite sem peças cadastradas usa o episodiosPorNoite */
function epsDaNoite(s){
  const nd = ND[s];
  return (nd && Array.isArray(nd.pecas) && nd.pecas.length) ? nd.pecas.length : EPS;
}
let MAX_EPS = EPS;
for(let _s = 1; _s <= NUM_NOITES; _s++) MAX_EPS = Math.max(MAX_EPS, epsDaNoite(_s));

function dataNoite(n){ return (ND[n] && ND[n].data) ? new Date(ND[n].data) : null; }
const INICIO      = (ED && ED.inicio)     ? new Date(ED.inicio)     : null;
const FIM_VOTACAO = (ED && ED.fimVotacao) ? new Date(ED.fimVotacao) : null;

/* ---------------------- horário oficial (servidor) ----------------------
   O relógio do visitante pode estar errado (ou alterado de propósito).
   O site só libera a votação depois de receber o horário do servidor
   (vem junto na resposta do fetchVotos). */
let serverTimeOffset = null;
let serverSaysClosed = false;
function agora(){ return serverTimeOffset === null ? new Date() : new Date(Date.now() + serverTimeOffset); }
function horarioSincronizado(){ return serverTimeOffset !== null; }

function inicioEdicao(){ return INICIO || dataNoite(1); }
function edicaoComecou(){ const d = inicioEdicao(); return d ? agora() >= d : true; }
function noiteLiberada(n){ const d = dataNoite(n); return d ? agora() >= d : true; }
function votacaoEncerrada(){ return serverSaysClosed || (FIM_VOTACAO && agora() >= FIM_VOTACAO); }
function podeVotar(){ return horarioSincronizado() && edicaoComecou() && !votacaoEncerrada(); }

/* ---------------------- janela do bolão ----------------------
   Vem pronta do servidor (config.js pro menu, edicao.js pra página do ano),
   porque quem sabe a hora da Noite 1 e o que o painel configurou é o banco:

     abre   junto com o Monte o Seu
     fecha  no horário da Noite 1 — daí em diante ninguém edita palpite
     some   1 dia depois do fim da votação (sai do menu, mas a URL continua
            servindo de histórico do ano)

   `cfgEd` é um item do EDICOES (menu) ou o próprio EDICAO (página do ano). */
function estadoBolaoDe(cfgEd){
  const b = cfgEd && cfgEd.bolao;
  if(!b) return { existe:false };
  const abre  = b.abreEm  ? new Date(b.abreEm)  : null;
  const fecha = b.fechaEm ? new Date(b.fechaEm) : null;
  const some  = b.someEm  ? new Date(b.someEm)  : null;
  const n = agora();
  const liberado = !abre || isNaN(abre) || n >= abre;
  const fechado  = !!(fecha && !isNaN(fecha) && n >= fecha);
  return {
    existe: true, abre, fecha, some, regras: b.regras || '',
    liberado,
    aberto: liberado && !fechado,     // dá pra palpitar agora
    fechado,                          // palpite travado, placar rolando
    sumiu: !!(some && !isNaN(some) && n >= some)
  };
}
/* estado do bolão DESTA página de edição */
function estadoBolao(){ return estadoBolaoDe(ED); }
/* a edição em destaque é a que manda no link do menu lateral */
function edicaoDestaque(){
  if(typeof EDICOES === 'undefined' || typeof EDICAO_EM_DESTAQUE === 'undefined') return null;
  return EDICOES.find(e => e.ano === EDICAO_EM_DESTAQUE) || null;
}

function fmtData(d){
  return d ? d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
}
function cabecalhoNoite(n){
  return noiteLiberada(n) ? `S${n}` : `S${n} <span class="lock-icon" title="Libera em ${fmtData(dataNoite(n))}">🔒</span>`;
}

/* ---------------------- votos (planilha) ---------------------- */
let submissions = [];

async function fetchVotos(){
  if(!ANO || !API_URL || API_URL.startsWith('COLE_AQUI')) return;
  try{
    /* cache:'no-store' + parâmetro _ : garante que o navegador/Google não
       devolva uma resposta velha em cache (senão o site "não atualiza") */
    const res  = await fetch(API_URL + '?year=' + ANO + '&_=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    if(Array.isArray(data)){
      submissions = filtrarVotosDoAno(data, ANO);
    } else {
      submissions = filtrarVotosDoAno(data.submissions, ANO);
      if(typeof data.serverNow === 'number') serverTimeOffset = data.serverNow - Date.now();
      serverSaysClosed = !!data.votingClosed;
    }
    salvarCacheVotos(ANO, submissions);   // regrava o cache SWR com o que veio da rede
  }catch(e){ console.error('Falha ao carregar avaliações', e); }
}

/* payload agregado do acervo inteiro (edições + peças + votos de todos os
   anos + bolaoWins), a mesma rota que o Hall usa (`?hall=1`). Cacheado em
   memória pela duração da página — a Home e o Hall podem chamar mais de
   uma vez sem duplicar o hit de rede. Ver comentário completo em `db.js`
   → `apiDadosHall`. */
let _acervoAgregadoCache = null;
async function carregarAcervoAgregado(){
  if(_acervoAgregadoCache) return _acervoAgregadoCache;
  const r = await fetch(API_URL + '?hall=1&_=' + Date.now(), { cache: 'no-store' });
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if(!j || j.ok === false) throw new Error((j && j.error) || 'acervo agregado falhou');
  _acervoAgregadoCache = j;
  return j;
}

/* id de uma avaliação. Vira também o id do post no feed social (`sub:<id>`),
   então precisa ser único de verdade — duas avaliações com o mesmo id
   compartilhariam as reações. `randomUUID` existe em todo navegador que o
   site já exige; o fallback cobre contexto sem HTTPS (dev local por IP). */
function idAvaliacao(){
  try{ if(crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); }catch(e){}
  return Date.now() + '-' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10);
}

async function postVoto(sub){
  if(!API_URL || API_URL.startsWith('COLE_AQUI')){
    alert('A planilha ainda não foi configurada (API_URL no config.js).');
    return;
  }
  /* anexa dono + token só quando a avaliação NÃO é anônima (sub.user preenchido).
     Anônima = sub.user vazio -> o servidor grava sem dono, não entra no perfil. */
  const sess = usuarioLogado();
  const payload = (sess && sub.user && sub.user === sess.user) ? { ...sub, token: sess.token } : { ...sub };
  try{
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS no Apps Script
      body: JSON.stringify(payload)
    });
  }catch(e){ console.error('Falha ao enviar avaliação', e); }
}

function valoresDaChave(key){
  return submissions.map(s => s.grid[key]).filter(v => v !== undefined && v !== null);
}

/* Cada voto pertence a UMA edição. Voto sem ano (linhas antigas da planilha)
   pertence ao ANO_VOTOS_ANTIGOS do config.js — nunca a todas as edições. */
const ANO_LEGADO = (typeof ANO_VOTOS_ANTIGOS !== 'undefined') ? ANO_VOTOS_ANTIGOS : 2026;
function filtrarVotosDoAno(lista, ano){
  return (lista || []).filter(s => (s.year ? Number(s.year) : ANO_LEGADO) === Number(ano));
}

/* ---- cache local dos votos (Stale-While-Revalidate) ----
   Guarda a última resposta boa da planilha, por ano, no localStorage. Assim a
   página pinta as notas na hora (mesmo offline) e a rede só atualiza por cima.
   IMPORTANTE: não afeta a trava de horário — votar continua bloqueado até o
   servidor confirmar o relógio (podeVotar() checa horarioSincronizado()). */
function cacheVotosKey(ano){ return 'cetec-votos-' + ano; }
function lerCacheVotos(ano){
  if(!ano) return null;
  try{ const v = JSON.parse(localStorage.getItem(cacheVotosKey(ano)) || 'null'); return Array.isArray(v) ? v : null; }
  catch(e){ return null; }
}
function salvarCacheVotos(ano, lista){
  if(!ano || !Array.isArray(lista)) return;
  try{ localStorage.setItem(cacheVotosKey(ano), JSON.stringify(lista)); }catch(e){}
}
/* pinta a última versão conhecida antes mesmo de a rede responder */
if(typeof ANO !== 'undefined' && ANO){ const _cacheVotos = lerCacheVotos(ANO); if(_cacheVotos) submissions = _cacheVotos; }

/* ---- pôster do "Monte o Seu" no IndexedDB ----
   Capas enviadas pela pessoa NÃO vão mais como base64 gigante no localStorage
   (estourava a cota). Ficam aqui, que tem cota bem maior, já reduzidas. */
function idbAbrir(){
  return new Promise((res, rej) => {
    const req = indexedDB.open('cetecritic', 1);
    req.onupgradeneeded = () => { const db = req.result; if(!db.objectStoreNames.contains('posters')) db.createObjectStore('posters'); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbSalvarPoster(chave, dataUrl){
  try{ const db = await idbAbrir(); return await new Promise((res, rej) => { const tx = db.transaction('posters', 'readwrite'); tx.objectStore('posters').put(dataUrl, chave); tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); }); }
  catch(e){ return false; }
}
async function idbLerPoster(chave){
  try{ const db = await idbAbrir(); return await new Promise((res) => { const tx = db.transaction('posters', 'readonly'); const rq = tx.objectStore('posters').get(chave); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); }
  catch(e){ return null; }
}
async function idbApagarPoster(chave){
  try{ const db = await idbAbrir(); return await new Promise((res) => { const tx = db.transaction('posters', 'readwrite'); tx.objectStore('posters').delete(chave); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); }
  catch(e){ return false; }
}
/* reduz a imagem enviada para no máx. `maxLargura`px — de vários MB para
   poucas centenas de KB, sem estourar cota nem travar o navegador.

   Três cuidados que faltavam e é onde a qualidade estava indo embora:
   1. limitava só a LARGURA — uma foto em pé passava com 4000px de altura
      (ou, ao contrário, era espremida à toa);
   2. reduzia de uma vez só: cair de 4000px para 700px num único drawImage
      serrilha a imagem, porque o filtro do navegador só amostra 2x2;
   3. gravava sempre em JPEG. WebP na mesma qualidade percebida ocupa perto
      da metade, então dá pra guardar MAIS pixels no mesmo espaço.
   `createImageBitmap` ainda resolve a orientação EXIF: foto de celular
   deitada não chega mais girada. */
async function reduzirImagem(file, maxLado, qualidade){
  const maxL = Number(maxLado) || 1400;
  const q = (qualidade === undefined) ? 0.86 : qualidade;

  const dataUrlOriginal = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = () => rej(reader.error || new Error('leitura falhou'));
    reader.readAsDataURL(file);
  });

  /* fonte: bitmap (respeita EXIF) com fallback pra <img> em navegador antigo */
  let fonte = null, largura = 0, altura = 0;
  try{
    if(typeof createImageBitmap === 'function'){
      fonte = await createImageBitmap(file, { imageOrientation: 'from-image' });
      largura = fonte.width; altura = fonte.height;
    }
  }catch(e){ fonte = null; }
  if(!fonte){
    fonte = await new Promise(res => {
      const im = new Image();
      im.onload = () => res(im.naturalWidth ? im : null);
      im.onerror = () => res(null);
      im.src = dataUrlOriginal;
    });
    if(!fonte) return dataUrlOriginal;
    largura = fonte.naturalWidth; altura = fonte.naturalHeight;
  }
  if(!largura || !altura) return dataUrlOriginal;

  try{
    const escala = Math.min(1, maxL / Math.max(largura, altura));   // limita os DOIS lados
    const w = Math.max(1, Math.round(largura * escala));
    const h = Math.max(1, Math.round(altura * escala));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    if(!ctx) return dataUrlOriginal;
    desenharSuave(ctx, fonte, 0, 0, largura, altura, 0, 0, w, h);   // downscale em etapas

    let out = '';
    try{
      out = cv.toDataURL('image/webp', q);
      if(out.indexOf('data:image/webp') !== 0) out = '';
    }catch(e){ out = ''; }
    if(!out) out = cv.toDataURL('image/jpeg', q);
    /* se a "compressão" engordou o arquivo (PNG pequeno, imagem já enxuta),
       o original é melhor negócio */
    return (out && out.length < dataUrlOriginal.length) ? out : dataUrlOriginal;
  }catch(e){
    return dataUrlOriginal;
  }finally{
    if(fonte && typeof fonte.close === 'function') fonte.close();   // libera o bitmap
  }
}

/* =====================================================================
   CONTAS (login simples) — sessão no navegador + API na planilha
   =====================================================================
   Segurança propositalmente leve (é festival de escola): a senha é
   guardada com hash no servidor e a sessão vive num token. Ainda assim,
   avise para NÃO reusar uma senha importante. */
const SESSAO_KEY = 'cetec-sessao';
function usuarioLogado(){
  try{ const s = JSON.parse(localStorage.getItem(SESSAO_KEY) || 'null'); return (s && s.user && s.token) ? s : null; }
  catch(e){ return null; }
}
function salvarSessao(user, token, admin){ localStorage.setItem(SESSAO_KEY, JSON.stringify({ user, token, admin: !!admin })); }
/* atualiza só o flag de admin da sessão (usado quando o meuPerfil confirma) */
function marcarSessaoAdmin(admin){
  const s = usuarioLogado(); if(!s) return;
  s.admin = !!admin; try{ localStorage.setItem(SESSAO_KEY, JSON.stringify(s)); }catch(e){}
}
function sairSessao(){ localStorage.removeItem(SESSAO_KEY); }

async function apiPost(payload){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: sem preflight CORS
    body: JSON.stringify(payload)
  });
  return await res.json();
}
/* rótulo do aparelho atual, pra você reconhecer as sessões (ex.: "Chrome · Windows") */
function descreverDispositivo(){
  const ua = navigator.userAgent || '';
  let so = 'Dispositivo';
  if(/Android/i.test(ua)) so = 'Android';
  else if(/iPhone|iPad|iPod/i.test(ua)) so = 'iPhone/iPad';
  else if(/Windows/i.test(ua)) so = 'Windows';
  else if(/Macintosh|Mac OS/i.test(ua)) so = 'Mac';
  else if(/Linux/i.test(ua)) so = 'Linux';
  let nav = 'Navegador';
  if(/Edg/i.test(ua)) nav = 'Edge';
  else if(/OPR|Opera/i.test(ua)) nav = 'Opera';
  else if(/Chrome|CriOS/i.test(ua)) nav = 'Chrome';
  else if(/Firefox|FxiOS/i.test(ua)) nav = 'Firefox';
  else if(/Safari/i.test(ua)) nav = 'Safari';
  const app = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? ' (app)' : '';
  return nav + ' · ' + so + app;
}
async function apiRegistrar(user, senha, email){ return apiPost({ action:'registrar', user, senha, email, dispositivo: descreverDispositivo() }); }
async function apiLogin(user, senha){ return apiPost({ action:'login', user, senha, dispositivo: descreverDispositivo() }); }
async function apiLogin2fa(user, code){ return apiPost({ action:'login2fa', user, code, dispositivo: descreverDispositivo() }); }

/* botão "reenviar": nasce oculto; ao chamar isto ele aparece grayed com um
   timer de 90s e só fica clicável no fim. Ao clicar, reenvia e reinicia o timer. */
function iniciarTimerReenvio(btn, aoReenviar, segundos){
  if(!btn) return;
  if(btn._timer){ clearTimeout(btn._timer); btn._timer = null; }
  btn.style.display = '';
  btn.disabled = true;
  let seg = segundos || 90;
  const tick = () => {
    if(seg <= 0){ btn.disabled = false; btn.textContent = 'Reenviar código'; return; }
    const m = Math.floor(seg / 60), s = seg % 60;
    btn.textContent = 'Reenviar em ' + m + ':' + String(s).padStart(2, '0');
    seg--; btn._timer = setTimeout(tick, 1000);
  };
  tick();
  btn.onclick = async () => {
    if(btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Reenviando…';
    try{ await aoReenviar(); }catch(e){}
    iniciarTimerReenvio(btn, aoReenviar, segundos);   // reinicia o timer
  };
}
async function apiListarSessoes(){ const s = usuarioLogado(); if(!s) return { ok:false, sessoes:[] }; return apiPost({ action:'listarSessoes', user:s.user, token:s.token }); }
async function apiRevogarSessao(id){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'revogarSessao', user:s.user, token:s.token, id }); }
async function apiLogout(){ const s = usuarioLogado(); if(!s) return { ok:true }; return apiPost({ action:'logout', user:s.user, token:s.token }); }
async function apiEnviarPalpite(year, palpites){
  const s = usuarioLogado();
  if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'palpite', user:s.user, token:s.token, year, palpites });
}
/* ---- BOLÃO ---------------------------------------------------------
   Pontuação linear, 0 a 5 por peça. Esta cópia existe só pra desenhar a
   tabela de regras e a comparação na tela — a conta que VALE é a do
   servidor, que é quem monta o placar. As faixas precisam bater com as do
   api/db.js (BOLAO_FAIXAS).

   O epsilon é porque 7,6 - 7,5 dá 0.10000000000000053 em ponto flutuante. */
const BOLAO_FAIXAS = [
  { ate: 0.1, pts: 5 },
  { ate: 0.6, pts: 4 },
  { ate: 1.2, pts: 3 },
  { ate: 1.8, pts: 2 },
  { ate: 3.0, pts: 1 }
];
const BOLAO_PONTOS_MAX = 5;
function pontosBolao(palpite, real){
  const p = Number(palpite), r = Number(real);
  if(!isFinite(p) || !isFinite(r)) return 0;
  const d = Math.abs(p - r);
  for(const f of BOLAO_FAIXAS){ if(d <= f.ate + 1e-9) return f.pts; }
  return 0;
}

/* placar público de um ano (só ranking — o servidor nunca devolve palpite de
   terceiro). Cacheado por ano: o perfil e o hall pedem os mesmos anos. */
const _placarCache = new Map();
async function fetchPlacarBolao(year, forcar){
  const y = Number(year);
  if(!forcar && _placarCache.has(y)) return _placarCache.get(y);
  const p = (async () => {
    try{
      const r = await fetch(API_URL + '?bolao=' + y + '&_=' + Date.now(), { cache:'no-store' });
      const j = await r.json();
      if(!j || j.ok === false) return null;
      return { estado: j.estado || {}, placar: Array.isArray(j.placar) ? j.placar : [], pecasApuradas: j.pecasApuradas || 0 };
    }catch(e){ return null; }
  })();
  _placarCache.set(y, p);
  return p;
}

/* o SEU palpite daquele ano, com as médias reais e os pontos já calculados.
   Exige token — é o que permite a comparação peça a peça no perfil sem
   expor o palpite de ninguém. */
async function fetchMeuPalpite(year){
  const s = usuarioLogado();
  if(!s) return null;
  try{
    const url = API_URL + '?palpites=' + Number(year)
      + '&user=' + encodeURIComponent(s.user)
      + '&token=' + encodeURIComponent(s.token) + '&_=' + Date.now();
    const r = await fetch(url, { cache:'no-store' });
    const j = await r.json();
    return (j && j.ok) ? j : null;
  }catch(e){ return null; }
}

/* ---- APIs sociais (perfil / visitas / carimbos) ---- */
async function apiSalvarPerfil(perfil){
  const s = usuarioLogado(); if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'perfil', user:s.user, token:s.token, perfil });
}
async function apiRegistrarVisita(alvo){
  const s = usuarioLogado(); if(!s) return { ok:false };
  return apiPost({ action:'visita', user:s.user, token:s.token, alvo });
}
async function apiCarimbar(alvo, tipo){
  const s = usuarioLogado(); if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'carimbo', user:s.user, token:s.token, alvo, tipo });
}
/* reputação (karma): valor = 1 (👍), -1 (👎) ou 0 (tira o voto) */
async function apiVotarReputacao(alvo, valor){
  const s = usuarioLogado(); if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'reputacao', user:s.user, token:s.token, alvo, valor });
}
async function fetchPerfilPublico(user, por){
  try{
    let extra = por ? '&por=' + encodeURIComponent(por) : '';
    /* perfil privado agora só volta completo pro DONO: quando o alvo é a
       própria conta logada, mandamos o token junto pra provar isso. */
    const s = usuarioLogado();
    if(s && String(user || '').trim().toLowerCase() === s.user.trim().toLowerCase()){
      extra = '&por=' + encodeURIComponent(s.user) + '&token=' + encodeURIComponent(s.token);
    }
    const r = await fetch(API_URL + '?perfil=' + encodeURIComponent(user) + extra + '&_=' + Date.now(), { cache:'no-store' });
    return await r.json();
  }catch(e){ return null; }
}
/* ranking de reputação (todos os perfis, do maior para o menor) */
async function fetchRankingReputacao(){
  try{
    const r = await fetch(API_URL + '?ranking=reputacao&_=' + Date.now(), { cache:'no-store' });
    const j = await r.json();
    return (j && Array.isArray(j.ranking)) ? j.ranking : [];
  }catch(e){ return []; }
}

/* ---- APIs novas: perfil próprio, excluir conta, usuários, reset, push ---- */
async function apiMeuPerfil(){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'meuPerfil', user:s.user, token:s.token }); }
/* troca de nome obrigatória (só funciona se o admin marcou nome_bloqueado) */
/* reações nos posts do feed — mesma tabela de carimbos, com `alvo` = id do post.
   tipo null tira a reação (o botão liga e desliga). */
/* apaga a própria avaliação (o servidor confere a posse pelo token) */
async function apiApagarAvaliacao(id){
  const s = usuarioLogado(); if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'apagarAvaliacao', user:s.user, token:s.token, id });
}
async function apiReagir(postId, tipo, autor){
  const s = usuarioLogado(); if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'reagir', user:s.user, token:s.token, postId, tipo, autor });
}
/* atividade pública da comunidade — alimenta a aba Social > Geral */
async function fetchAtividade(){
  try{
    const r = await fetch(API_URL + '?atividade=1&_=' + Date.now(), { cache:'no-store' });
    const j = await r.json();
    return (j && j.atividade) || [];
  }catch(e){ return []; }
}
async function fetchReacoes(ids, por){
  if(!ids || !ids.length) return {};
  try{
    const extra = por ? '&por=' + encodeURIComponent(por) : '';
    const url = API_URL + '?reacoes=' + encodeURIComponent(ids.join(',')) + extra + '&_=' + Date.now();
    const r = await fetch(url, { cache:'no-store' });
    const j = await r.json();
    return (j && j.reacoes) || {};
  }catch(e){ return {}; }
}
async function apiTrocarNome(novoNome){
  const s = usuarioLogado(); if(!s) return { ok:false, error:'faça login' };
  return apiPost({ action:'trocarNome', user:s.user, token:s.token, novoNome, dispositivo: descreverDispositivo() });
}
async function apiDeletarConta(){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'deletarConta', user:s.user, token:s.token }); }
async function apiPedirReset(conta){ return apiPost({ action:'pedirReset', conta }); }
async function apiRedefinirSenha(user, token, novaSenha){ return apiPost({ action:'redefinirSenha', user, token, novaSenha, dispositivo: descreverDispositivo() }); }
/* lista de TODOS os usuários (já com anônimo/privado aplicados no servidor).
   Volta [] se o endpoint ainda não existir (antes do redeploy da Fase 2). */
async function fetchUsuarios(){
  try{
    const r = await fetch(API_URL + '?usuarios=1&_=' + Date.now(), { cache:'no-store' });
    const j = await r.json();
    return (j && Array.isArray(j.usuarios)) ? j.usuarios : [];
  }catch(e){ return []; }
}
async function apiSalvarPush(sub){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'salvarPush', user:s.user, token:s.token, sub }); }
async function apiRemoverPush(endpoint){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'removerPush', user:s.user, token:s.token, endpoint }); }

/* ---- central de notificações: toda notificação push enviada também fica
   guardada aqui, pra quem não viu (ou desativou o push) ver depois no site ---- */
async function apiListarNotificacoes(){ const s = usuarioLogado(); if(!s) return { ok:false, notificacoes:[] }; return apiPost({ action:'listarNotificacoes', user:s.user, token:s.token }); }
async function apiContarNotifNaoLidas(){ const s = usuarioLogado(); if(!s) return { ok:false, total:0 }; return apiPost({ action:'contarNotifNaoLidas', user:s.user, token:s.token }); }
async function apiMarcarNotifLidas(ids){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'marcarNotifLidas', user:s.user, token:s.token, ids }); }
/* o próprio usuário cria uma notificação pra si (badges, noites, votação, edições,
   resultado do bolão — detectados no navegador). O servidor não duplica pelo id. */
async function apiCriarNotif(tipo, id, titulo, corpo, url){ const s = usuarioLogado(); if(!s) return { ok:false }; return apiPost({ action:'criarNotif', user:s.user, token:s.token, tipo, id, titulo, corpo, url }); }

/* ---- Push (F2): inscrição no navegador via VAPID ----
   A chave PÚBLICA fica no config.js (VAPID_PUBLIC_KEY). A privada vive só no Vercel.
   Fallback abaixo só pra não quebrar caso um config.js antigo (em cache) não a tenha. */
if(typeof VAPID_PUBLIC_KEY === 'undefined'){
  window.VAPID_PUBLIC_KEY = 'BHHyvYlbob5Jvt8h_7g8H96uT8eqFH1QlPo-jUNfY_R9fCVOnKh0VKQvvwarizc5EgpyfPbUOPff46DAchJkZBQ';
}
function urlBase64ParaUint8(base64){
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64); const arr = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function ativarPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return { ok:false, error:'Seu navegador não suporta notificações push.' };
  let perm;
  try{ perm = await Notification.requestPermission(); }catch(e){ perm = Notification.permission; }
  if(perm !== 'granted') return { ok:false, error:'Permissão de notificação negada.' };
  try{
    const reg = await navigator.serviceWorker.ready;
    const alvoKey = urlBase64ParaUint8(VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    /* Se já existe uma inscrição, mas foi feita com OUTRA chave VAPID (ex.: você
       trocou o par de chaves), ela nunca vai receber push (o serviço recusa).
       Nesse caso a gente descarta a antiga e cria uma nova com a chave atual. */
    if(sub){
      const atual = (sub.options && sub.options.applicationServerKey)
        ? new Uint8Array(sub.options.applicationServerKey) : null;
      const mesmaChave = atual && atual.length === alvoKey.length && atual.every((b, i) => b === alvoKey[i]);
      if(!mesmaChave){
        try{ await apiRemoverPush(sub.endpoint); }catch(e){}
        try{ await sub.unsubscribe(); }catch(e){}
        sub = null;
      }
    }
    if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: alvoKey });
    const r = await apiSalvarPush(sub.toJSON());
    return (r && r.ok) ? { ok:true } : { ok:false, error:(r && r.error) || 'não foi possível registrar' };
  }catch(e){ return { ok:false, error:'não foi possível ativar (' + (e && e.message ? e.message : 'erro') + ')' }; }
}
async function desativarPush(){
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub){ const ep = sub.endpoint; await sub.unsubscribe(); await apiRemoverPush(ep); }
  }catch(e){}
  return { ok:true };
}

/* ---- configuração do perfil (perfil.js, carregado só na perfil.html) ----
   Tudo que dá pra ajustar sem mexer aqui fica no perfil.js. Se ele não
   estiver carregado (outras páginas), vale o padrão abaixo. */
const PERFIL_CFG = (typeof PERFIL !== 'undefined') ? PERFIL : {};
const PERFIL_METAS = PERFIL_CFG.metas || {};
function metaPerfil(chave, padrao){ return (PERFIL_METAS[chave] !== undefined) ? PERFIL_METAS[chave] : padrao; }

/* ---- nível por XP ---- */
const XP_POR_EPISODIO = PERFIL_CFG.xpPorEpisodio || 20;
const XP_POR_NIVEL = PERFIL_CFG.xpPorNivel || 100;
const BADGES_PREVIEW = PERFIL_CFG.badgesPreview || 3;
function nivelInfo(numEpisodios){
  const xp = numEpisodios * XP_POR_EPISODIO;
  const nivel = Math.floor(xp / XP_POR_NIVEL) + 1;
  const noNivel = xp % XP_POR_NIVEL;
  return { xp, nivel, noNivel, faltamXp: XP_POR_NIVEL - noNivel, pct: XP_POR_NIVEL ? (noNivel / XP_POR_NIVEL) * 100 : 0 };
}

/* ---- reputação (karma) + títulos — configurável no perfil.js ---- */
const REP_TITULOS = (() => {
  const t = (PERFIL_CFG.reputacao && Array.isArray(PERFIL_CFG.reputacao.titulos) && PERFIL_CFG.reputacao.titulos.length)
    ? PERFIL_CFG.reputacao.titulos.slice()
    : [
        { min: -10, emoji: '🃏', nome: 'Figurante' },
        { min:   0, emoji: '🎟️', nome: 'Fã' },
        { min:   3, emoji: '🍿', nome: 'Plateia Fiel' },
        { min:   8, emoji: '✍️', nome: 'Crítico Iniciante' },
        { min:  15, emoji: '🎭', nome: 'Roteirista' },
        { min:  25, emoji: '🎬', nome: 'Cineasta' },
        { min:  35, emoji: '🏆', nome: 'Diretor Premiado' },
        { min:  50, emoji: '👑', nome: 'Chefe da Indústria' }
      ];
  return t.sort((a, b) => Number(a.min) - Number(b.min));
})();
/* dado um valor de reputação, devolve o título atual e o próximo (p/ "faltam X") */
function tituloPorReputacao(rep){
  let atual = REP_TITULOS[0] || null;
  REP_TITULOS.forEach(t => { if(rep >= Number(t.min)) atual = t; });
  const prox = REP_TITULOS.find(t => Number(t.min) > rep) || null;
  return { atual, prox };
}

/* ---- carimbos pré-definidos (visual + explicação) — editáveis no perfil.js.
   Lembre: o TIPO/chave também precisa existir no CARIMBOS_VALIDOS do Apps Script. */
/* O ❤️ Curtida é a reação simples e padrão dos posts do feed, e vale também
   como carimbo de perfil — é um vocabulário só nos dois lugares.
   Merge (e não `||`) de propósito: se o admin tiver personalizado os carimbos
   no config, os tipos padrão continuam existindo em vez de sumirem. */
const CARIMBOS = Object.assign({
  curtida:  { emoji:'❤️', nome:'Curtida',     desc:'Curtiu — a reação simples.' },
  joia:     { emoji:'💎', nome:'Joia',        desc:'Curtiu o perfil e as avaliações dessa pessoa.' },
  palmas:   { emoji:'👏', nome:'Palmas',      desc:'Reconhecimento pelas boas avaliações.' },
  critico:  { emoji:'🧐', nome:'Bom crítico', desc:'Acha que a pessoa avalia com critério.' },
  parceiro: { emoji:'🤝', nome:'Parceiro',    desc:'Um agrado de quem acompanha o festival junto.' },
  concordo: { emoji:'✅', nome:'Concordo',     desc:'Costuma concordar com as notas dessa pessoa.' },
  discordo: { emoji:'❌', nome:'Discordo',     desc:'Discorda das notas dessa pessoa.' },
  polemico: { emoji:'🔥', nome:'Polêmico',     desc:'As opiniões dessa pessoa dão o que falar.' },
  lenda:    { emoji:'👑', nome:'Lenda',        desc:'Respeito máximo pela dedicação ao acervo.' }
}, PERFIL_CFG.carimbos || {});

/* ---- afinidade de gosto: baseada nas notas das MESMAS peças ---- */
function afinidadeGosto(subsA, subsB){
  const mapa = lista => {
    const m = {};
    (lista || []).forEach(s => { const y = s.year; Object.keys(s.grid).forEach(k => { const v = Number(s.grid[k]); if(!isNaN(v)) m[y + '|' + k] = v; }); });
    return m;
  };
  const A = mapa(subsA), B = mapa(subsB);
  let soma = 0, n = 0;
  Object.keys(A).forEach(k => { if(B[k] !== undefined){ soma += Math.abs(A[k] - B[k]); n++; } });
  if(!n) return { pct: null, shared: 0, meanDiff: null };
  return { pct: Math.max(0, 100 * (1 - (soma / n) / NOTA_MAXIMA)), shared: n, meanDiff: soma / n };
}

/* =====================================================================
   LOGIN COM GOOGLE (Supabase Auth como provador de identidade)
   =====================================================================
   O supabase-js entra por import dinamico SO quando alguem clica no botao —
   assim nenhum dos ~60 HTMLs precisa de <script> novo e quem nao usa Google
   nao baixa a biblioteca.

   Coloque no config.js:
     const SUPABASE_URL = 'https://xxxx.supabase.co';
     const SUPABASE_ANON_KEY = 'sb_publishable_...';   // chave PUBLICA, pode ficar no cliente */
const SB_URL  = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : 'https://hytmomrbovixmixgczdq.supabase.co';
const SB_ANON = (typeof SUPABASE_ANON_KEY !== 'undefined') ? SUPABASE_ANON_KEY : 'sb_publishable_lb_jEyHC7e-A5gD7qf1ZCg_08vWbVQo';
const OAUTH_ATIVO = !!(SB_URL && SB_ANON);

let _sbCliente = null;
async function sbAuth(){
  if(_sbCliente) return _sbCliente;
  if(!OAUTH_ATIVO) return null;
  const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  _sbCliente = mod.createClient(SB_URL, SB_ANON, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  return _sbCliente;
}

async function apiLoginOAuth(accessToken){ return apiPost({ action:'loginOAuth', accessToken, dispositivo: descreverDispositivo() }); }
async function apiFinalizarOAuth(accessToken, user){ return apiPost({ action:'finalizarOAuth', accessToken, user, dispositivo: descreverDispositivo() }); }

/* dispara o fluxo: sai do site, volta em /index.html com a sessao do Supabase */
async function entrarComGoogle(){
  const sbc = await sbAuth();
  if(!sbc) throw new Error('login social nao configurado');
  const { error } = await sbc.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + BASE + 'index.html' }
  });
  if(error) throw error;
}

/* limpa a sessao do Supabase — a nossa sessao (localStorage) e outra coisa */
async function limparSessaoSupabase(){
  try{ const sbc = await sbAuth(); if(sbc) await sbc.auth.signOut(); }catch(e){}
}

/* Roda em TODA pagina: se voltamos de um redirect do Google, troca o token do
   Supabase por um token NOSSO. Se a pessoa ainda nao tem conta aqui, abre o
   modal na etapa de escolher nome de usuario. */
async function checarRetornoOAuth(){
  if(!OAUTH_ATIVO) return;
  if(usuarioLogado()) return;                                  /* ja logado aqui: nao mexe */
  const temCallback = /[?&]code=|access_token=/.test(location.search + location.hash);
  const pendente = sessionStorage.getItem('cetec-oauth-pendente') === '1';
  if(!temCallback && !pendente) return;                        /* pagina normal: nem carrega a lib */

  try{
    const sbc = await sbAuth();
    if(!sbc) return;
    const { data } = await sbc.auth.getSession();
    const tok = data && data.session && data.session.access_token;
    if(!tok){ sessionStorage.removeItem('cetec-oauth-pendente'); return; }

    const r = await apiLoginOAuth(tok);
    if(r && r.ok){
      sessionStorage.removeItem('cetec-oauth-pendente');
      salvarSessao(r.user, r.token, r.admin);
      await limparSessaoSupabase();
      history.replaceState(null, '', location.pathname);       /* tira o ?code= da barra */
      location.reload();
      return;
    }
    if(r && r.precisaNome){
      sessionStorage.setItem('cetec-oauth-pendente', '1');
      history.replaceState(null, '', location.pathname);
      abrirEscolhaNomeOAuth(tok, r.sugestao || '', r.email || '');
      return;
    }
    sessionStorage.removeItem('cetec-oauth-pendente');
    await limparSessaoSupabase();
    if(r && r.error) alert('Nao deu pra entrar com o Google:\n\n' + r.error);
  }catch(e){
    sessionStorage.removeItem('cetec-oauth-pendente');
  }
}

/* abre o modal de login ja na etapa "escolha seu nome de usuario" */
function abrirEscolhaNomeOAuth(accessToken, sugestao, email){
  const overlay = document.getElementById('loginModalOverlay');
  if(!overlay) return;
  const form = overlay.querySelector('.login-form');
  const w2fa = document.getElementById('login2faWrap');
  const wNome = document.getElementById('loginOauthWrap');
  if(!wNome) return;
  const titulo = document.getElementById('loginTitulo');
  if(titulo) titulo.textContent = 'Escolha seu nome';
  if(form) form.style.display = 'none';
  if(w2fa) w2fa.style.display = 'none';
  wNome.style.display = '';
  const cxEmail = document.getElementById('loginOauthEmail');
  if(cxEmail) cxEmail.textContent = email ? ('Conectado como ' + email) : '';
  const inp = document.getElementById('loginOauthNome');
  if(inp) inp.value = sugestao || '';
  overlay.classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => inp && inp.focus(), 60);

  const bt = document.getElementById('loginOauthSubmit');
  const err = document.getElementById('loginOauthErro');
  const tos = document.getElementById('loginOauthTos');
  if(!bt) return;
  bt.onclick = async () => {
    const nome = (inp && inp.value || '').trim();
    if(nome.length < 2){ err.textContent = 'Escolha um nome com pelo menos 2 caracteres.'; return; }
    if(!/^[A-Za-z0-9_.\- ]+$/.test(nome)){ err.textContent = 'Use so letras, numeros, espaco, ponto, hifen ou _.'; return; }
    if(tos && !tos.checked){ err.textContent = 'Marque a caixa dos Termos de Servico.'; return; }
    bt.disabled = true; err.textContent = '';
    const original = bt.textContent;
    bt.innerHTML = '<span class="spinner"></span>Criando...';
    try{
      const r = await apiFinalizarOAuth(accessToken, nome);
      if(r && r.ok){
        sessionStorage.removeItem('cetec-oauth-pendente');
        salvarSessao(r.user, r.token, r.admin);
        await limparSessaoSupabase();
        location.reload();
        return;
      }
      err.textContent = (r && r.error) ? r.error : 'Nao foi possivel criar a conta.';
    }catch(e){ err.textContent = 'Falha de conexao. Tente de novo.'; }
    bt.disabled = false; bt.textContent = original;
  };
  if(inp) inp.onkeydown = ev => { if(ev.key === 'Enter') bt.click(); };
}

function htmlModalLogin(){
  return `<div class="modal-overlay" id="loginModalOverlay">
    <div class="modal-card">
      <div class="modal-header"><h2 id="loginTitulo">Entrar</h2><button class="modal-close" id="loginModalClose">✕</button></div>
      <div class="modal-sub">Sua conta guarda suas avaliações no perfil, os badges e o bolão.</div>
      <div class="login-form">
        <label for="loginUser">Usuário</label>
        <input type="text" id="loginUser" maxlength="20" autocomplete="off" placeholder="ex: Maria">
        <label for="loginSenha">Senha</label>
        <input type="password" id="loginSenha" maxlength="60" placeholder="Mínimo 8 caracteres">
        <div id="loginSenha2Wrap" style="display:none;">
          <label for="loginSenha2">Repita a senha</label>
          <input type="password" id="loginSenha2" maxlength="60" placeholder="Digite a senha de novo">
        </div>
        <div id="loginEmailWrap" style="display:none;">
          <label for="loginEmail">E-mail (opcional)</label>
          <input type="email" id="loginEmail" maxlength="120" autocomplete="off" placeholder="Para recuperar a senha depois">
          <div class="login-seguranca" style="margin-top:4px;">Sem e-mail, não dá pra recuperar a senha se esquecer. Você pode adicionar ou trocar depois em Configurações.</div>
        </div>
        <div class="login-seguranca">🔒 Sua senha é criptografada - nem nós conseguimos vê-la.</div>
        <div id="loginTosWrap" style="display:none;">
          <label class="tos-check" id="loginTosLabel">
            <input type="checkbox" id="loginTos">
            <span>Declaro que concordo com os <a href="${BASE}termos.pdf" target="_blank" rel="noopener">Termos de Serviço</a> e sou maior de 13 anos.</span>
          </label>
        </div>
        <div class="login-erro" id="loginErro"></div>
        <button class="submit-btn" id="loginSubmit">Entrar</button>
        <div class="login-ou" id="loginOuWrap" style="display:none;"><span>ou</span></div>
        <button type="button" class="btn-google" id="loginGoogle" style="display:none;">
          <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
          Entrar com Google
        </button>
        <div class="login-toggle">
          <span id="loginToggleTxt">Ainda não tem conta?</span>
          <button type="button" id="loginToggleBtn">Criar conta</button>
        </div>
        <div class="login-toggle" id="loginEsqueci" style="display:flex; justify-content:space-between; gap:10px;">
          <button type="button" id="loginEsqueciBtn">Esqueci a senha</button>
          <button type="button" id="loginReenviarReset" style="display:none;">Reenviar link</button>
        </div>
      </div>
      <!-- etapa do login social: quem entra pelo Google sem conta escolhe um nome
           de usuario aqui, porque a identidade do site e o nome, nao o e-mail -->
      <div class="login-form" id="loginOauthWrap" style="display:none;">
        <div class="modal-sub">Falta so escolher como você vai aparecer no site. Esse nome fica nas suas avaliacoes, no ranking e no perfil.</div>
        <div class="login-seguranca" id="loginOauthEmail" style="margin-bottom:4px;"></div>
        <label for="loginOauthNome">Nome de usuario</label>
        <input type="text" id="loginOauthNome" maxlength="20" autocomplete="off" placeholder="ex: maria">
        <label class="tos-check">
          <input type="checkbox" id="loginOauthTos">
          <span>Declaro que concordo com os <a href="${BASE}termos.pdf" target="_blank" rel="noopener">Termos de Servico</a> e sou maior de 13 anos.</span>
        </label>
        <div class="login-erro" id="loginOauthErro"></div>
        <button class="submit-btn" id="loginOauthSubmit">Criar minha conta</button>
      </div>

      <div class="login-form" id="login2faWrap" style="display:none;">
        <div class="modal-sub">Enviamos um código de 6 dígitos pro seu e-mail. Ele é válido por 5 minutos.</div>
        <label for="login2faCode">Código de acesso</label>
        <input type="text" id="login2faCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" style="letter-spacing:8px; text-align:center; font-size:20px;">
        <div class="login-erro" id="login2faErro"></div>
        <button class="submit-btn" id="login2faSubmit">Confirmar código</button>
        <div class="login-toggle" style="display:flex; justify-content:space-between; gap:10px;">
          <button type="button" id="login2faVoltar">Voltar</button>
          <button type="button" id="login2faReenviar" style="display:none;">Reenviar código</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* liga os botões de conta (sidebar) e o modal de login. Chamado no montarShell. */
function wireLogin(){
  const overlay = document.getElementById('loginModalOverlay');
  if(!overlay) return;
  let modo = 'login'; // 'login' | 'registrar'

  const titulo = document.getElementById('loginTitulo');
  const submit = document.getElementById('loginSubmit');
  const toggleTxt = document.getElementById('loginToggleTxt');
  const toggleBtn = document.getElementById('loginToggleBtn');
  const erro = document.getElementById('loginErro');
  const inpUser = document.getElementById('loginUser');
  const inpSenha = document.getElementById('loginSenha');
  const inpSenha2 = document.getElementById('loginSenha2');
  const senha2Wrap = document.getElementById('loginSenha2Wrap');
  const inpEmail = document.getElementById('loginEmail');
  const emailWrap = document.getElementById('loginEmailWrap');
  /* etapa de 2FA (código por e-mail) */
  const formPrincipal = overlay.querySelector('.login-form');   // o primeiro .login-form = o formulário normal
  const wrap2fa = document.getElementById('login2faWrap');
  const inp2fa = document.getElementById('login2faCode');
  const erro2fa = document.getElementById('login2faErro');
  let pending2faUser = null, pending2faSenha = '';
  function mostrar2fa(u){
    pending2faUser = u; if(erro2fa) erro2fa.textContent = '';
    if(formPrincipal) formPrincipal.style.display = 'none';
    if(wrap2fa) wrap2fa.style.display = '';
    if(submit) submit.disabled = false;
    if(inp2fa){ inp2fa.value = ''; setTimeout(() => inp2fa.focus(), 60); }
    /* botão reenviar: aparece grayed com timer de 1:30 e reenvia o código */
    iniciarTimerReenvio(document.getElementById('login2faReenviar'), async () => {
      const rr = await apiLogin(pending2faUser, pending2faSenha);
      if(erro2fa) erro2fa.textContent = (rr && rr.need2fa) ? 'Novo código enviado ✓' : ((rr && rr.error) || 'Não foi possível reenviar.');
    });
  }
  function voltar2fa(){
    pending2faUser = null; pending2faSenha = '';
    const bR = document.getElementById('login2faReenviar'); if(bR){ if(bR._timer) clearTimeout(bR._timer); bR.style.display = 'none'; }
    if(wrap2fa) wrap2fa.style.display = 'none'; if(formPrincipal) formPrincipal.style.display = ''; aplicarModo();
  }

  function aplicarModo(){
    const ent = modo === 'login';
    titulo.textContent = ent ? 'Entrar' : 'Criar conta';
    submit.textContent = ent ? 'Entrar' : 'Criar conta';
    toggleTxt.textContent = ent ? 'Ainda não tem conta?' : 'Já tem conta?';
    toggleBtn.textContent = ent ? 'Criar conta' : 'Entrar';
    if(senha2Wrap) senha2Wrap.style.display = ent ? 'none' : 'block';   // "repita a senha" só ao criar conta
    if(inpSenha2) inpSenha2.value = '';
    if(emailWrap) emailWrap.style.display = ent ? 'none' : 'block';      // e-mail opcional só ao criar conta
    if(inpEmail && ent) inpEmail.value = '';
    if(wrap2fa) wrap2fa.style.display = 'none';                          // sempre volta pro formulário normal
    if(formPrincipal) formPrincipal.style.display = '';
    const esq = document.getElementById('loginEsqueci');
    if(esq) esq.style.display = ent ? 'flex' : 'none';   // "esqueci a senha" só no login
    const tosWrap = document.getElementById('loginTosWrap');
    const tosChk = document.getElementById('loginTos');
    if(tosWrap) tosWrap.style.display = ent ? 'none' : 'block';   // aceite do ToS só ao criar conta
    if(tosChk) tosChk.checked = false;
    const tosLabel = document.getElementById('loginTosLabel');
    if(tosLabel) tosLabel.classList.remove('tos-erro');
    erro.style.color = '';
    erro.textContent = '';
  }
  function abrir(){
    aplicarModo();
    overlay.classList.add('open');
    requestAnimationFrame(() => overlay.classList.add('show'));
    setTimeout(() => inpUser && inpUser.focus(), 60);
  }
  function fechar(){ fecharOverlay(overlay); }

  /* botao do Google: so aparece se o config.js tiver as chaves do Supabase */
  const btnGoogle = document.getElementById('loginGoogle');
  const ouWrap = document.getElementById('loginOuWrap');
  if(btnGoogle && OAUTH_ATIVO){
    btnGoogle.style.display = '';
    if(ouWrap) ouWrap.style.display = '';
    btnGoogle.addEventListener('click', async () => {
      btnGoogle.disabled = true;
      erro.textContent = '';
      try{
        sessionStorage.setItem('cetec-oauth-pendente', '1');
        await entrarComGoogle();                       /* redireciona pro Google */
      }catch(e){
        sessionStorage.removeItem('cetec-oauth-pendente');
        btnGoogle.disabled = false;
        erro.textContent = 'Erro ao abrir login do Google.';
      }
    });
  }

  const btnEntrar = document.getElementById('btnEntrar');
  if(btnEntrar) btnEntrar.addEventListener('click', abrir);
  const btnSair = document.getElementById('btnSair');
  if(btnSair) btnSair.addEventListener('click', async () => { try{ await apiLogout(); }catch(e){} await limparSessaoSupabase(); sairSessao(); location.reload(); });

  document.getElementById('loginModalClose').addEventListener('click', fechar);
  overlay.addEventListener('click', ev => { if(ev.target === overlay) fechar(); });
  toggleBtn.addEventListener('click', () => { modo = modo === 'login' ? 'registrar' : 'login'; aplicarModo(); });

  async function enviar(){
    const user = inpUser.value.trim();
    const senha = inpSenha.value;
    if(user.length < 2 || user.length > 20){ erro.textContent = 'Escolha um usuário de 2 a 20 caracteres.'; return; }
    if(senha.length < 8){ erro.textContent = 'A senha precisa de pelo menos 8 caracteres.'; return; }
    if(modo === 'registrar' && senha !== (inpSenha2 ? inpSenha2.value : senha)){
      erro.textContent = 'As senhas não são diferentes. Digite a mesma nos dois campos.'; return;
    }
    const tosChk = document.getElementById('loginTos');
    const tosLabel = document.getElementById('loginTosLabel');
    if(modo === 'registrar' && tosChk && !tosChk.checked){
      erro.textContent = 'Marque a caixa dos Termos de Serviço para criar sua conta.';
      if(tosLabel) tosLabel.classList.add('tos-erro');
      return;
    }
    if(tosLabel) tosLabel.classList.remove('tos-erro');
    const email = (modo === 'registrar' && inpEmail) ? inpEmail.value.trim() : '';
    if(email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ erro.textContent = 'E-mail inválido (ou deixe em branco).'; return; }
    submit.disabled = true;
    const original = submit.textContent;
    submit.innerHTML = '<span class="spinner"></span>Aguarde...';
    erro.textContent = '';
    try{
      const r = modo === 'login' ? await apiLogin(user, senha) : await apiRegistrar(user, senha, email);
      if(r && r.need2fa){ pending2faSenha = senha; mostrar2fa(r.user); return; }   // conta com 2FA: vai pra etapa do código
      if(r && r.ok){
        salvarSessao(r.user, r.token, r.admin);
        location.reload();
        return;
      }
      erro.textContent = (r && r.error) ? r.error : 'Não foi possível concluir. Tente de novo.';
    }catch(e){
      erro.textContent = 'Falha de conexão. Tente de novo.';
    }
    submit.disabled = false;
    submit.textContent = original;
  }
  submit.addEventListener('click', enviar);
  /* etapa 2FA: confirmar código / voltar */
  const btn2faVoltar = document.getElementById('login2faVoltar');
  if(btn2faVoltar) btn2faVoltar.addEventListener('click', voltar2fa);
  async function enviar2fa(){
    const code = (inp2fa.value || '').trim();
    if(code.length < 6){ erro2fa.textContent = 'Digite os 6 dígitos.'; return; }
    erro2fa.textContent = 'Verificando…';
    try{
      const r = await apiLogin2fa(pending2faUser, code);
      if(r && r.ok){ salvarSessao(r.user, r.token, r.admin); location.reload(); return; }
      erro2fa.textContent = (r && r.error) ? r.error : 'Código inválido.';
    }catch(e){ erro2fa.textContent = 'Falha de conexão. Tente de novo.'; }
  }
  const btn2faSubmit = document.getElementById('login2faSubmit');
  if(btn2faSubmit) btn2faSubmit.addEventListener('click', enviar2fa);
  if(inp2fa) inp2fa.addEventListener('keydown', ev => { if(ev.key === 'Enter') enviar2fa(); });
  const loginTosChk = document.getElementById('loginTos');
  if(loginTosChk) loginTosChk.addEventListener('change', () => {
    if(loginTosChk.checked){
      const tl = document.getElementById('loginTosLabel');
      if(tl) tl.classList.remove('tos-erro');
    }
  });
  inpSenha.addEventListener('keydown', ev => { if(ev.key === 'Enter') enviar(); });
  if(inpSenha2) inpSenha2.addEventListener('keydown', ev => { if(ev.key === 'Enter') enviar(); });
  const esqueciBtn = document.getElementById('loginEsqueciBtn');
  if(esqueciBtn) esqueciBtn.addEventListener('click', async () => {
    const conta = (inpUser.value.trim()) || (prompt('Digite seu usuário ou o e-mail cadastrado:') || '').trim();
    if(!conta){ return; }
    erro.style.color = 'var(--text-muted)';
    erro.textContent = 'Enviando…';
    try{
      const r = await apiPedirReset(conta);
      erro.textContent = (r && r.msg) ? r.msg : 'Se houver um e-mail cadastrado, enviamos o link.';
      /* botão reenviar: aparece grayed com timer de 1:30 e reenvia o link */
      iniciarTimerReenvio(document.getElementById('loginReenviarReset'), async () => {
        const rr = await apiPedirReset(conta);
        erro.style.color = 'var(--text-muted)';
        erro.textContent = (rr && rr.msg) ? rr.msg : 'Reenviado - confira seu e-mail.';
      });
    }catch(e){ erro.style.color = ''; erro.textContent = 'Falha de conexão. Tente de novo.'; }
  });
}

/* ---------------------- shell (sidebar + rodapé + modais) ---------------------- */
function htmlSidebar(){
  const _sessAdmin = !!(usuarioLogado() && usuarioLogado().admin);
  let h = `<div class="sidebar-logo">
    <a class="sidebar-logo-link" href="${BASE}index.html" title="Ir para o início">
      <img src="${BASE}assets/logo.png" alt="" onerror="this.style.display='none'">
      <span>CETEC<br>Critic</span>
    </a>
    <button class="nav-toggle" id="navToggle" aria-label="Abrir menu">☰</button>
    <div class="sidebar-quick">
      <a href="${BASE}perfil.html"${PAGINA.tipo === 'perfil' ? ' class="active"' : ''} title="Perfil" aria-label="Perfil">👤</a>
      <a href="${BASE}notificacoes.html" class="notif-link${PAGINA.tipo === 'notif' ? ' active' : ''}" title="Notificações" aria-label="Notificações">🔔<span class="notif-badge" id="notifBadgeQuick" style="display:none;"></span></a>
      <a href="${BASE}configuracoes.html"${PAGINA.tipo === 'config' ? ' class="active"' : ''} title="Configurações" aria-label="Configurações">⚙️</a>
      ${_sessAdmin ? `<a href="${BASE}admin.html" title="Painel admin" aria-label="Painel admin">💻</a>` : ''}
    </div>
  </div>
  <div class="sidebar-nav" id="sidebarNav">
  `;

  /* bloco de conta primeiro de tudo: "Entrar" ou o usuário logado (+ Sair) */
  const sess = usuarioLogado();
  if(sess){
    h += `<div class="nav-account">
      <a class="nav-link nav-parent nav-perfil${PAGINA.tipo === 'perfil' ? ' active' : ''}" href="${BASE}perfil.html"><span>👤 ${esc(sess.user)}</span></a>
      <button class="nav-link nav-sair" id="btnSair" type="button" title="Sair da conta">Sair</button>
    </div>
    <a class="nav-link nav-parent${PAGINA.tipo === 'notif' ? ' active' : ''}" href="${BASE}notificacoes.html">Notificações<span class="notif-badge" id="notifBadgeNav" style="display:none;"></span></a>`;
  } else {
    h += `<button class="nav-link nav-parent nav-entrar" id="btnEntrar" type="button">Entrar / Criar conta</button>`;
  }

  h += `
  <a class="nav-link nav-parent${PAGINA.tipo === 'home' ? ' active' : ''}" href="${BASE}index.html">Início</a>
  <button class="nav-link nav-parent" id="navMonte">Monte o Seu</button>
  <a class="nav-link nav-parent${PAGINA.tipo === 'busca' ? ' active' : ''}" href="${BASE}busca.html">Buscar</a>
  <a class="nav-link nav-parent${PAGINA.tipo === 'hall' ? ' active' : ''}" href="${BASE}hall.html">Hall da Fama</a>`;

  /* ---- Bolão (logo abaixo do Hall) ----
     Só aparece enquanto o bolão da edição em destaque está no ar: some 1 dia
     depois de as notas fecharem. A URL continua servindo — cada ano guarda o
     próprio bolão como sub-página, então dá pra rever 2024 quando quiser. */
  {
    const cfgD = edicaoDestaque();
    const eb = cfgD ? estadoBolaoDe(cfgD) : { existe:false };
    if(eb.existe && eb.liberado && !eb.sumiu){
      const ativo = (PAGINA.tipo === 'bolao' && ANO === cfgD.ano);
      const selo = eb.aberto ? '<span class="nav-selo">palpite aberto</span>' : '';
      h += `
  <a class="nav-link nav-parent nav-bolao${ativo ? ' active' : ''}" href="${BASE}${cfgD.ano}/bolao.html">🔮 Bolão${selo}</a>`;
    }
  }

  /* edição em foco: o ano da página atual ou, na home/hall, a edição em destaque.
     A década desse ano é a que começa aberta; as outras ficam recolhidas. */
  const anoFoco = ANO || (typeof EDICAO_EM_DESTAQUE !== 'undefined' ? EDICAO_EM_DESTAQUE : null);
  const decadaFoco = anoFoco ? Math.floor(anoFoco / 10) * 10 : null;

  /* agrupa as edições por década, preservando a ordem definida no config.js */
  const decadas = [];
  EDICOES.forEach(e => {
    const dec = Math.floor(e.ano / 10) * 10;
    let g = decadas.find(d => d.dec === dec);
    if(!g){ g = { dec, itens: [] }; decadas.push(g); }
    g.itens.push(e);
  });

  decadas.forEach(g => {
    const decAberta = g.dec === decadaFoco;
    let edicoesHtml = '';
    g.itens.forEach(e => {
      const aberto = e.ano === ANO;
      const p = `${BASE}${e.ano}/`;
      const at = cond => cond ? ' active' : '';

      /* edição "Em breve": link único para a página compartilhada — não
         depende de pasta nem de subpáginas (Sobre/Abertura/Noites) */
      if(e.emBreve){
        edicoesHtml += `<div class="nav-section">
          <a class="nav-link nav-parent nav-embreve${at(aberto)}" href="${BASE}em-breve.html?ano=${e.ano}">
            <span>Cetec Festival ${e.ano} <span class="nav-tag">em breve</span></span>
          </a>
        </div>`;
        return;
      }

      let filhos = `
        <a class="nav-link nav-child${at(aberto && (PAGINA.tipo === 'sobre' || PAGINA.tipo === 'abertura' || PAGINA.tipo === 'resumo'))}" href="${p}sobre.html">📋 Resumo Rápido</a>`;
      for(let n = 1; n <= e.noites; n++){
        filhos += `<a class="nav-link nav-child${at(aberto && PAGINA.tipo === 'noite' && PAGINA.noite === n)}" href="${p}noite-${n}.html">Noite ${n}</a>`;
      }
      edicoesHtml += `<div class="nav-section${aberto ? ' open' : ''}">
        <a class="nav-link nav-parent${at(aberto && (PAGINA.tipo === 'edicao' || PAGINA.tipo === 'monte'))}" href="${p}index.html">
          <span>Cetec Festival ${e.ano}</span><span class="nav-caret">▾</span>
        </a>
        <div class="nav-children">${filhos}</div>
      </div>`;
    });
    h += `<div class="nav-decade${decAberta ? ' open' : ''}">
      <button class="nav-link nav-parent nav-decade-head" type="button">
        <span>Anos ${g.dec}</span><span class="nav-caret">▾</span>
      </button>
      <div class="nav-decade-children">${edicoesHtml}</div>
    </div>`;
  });
  h += '</div>'; /* fecha .sidebar-nav */
  /* barra fixa no rodapé do menu (desktop): Perfil + Configurações */
  h += `<div class="sidebar-account-bar">
    <a href="${BASE}perfil.html"${PAGINA.tipo === 'perfil' ? ' class="active"' : ''} title="Perfil" aria-label="Perfil">👤</a>
    <a href="${BASE}notificacoes.html"${PAGINA.tipo === 'notif' ? ' class="active"' : ''} title="Notificações" aria-label="Notificações">🔔<span class="notif-badge" id="notifBadgeBar" style="display:none;"></span></a>
    <a href="${BASE}configuracoes.html"${PAGINA.tipo === 'config' ? ' class="active"' : ''} title="Configurações" aria-label="Configurações">⚙️</a>
    ${_sessAdmin ? `<a href="${BASE}admin.html"${PAGINA.tipo === 'admin' ? ' class="active"' : ''} title="Painel admin" aria-label="Painel admin">💻</a>` : ''}
  </div>`;
  return h;
}

function htmlModalMonte(){
  const opcoes = EDICOES.filter(e => !e.emBreve).map(e => {
    const trancado = e.monteAbreEm && agora() < new Date(e.monteAbreEm);
    const sub = trancado
      ? `Ainda não disponível — abre em ${fmtData(new Date(e.monteAbreEm))}`
      : 'Monte sua tabela com foto, título e descrição';
    return `<a class="year-pick-btn" href="${BASE}${e.ano}/monte.html">
      <span class="yr">Cetec Festival ${e.ano}</span>
      <span class="yr-sub">${sub}</span>
    </a>`;
  }).join('');
  return `<div class="modal-overlay" id="monteModalOverlay">
    <div class="modal-card">
      <div class="modal-header"><h2>Monte o Seu</h2><button class="modal-close" id="monteModalClose">✕</button></div>
      <div class="modal-sub">Escolha para qual festival você quer montar a sua versão.</div>
      <div class="year-pick-options">${opcoes}</div>
    </div>
  </div>`;
}

/* atualiza a bolinha de "não lidas" no sino (topo, menu principal e barra fixa) —
   chamada em toda página (montarShell) e de novo sempre que algo é marcado como lida */
async function atualizarBadgeNotificacoes(){
  const sess = usuarioLogado();
  const badges = ['notifBadgeQuick', 'notifBadgeNav', 'notifBadgeBar']
    .map(id => document.getElementById(id)).filter(Boolean);
  if(!badges.length) return;
  if(!sess){ badges.forEach(b => b.style.display = 'none'); return; }
  const r = await apiContarNotifNaoLidas();
  const total = (r && r.ok && typeof r.total === 'number') ? r.total : 0;
  badges.forEach(b => {
    if(total > 0){ b.textContent = total > 9 ? '9+' : String(total); b.style.display = ''; }
    else { b.style.display = 'none'; }
  });
}

/* =====================================================================
   NOTIFICAÇÕES — banner animado + detecção de novidades
   =====================================================================
   - mostrarNotifBanner: um card desliza do TOPO (mesmo espírito do banner de
     "adicionar à tela inicial"), fica 3s e some com fade.
   - checarNotificacoesNovas: busca as não lidas e mostra banner das que ainda
     não apareceram neste aparelho.
   - checarEventosDaEdicao / checarEdicoesNovas: detectam no navegador quando
     uma noite/votação abre, quando sai o resultado do bolão e quando entra uma
     edição nova — e criam a notificação na conta (o servidor não duplica). */

/* preferências de notificação em cache local (gravadas pela tela de Config).
   Ausente = ligado; só desliga com valor === false. */
function lerPrefsNotif(){
  const s = usuarioLogado(); if(!s) return {};
  try{ return JSON.parse(localStorage.getItem('cetec-notifprefs-' + s.user) || '{}') || {}; }
  catch(e){ return {}; }
}
function salvarPrefsNotifCache(user, notif){
  try{ localStorage.setItem('cetec-notifprefs-' + user, JSON.stringify(notif || {})); }catch(e){}
}
function notifTipoLigado(tipo){ return lerPrefsNotif()[tipo] !== false; }

/* push é POR APARELHO (flag local, não vai pra conta): assim dá pra ter ligado
   no celular e desligado no PC de forma independente. */
function pushLocalLigado(){
  const v = localStorage.getItem('cetec-push-on');
  if(v === '1') return true;
  if(v === '0') return false;
  return (typeof Notification !== 'undefined' && Notification.permission === 'granted'); // sem decisão: segue a permissão
}
function setPushLocal(on){ try{ localStorage.setItem('cetec-push-on', on ? '1' : '0'); }catch(e){} }

/* marca localmente um id como "já apareceu em banner" (não mexe no lido/servidor) */
function marcarNotifVistaLocal(id){
  const s = usuarioLogado(); if(!s) return;
  const key = 'cetec-notif-vistas-' + s.user;
  let v = []; try{ v = JSON.parse(localStorage.getItem(key) || '[]'); }catch(e){ v = []; }
  if(v.indexOf(String(id)) < 0){ v.push(String(id)); try{ localStorage.setItem(key, JSON.stringify(v.slice(-300))); }catch(e){} }
}

function mostrarNotifBanner(n){
  if(!n || (!n.titulo && !n.corpo)) return;
  let host = document.getElementById('notifToastHost');
  if(!host){ host = document.createElement('div'); host.id = 'notifToastHost'; host.className = 'notif-toast-host'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'notif-toast';
  el.innerHTML = `<span class="notif-toast-ico">🔔</span>
    <span class="notif-toast-txt"><b>${esc(n.titulo || 'Notificação')}</b>${n.corpo ? `<span>${esc(n.corpo)}</span>` : ''}</span>
    <button class="notif-toast-x" type="button" aria-label="Fechar">✕</button>`;
  if(n.url){ el.classList.add('clicavel'); }
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let saiu = false;
  const sair = () => { if(saiu) return; saiu = true; el.classList.remove('show'); el.classList.add('hide'); setTimeout(() => el.remove(), 420); };
  el.querySelector('.notif-toast-x').addEventListener('click', ev => { ev.stopPropagation(); sair(); });
  if(n.url) el.addEventListener('click', () => { location.href = n.url; });
  /* fica na tela pelo tempo pedido (padrão 3s) e some com fade */
  const dur = (typeof n.duracao === 'number' && n.duracao > 0) ? n.duracao : 3000;
  setTimeout(sair, dur);
}

async function checarNotificacoesNovas(){
  const s = usuarioLogado(); if(!s) return;
  const r = await apiListarNotificacoes();
  if(!r || !r.ok || !Array.isArray(r.notificacoes)) return;
  const key = 'cetec-notif-vistas-' + s.user;
  let vistas = []; try{ vistas = JSON.parse(localStorage.getItem(key) || '[]'); }catch(e){ vistas = []; }
  const novas = r.notificacoes.filter(n => !n.lida && vistas.indexOf(String(n.id)) < 0);
  if(!novas.length) return;
  /* mostra no máx. 3 (das mais antigas p/ as mais novas, uma após a outra) */
  novas.slice(0, 3).reverse().forEach((n, i) => setTimeout(() => mostrarNotifBanner(n), i * 700));
  const todas = vistas.concat(novas.map(n => String(n.id)));
  try{ localStorage.setItem(key, JSON.stringify(todas.slice(-300))); }catch(e){}
}

/* cria a notificação só uma vez por aparelho (guarda os ids já disparados);
   o servidor também dedupe pelo id, então nunca duplica de verdade. */
async function criarNotifSeNova(id, tipo, titulo, corpo, url){
  const s = usuarioLogado(); if(!s) return;
  if(!notifTipoLigado(tipo)) return;
  const key = 'cetec-notif-fired-' + s.user;
  let fired = []; try{ fired = JSON.parse(localStorage.getItem(key) || '[]'); }catch(e){ fired = []; }
  if(fired.indexOf(id) >= 0) return;
  fired.push(id);
  try{ localStorage.setItem(key, JSON.stringify(fired.slice(-500))); }catch(e){}
  await apiCriarNotif(tipo, id, titulo, corpo, url);
}

/* noites/votação/bolão: só avisa eventos RECENTES (últimos 3 dias). Antes ele
   disparava pra qualquer data passada (hoje >= data é verdade sempre), então
   visitar uma edição de 2025 gerava "noite 5 aberta" de um ano atrás. Agora só
   dispara se o evento aconteceu de verdade agora, e (pra votação/noite) se a
   votação ainda não encerrou. Relógio do aparelho — é só aviso, não trava voto. */
async function checarEventosDaEdicao(){
  const s = usuarioLogado(); if(!s || !ANO) return;
  const hoje = Date.now();
  const JANELA = 3 * 24 * 60 * 60 * 1000;   // 3 dias
  const recente = d => { if(!d) return false; const t = d.getTime(); return hoje >= t && (hoje - t) <= JANELA; };
  const encerrada = (FIM_VOTACAO && hoje >= FIM_VOTACAO.getTime());

  const ini = INICIO || dataNoite(1);
  if(recente(ini) && !encerrada){
    await criarNotifSeNova('votacao:' + ANO, 'votacoes', '🗳️ Votação aberta',
      'A votação do Cetec Festival ' + ANO + ' está aberta. Vote nas peças!', '/' + ANO + '/index.html');
  }
  for(let n = 1; n <= NUM_NOITES; n++){
    if(recente(dataNoite(n)) && !encerrada){
      await criarNotifSeNova('noite:' + ANO + ':' + n, 'noites', '🎭 Noite ' + n + ' liberada',
        'A Noite ' + n + ' do Cetec Festival ' + ANO + ' já está no ar.', '/' + ANO + '/noite-' + n + '.html');
    }
  }
  if(recente(FIM_VOTACAO)){
    await criarNotifSeNova('bolao:' + ANO, 'bolao', '🔮 Resultado do bolão',
      'A votação de ' + ANO + ' encerrou — veja como você foi no bolão!', '/' + ANO + '/index.html');
  }
}

/* novas edições: compara EDICOES (config.js) com o que este usuário já conhecia.
   Na primeira vez só memoriza (pra não notificar todas de uma vez). */
async function checarEdicoesNovas(){
  const s = usuarioLogado(); if(!s || typeof EDICOES === 'undefined') return;
  const key = 'cetec-edicoes-conhecidas-' + s.user;
  const atuais = EDICOES.map(e => e.ano);
  let conhecidas = null;
  try{ conhecidas = JSON.parse(localStorage.getItem(key) || 'null'); }catch(e){ conhecidas = null; }
  if(!Array.isArray(conhecidas)){ try{ localStorage.setItem(key, JSON.stringify(atuais)); }catch(e){} return; }
  const novas = atuais.filter(a => conhecidas.indexOf(a) < 0);
  for(const ano of novas){
    const ed = EDICOES.find(e => e.ano === ano);
    const url = (ed && ed.emBreve) ? ('/em-breve.html?ano=' + ano) : ('/' + ano + '/index.html');
    await criarNotifSeNova('edicao:' + ano, 'edicoes', '🎬 Nova edição',
      'O Cetec Festival ' + ano + ' entrou no ar. Dá uma olhada!', url);
  }
  try{ localStorage.setItem(key, JSON.stringify(atuais)); }catch(e){}
}

/* badges recém-desbloqueadas: compara o catálogo atual com o que estava
   guardado. Na 1ª vez só memoriza. Notifica E mostra o banner na hora. */
function detectarBadgesNovas(cat){
  const s = usuarioLogado(); if(!s || !Array.isArray(cat)) return;
  const key = 'cetec-badges-' + s.user;
  const desbloqueadas = cat.filter(b => b.unlocked).map(b => b.titulo);
  let antes = null;
  try{ antes = JSON.parse(localStorage.getItem(key) || 'null'); }catch(e){ antes = null; }
  if(!Array.isArray(antes)){ try{ localStorage.setItem(key, JSON.stringify(desbloqueadas)); }catch(e){} return; }
  const novas = desbloqueadas.filter(t => antes.indexOf(t) < 0);
  novas.forEach(t => {
    const b = cat.find(x => x.titulo === t);
    const id = 'badge:' + t;
    criarNotifSeNova(id, 'badges', '🏅 Nova badge!', 'Você desbloqueou a badge "' + t + '".', '/perfil.html');
    if(notifTipoLigado('badges')){
      mostrarNotifBanner({ titulo: '🏅 Nova badge: ' + t, corpo: (b && b.texto) || '', url: '/perfil.html' });
      marcarNotifVistaLocal(id);   // já mostrada — não repetir no próximo carregamento
    }
  });
  try{ localStorage.setItem(key, JSON.stringify(desbloqueadas)); }catch(e){}
}

/* posição no Hall da Fama (ranking de reputação): avisa quando o usuário ENTRA
   no ranking ou MUDA de posição. Recebe o ranking completo do servidor.
   Guarda a última posição conhecida por aparelho (0 = fora do ranking); a 1ª
   vez só memoriza, pra não disparar no primeiro acesso de quem já está lá. */
function detectarPosicaoHall(rk){
  const s = usuarioLogado(); if(!s) return;
  const ranked = (rk || []).filter(x => Number(x.rep) > 0);
  const meu = s.user.trim().toLowerCase();
  const idx = ranked.findIndex(x => String(x.user).trim().toLowerCase() === meu);
  const pos = idx < 0 ? 0 : idx + 1;   // 0 = fora do ranking (ou anônimo/sem match)
  const key = 'cetec-hallpos-' + s.user;
  let antes = null;
  try{ const raw = localStorage.getItem(key); antes = (raw === null) ? null : JSON.parse(raw); }catch(e){ antes = null; }
  if(antes === null){ try{ localStorage.setItem(key, JSON.stringify(pos)); }catch(e){} return; }  // baseline
  if(antes === pos) return;                         // nada mudou
  try{ localStorage.setItem(key, JSON.stringify(pos)); }catch(e){}
  if(pos === 0) return;                             // saiu do ranking — não avisa
  if(!notifTipoLigado('hall')) return;
  let titulo, corpo;
  if(antes === 0){ titulo = '🏆 Você entrou no Hall da Fama!'; corpo = 'Você estreou no ranking de reputação, em ' + pos + 'º lugar.'; }
  else if(pos < antes){ titulo = '🏆 Você subiu no Hall da Fama!'; corpo = 'De ' + antes + 'º para ' + pos + 'º no ranking de reputação.'; }
  else { titulo = '📊 Você mudou de posição no Hall da Fama'; corpo = 'De ' + antes + 'º para ' + pos + 'º no ranking de reputação.'; }
  const nid = 'hall:' + antes + '->' + pos;
  apiCriarNotif('hall', nid, titulo, corpo, '/hall.html');
  mostrarNotifBanner({ titulo, corpo, url: '/hall.html' });
  marcarNotifVistaLocal(nid);
}

/* orquestra tudo em segundo plano (não trava a renderização da página) */
function checarNotificacoes(){
  if(!usuarioLogado()) return;
  (async () => {
    try{ await checarEventosDaEdicao(); }catch(e){}
    try{ await checarEdicoesNovas(); }catch(e){}
    try{ await checarNotificacoesNovas(); }catch(e){}
  })();
}

/* ---- BROADCASTS (avisos "para todos") ----
   Aparecem pra QUALQUER visitante (logado ou não), de forma transitória: o
   banner sobe, fica alguns segundos e some. Cada aviso aparece uma vez por
   aparelho (guardamos os ids já vistos no localStorage). */
async function fetchBroadcasts(){
  if(!API_URL || API_URL.startsWith('COLE_AQUI')) return [];
  try{
    const r = await fetch(API_URL + '?broadcasts=1&_=' + Date.now(), { cache:'no-store' });
    const j = await r.json();
    return (j && Array.isArray(j.broadcasts)) ? j.broadcasts : [];
  }catch(e){ return []; }
}
async function checarBroadcasts(){
  const lista = await fetchBroadcasts();
  if(!lista.length) return;
  const key = 'cetec-broadcasts-vistos';   // transitórios: uma vez por aparelho
  let vistos = []; try{ vistos = JSON.parse(localStorage.getItem(key) || '[]'); }catch(e){ vistos = []; }
  const novos = [];
  lista.forEach(b => {
    const modo = b.modo || 'uma_vez';
    if(modo === 'sempre'){
      novos.push(b);                                   // toda visita
    } else if(modo === 'sessao'){
      const ks = 'cetec-banner-sessao-' + b.id;        // 1× por sessão
      let jaViu = true; try{ jaViu = !!sessionStorage.getItem(ks); }catch(e){}
      if(!jaViu){ novos.push(b); try{ sessionStorage.setItem(ks, '1'); }catch(e){} }
    } else {
      if(vistos.indexOf(String(b.id)) < 0){ novos.push(b); vistos.push(String(b.id)); }  // 1× por aparelho
    }
  });
  if(!novos.length) return;
  try{ localStorage.setItem(key, JSON.stringify(vistos.slice(-200))); }catch(e){}
  novos.slice(0, 3).reverse().forEach((b, i) => setTimeout(() => mostrarNotifBanner({
    titulo:b.titulo, corpo:b.corpo, url:b.url,
    duracao: (Number(b.dur) > 0 ? Number(b.dur) * 1000 : undefined)
  }), i * 800));
}

/* ---- saúde da inscrição push ----
   Se a inscrição do aparelho sumiu/expirou (foi limpa no servidor) mas o usuário
   queria push, o app tenta religar sozinho (se tiver permissão) ou mostra um
   banner pedindo pra reativar. */
async function salvarPushPref(v){
  const s = usuarioLogado(); if(!s) return;
  try{
    const meu = await apiMeuPerfil();
    const cfg = (meu && meu.ok && meu.perfil && typeof meu.perfil === 'object') ? meu.perfil : {};
    const notif = Object.assign({}, (cfg.notif || {}), { push: v });
    salvarPrefsNotifCache(s.user, notif);
    await apiSalvarPerfil(Object.assign({}, cfg, { notif }));
  }catch(e){}
}
function mostrarBannerReativarPush(){
  try{ if(sessionStorage.getItem('cetec-reativar-push-off')) return; }catch(e){}
  if(document.getElementById('reativarPushBanner')) return;
  const b = document.createElement('div');
  b.id = 'reativarPushBanner';
  b.className = 'push-reativar';
  b.innerHTML = `<span class="pr-txt">🔔 Suas notificações estão desativadas. Deseja reativar?</span>
    <button class="pr-ok" type="button">Reativar</button>
    <button class="pr-x" type="button" aria-label="Fechar">✕</button>`;
  document.body.appendChild(b);
  b.querySelector('.pr-x').addEventListener('click', () => { try{ sessionStorage.setItem('cetec-reativar-push-off','1'); }catch(e){} b.remove(); });
  b.querySelector('.pr-ok').addEventListener('click', async () => {
    const ok = b.querySelector('.pr-ok'); ok.textContent = 'Ativando…'; ok.disabled = true;
    const r = await ativarPush();
    if(r && r.ok){ setPushLocal(true); b.remove(); mostrarNotifBanner({ titulo:'🔔 Notificações reativadas' }); }
    else { alert('Não deu pra reativar: ' + ((r && r.error) || 'erro')); ok.textContent = 'Reativar'; ok.disabled = false; }
  });
}
async function verificarInscricaoPush(){
  const s = usuarioLogado(); if(!s) return;
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return;
  if(localStorage.getItem('cetec-push-on') !== '1') return;   // este aparelho não optou por push
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub){
      /* ainda inscrito: re-salva no servidor (caso a linha dele tenha sido limpa) */
      try{ await apiSalvarPush(sub.toJSON()); }catch(e){}
      return;
    }
    /* inscrição sumiu, mas o usuário queria push */
    if(Notification.permission === 'granted'){
      const r = await ativarPush();          // dá pra religar sem gesto se já tem permissão
      if(!r || !r.ok) mostrarBannerReativarPush();
    } else {
      mostrarBannerReativarPush();            // precisa da ação do usuário
    }
  }catch(e){}
}

/* banner "ativar notificações?" — usado na 1ª abertura do app instalado (e no
   iPhone, onde o pedido de permissão precisa vir de um toque do usuário). */
function mostrarBannerPedirPush(){
  if(document.getElementById('pedirPushBanner')) return;
  const b = document.createElement('div');
  b.id = 'pedirPushBanner'; b.className = 'push-reativar';
  b.innerHTML = `<span class="pr-txt">🔔 Ativar as notificações do CETECritic neste aparelho?</span>
    <button class="pr-ok" type="button">Ativar</button>
    <button class="pr-x" type="button" aria-label="Agora não">✕</button>`;
  document.body.appendChild(b);
  const marcarPerguntado = () => { try{ localStorage.setItem('cetec-pwa-push-perguntado', '1'); }catch(e){} };
  b.querySelector('.pr-x').addEventListener('click', () => { setPushLocal(false); marcarPerguntado(); b.remove(); });
  b.querySelector('.pr-ok').addEventListener('click', async () => {
    const ok = b.querySelector('.pr-ok'); ok.textContent = 'Ativando…'; ok.disabled = true;
    const r = await ativarPush();
    if(r && r.ok){ setPushLocal(true); marcarPerguntado(); b.remove(); mostrarNotifBanner({ titulo: '🔔 Notificações ativadas' }); }
    else { alert('Não deu pra ativar: ' + ((r && r.error) || 'erro')); ok.textContent = 'Ativar'; ok.disabled = false; }
  });
}
/* Na 1ª abertura do app INSTALADO (PWA), pede as notificações automaticamente.
   Android/desktop: dispara o pedido nativo direto. iPhone: mostra o banner (que
   pede no toque). Só roda logado (a inscrição precisa da conta) e uma vez só. */
async function pedirPushNaPrimeiraVezPWA(){
  if(!usuarioLogado()) return;
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return;
  const standalone = !!(window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true));
  if(!standalone) return;                                       // só no app instalado
  if(localStorage.getItem('cetec-pwa-push-perguntado')) return; // só na primeira vez
  if(localStorage.getItem('cetec-push-on') === '0') return;     // já desligou de propósito neste aparelho
  if(Notification.permission === 'denied'){ localStorage.setItem('cetec-pwa-push-perguntado', '1'); return; }
  if(Notification.permission === 'granted'){
    localStorage.setItem('cetec-pwa-push-perguntado', '1');
    const r = await ativarPush(); if(r && r.ok) setPushLocal(true);
    return;
  }
  // permission 'default'
  const ehIOS = (typeof window.pwaEhIOS === 'function') ? window.pwaEhIOS() : /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  if(ehIOS){
    mostrarBannerPedirPush();   // iOS: precisa de gesto
  } else {
    localStorage.setItem('cetec-pwa-push-perguntado', '1');
    const r = await ativarPush();
    if(r && r.ok) setPushLocal(true);
    else if(Notification.permission === 'default') mostrarBannerPedirPush();  // não apareceu: cai no banner
  }
}

function montarShell(conteudo){
  document.body.insertAdjacentHTML('afterbegin', `
    <nav class="sidebar">${htmlSidebar()}</nav>
    <div class="main-content">
      ${conteudo}
      <footer class="site-footer">
        <img class="footer-logo" src="${BASE}assets/logo-rodape.png" alt="" onerror="this.style.display='none'">
        <div>${esc(RODAPE)}</div>
        <div>Contato e contribuições: <a href="mailto:${(typeof EMAIL_CONTATO !== 'undefined') ? EMAIL_CONTATO : 'cetecritic@gmail.com'}">${(typeof EMAIL_CONTATO !== 'undefined') ? EMAIL_CONTATO : 'cetecritic@gmail.com'}</a></div>
        <div><a href="${BASE}termos.pdf" target="_blank" rel="noopener">Termos de Serviço e Política de Privacidade</a></div>
      </footer>
    </div>`);

  document.body.insertAdjacentHTML('beforeend', htmlModalMonte());
  const mo = document.getElementById('monteModalOverlay');
  document.getElementById('navMonte').addEventListener('click', () => {
    mo.classList.add('open');
    requestAnimationFrame(() => mo.classList.add('show'));
  });
  document.getElementById('monteModalClose').addEventListener('click', () => fecharOverlay(mo));
  mo.addEventListener('click', ev => { if(ev.target === mo) fecharOverlay(mo); });

  /* modal de login/conta (disponível em todas as páginas) */
  document.body.insertAdjacentHTML('beforeend', htmlModalLogin());
  wireLogin();

  /* menu retrátil no celular — controla a visibilidade direto no elemento,
     então funciona mesmo se o CSS estiver em cache antigo no navegador */
  const navToggle = document.getElementById('navToggle');
  const sidebarEl = document.querySelector('.sidebar');
  const sidebarNavEl = document.getElementById('sidebarNav');
  const ehCelular = () => window.matchMedia('(max-width: 860px)').matches;

  function aplicarEstadoMenu(){
    if(!sidebarNavEl) return;
    if(ehCelular()){
      const aberto = sidebarEl.classList.contains('nav-open');
      sidebarNavEl.style.display = aberto ? 'flex' : 'none';
      sidebarNavEl.style.flexDirection = 'column';
      sidebarNavEl.style.marginTop = aberto ? '12px' : '';
      if(navToggle) navToggle.textContent = aberto ? '✕' : '☰';
    } else {
      sidebarNavEl.style.display = '';
      sidebarNavEl.style.marginTop = '';
      sidebarEl.classList.remove('nav-open');
      if(navToggle) navToggle.textContent = '☰';
    }
  }
  if(navToggle) navToggle.addEventListener('click', () => {
    sidebarEl.classList.toggle('nav-open');
    aplicarEstadoMenu();
  });
  /* cabeçalho de década: abre/fecha o grupo de edições daquela década */
  document.querySelectorAll('.nav-decade-head').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.nav-decade').classList.toggle('open'));
  });
  /* tocar em qualquer item do menu já fecha ele na hora
     (menos o cabeçalho de década, que só expande/recolhe o grupo) */
  if(sidebarNavEl) sidebarNavEl.addEventListener('click', ev => {
    if(ev.target.closest('.nav-decade-head')) return;
    if(ehCelular() && ev.target.closest('a, button')){
      sidebarEl.classList.remove('nav-open');
      aplicarEstadoMenu();
    }
  });
  /* página restaurada do histórico (botão voltar do celular) volta com menu fechado */
  window.addEventListener('pageshow', () => {
    sidebarEl.classList.remove('nav-open');
    aplicarEstadoMenu();
  });
  window.addEventListener('resize', aplicarEstadoMenu);
  aplicarEstadoMenu();

  atualizarBadgeNotificacoes();
  checarNotificacoes();   // banner de novidades + detecção de noites/edições/bolão
  checarBroadcasts();     // avisos "para todos" — aparecem pra qualquer visitante
  verificarInscricaoPush();       // religa/pede pra religar se a inscrição push sumiu
  pedirPushNaPrimeiraVezPWA();     // 1ª abertura do app instalado: pede as notificações
  /* confirma no servidor se a conta é admin e mostra o 💻 (uma vez por sessão
     enquanto ainda não for admin — quem já é admin não precisa re-checar) */
  (async () => {
    const s = usuarioLogado();
    if(!s) return;
    if(sessionStorage.getItem('cetec-sess-checada')) return;
    try{
      const r = await apiMeuPerfil();
      // r.ok === false significa que o SERVIDOR recusou o token (sessão derrubada
      // em outro aparelho, senha trocada, sessão revogada). Aí desloga de vez em
      // vez de ficar "fantasma" (parece logado mas nada funciona).
      if(r && r.ok === false){ sairSessao(); location.reload(); return; }
      sessionStorage.setItem('cetec-sess-checada', '1');
      if(r && r.ok){
        const admin = !!r.admin;
        if(admin !== !!s.admin){ marcarSessaoAdmin(admin); location.reload(); }
      }
    }catch(e){ /* erro de rede: mantém a sessão, tenta de novo depois */ }
  })();

  /* ---- aviso de edição histórica (anos <= ANO_EDICAO_HISTORICA) ----
     aparece 1x por sessão para cada ano histórico visitado */
  const limiteHist = (typeof ANO_EDICAO_HISTORICA !== 'undefined') ? ANO_EDICAO_HISTORICA : 2009;
  if(ANO && ANO <= limiteHist && !sessionStorage.getItem('aviso-historico-' + ANO)){
    const emailHist = (typeof EMAIL_CONTATO !== 'undefined') ? EMAIL_CONTATO : 'cetecritic@gmail.com';
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay open" id="histModalOverlay">
        <div class="modal-card" style="text-align:center;">
          <div class="hist-title">Você está entrando em uma edição histórica</div>
          <div class="hist-text">
            Edições históricas são festivais antigos (até ${limiteHist}), reconstruídos com o pouco
            material que sobreviveu ao tempo. Por isso elas têm bem menos dados —
            podem faltar peças, sinopses, turmas e vídeos.<br><br>
            Participou dessa época ou guarda programas, fotos ou lembranças?
            Contribua enviando um e-mail para
            <a href="mailto:${emailHist}">${emailHist}</a> 💛
          </div>
          <button class="btn btn-solid" id="histModalOk">Entendi, quero explorar</button>
        </div>
      </div>`);
    requestAnimationFrame(() => document.getElementById('histModalOverlay').classList.add('show'));
    document.getElementById('histModalOk').addEventListener('click', () => {
      sessionStorage.setItem('aviso-historico-' + ANO, '1');
      fecharOverlay(document.getElementById('histModalOverlay'));
    });
  }
}

function fecharOverlay(el){
  el.classList.remove('show');
  setTimeout(() => el.classList.remove('open'), 200);
}

/* ---------------------- polling que respeita a aba ----------------------
   Todo o site atualiza sozinho a cada 20s. Só que `setInterval` continua
   disparando com a aba escondida: quem deixa o CETECritic aberto num pino
   do navegador ficava com um cronjob de rede rodando o dia inteiro,
   gastando bateria e dados à toa.

   Este envelope pula o trabalho enquanto a aba está oculta e dispara UMA
   vez quando a pessoa volta, se já tiver passado do intervalo. */
function intervaloVisivel(fn, ms){
  let ultimo = Date.now();
  let rodando = false;
  async function executar(){
    if(rodando) return;                 // não empilha se a chamada anterior demorou
    rodando = true;
    ultimo = Date.now();
    try{ await fn(); }catch(e){ console.warn('atualização periódica falhou', e); }
    finally{ rodando = false; }
  }
  const id = setInterval(() => { if(!document.hidden) executar(); }, ms);
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && Date.now() - ultimo >= ms) executar();
  });
  return id;
}

/* ---------------------- countdowns (tick global) ----------------------
   Qualquer elemento com data-count-to="ISO" é atualizado a cada segundo.
   Se tiver data-reload="1", a página recarrega quando o tempo zera
   (é assim que noites/edições "abrem" sozinhas). */
let tickPagina = null;
setInterval(() => {
  /* aba escondida: ninguém está vendo o contador, e o texto é recalculado
     do zero quando ela volta. Poupa um querySelectorAll por segundo. */
  if(document.hidden) return;
  document.querySelectorAll('[data-count-to]').forEach(el => {
    const resto = new Date(el.dataset.countTo) - agora();
    el.textContent = formatDuracao(resto);
    if(resto <= 0 && el.dataset.reload === '1' && !el.dataset.reloaded){
      el.dataset.reloaded = '1';
      setTimeout(() => location.reload(), 1200);
    }
  });
  if(tickPagina) tickPagina();
}, 1000);

function htmlCountdownBox(ate, comReload){
  return `<div class="grid-countdown-box">
    <div class="lbl">Abre em</div>
    <div class="val" data-count-to="${ate.toISOString()}"${comReload ? ' data-reload="1"' : ''}>--:--:--</div>
  </div>`;
}

/* ---------------------- "Em breve" (sem countdown) ----------------------
   Edições marcadas com emBreve:true no config.js mostram só um aviso
   "Em breve", sem contador. Útil para anos futuros ainda sem data. */
function edicaoEmBreve(){ return !!(CFG_EDICAO && CFG_EDICAO.emBreve); }
function htmlEmBreveBox(sub){
  return `<div class="grid-countdown-box em-breve-box">
    <div class="val em-breve-val">Em breve</div>
    <div class="lbl em-breve-sub">${esc(sub || 'Esta edição ainda não foi liberada')}</div>
  </div>`;
}

/* ---------------------- recado de edição histórica ----------------------
   Banner fixo no topo da página da edição (anos <= ANO_EDICAO_HISTORICA). */
function htmlHistBanner(){
  const limite = (typeof ANO_EDICAO_HISTORICA !== 'undefined') ? ANO_EDICAO_HISTORICA : 2009;
  if(!(ANO && ANO <= limite)) return '';
  const email = (typeof EMAIL_CONTATO !== 'undefined') ? EMAIL_CONTATO : 'cetecritic@gmail.com';
  return `<div class="hist-banner">
    <span class="hist-banner-icon">📜</span>
    <div class="hist-banner-text">
      <b>Edição histórica.</b> Esta é uma edição antiga do CETEC Festival, reconstruída
      com o pouco material que sobreviveu ao tempo — por isso pode faltar peças, sinopses, turmas e vídeos.
      Guarda fotos, programas ou lembranças dessa época? Contribua enviando para
      <a href="mailto:${email}">${email}</a> 💛
    </div>
  </div>`;
}

/* ---------------------- grids ---------------------- */
function gridVazioHtml(){
  let h = `<div class="grid-row"><div class="cell label"></div>`;
  for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell header">S${s}</div>`;
  h += `</div>`;
  for(let e = 1; e <= MAX_EPS; e++){
    h += `<div class="grid-row"><div class="cell label">E${e}</div>`;
    for(let s = 1; s <= NUM_NOITES; s++)
      h += e <= epsDaNoite(s) ? `<div class="cell empty-cell">–</div>` : `<div class="cell cell-void"></div>`;
    h += `</div>`;
  }
  return h;
}

function buildDisplayGrid(containerId){
  const c = document.getElementById(containerId);
  if(!c) return;
  let h = `<div class="grid-row"><div class="cell label"></div>`;
  for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell header">${cabecalhoNoite(s)}</div>`;
  h += `</div>`;

  h += `<div class="grid-row"><div class="cell label" style="font-size:10px;">MÉDIA</div>`;
  for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell cell-avg pop" id="${containerId}-avg-s${s}">–</div>`;
  h += `</div>`;

  for(let e = 1; e <= MAX_EPS; e++){
    h += `<div class="grid-row"><div class="cell label">E${e}</div>`;
    for(let s = 1; s <= NUM_NOITES; s++){
      if(e > epsDaNoite(s)){ h += `<div class="cell cell-void"></div>`; continue; }
      const key = `s${s}e${e}`;
      h += `<div class="cell cell-data empty-cell pop" id="${containerId}-disp-${key}" style="animation-delay:${(s+e)*0.03}s">
        <span class="val"></span><span class="tooltip"></span>
      </div>`;
    }
    h += `</div>`;
  }
  c.innerHTML = h;
}

const DISPLAY_CONTAINERS = ['grid-container', 'gerais-grid-container'];

function refreshDisplayGrids(){
  let allValues = [];
  DISPLAY_CONTAINERS.forEach(containerId => {
    if(!document.getElementById(containerId)) return;
    for(let s = 1; s <= NUM_NOITES; s++){
      let seasonValues = [];
      for(let e = 1; e <= MAX_EPS; e++){
        const key = `s${s}e${e}`;
        const vals = valoresDaChave(key);
        seasonValues = seasonValues.concat(vals);
        if(containerId === DISPLAY_CONTAINERS[0]) allValues = allValues.concat(vals);

        const cell = document.getElementById(`${containerId}-disp-${key}`);
        if(cell){
          const v = media(vals);
          const valEl = cell.querySelector('.val');
          const tipEl = cell.querySelector('.tooltip');
          if(v === null){
            valEl.textContent = '–';
            cell.classList.add('empty-cell');
            cell.style.backgroundColor = '';
            tipEl.textContent = 'Sem avaliações';
          } else {
            valEl.textContent = v.toFixed(1);
            cell.classList.remove('empty-cell');
            cell.style.backgroundColor = corDaNota(v);
            tipEl.textContent = `${vals.length} avaliação${vals.length === 1 ? '' : 'ões'}`;
          }
        }
      }
      const avgEl = document.getElementById(`${containerId}-avg-s${s}`);
      const sv = media(seasonValues);
      if(avgEl){
        if(sv === null){
          avgEl.textContent = '–';
          avgEl.style.backgroundColor = 'var(--surface-2)';
          avgEl.style.borderColor = 'var(--border)';
        } else {
          avgEl.textContent = sv.toFixed(1);
          const c = corDaNota(sv);
          avgEl.style.backgroundColor = c;
          avgEl.style.borderColor = c;
        }
      }
    }
  });

  const overall = media(allValues);
  const set = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  set('overallAvg', overall === null ? '–' : overall.toFixed(1));
  set('overallCount', `${submissions.length} avaliaç${submissions.length === 1 ? 'ão' : 'ões'}`);
  set('geraisAvg', overall === null ? '–' : overall.toFixed(1));
  set('geraisCount', String(submissions.length));
}

/* ---------------------- lista de avaliações recebidas ---------------------- */
function renderSubmissions(){
  const list = document.getElementById('submissionList');
  if(!list) return;
  if(submissions.length === 0){
    list.innerHTML = '<div class="empty-note">Nenhuma avaliação enviada ainda. Clique em "Avaliar episódios" no topo!</div>';
    return;
  }
  const sorted = [...submissions].sort((a,b) => b.ts - a.ts);
  list.innerHTML = sorted.map((sub, i) => {
    const vals = Object.values(sub.grid);
    const avg = media(vals);
    let chips = '';
    for(let s = 1; s <= NUM_NOITES; s++){
      for(let e = 1; e <= epsDaNoite(s); e++){
        const v = sub.grid[`s${s}e${e}`];
        chips += v !== undefined
          ? `<div class="mini-chip" style="background:${corDaNota(v)}"></div>`
          : `<div class="mini-chip blank"></div>`;
      }
    }
    return `<div class="submission-item" style="animation-delay:${i*0.03}s" data-id="${sub.id}">
      <div class="submission-head">
        <div class="submission-avg" style="background:${corDaNota(avg)}">${avg.toFixed(1)}</div>
        <div class="submission-meta">
          <div class="submission-name">${sub.name ? esc(sub.name) : `Avaliação #${sorted.length - i}`}</div>
          <div class="submission-when">${tempoAtras(sub.ts)} · ${vals.length} episódio${vals.length === 1 ? '' : 's'} avaliado${vals.length === 1 ? '' : 's'}</div>
        </div>
        <div class="submission-mini">${chips}</div>
        <div class="chevron">▾</div>
      </div>
      <div class="submission-detail"><div class="submission-detail-inner">
        <div class="grid-panel mini-grid" id="detail-grid-${sub.id}"></div>
      </div></div>
    </div>`;
  }).join('');

  list.querySelectorAll('.submission-item').forEach(item => {
    item.querySelector('.submission-head').addEventListener('click', () => toggleSubmission(item));
  });
}

function toggleSubmission(item){
  const id = item.dataset.id;
  const estavaAberto = item.classList.contains('expanded');
  document.querySelectorAll('.submission-item.expanded').forEach(el => { if(el !== item) el.classList.remove('expanded'); });
  if(estavaAberto){ item.classList.remove('expanded'); return; }
  item.classList.add('expanded');
  const sub = submissions.find(s => s.id === id);
  if(sub) buildMiniGrid(`detail-grid-${id}`, sub.grid);
}

function buildMiniGrid(containerId, grid){
  const c = document.getElementById(containerId);
  if(!c || c.dataset.built === '1') return;
  c.dataset.built = '1';
  let h = `<div class="grid-row"><div class="cell label"></div>`;
  for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell header">S${s}</div>`;
  h += `</div>`;
  for(let e = 1; e <= MAX_EPS; e++){
    h += `<div class="grid-row"><div class="cell label">E${e}</div>`;
    for(let s = 1; s <= NUM_NOITES; s++){
      if(e > epsDaNoite(s)){ h += `<div class="cell cell-void"></div>`; continue; }
      const v = grid[`s${s}e${e}`];
      h += `<div class="cell" style="background:${v !== undefined ? corDaNota(v) : 'var(--gray-cell)'}; color:${v !== undefined ? '#14161a' : 'var(--text-muted)'}">${v !== undefined ? Number(v).toFixed(1) : '–'}</div>`;
    }
    h += `</div>`;
  }
  c.innerHTML = h;
}

/* ---------------------- formulário de votação ---------------------- */
let formValues = {};
const COOLDOWN_MS = (typeof COOLDOWN_MINUTOS !== 'undefined' ? COOLDOWN_MINUTOS : 5) * 60 * 1000;
let cooldownInterval = null;

function cooldownRestanteMs(){
  const last = Number(localStorage.getItem('last-submission-ts') || 0);
  const r = COOLDOWN_MS - (Date.now() - last);
  return r > 0 ? r : 0;
}
function formatCooldown(ms){
  const totalSec = Math.ceil(ms / 1000);
  return `${Math.floor(totalSec/60)}:${String(totalSec % 60).padStart(2,'0')}`;
}

function buildFormGrid(){
  const c = document.getElementById('form-grid-container');
  if(!c) return;
  let h = `<div class="grid-row"><div class="cell label"></div>`;
  for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell header">${cabecalhoNoite(s)}</div>`;
  h += `</div>`;
  for(let e = 1; e <= MAX_EPS; e++){
    h += `<div class="grid-row"><div class="cell label">E${e}</div>`;
    for(let s = 1; s <= NUM_NOITES; s++){
      if(e > epsDaNoite(s)){ h += `<div class="cell cell-void"></div>`; continue; }
      const key = `s${s}e${e}`;
      if(!noiteLiberada(s)){
        h += `<div class="cell cell-input locked" title="Libera em ${fmtData(dataNoite(s))}">🔒</div>`;
        continue;
      }
      const existing = formValues[key];
      h += `<div class="cell cell-input" id="fcell-${key}" style="${existing !== undefined ? `background-color:${corDaNota(existing)}` : ''}">
        <input type="number" min="0" max="${NOTA_MAXIMA}" step="0.1" placeholder="–" data-key="${key}" value="${existing !== undefined ? existing : ''}">
      </div>`;
    }
    h += `</div>`;
  }
  c.innerHTML = h;
  c.querySelectorAll('.cell-input input').forEach(inp => inp.addEventListener('input', () => onFormInput(inp)));
  updateFillHint();
}

function onFormInput(inp){
  const key = inp.dataset.key;
  const cellDiv = document.getElementById(`fcell-${key}`);
  if(inp.value === ''){
    delete formValues[key];
    cellDiv.style.backgroundColor = 'var(--surface-2)';
    updateFillHint();
    return;
  }
  let val = parseFloat(inp.value);
  if(isNaN(val)) return;
  if(val > NOTA_MAXIMA){ val = NOTA_MAXIMA; inp.value = NOTA_MAXIMA; }
  if(val < 0){ val = 0; inp.value = 0; }
  formValues[key] = val;
  cellDiv.style.backgroundColor = corDaNota(val);
  updateFillHint();
}

function updateFillHint(){
  const hintEl = document.getElementById('fillHint');
  const submitBtn = document.getElementById('submitReview');
  if(!hintEl || !submitBtn) return;

  const filled = Object.keys(formValues).length;
  let disponiveis = 0;
  for(let s = 1; s <= NUM_NOITES; s++){ if(noiteLiberada(s)) disponiveis += epsDaNoite(s); }

  const restante = cooldownRestanteMs();
  if(restante > 0){
    hintEl.textContent = `Aguarde ${formatCooldown(restante)} para enviar outra avaliação (evita spam)`;
    submitBtn.disabled = true;
    return;
  }
  const tosChk = document.getElementById('reviewTos');
  if(tosChk && !tosChk.checked){
    hintEl.textContent = `${filled} de ${disponiveis} episódios preenchidos — marque a caixa dos Termos de Serviço para enviar`;
    submitBtn.disabled = true;
    return;
  }

  hintEl.textContent = `${filled} de ${disponiveis} episódios preenchidos`;
  submitBtn.disabled = filled < 1;
}

/* ---------------------- captura de imagem (html2canvas) ---------------------- */
function neutralizarAnimacoes(clonedDoc, rootId){
  const root = clonedDoc.getElementById(rootId);
  if(!root) return;
  [root, ...root.querySelectorAll('*')].forEach(el => {
    el.style.animation = 'none';
    el.style.opacity = '1';
    el.style.transform = 'none';
  });
  root.querySelectorAll('.tooltip').forEach(el => { el.style.opacity = '0'; el.style.display = 'none'; });
  root.querySelectorAll('.cell-input input').forEach(input => {
    const raw = input.value;
    const num = parseFloat(raw);
    const span = clonedDoc.createElement('div');
    span.textContent = (raw === '' || isNaN(num)) ? '–' : num.toFixed(1);
    Object.assign(span.style, {
      width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center',
      fontWeight:'800', fontSize:'13px', fontFamily:"'Inter', sans-serif",
      color: (raw === '' || isNaN(num)) ? 'var(--text-muted)' : 'inherit'
    });
    input.replaceWith(span);
  });
}

/* espera as <img> do container carregarem — com teto de tempo, senão uma
   imagem que nunca dispara load/error (rede pendurada, CDN fora do ar)
   deixa o botão "Gerando..." travado pra sempre */
function aguardarImagens(container, limiteMs){
  if(!container) return Promise.resolve();
  const teto = Number(limiteMs) || 15000;
  return Promise.all(Array.from(container.querySelectorAll('img')).map(img => {
    if(img.complete) return Promise.resolve();
    return new Promise(res => {
      let feito = false;
      const fim = () => { if(feito) return; feito = true; clearTimeout(t); res(); };
      const t = setTimeout(fim, teto);
      img.addEventListener('load', fim, { once:true });
      img.addEventListener('error', fim, { once:true });
    });
  }));
}

/* =====================================================================
   EXPORTAÇÃO DE IMAGEM — dois problemas do html2canvas resolvidos aqui
   ===================================================================== */

/* 1) object-fit não é implementado pelo html2canvas: a imagem aparece
   recortada na tela e ESTICADA no PNG.

   A primeira versão disto trocava cada <img> por um <div> com
   background-size — e era exatamente aí que a qualidade morria. O
   html2canvas rasteriza `background-image` num canvas do tamanho em CSS px
   e SÓ DEPOIS amplia tudo pela `scale`: um pôster de 204px virava 204px
   esticados para 734px no PNG final. Daí o card sair borrado.

   Agora recortamos a imagem num canvas já na resolução FINAL (tamanho na
   tela × escala da exportação) e trocamos por um <img> na proporção exata
   do elemento. Como <img>, o html2canvas usa drawImage direto da fonte,
   sem passo intermediário — sai nítido. O <div> continua existindo só como
   plano B para imagem de outra origem sem CORS (canvas "tainted"). */

/* cópia da imagem com CORS habilitado, pra poder ler os pixels no canvas.
   Se o servidor não liberar CORS, resolve null e caímos no plano B. */
const _imgCorsCache = new Map();
function carregarImagemCors(src){
  if(_imgCorsCache.has(src)) return _imgCorsCache.get(src);
  const p = new Promise(resolve => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    let pronto = false;
    const fim = v => { if(!pronto){ pronto = true; resolve(v); } };
    im.onload  = () => fim(im.naturalWidth ? im : null);
    im.onerror = () => fim(null);
    setTimeout(() => fim(null), 15000);   // nunca deixa a exportação pendurada
    im.src = src;
  });
  if(_imgCorsCache.size > 40) _imgCorsCache.clear();   // teto simples de memória
  _imgCorsCache.set(src, p);
  return p;
}

/* Downscale em etapas. Reduzir 4x de uma vez no canvas serrilha a imagem
   (o filtro do navegador só amostra 2x2); cortar pela metade a cada passo
   dá o mesmo resultado de um resample de verdade. */
function desenharSuave(ctx, fonte, sx, sy, sw, sh, dx, dy, dw, dh){
  let orig = fonte, ox = sx, oy = sy, ow = sw, oh = sh;
  while(ow > dw * 2 && oh > dh * 2){
    const nw = Math.max(dw, Math.round(ow / 2)), nh = Math.max(dh, Math.round(oh / 2));
    const tmp = document.createElement('canvas');
    tmp.width = nw; tmp.height = nh;
    const tctx = tmp.getContext('2d');
    if(!tctx) break;
    tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(orig, ox, oy, ow, oh, 0, 0, nw, nh);
    orig = tmp; ox = 0; oy = 0; ow = nw; oh = nh;
  }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(orig, ox, oy, ow, oh, dx, dy, dw, dh);
}

/* recorta `src` no formato do elemento (cover/contain) já na resolução final */
async function recortarNaResolucao(src, destW, destH, fit, escala){
  const fonte = await carregarImagemCors(src);
  if(!fonte) return null;
  const nw = fonte.naturalWidth, nh = fonte.naturalHeight;
  if(!nw || !nh) return null;

  const k = Math.max(1, Number(escala) || 1);
  let cw = Math.round(destW * k), ch = Math.round(destH * k);
  /* teto de 4096px por lado: acima disso o iOS devolve canvas em branco */
  const maior = Math.max(cw, ch);
  if(maior > 4096){ const f = 4096 / maior; cw = Math.round(cw * f); ch = Math.round(ch * f); }
  if(cw < 1 || ch < 1) return null;

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  if(!ctx) return null;

  if(fit === 'contain'){
    const e = Math.min(cw / nw, ch / nh);
    const w = Math.max(1, Math.round(nw * e)), h = Math.max(1, Math.round(nh * e));
    desenharSuave(ctx, fonte, 0, 0, nw, nh, Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
  }else{                                            // cover
    const e = Math.max(cw / nw, ch / nh);
    const sw = Math.max(1, Math.min(nw, Math.round(cw / e)));
    const sh = Math.max(1, Math.min(nh, Math.round(ch / e)));
    desenharSuave(ctx, fonte, Math.round((nw - sw) / 2), Math.round((nh - sh) / 2), sw, sh, 0, 0, cw, ch);
  }
  /* PNG: o recorte ainda vai ser reamostrado pelo html2canvas, então
     recomprimir em JPEG aqui só somaria artefato em cima de artefato */
  try{ return cv.toDataURL('image/png'); }
  catch(e){ return null; }                          // canvas "tainted" (sem CORS)
}

async function comImagensRecortadas(area, tarefa, escala){
  const trocas = [];
  const alvos = area ? Array.from(area.querySelectorAll('img')) : [];

  for(const img of alvos){
    let cs; try{ cs = getComputedStyle(img); }catch(e){ continue; }
    const fit = cs.objectFit;
    if(fit !== 'cover' && fit !== 'contain') continue;
    const src = img.currentSrc || img.src;
    if(!src) continue;
    /* offsetWidth/Height em vez do rect: não é afetado por transform de
       animação, então o substituto nasce do tamanho certo mesmo se o modal
       ainda estiver no meio da transição de entrada */
    const r = img.getBoundingClientRect();
    const w = img.offsetWidth || r.width, h = img.offsetHeight || r.height;
    if(!w || !h) continue;

    let sub = null;
    let recorte = null;
    try{ recorte = await recortarNaResolucao(src, w, h, fit, escala); }catch(e){ recorte = null; }

    if(recorte){
      /* caminho bom: <img> já na proporção do elemento e em alta resolução.
         Bônus: sendo data: URL, não "tainta" o canvas do html2canvas. */
      sub = new Image();
      sub.src = recorte;
      sub.style.cssText =
        `width:${w}px;height:${h}px;flex:none;display:block;object-fit:fill;` +
        `border-radius:${cs.borderRadius};`;
      try{ if(sub.decode) await sub.decode(); }catch(e){ /* segue: html2canvas espera de novo */ }
    }else{
      /* plano B (imagem de outra origem sem CORS): perde nitidez, mas não
         estica nem derruba a exportação */
      sub = document.createElement('div');
      sub.style.cssText =
        `width:${w}px;height:${h}px;flex:none;display:block;` +
        `border-radius:${cs.borderRadius};` +
        `background-image:url("${src.replace(/"/g, '\\"')}");background-size:${fit};` +
        `background-position:center;background-repeat:no-repeat;`;
    }

    if(!img.parentNode) continue;
    img.parentNode.insertBefore(sub, img);
    trocas.push({ img, sub, displayAntes: img.style.display });
    img.style.display = 'none';
  }

  try{ return await tarefa(); }
  finally{ trocas.forEach(t => { t.sub.remove(); t.img.style.display = t.displayAntes; }); }
}

/* 2) Cores dominantes da capa, pro fundo do compartilhamento (a ideia é a
   mesma do Spotify: o cartão nasce com a cara do pôster).

   Se a imagem for de outra origem sem CORS liberado, o canvas fica "tainted"
   e getImageData lança — daí caímos na paleta do site em vez de quebrar. */
const _coresCache = {};
async function coresDaImagem(url){
  const chave = String(url || '');
  if(!chave) return null;
  /* só usa o cache se uma tentativa ANTERIOR teve sucesso. Uma falha (null)
     não é memorizada: pode ter sido um soluço passageiro (cold start do
     Storage, ou o service worker servindo uma resposta opaca pra um pedido
     que precisava de CORS de verdade — ver 09-riscos), e vale tentar de
     novo na próxima vez que o card for aberto, em vez de ficar cinza pelo
     resto da sessão inteira por causa de uma falha de um instante só. */
  if(_coresCache[chave]) return _coresCache[chave];

  const resultado = await new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try{
        const N = 40;
        const cv = document.createElement('canvas');
        cv.width = N; cv.height = N;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, N, N);
        const px = ctx.getImageData(0, 0, N, N).data;

        /* agrupa por faixa grossa de cor e guarda a média real de cada grupo,
           pra não devolver uma cor "quantizada" feia */
        const baldes = {};
        for(let i = 0; i < px.length; i += 4){
          const a = px[i+3]; if(a < 128) continue;
          const r = px[i], g = px[i+1], b = px[i+2];
          const max = Math.max(r,g,b), min = Math.min(r,g,b);
          if(max < 28 || min > 232) continue;            // quase preto ou quase branco
          const k = `${r>>5}|${g>>5}|${b>>5}`;
          const o = baldes[k] || (baldes[k] = { n:0, r:0, g:0, b:0, sat:0 });
          o.n++; o.r += r; o.g += g; o.b += b;
          o.sat += max === 0 ? 0 : (max - min) / max;
        }
        const lista = Object.keys(baldes).map(k => {
          const o = baldes[k];
          return { n:o.n, sat:o.sat/o.n, r:Math.round(o.r/o.n), g:Math.round(o.g/o.n), b:Math.round(o.b/o.n) };
        });
        if(!lista.length) return resolve(null);

        /* pontua frequência E saturação: a cor mais comum costuma ser um
           cinza de fundo, que daria um cartão sem graça */
        lista.sort((x, y) => (y.n * (0.35 + y.sat)) - (x.n * (0.35 + x.sat)));
        const hex = c => '#' + [c.r,c.g,c.b].map(v => v.toString(16).padStart(2,'0')).join('');
        const principal = lista[0];
        const dist = c => Math.abs(c.r-principal.r) + Math.abs(c.g-principal.g) + Math.abs(c.b-principal.b);
        const secundaria = lista.slice(1).find(c => dist(c) > 90) || lista[1] || principal;
        resolve({ principal: hex(principal), secundaria: hex(secundaria) });
      }catch(e){
        // canvas "tainted": a imagem carregou mas o navegador recusou ler os
        // pixels. Quase sempre é CORS (ver 09-riscos) — logamos o motivo
        // real em vez de engolir, porque esse catch escondia o diagnóstico.
        console.warn('coresDaImagem: canvas tainted (provável falta de CORS)', chave, e);
        resolve(null);
      }
    };
    img.onerror = (ev) => {
      console.warn('coresDaImagem: a imagem não carregou em modo CORS', chave, ev);
      resolve(null);
    };
    img.src = chave;
  });

  /* só grava no cache o que deu certo — falha não é persistida (ver acima) */
  if(resultado) _coresCache[chave] = resultado;
  return resultado;
}

/* escurece/clareia um hex — usado pra derivar um degradê legível */
function ajustarCor(hex, fator){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if(!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n>>16)&255, (n>>8)&255, n&255].map(v => {
    const x = fator >= 0 ? v + (255 - v) * fator : v * (1 + fator);
    return Math.max(0, Math.min(255, Math.round(x)));
  });
  return '#' + ch.map(v => v.toString(16).padStart(2,'0')).join('');
}

async function baixarImagem(areaId, nomeArquivo, btn){
  const original = btn.textContent;
  btn.textContent = 'Gerando...';
  try{
    const area = document.getElementById(areaId);
    await aguardarImagens(area);
    /* mira ~1600px de largura em vez de escala fixa: num celular estreito a
       escala 2 fixa gerava um PNG de ~700px, que é o que deixava a grade
       do "Monte o Seu" pixelada ao abrir no computador */
    const escala = Math.min(4, Math.max(2, 1600 / (area.offsetWidth || 800)));
    /* sem isto, o pôster sai esticado no PNG do "Monte o Seu" */
    const canvas = await comImagensRecortadas(area, () => html2canvas(area, {
      backgroundColor: '#17181c', scale: escala, useCORS: true, imageTimeout: 15000,
      onclone: doc => neutralizarAnimacoes(doc, areaId)
    }), escala);
    const link = document.createElement('a');
    link.download = nomeArquivo;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }catch(e){
    console.error(e);
    alert('Não foi possível gerar a imagem.');
  }finally{
    btn.textContent = original;
  }
}

/* ---------------------- escolha de escopo antes de compartilhar (página "Monte o seu") ----------------------
   Pergunta se a pessoa quer compartilhar a nota do festival inteiro, de uma
   noite específica ou de um episódio específico. Resolve com
   { tipo:'festival' } | { tipo:'noite', valor:N } | { tipo:'episodio', valor:N },
   ou null se cancelou. */
function abrirEscolhaEscopo(numNoites, maxEps){
  return new Promise(resolve => {
    let noiteOpts = '';
    for(let s = 1; s <= numNoites; s++) noiteOpts += `<option value="${s}">Noite ${s}</option>`;
    // episódios de UMA noite específica (o nº pode variar por noite)
    const epsDeNoite = s => {
      const n = (typeof epsDaNoite === 'function') ? epsDaNoite(s) : maxEps;
      let o = ''; for(let e = 1; e <= n; e++) o += `<option value="${e}">Episódio ${e}</option>`; return o;
    };

    const overlay = document.createElement('div');
    overlay.className = 'share-overlay';
    overlay.innerHTML = `
      <div class="share-modal" style="max-width: 340px;">
        <div class="noite-card escopo-card" style="width:100%;">
          <h2 style="margin:0 0 4px;">Compartilhar nota de…</h2>
          <div class="cfg-group-sub" style="margin-bottom:14px;">Escolha o que essa nota representa.</div>
          <div class="escopo-opcoes">
            <label class="escopo-opt"><input type="radio" name="escopoShare" value="festival" checked> 🎪 O festival inteiro</label>
            <label class="escopo-opt"><input type="radio" name="escopoShare" value="noite"> 🌙 Uma noite específica</label>
            <select id="escopoNoiteSel" class="escopo-select" style="display:none;">${noiteOpts}</select>
            <label class="escopo-opt"><input type="radio" name="escopoShare" value="episodio"> 🎬 Um episódio específico</label>
            <div id="escopoEpWrap" style="display:none; flex-direction:column; gap:8px;">
              <select id="escopoEpNoiteSel" class="escopo-select">${noiteOpts}</select>
              <select id="escopoEpSel" class="escopo-select">${epsDeNoite(1)}</select>
            </div>
          </div>
          <div class="share-actions" style="margin-top:16px; justify-content:flex-end;">
            <button class="btn btn-ghost" id="escopoCancelar">Cancelar</button>
            <button class="btn btn-solid" id="escopoConfirmar">Compartilhar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const radios = overlay.querySelectorAll('input[name="escopoShare"]');
    const selNoite = overlay.querySelector('#escopoNoiteSel');
    const selEpNoite = overlay.querySelector('#escopoEpNoiteSel');
    const selEp = overlay.querySelector('#escopoEpSel');
    const epWrap = overlay.querySelector('#escopoEpWrap');
    // ao trocar a noite do episódio, recarrega a lista de episódios daquela noite
    selEpNoite.addEventListener('change', () => { selEp.innerHTML = epsDeNoite(Number(selEpNoite.value)); });
    function atualizarSelects(){
      const v = overlay.querySelector('input[name="escopoShare"]:checked').value;
      selNoite.style.display = (v === 'noite') ? '' : 'none';
      epWrap.style.display = (v === 'episodio') ? 'flex' : 'none';
    }
    radios.forEach(r => r.addEventListener('change', atualizarSelects));

    const fechar = resultado => { overlay.remove(); resolve(resultado); };
    overlay.addEventListener('click', ev => { if(ev.target === overlay) fechar(null); });
    overlay.querySelector('#escopoCancelar').addEventListener('click', () => fechar(null));
    overlay.querySelector('#escopoConfirmar').addEventListener('click', () => {
      const v = overlay.querySelector('input[name="escopoShare"]:checked').value;
      if(v === 'noite') fechar({ tipo: 'noite', valor: Number(selNoite.value) });
      else if(v === 'episodio') fechar({ tipo: 'episodio', noite: Number(selEpNoite.value), valor: Number(selEp.value) });
      else fechar({ tipo: 'festival' });
    });
  });
}

/* ---------------------- cartão compartilhável (story estilo Letterboxd) ----------------------
   Gera um card vertical (pôster + título + nota em estrelas + marca CETECritic)
   pronto pra postar no story do Insta. Usado nas peças e nas edições. */
function garantirHtml2Canvas(){
  if(typeof html2canvas !== 'undefined') return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = res; s.onerror = () => rej(new Error('html2canvas'));
    document.head.appendChild(s);
  });
}
function pctEstrelas(nota){
  const max = (typeof NOTA_MAXIMA !== 'undefined') ? NOTA_MAXIMA : 10;
  if(nota === null || nota === undefined || isNaN(nota)) return 0;
  return Math.max(0, Math.min(100, (nota / max) * 100));
}
/* opts: { poster, titulo, sub, nota, legenda, arquivo } */
function abrirCompartilhamento(opts){
  const max = (typeof NOTA_MAXIMA !== 'undefined') ? NOTA_MAXIMA : 10;
  const temNota = (opts.nota !== null && opts.nota !== undefined && !isNaN(opts.nota));
  const pct = pctEstrelas(opts.nota);
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <div class="share-palco" id="sharePalco">
      <div class="share-card" id="shareCard">
        <div class="sc-poster-wrap${opts.poster ? '' : ' sem-poster'}">${opts.poster ? `<img class="sc-poster-img" src="${esc(opts.poster)}" alt="" onerror="this.closest('.sc-poster-wrap').classList.add('sem-poster'); this.remove();">` : ''}</div>
        <div class="sc-body">
          <div class="sc-title">${esc(opts.titulo)}</div>
          ${opts.sub ? `<div class="sc-sub">${esc(opts.sub)}</div>` : ''}
          ${temNota
            ? `<div class="sc-stars"><span class="sc-stars-base">★★★★★</span><span class="sc-stars-fill" style="width:${pct}%">★★★★★</span></div>
               <div class="sc-nota">${Number(opts.nota).toFixed(1)}<span>/${max}</span></div>`
            : `<div class="sc-nota sc-semnota">Ainda sem avaliações</div>`}
          ${opts.legenda ? `<div class="sc-legenda">${esc(opts.legenda)}</div>` : ''}
          <div class="sc-brand"><img src="${BASE}assets/logo.png" alt="" onerror="this.remove()"><span>CETECritic</span></div>
        </div>
      </div>
      </div>
      <div class="share-fundos" id="shareFundos" role="group" aria-label="Fundo do card">
        <button class="fundo-opt ativo" data-fundo="principal"  title="Cor principal"></button>
        <button class="fundo-opt"       data-fundo="degrade"    title="Degradê"></button>
        <button class="fundo-opt"       data-fundo="secundaria" title="Cor secundária"></button>
        <button class="fundo-opt fundo-nenhum" data-fundo="nenhum" title="Sem fundo (PNG transparente)"></button>
      </div>
      <div class="share-actions">
        <button class="btn btn-solid" id="shareBaixar">📥 Baixar</button>
        <button class="btn btn-ghost" id="shareEnviar">📤 Compartilhar</button>
        <button class="btn btn-ghost" id="shareFechar">Fechar</button>
      </div>
      <div class="share-hint" id="shareHint">Dica: no celular, "Compartilhar" abre direto o Instagram, WhatsApp etc.</div>
    </div>`;
  document.body.appendChild(overlay);
  const fechar = () => overlay.remove();
  overlay.addEventListener('click', ev => { if(ev.target === overlay) fechar(); });
  overlay.querySelector('#shareFechar').addEventListener('click', fechar);

  const card = overlay.querySelector('#shareCard');
  const palco = overlay.querySelector('#sharePalco');
  const hint = overlay.querySelector('#shareHint');
  const bBaixar = overlay.querySelector('#shareBaixar');
  const bEnviar = overlay.querySelector('#shareEnviar');

  /* ---- fundo do card (estilo Spotify) --------------------------------
     As cores saem da própria capa. O fundo resolve, de quebra, o problema
     das "pontas pretas" no story: exportando o palco inteiro não existe
     canto transparente para o Instagram achatar em preto. Quem quiser o
     PNG recortado escolhe "sem fundo" — aí exportamos só o card, e a
     transparência é intencional. */
  let FUNDOS = {
    principal: '#1f2126',
    secundaria: '#3a3d44',
    degrade: 'linear-gradient(160deg, #1f2126 0%, #3a3d44 100%)'
  };
  let fundoAtual = 'principal';

  function pintarFundo(){
    palco.classList.toggle('sem-fundo', fundoAtual === 'nenhum');
    palco.style.background = fundoAtual === 'nenhum' ? 'transparent' : FUNDOS[fundoAtual];
  }
  function pintarAmostras(){
    const b = overlay.querySelectorAll('.fundo-opt');
    b[0].style.background = FUNDOS.principal;
    b[1].style.background = FUNDOS.degrade;
    b[2].style.background = FUNDOS.secundaria;
  }
  pintarAmostras(); pintarFundo();

  /* extrai as cores da capa em segundo plano: se falhar (imagem de outra
     origem sem CORS), fica a paleta neutra acima e nada quebra */
  if(opts.poster) coresDaImagem(opts.poster).then(c => {
    if(!c) return;
    FUNDOS = {
      principal: c.principal,
      secundaria: c.secundaria,
      degrade: `linear-gradient(160deg, ${c.principal} 0%, ${ajustarCor(c.secundaria, -0.15)} 100%)`
    };
    pintarAmostras(); pintarFundo();
  });

  overlay.querySelector('#shareFundos').addEventListener('click', ev => {
    const b = ev.target.closest('.fundo-opt'); if(!b) return;
    overlay.querySelectorAll('.fundo-opt').forEach(x => x.classList.remove('ativo'));
    b.classList.add('ativo');
    fundoAtual = b.dataset.fundo;
    pintarFundo();
    hint.textContent = fundoAtual === 'nenhum'
      ? 'Sem fundo: baixa só o card, com as bordas transparentes.'
      : 'Dica: no celular, "Compartilhar" abre direto o Instagram, WhatsApp etc.';
  });

  async function gerarBlob(){
    await garantirHtml2Canvas();
    /* "sem fundo" exporta só o card (transparente, de propósito).
       Com fundo, exporta o palco inteiro — sem canto transparente sobrando. */
    const alvo = fundoAtual === 'nenhum' ? card : palco;
    await aguardarImagens(alvo);
    /* mira 1080px de largura (padrão de story) em vez de uma escala fixa:
       assim o PNG sai na mesma resolução independente do tamanho que o card
       tiver na tela, inclusive no celular */
    const escala = Math.min(6, Math.max(2, 1080 / (alvo.offsetWidth || 320)));
    const canvas = await comImagensRecortadas(alvo, () => html2canvas(alvo, {
      backgroundColor: null, scale: escala, useCORS: true, imageTimeout: 15000
    }), escala);
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  }
  bBaixar.addEventListener('click', async () => {
    bBaixar.disabled = true; hint.textContent = 'Gerando imagem...';
    try{
      const blob = await gerarBlob();
      const a = document.createElement('a');
      a.download = opts.arquivo || 'cetecritic.png';
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
      hint.textContent = 'Imagem salva! 📸';
    }catch(e){ console.error(e); hint.textContent = 'Não foi possível gerar a imagem.'; }
    bBaixar.disabled = false;
  });
  bEnviar.addEventListener('click', async () => {
    bEnviar.disabled = true; hint.textContent = 'Gerando imagem...';
    try{
      const blob = await gerarBlob();
      const file = new File([blob], opts.arquivo || 'cetecritic.png', { type: 'image/png' });
      if(navigator.canShare && navigator.canShare({ files: [file] })){
        await navigator.share({ files: [file], title: opts.titulo });
        hint.textContent = '';
      }else{
        const a = document.createElement('a'); a.download = file.name; a.href = URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href);
        hint.textContent = 'Seu navegador não compartilha imagem direto — baixamos pra você postar. 📸';
      }
    }catch(e){ if(!(e && e.name === 'AbortError')){ console.error(e); hint.textContent = 'Não foi possível compartilhar.'; } }
    bEnviar.disabled = false;
  });
}

/* ---------------------- estatísticas & badges ---------------------- */
function statsDeVals(vals){
  const n = vals.length;
  if(!n) return null;
  const avg = vals.reduce((a,b)=>a+b,0)/n;
  const std = Math.sqrt(vals.reduce((a,b)=>a+(b-avg)*(b-avg),0)/n);
  return {
    n, avg, std,
    min: Math.min(...vals), max: Math.max(...vals),
    p9: vals.filter(v => v >= 9).length / n,          // % de notas 9+
    p10: vals.filter(v => v >= NOTA_MAXIMA - 0.01).length / n, // % de notas máximas
    pos: vals.filter(v => v >= 7).length,             // elogios
    neg: vals.filter(v => v <= 4).length              // críticas
  };
}

/* ---------------------------------------------------------------------
   AS NOVE BADGES DE PEÇA

   Toda badge daqui é POSITIVA por decisão de projeto. Nenhuma aponta a pior
   peça do ano: são estudantes que subiram no palco, e o site existe pra
   celebrar o festival, não pra constranger ninguém. "Polêmica" é o limite —
   e ela diz "dividiu opinião", que numa mostra de teatro é elogio.

   Cada uma mede um EIXO diferente. Se duas medissem quase a mesma coisa,
   uma delas nunca encontraria dono (ver a regra de desempate no
   badgesDoAno logo abaixo):

     campea        o topo da média
     melhorHist    o topo da média entre TODAS as edições
     favorita      o pico do entusiasmo  (fatia de notas 9+)
     polemica      a dispersão pra cima
     consistente   a dispersão pra baixo
     maisAvaliada  alcance (quanta gente viu)
     joiaEscondida alcance INVERTIDO (nota alta com pouca gente)
     bocaABoca     o TEMPO (a nota subiu conforme mais gente avaliou)
     bemRecebida   saldo de elogios sobre críticas (consolação)

   Tudo aqui é relativo à PRÓPRIA EDIÇÃO: a mediana que separa "pouca gente
   viu", a comparação de dispersão, o crescimento no tempo. A única exceção é
   a ⭐ melhorHist, que por definição compara o acervo inteiro e é atribuída
   fora desta função.
   --------------------------------------------------------------------- */
const BADGES_DEF = {
  campea:        { emoji:'🥇', nome:'Campeã do ano', desc:'A peça com a maior nota média da edição.' },
  melhorHist:    { emoji:'⭐', nome:'Melhor episódio da história', desc:'A maior nota média entre TODAS as edições do festival.' },
  favorita:      { emoji:'👏', nome:'Favorita do público', desc:'A maior porcentagem de notas 9+ da edição.' },
  polemica:      { emoji:'🔥', nome:'Polêmica', desc:'As notas mais divididas do ano — teve gente amando e gente detestando.' },
  consistente:   { emoji:'🎯', nome:'Consistente', desc:'As notas mais parecidas do ano — quase todo mundo deu a mesma nota.' },
  maisAvaliada:  { emoji:'📊', nome:'Mais avaliada', desc:'A peça que mais recebeu notas na edição.' },
  joiaEscondida: { emoji:'💎', nome:'Joia escondida', desc:'A melhor nota entre as peças que menos gente avaliou naquela edição — quem viu, viu.' },
  bocaABoca:     { emoji:'🗣️', nome:'Boca a boca', desc:'A nota dela subiu conforme mais gente foi avaliando — começou discreta e cresceu no boca a boca.' },
  bemRecebida:   { emoji:'📈', nome:'Bem recebida', desc:'Mais elogios (notas 7+) do que críticas (notas 4 ou menos).' }
};

/* =====================================================================
   badgesDoAno — as badges de UMA edição, a partir dos votos dela
   =====================================================================
   Retorna { 's1e1': [badge, ...], ... }

   O QUE ESTAVA ERRADO ANTES

   A regra "uma badge por peça" era aplicada assim: cada critério elegia a
   sua campeã e, se ela JÁ tivesse badge, aquele critério simplesmente ficava
   sem dono no ano. O comentário antigo dizia isso com todas as letras.

   Na prática as badges se atropelavam quase sempre, porque os critérios são
   correlacionados: a peça de maior média costuma ser também a com mais notas
   9+ (👏 Favorita) e uma das mais consensuais (🎯 Consistente). Numa edição
   típica, três ou quatro das badges eram eleitas pela MESMA peça — a
   primeira ficava com ela e as outras não iam pra ninguém. Era comum sobrar
   duas ou três badges distribuídas de sete.

   COMO FICOU

   Cada critério agora ORDENA todas as candidatas e desce a lista até achar
   uma que ainda não tenha badge. A campeã de média continua ganhando 🥇; a
   segunda colocada em notas 9+ leva o 👏 se a primeira já estiver ocupada.
   Nenhuma peça acumula, nenhum critério fica órfão enquanto houver peça
   elegível — que é o que o texto do Hall sempre prometeu.

   A ORDEM DA LISTA É A PRIORIDADE, e ela põe as badges RARAS primeiro — não
   as mais prestigiosas. O motivo está comentado em cima do array CRITERIOS,
   com os números que sustentam a escolha.

   As badges de qualidade têm PISO (`minimo`): num ano em que a peça pouco
   vista de melhor nota tirou 6,0, ninguém recebe "💎 Joia escondida" — badge
   que se dá a qualquer coisa deixa de significar alguma coisa.

   (⭐ da história e as badges manuais do hall-dados.js entram por fora e não
   contam no limite de uma por peça.)
   ===================================================================== */
function badgesDoAno(subs){
  const stats = {};
  const chaves = new Set();
  (subs || []).forEach(s => { if(s && s.grid) Object.keys(s.grid).forEach(k => chaves.add(k)); });
  chaves.forEach(k => {
    const vals = (subs || []).map(s => Number(s.grid[k])).filter(v => !isNaN(v));
    const st = statsDeVals(vals);
    if(st) stats[k] = st;
  });
  const ks = Object.keys(stats);
  const out = {};
  ks.forEach(k => out[k] = []);
  if(!ks.length) return out;

  const minAv = (typeof HALL !== 'undefined' && HALL.minAvaliacoes) || 3;
  let elig = ks.filter(k => stats[k].n >= minAv);
  if(!elig.length) elig = ks;                 // pouca gente votou ainda: usa o que tem

  /* ---------------------------------------------------------------------
     CRESCIMENTO NO TEMPO — o eixo do 🗣️ Boca a boca

     Compara a média da PRIMEIRA metade dos votos daquela peça com a da
     SEGUNDA metade, ordenadas por horário. Como cada pessoa envia a grade
     inteira de uma vez, na prática isto compara "quem votou logo depois da
     noite" com "quem votou dias depois" — que é exatamente o sinal de boca
     a boca que se quer capturar.

     Os dois pisos existem porque este é o critério mais ruidoso do conjunto,
     e sem eles ele premiaria acaso:

       BOCA_MIN_VOTOS  — com menos que isto, primeira metade contra segunda
                         metade é praticamente sorteio;
       BOCA_MIN_DELTA  — um ganho menor que meio ponto não é história
                         nenhuma, é oscilação normal.

     Em contagem ímpar o voto do meio fica de fora das duas metades, para não
     contaminar os dois lados com o mesmo dado.
     --------------------------------------------------------------------- */
  const BOCA_MIN_VOTOS = 8;
  const BOCA_MIN_DELTA = 0.5;
  const crescimento = {};
  chaves.forEach(k => {
    const pares = (subs || [])
      .map(sub => ({ ts: Number(sub && sub.ts) || 0, v: Number(sub && sub.grid && sub.grid[k]) }))
      .filter(x => x.ts > 0 && !isNaN(x.v))
      .sort((a, b) => a.ts - b.ts);
    if(pares.length < BOCA_MIN_VOTOS) return;      // amostra pequena demais
    const metade = Math.floor(pares.length / 2);
    const cedo = pares.slice(0, metade);
    const tarde = pares.slice(pares.length - metade);
    const m = arr => arr.reduce((a, x) => a + x.v, 0) / arr.length;
    crescimento[k] = m(tarde) - m(cedo);
  });

  /* mediana de avaliações — separa "muita gente viu" de "pouca gente viu",
     que é o eixo do 📊 e do 💎 */
  const ns = elig.map(k => stats[k].n).sort((a, b) => a - b);
  const medianaN = ns[Math.floor(ns.length / 2)];

  /* Cada critério é { tipo, entre, por, maior, minimo }:
       entre  — quem pode concorrer
       por    — (stats, chave) => valor comparado. Recebe a chave também
                porque nem todo eixo cabe no `stats` (o 🗣️ mede crescimento
                no tempo, que vive num mapa à parte)
       maior  — true = vence o maior; false = vence o menor
       minimo — piso de qualidade (média), quando a badge afirma que é boa */
  /* ---------------------------------------------------------------------
     A ORDEM AQUI É A PRIORIDADE — e ela é diferente da ordem em que as
     badges aparecem no Hall, de propósito.

     A vitrine ordena por prestígio, que é como o público lê a lista. Aqui a
     ordem é operacional: quem escolhe primeiro leva. E a regra que funciona
     é RARAS PRIMEIRO.

     Por quê: um critério raro colocado no fim quase nunca chega a alguém.
     A peça que cresceu no boca a boca costuma ser boa também, então ela já
     foi levada por 🥇, 👏 ou 🤝 antes de o 🗣️ ter vez — e o critério fica
     órfão descrevendo uma história que ninguém vê.

     Medido em 400 edições simuladas, movendo 💎 e 🗣️ para logo depois da 🥇:

         💎 Joia escondida    84% -> 97% das edições
         🗣️ Boca a boca       54% -> 72%

     e nenhuma das outras perdeu nada relevante.
     --------------------------------------------------------------------- */
  const CRITERIOS = [
    { tipo:'campea',        entre: elig,
      por: s => s.avg, maior: true },

    /* o avesso do 📊: entre as peças que MENOS gente avaliou, a melhor.
       Existe porque o sistema todo empurra pra frente quem já tem público, e
       uma peça ótima numa noite de chuva ficava invisível pra sempre. */
    { tipo:'joiaEscondida', entre: elig.filter(k => stats[k].n <= medianaN),
      por: s => s.avg, maior: true, minimo: 7.5 },

    /* a peça que mais cresceu entre a primeira e a segunda metade dos votos.
       Só concorre quem cresceu ACIMA do piso de ruído. */
    { tipo:'bocaABoca',     entre: elig.filter(k => (crescimento[k] || 0) >= BOCA_MIN_DELTA),
      por: (s, k) => crescimento[k] || 0, maior: true, minimo: 7 },

    { tipo:'favorita',      entre: elig.filter(k => stats[k].p9 > 0),
      por: s => s.p9, maior: true },

    { tipo:'polemica',      entre: elig.filter(k => stats[k].std > 0),
      por: s => s.std, maior: true },

    { tipo:'consistente',   entre: elig.length > 1 ? elig : [],
      por: s => s.std, maior: false },

    { tipo:'maisAvaliada',  entre: elig,
      por: s => s.n, maior: true }
  ];

  const livre = k => out[k] && out[k].length === 0;

  CRITERIOS.forEach(c => {
    const candidatas = (c.entre || [])
      .filter(k => c.minimo === undefined || stats[k].avg >= c.minimo)
      .sort((a, b) => {
        const d = c.maior ? c.por(stats[b], b) - c.por(stats[a], a)
                          : c.por(stats[a], a) - c.por(stats[b], b);
        /* desempate estável: mais avaliações e, no fim, a chave — sem isso a
           mesma edição poderia dar badges diferentes em navegadores
           diferentes, conforme a ordem em que os votos chegaram */
        return d || (stats[b].n - stats[a].n) || a.localeCompare(b);
      });
    /* desce a lista até achar quem ainda não tem badge. ERA AQUI o bug:
       antes só a primeira colocada era considerada, e se ela estivesse
       ocupada o critério inteiro ficava sem dono. */
    const vencedora = candidatas.find(livre);
    if(vencedora) out[vencedora].push(BADGES_DEF[c.tipo]);
  });

  /* consolação, sempre por último: a peça ainda sem badge com o melhor saldo
     de elogios (7+) sobre críticas (4-) */
  const semBadge = elig.filter(k => livre(k) && stats[k].pos > stats[k].neg)
    .sort((a, b) => (stats[b].pos - stats[b].neg) - (stats[a].pos - stats[a].neg) || a.localeCompare(b));
  if(semBadge.length) out[semBadge[0]].push(BADGES_DEF.bemRecebida);

  return out;
}

function htmlBadges(lista){
  return (lista || []).map(b => `<span class="badge" title="${b.nome}${b.desc ? ' — ' + b.desc : ''}">${b.emoji}</span>`).join('');
}

/* ---- badges extras (manuais, definidas no hall-dados.js) ----
   O hall.html carrega o hall-dados.js direto; as páginas de noite buscam
   o arquivo sob demanda para as badges extras aparecerem lá também. */
let HALL_CFG = (typeof HALL !== 'undefined') ? HALL : null;
/* ---- carregador dos dados de uma edição (edicao.js + noites/*.js) ----
   Hall, perfil e busca faziam exatamente isto, cada um com a sua cópia do
   código e nenhum com cache. Num acervo de 15 edições de 5 noites, abrir o
   Hall e depois a busca disparava ~180 requisições pros MESMOS arquivos —
   e a busca ainda fazia em série (cada edição só começava quando a anterior
   terminava). Agora a promessa fica guardada por ano e é reaproveitada.

   De quebra, uma noite que falhe (404, arquivo ainda não publicado) não
   derruba mais a edição inteira: antes o HTML da página de erro entrava no
   texto concatenado e o `new Function` estourava com erro de sintaxe. */
const _edicaoCache = new Map();
function carregarDadosEdicao(cfg){
  const ano = cfg && cfg.ano;
  if(!ano) return Promise.resolve(null);
  if(_edicaoCache.has(ano)) return _edicaoCache.get(ano);

  const p = (async () => {
    try{
      const nNoites = Number(cfg.noites) || 0;
      const textos = await Promise.all([
        fetch(`${BASE}${ano}/edicao.js`).then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }),
        ...Array.from({ length: nNoites }, (_, i) =>
          fetch(`${BASE}${ano}/noites/noite-${i+1}.js`).then(r => r.ok ? r.text() : '').catch(() => ''))
      ]);
      const d = new Function(textos.join('\n') +
        '\n;return { EDICAO: typeof EDICAO !== "undefined" ? EDICAO : null,' +
        ' NOITES: typeof NOITES !== "undefined" ? NOITES : {} };')();
      if(!d.EDICAO) throw new Error('edicao.js sem EDICAO');
      return { cfg, ed: d.EDICAO, noites: d.NOITES || {} };
    }catch(e){
      console.warn('Falha ao carregar a edição', ano, e);
      _edicaoCache.delete(ano);     // falha de rede não fica grudada no cache
      return null;
    }
  })();

  _edicaoCache.set(ano, p);
  return p;
}

async function carregarHallDados(){
  if(HALL_CFG) return HALL_CFG;
  try{
    const txt = await fetch(BASE + 'hall-dados.js', { cache: 'no-store' }).then(r => r.text());
    HALL_CFG = new Function(txt + '\n;return HALL;')();
  }catch(e){ HALL_CFG = {}; }
  return HALL_CFG;
}
function badgesExtrasDaPeca(ano, key){
  const lista = (HALL_CFG && HALL_CFG.badgesExtras) || [];
  return lista.filter(b => Number(b.ano) === Number(ano) && b.chave === key);
}

/* =====================================================================
   PÁGINA: EDIÇÃO (votação / notas agregadas)
   ===================================================================== */
function paginaEdicao(){
  document.title = `${ED.titulo} - Avaliações`;

  /* -------- edição "Em breve" (sem countdown) -------- */
  if(edicaoEmBreve()){
    montarShell(`
      <div id="capture-area">
        <div class="left-panel">
          <div class="poster-box question-mark"><span>?</span></div>
          <div class="title-section"><h1>${esc(ED.titulo)}</h1><div class="description">-</div></div>
        </div>
        <div class="grid-blur-wrap">
          <div class="grid-panel">${gridVazioHtml()}</div>
          <div class="grid-blur-overlay">${htmlEmBreveBox()}</div>
        </div>
      </div>`);
    return;
  }

  /* -------- edição ainda não começou: teaser com blur + countdown -------- */
  if(!edicaoComecou()){
    montarShell(`
      <div id="capture-area">
        <div class="left-panel">
          <div class="poster-box question-mark"><span>?</span></div>
          <div class="title-section"><h1>${esc(ED.titulo)}</h1><div class="description">-</div></div>
        </div>
        <div class="grid-blur-wrap">
          <div class="grid-panel">${gridVazioHtml()}</div>
          <div class="grid-blur-overlay">${htmlCountdownBox(inicioEdicao(), true)}</div>
        </div>
      </div>`);
    fetchVotos(); // só para sincronizar o relógio
    return;
  }

  /* -------- edição em andamento ou encerrada -------- */
  /* próxima edição = o menor ano DEPOIS do atual no config.js;
     o abreEm dela só é usado para o countdown (se faltar/for inválido,
     o banner aparece sem contador em vez de pular para outro ano) */
  const proximaCfg = EDICOES
    .filter(e => e.ano > ANO)
    .sort((a,b) => a.ano - b.ano)[0];
  let proxima = null;
  if(proximaCfg){
    const d = proximaCfg.abreEm ? new Date(proximaCfg.abreEm) : null;
    proxima = { ano: proximaCfg.ano, d: (d && !isNaN(d) && d > agora()) ? d : null };
  }

  montarShell(`
    ${htmlHistBanner()}
    <div class="topbar">
      <div class="topbar-actions">
        <button class="btn btn-solid" id="openReviewModal" disabled title="Verificando horário no servidor...">Avaliar episódios</button>
        <button class="btn btn-ghost" id="downloadBtn">Baixar imagem</button>
        <button class="btn btn-ghost" id="shareEdicaoBtn">📤 Compartilhar edição</button>
      </div>
    </div>

    <div class="countdown-banner" id="countdownBanner" style="display:none;">
      As avaliações irão fechar em <span class="cd" ${FIM_VOTACAO ? `data-count-to="${FIM_VOTACAO.toISOString()}"` : ''}>--:--:--</span>
    </div>

    <div class="end-banner" id="endBanner" style="display:none;">
      <div class="end-banner-msg">${esc(ED.mensagemFim || 'Agradecemos o apoio de todos! 🎉')}</div>
      ${proxima ? (proxima.d
        ? `<div class="end-banner-countdown">Faltam <span class="cd" data-count-to="${proxima.d.toISOString()}">--</span> para o CETEC Festival ${proxima.ano}</div>`
        : `<div class="end-banner-countdown">Nos vemos no CETEC Festival ${proxima.ano}!</div>`) : ''}
    </div>

    <div id="capture-area">
      <div class="left-panel">
        <div class="poster-box${posterDaEdicao(ANO, ED.poster) ? ' has-image' : ''}" id="posterBox">
          ${htmlPoster(posterDaEdicao(ANO, ED.poster), '')}
          <div class="poster-hint"><b>Sem capa</b>Suba o poster desta edição pelo painel admin</div>
        </div>
        <div class="title-section">
          <h1>${esc(ED.titulo)}</h1>
          <div class="rating-line">
            <span class="star">★</span>
            <span class="num" id="overallAvg">–</span>
            <span class="cnt" id="overallCount">0 avaliações</span>
          </div>
          <div class="description">${esc(ED.descricao || '')}</div>
        </div>
      </div>
      <div class="grid-panel" id="grid-container"></div>
    </div>

    ${estadoBolao().existe ? `<div class="section" id="bolaoSection">
      <h2>🔮 Bolão</h2>
      <div id="bolaoBox"><div class="empty-note">Carregando...</div></div>
    </div>` : ''}

    <div class="section" id="geraisSection">
      <h2>Avaliações Gerais</h2>
      <div class="sub">A nota exibida no topo é a média de todas as avaliações recebidas aqui. Você pode avaliar só os episódios que quiser, não precisa preencher tudo.</div>
      <div class="gerais-summary">
        <div class="gerais-stat"><div class="big" id="geraisAvg">–</div><div class="lbl">Nota geral</div></div>
        <div class="gerais-stat"><div class="big" id="geraisCount">0</div><div class="lbl">Avaliações recebidas</div></div>
      </div>
      <h3 class="subhead">Nota agregada por episódio</h3>
      <div class="grid-panel" id="gerais-grid-container"></div>
      <h3 class="subhead">Avaliações recebidas</h3>
      <div class="submission-list" id="submissionList">
        <div class="empty-note">Nenhuma avaliação enviada ainda. Clique em "Avaliar episódios" no topo!</div>
      </div>
    </div>`);

  /* modal de votação */
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-card">
        <div class="modal-header"><h2>Avaliar episódios</h2><button class="modal-close" id="modalClose">✕</button></div>
        <div class="modal-sub">Clique nas células e preencha as notas de 0 a ${NOTA_MAXIMA}. Pode avaliar só os episódios que quiser — não precisa preencher todos. <br>🔒</div>
        <div class="name-field">
          <label for="reviewerName">Seu nome <span class="optional-tag">(opcional)</span></label>
          <input type="text" id="reviewerName" placeholder="Ex: Maria" maxlength="40" autocomplete="off">
        </div>
        <div class="grid-panel" id="form-grid-container"></div>
        <div class="form-footer">
          <div class="hint-text" id="fillHint"></div>
          <button class="submit-btn" id="submitReview" disabled>Enviar avaliação</button>
        </div>
        <div class="shared-note">As avaliações enviadas aqui são compartilhadas: todo mundo que abrir este site vê as mesmas notas e a mesma média. Só dá pra enviar uma avaliação a cada ${typeof COOLDOWN_MINUTOS !== 'undefined' ? COOLDOWN_MINUTOS : 5} minutos, pra evitar spam.</div>
      </div>
    </div>`);

  const modalOverlay = document.getElementById('modalOverlay');
  const btnAbrir = document.getElementById('openReviewModal');

  function abrirModal(){
    if(!podeVotar()) return;
    modalOverlay.classList.add('open');
    requestAnimationFrame(() => modalOverlay.classList.add('show'));
    updateFillHint();
    if(cooldownInterval) clearInterval(cooldownInterval);
    cooldownInterval = setInterval(updateFillHint, 1000);
  }
  function fecharModal(){
    fecharOverlay(modalOverlay);
    if(cooldownInterval){ clearInterval(cooldownInterval); cooldownInterval = null; }
  }
  btnAbrir.addEventListener('click', abrirModal);
  document.getElementById('modalClose').addEventListener('click', fecharModal);
  modalOverlay.addEventListener('click', ev => { if(ev.target === modalOverlay) fecharModal(); });

  document.getElementById('downloadBtn').addEventListener('click', ev =>
    baixarImagem('capture-area', `Cetec_Festival_${ANO}_Ratings.png`, ev.currentTarget));

  const shareEdBtn = document.getElementById('shareEdicaoBtn');
  if(shareEdBtn) shareEdBtn.addEventListener('click', () => {
    const notas = [];
    submissions.forEach(s => Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) notas.push(x); }));
    abrirCompartilhamento({
      poster: posterDaEdicao(ANO, ED && ED.poster),
      titulo: (ED && ED.titulo) || `Cetec Festival ${ANO}`,
      /* sob o título do ano vai o TEMA daquela edição */
      sub: temaDaEdicao(ED) || `Cetec Festival ${ANO}`,
      nota: media(notas),
      legenda: `Média do festival · ${notas.length} nota${notas.length === 1 ? '' : 's'} no CETECritic`,
      arquivo: `CETECritic_${ANO}.png`
    });
  });

  /* envio */
  const reviewerNameEl = document.getElementById('reviewerName');
  /* logado: o nome vem da conta e a avaliação vai pro perfil — a menos que
     a pessoa marque "anônimo" */
  const sessNome = usuarioLogado();
  if(sessNome){
    const nf = reviewerNameEl.closest('.name-field');
    if(nf) nf.innerHTML = `<label>Avaliando como <b style="color:var(--gold)">👤 ${esc(sessNome.user)}</b></label>
      <label class="anon-check"><input type="checkbox" id="reviewAnon"> Enviar como anônimo <span class="anon-sub">(não vincula ao seu perfil)</span></label>`;
  } else {
    /* sem conta: precisa declarar o aceite do ToS a cada avaliação
       (quem tem conta já declarou isso ao se cadastrar) */
    const nf = reviewerNameEl.closest('.name-field');
    if(nf) nf.insertAdjacentHTML('beforeend', `
      <label class="tos-check" id="reviewTosLabel">
        <input type="checkbox" id="reviewTos">
        <span>Declaro que concordo com os <a href="${BASE}termos.pdf" target="_blank" rel="noopener">Termos de Serviço</a> e sou maior de 13 anos.</span>
      </label>`);
    const reviewTosChk = document.getElementById('reviewTos');
    if(reviewTosChk) reviewTosChk.addEventListener('change', () => {
      const rl = document.getElementById('reviewTosLabel');
      if(rl) rl.classList.toggle('tos-erro', false);
      updateFillHint();
    });
  }
  document.getElementById('submitReview').addEventListener('click', async () => {
    if(!podeVotar()) return;
    if(Object.keys(formValues).length < 1) return;
    if(cooldownRestanteMs() > 0) return;
    const reviewTosChk = document.getElementById('reviewTos');
    if(reviewTosChk && !reviewTosChk.checked){
      const rl = document.getElementById('reviewTosLabel');
      if(rl) rl.classList.add('tos-erro');
      return;
    }

    const btn = document.getElementById('submitReview');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<span class="spinner"></span>Enviando...';
    localStorage.setItem('last-submission-ts', Date.now());

    const sessAtual = usuarioLogado();
    const anon = !!(document.getElementById('reviewAnon') && document.getElementById('reviewAnon').checked);
    const logadoNaoAnon = sessAtual && !anon;
    const submission = {
      /* `crypto.randomUUID()` no lugar de Date.now()+Math.random(): o id
         antigo tinha cinco caracteres de aleatoriedade e não é único no
         banco — e ele vira o id do post reagível no feed social, onde uma
         colisão junta as reações de duas avaliações diferentes. */
      id: idAvaliacao(),
      ts: Date.now(),
      name: (logadoNaoAnon ? sessAtual.user : (anon ? 'Anônimo' : reviewerNameEl.value.trim())).slice(0, 40),
      grid: { ...formValues },
      year: ANO,
      user: logadoNaoAnon ? sessAtual.user : ''
    };
    submissions.push(submission);
    refreshDisplayGrids();
    renderSubmissions();
    await postVoto(submission);

    btn.classList.remove('loading');
    btn.innerHTML = 'Avaliação enviada! ✓';
    await new Promise(r => setTimeout(r, 900));

    formValues = {};
    if(reviewerNameEl && reviewerNameEl.isConnected) reviewerNameEl.value = '';
    buildFormGrid();
    btn.textContent = originalLabel;
    fecharModal();
  });

  /* estado do botão + banners (roda a cada segundo via tick) */
  function atualizarEstado(){
    const cb = document.getElementById('countdownBanner');
    const eb = document.getElementById('endBanner');
    if(votacaoEncerrada()){
      cb.style.display = 'none';
      eb.style.display = 'block';
      btnAbrir.disabled = true;
      btnAbrir.title = 'As avaliações encerraram';
      if(modalOverlay.classList.contains('open')) fecharModal();
    } else {
      cb.style.display = FIM_VOTACAO ? 'block' : 'none';
      eb.style.display = 'none';
      if(!horarioSincronizado()){
        btnAbrir.disabled = true;
        btnAbrir.title = 'Verificando horário no servidor...';
      } else {
        btnAbrir.disabled = false;
        btnAbrir.title = '';
      }
    }
  }
  tickPagina = atualizarEstado;

  /* ---------------------- bolão (chamada) ----------------------
     O bolão mora numa sub-página do ano (/ANO/bolao.html): lá cabe a
     explicação das regras, o placar e a comparação, e cada edição guarda o
     seu, então dá pra rever os anos anteriores. Aqui na página da edição
     fica só o convite, com o estado atual. */
  let bolaoModo = null;

  async function atualizarBolao(){
    const box = document.getElementById('bolaoBox');
    if(!box) return;                       /* edição sem bolão configurado */
    const eb = estadoBolao();
    if(!eb.existe) return;

    const modo = !eb.liberado ? 'travado' : (eb.aberto ? 'aberto' : (eb.sumiu ? 'arquivado' : 'apurando'));
    if(modo === bolaoModo) return;         /* já desenhado: não recria à toa */
    bolaoModo = modo;

    const link = `${BASE}${ANO}/bolao.html`;
    if(modo === 'travado'){
      box.innerHTML = `<div class="bolao-locked">🔒 O bolão abre em <b>${fmtData(eb.abre)}</b> — junto com o "Monte o Seu" deste ano.</div>`;
      return;
    }
    if(modo === 'aberto'){
      box.innerHTML = `<div class="bolao-cta">
        <div>
          <div class="bolao-cta-tit">O bolão está aberto!</div>
          <div class="bolao-cta-sub">Palpite a nota final de cada peça${eb.fecha ? ` — o prazo vai até <b>${fmtData(eb.fecha)}</b>, quando a primeira noite começa` : ''}.</div>
        </div>
        <a class="btn btn-solid" href="${link}">🔮 Palpitar</a>
      </div>`;
      return;
    }
    box.innerHTML = `<div class="bolao-cta">
      <div>
        <div class="bolao-cta-tit">${modo === 'arquivado' ? 'Bolão encerrado' : 'Palpites travados — placar rolando'}</div>
        <div class="bolao-cta-sub">${modo === 'arquivado'
          ? 'Veja quem levou a melhor nesta edição.'
          : 'O placar se forma conforme as notas de cada peça vão saindo.'}</div>
      </div>
      <a class="btn btn-ghost" href="${link}">Ver o placar</a>
    </div>`;
  }

  /* carga inicial + atualização periódica */
  async function carregar(){
    await fetchVotos();
    DISPLAY_CONTAINERS.forEach(buildDisplayGrid);
    refreshDisplayGrids();
    renderSubmissions();
    if(!modalOverlay.classList.contains('open')) buildFormGrid();
    atualizarEstado();
    atualizarBolao();
  }
  carregar();
  intervaloVisivel(carregar, 20000);
}

/* =====================================================================
   PÁGINA: BOLÃO (/ANO/bolao.html)
   =====================================================================
   Sub-página de cada edição, então cada ano guarda o próprio bolão e os
   anteriores continuam consultáveis pela URL.

   Três estados:
     travado   antes de abrir (abre junto com o Monte o Seu)
     aberto    dá pra palpitar — obrigatório preencher TODAS as peças, e o
               prazo morre no horário da Noite 1
     apurando  palpite travado; o placar se forma conforme as notas saem
   ===================================================================== */

/* todas as chaves de peça da edição — é o que o palpite precisa cobrir */
function chavesDaEdicao(){
  const ks = [];
  for(let s = 1; s <= NUM_NOITES; s++)
    for(let e = 1; e <= epsDaNoite(s); e++) ks.push(`s${s}e${e}`);
  return ks;
}
function tituloDaPeca(s, e){
  const nd = ND[s];
  const p = (nd && Array.isArray(nd.pecas)) ? nd.pecas[e-1] : null;
  return p && p.titulo ? p.titulo : `Noite ${s} · Episódio ${e}`;
}
/* tabela de pontos, do jeito que ela é explicada na tela */
function htmlTabelaPontos(){
  const linhas = BOLAO_FAIXAS.map((f, i) => {
    const de = i === 0 ? '0' : BOLAO_FAIXAS[i-1].ate.toFixed(1).replace('.', ',');
    const ate = f.ate.toFixed(1).replace('.', ',');
    const faixa = i === 0 ? `cravou (até ${ate} de diferença)` : `de ${de} a ${ate}`;
    return `<div class="bpt-linha"><span class="bpt-pts">${f.pts}</span><span class="bpt-faixa">${faixa}</span></div>`;
  }).join('');
  return `<div class="bolao-pontos">${linhas}
    <div class="bpt-linha zero"><span class="bpt-pts">0</span><span class="bpt-faixa">errou por mais de 3,0</span></div>
  </div>`;
}

async function paginaBolao(){
  document.title = `Bolão ${ANO} — CETECritic`;
  const eb = estadoBolao();

  if(!eb.existe){
    montarShell(`<div class="perfil-head"><h1>🔮 Bolão ${ANO}</h1></div>
      <div class="noite-card" style="text-align:center;">
        <div class="perfil-vazio">Esta edição não tem bolão.</div>
        <a class="btn btn-ghost" href="${BASE}${ANO}/index.html">Voltar para a edição</a>
      </div>`);
    return;
  }

  const regrasCustom = String(eb.regras || '').trim();
  montarShell(`
    <div class="perfil-head"><h1>🔮 Bolão ${ANO}</h1></div>

    <div class="section" id="bolaoEstado"><div class="empty-note">Carregando...</div></div>

    <div class="section">
      <h2>Como funciona</h2>
      <div class="sub">${regrasCustom ? esc(regrasCustom) : `Antes do festival começar, você chuta a <b>nota média final</b> de cada peça.
        Quanto mais perto do resultado real, mais pontos. Quem somar mais pontos leva a taça —
        e o pódio ganha badge no perfil.`}</div>
      <h3 class="subhead">Pontos por peça</h3>
      ${htmlTabelaPontos()}
      <div class="sub" style="margin-top:10px;">
        Empate se resolve pelo menor erro médio; persistindo, por quem palpitou primeiro.
        Peça que ninguém avaliou fica fora da conta de todo mundo.
      </div>
    </div>

    <div id="bolaoConteudo"><div class="empty-note">Carregando...</div></div>`);

  const elEstado = document.getElementById('bolaoEstado');
  const elConteudo = document.getElementById('bolaoConteudo');

  /* ---- faixa de estado, com contador quando há prazo à vista ---- */
  function pintarEstado(){
    if(!eb.liberado){
      elEstado.innerHTML = `<div class="bolao-locked">🔒 O bolão abre em <b>${fmtData(eb.abre)}</b>, junto com o "Monte o Seu".
        ${eb.abre ? `<div class="grid-countdown-box" style="margin-top:10px;"><div class="lbl">Abre em</div><div class="val" data-count-to="${eb.abre.toISOString()}" data-reload="1">--:--:--</div></div>` : ''}</div>`;
    } else if(eb.aberto){
      elEstado.innerHTML = `<div class="bolao-aberto">✅ <b>Palpites abertos.</b> Dá pra ajustar quantas vezes quiser até o prazo.
        ${eb.fecha ? `<div class="grid-countdown-box" style="margin-top:10px;"><div class="lbl">Fecha em</div><div class="val" data-count-to="${eb.fecha.toISOString()}" data-reload="1">--:--:--</div></div>` : ''}</div>`;
    } else {
      elEstado.innerHTML = `<div class="bolao-locked">🔒 <b>Palpites travados</b> desde ${fmtData(eb.fecha)}.
        O placar se completa conforme as notas de cada peça vão saindo.</div>`;
    }
  }
  pintarEstado();

  /* ---- aberto: grade de palpite (todas as peças, obrigatório preencher) ---- */
  function renderFormulario(sess){
    const chaveLocal = `cetec-bolao-${ANO}-${sess.user.toLowerCase()}`;
    let vals = {};
    try{ vals = JSON.parse(localStorage.getItem(chaveLocal) || '{}'); }catch(e){ vals = {}; }
    const chaves = chavesDaEdicao();

    elConteudo.innerHTML = `<div class="section">
      <h2>Seu palpite</h2>
      <div class="sub">Preencha <b>todas as ${chaves.length} peças</b> — palpite pela metade não vale.
        As notas vão de 0 a ${NOTA_MAXIMA}, com uma casa decimal.</div>
      <div class="grid-panel bolao-grid" id="bolaoGridPanel"></div>
      <div class="bolao-actions">
        <div class="bolao-msg" id="bolaoMsg"></div>
        <button class="submit-btn" id="bolaoSalvar" disabled>Salvar palpite</button>
      </div>
    </div>`;

    /* grade destravada de propósito: o prazo acaba ANTES da primeira noite,
       então travar por noite liberada deixaria tudo inacessível */
    let g = `<div class="grid-row"><div class="cell label"></div>`;
    for(let s = 1; s <= NUM_NOITES; s++) g += `<div class="cell header">S${s}</div>`;
    g += `</div>`;
    for(let e = 1; e <= MAX_EPS; e++){
      g += `<div class="grid-row"><div class="cell label">E${e}</div>`;
      for(let s = 1; s <= NUM_NOITES; s++){
        if(e > epsDaNoite(s)){ g += `<div class="cell cell-void"></div>`; continue; }
        const key = `s${s}e${e}`;
        const v = vals[key];
        g += `<div class="cell cell-input" id="bcell-${key}" title="${esc(tituloDaPeca(s, e))}" style="${v !== undefined ? `background-color:${corDaNota(v)}` : ''}">
          <input type="number" min="0" max="${NOTA_MAXIMA}" step="0.1" placeholder="?" data-key="${key}" value="${v !== undefined ? v : ''}">
        </div>`;
      }
      g += `</div>`;
    }
    document.getElementById('bolaoGridPanel').innerHTML = g;

    const msg = document.getElementById('bolaoMsg');
    const btn = document.getElementById('bolaoSalvar');
    function revisar(){
      const faltam = chaves.filter(k => vals[k] === undefined).length;
      btn.disabled = faltam > 0;
      msg.innerHTML = faltam
        ? `Falta${faltam === 1 ? '' : 'm'} <b>${faltam}</b> de ${chaves.length} peça${faltam === 1 ? '' : 's'}.`
        : `Tudo preenchido — <b>${chaves.length} peças</b>. Pode salvar!`;
    }
    revisar();

    elConteudo.querySelectorAll('.cell-input input').forEach(inp => inp.addEventListener('input', () => {
      const key = inp.dataset.key;
      const cell = document.getElementById(`bcell-${key}`);
      if(inp.value === ''){ delete vals[key]; cell.style.backgroundColor = 'var(--surface-2)'; revisar(); return; }
      let v = parseFloat(inp.value);
      if(isNaN(v)) return;
      if(v > NOTA_MAXIMA){ v = NOTA_MAXIMA; inp.value = NOTA_MAXIMA; }
      if(v < 0){ v = 0; inp.value = 0; }
      vals[key] = v;
      cell.style.backgroundColor = corDaNota(v);
      revisar();
    }));

    btn.addEventListener('click', async () => {
      const orig = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Salvando...';
      const r = await apiEnviarPalpite(ANO, vals);
      btn.textContent = orig;
      if(r && r.ok){
        try{ localStorage.setItem(chaveLocal, JSON.stringify(vals)); }catch(e){}
        msg.innerHTML = 'Palpite salvo ✓ — dá pra ajustar até o prazo fechar.';
        btn.disabled = false;
      } else {
        msg.textContent = (r && r.error) ? r.error : 'Não foi possível salvar. Tente de novo.';
        revisar();
      }
    });
  }

  /* ---- travado: placar + a sua comparação peça a peça ---- */
  async function renderApuracao(){
    const [dados, meu] = await Promise.all([ fetchPlacarBolao(ANO, true), fetchMeuPalpite(ANO) ]);
    const placar = (dados && dados.placar) ? dados.placar : [];
    const sess = usuarioLogado();
    const meuNome = sess ? sess.user.trim().toLowerCase() : null;

    let html = '';

    if(!placar.length){
      html += `<div class="section"><h2>🏆 Placar</h2>
        <div class="empty-note">${(dados && dados.pecasApuradas)
          ? 'Ninguém palpitou nesta edição.'
          : 'Nenhuma peça tem nota ainda — o placar começa a se formar assim que as avaliações chegarem.'}</div></div>`;
    } else {
      const medalha = p => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '•';
      const lider = placar[0];
      html += `<div class="section">
        <h2>🏆 Placar</h2>
        <div class="sub">${placar.length} participante${placar.length === 1 ? '' : 's'} ·
          ${dados.pecasApuradas} peça${dados.pecasApuradas === 1 ? '' : 's'} apurada${dados.pecasApuradas === 1 ? '' : 's'}
          · máximo possível até aqui: <b>${dados.pecasApuradas * BOLAO_PONTOS_MAX}</b> pontos</div>
        <div class="bolao-lider">👑 Líder: <b>${esc(lider.user)}</b> com <b>${lider.pontos}</b> ponto${lider.pontos === 1 ? '' : 's'}</div>
        <div class="record-list">${placar.slice(0, 20).map(r => {
          const eu = meuNome && String(r.user).trim().toLowerCase() === meuNome;
          return `<div class="record-item${eu ? ' bolao-eu' : ''}">
            <span class="rec-emoji">${medalha(r.pos)}</span>
            <div><div class="rec-title">${r.pos}º · ${esc(r.user)}${eu ? ' (você)' : ''}</div>
            <div class="rec-text"><b style="color:var(--gold)">${r.pontos}</b> pontos · ${r.cravadas} cravada${r.cravadas === 1 ? '' : 's'} · erro médio ${r.erroMedio.toFixed(2)}</div></div>
          </div>`;
        }).join('')}</div>
      </div>`;
    }

    /* comparação pessoal: palpite × nota oficial, peça a peça */
    if(!sess){
      html += `<div class="section"><h2>Seu palpite</h2>
        <div class="bolao-login"><span>Entre para ver como você foi neste bolão.</span>
        <button class="btn btn-solid" id="bolaoEntrar">Entrar / Criar conta</button></div></div>`;
    } else if(meu && meu.temPalpite){
      html += `<div class="section"><h2>Você × resultado oficial</h2>
        <div class="sub">Seu palpite ao lado da nota que a peça realmente tirou, e o que aquilo rendeu.</div>
        ${htmlComparacaoBolao(meu.palpites, meu.medias, meu.pontos)}</div>`;
    } else {
      html += `<div class="section"><h2>Seu palpite</h2>
        <div class="empty-note">Você não palpitou nesta edição.</div></div>`;
    }

    elConteudo.innerHTML = html;
    const be = document.getElementById('bolaoEntrar');
    if(be) be.addEventListener('click', () => { const e = document.getElementById('btnEntrar'); if(e) e.click(); });
  }

  if(!eb.liberado){
    elConteudo.innerHTML = `<div class="section"><div class="empty-note">Volte quando o bolão abrir para dar o seu palpite.</div></div>`;
    return;
  }
  if(eb.aberto){
    const sess = usuarioLogado();
    if(!sess){
      elConteudo.innerHTML = `<div class="section"><h2>Seu palpite</h2>
        <div class="bolao-login"><span>Entre para palpitar no bolão.</span>
        <button class="btn btn-solid" id="bolaoEntrar">Entrar / Criar conta</button></div></div>`;
      const be = document.getElementById('bolaoEntrar');
      if(be) be.addEventListener('click', () => { const e = document.getElementById('btnEntrar'); if(e) e.click(); });
      return;
    }
    renderFormulario(sess);
    return;
  }
  await renderApuracao();
  /* a apuração muda conforme as notas chegam — mas só com a aba à vista */
  intervaloVisivel(renderApuracao, 30000);
}

/* grade "palpite × real" reaproveitada pelo bolão e pelo perfil */
function htmlComparacaoBolao(palpites, medias, pontos){
  const pal = palpites || {}, med = medias || {}, pts = pontos || {};
  const chaves = Object.keys(pal).sort((a, b) => {
    const pa = /^s(\d+)e(\d+)$/.exec(a), pb = /^s(\d+)e(\d+)$/.exec(b);
    if(!pa || !pb) return a.localeCompare(b);
    return (Number(pa[1]) - Number(pb[1])) || (Number(pa[2]) - Number(pb[2]));
  });
  if(!chaves.length) return '<div class="empty-note">Sem palpites registrados.</div>';

  const total = chaves.reduce((a, k) => a + (Number(pts[k]) || 0), 0);
  const apuradas = chaves.filter(k => med[k] !== undefined).length;

  const linhas = chaves.map(k => {
    const m = /^s(\d+)e(\d+)$/.exec(k);
    const nome = m ? tituloDaPecaSeguro(Number(m[1]), Number(m[2])) : k;
    const p = Number(pal[k]);
    const r = med[k];
    const pt = Number(pts[k]) || 0;
    const semNota = (r === undefined);
    return `<div class="bcomp-linha">
      <div class="bcomp-nome">${esc(nome)}</div>
      <div class="bcomp-vals">
        <span class="bcomp-chip" style="background:${corDaNota(p)}">${p.toFixed(1)}</span>
        <span class="bcomp-seta">→</span>
        ${semNota
          ? '<span class="bcomp-chip vazio">sem nota</span>'
          : `<span class="bcomp-chip" style="background:${corDaNota(r)}">${Number(r).toFixed(1)}</span>`}
        <span class="bcomp-pts${pt === BOLAO_PONTOS_MAX ? ' cravou' : ''}${semNota ? ' vazio' : ''}">${semNota ? '–' : '+' + pt}</span>
      </div>
    </div>`;
  }).join('');

  return `<div class="bcomp-total">Total: <b>${total}</b> ponto${total === 1 ? '' : 's'} em ${apuradas} peça${apuradas === 1 ? '' : 's'} apurada${apuradas === 1 ? '' : 's'}</div>
    <div class="bcomp">${linhas}</div>`;
}
/* o perfil abre bolões de OUTROS anos, onde o NOITES daquela edição não está
   carregado — aí o nome da peça vira o rótulo genérico em vez de quebrar */
function tituloDaPecaSeguro(s, e){
  try{ return tituloDaPeca(s, e); }catch(err){ return `Noite ${s} · Episódio ${e}`; }
}

/* =====================================================================
   PÁGINA: SOBRE
   ===================================================================== */
/* =====================================================================
   PÁGINA: RESUMO RÁPIDO (Seção 8 do Plano de Ação)
   =====================================================================
   Unifica Sobre + Abertura + Curiosidades/Contexto numa única página de 3
   colunas. Reaproveita o conteúdo que já existe (ED.sobre, ED.abertura) e,
   na 3ª coluna, usa o contexto próprio da edição (ED.sobre.contexto, editável
   no admin) ou, se vazio, as CURIOSIDADES gerais — nada de conteúdo novo.
   As rotas /ANO/sobre.html e /ANO/abertura.html caem aqui (ver switch). */
function paginaResumo(){
  document.title = `${ED.titulo} - Resumo Rápido`;
  const s = ED.sobre || {};
  const a = ED.abertura || {};
  if(edicaoEmBreve()){
    montarShell(`<div class="noite-intro"><h1>Resumo Rápido</h1></div>${htmlEmBreveBox()}`);
    return;
  }
  if(!s.texto && !a.texto && !edicaoComecou() && inicioEdicao()){
    montarShell(`<div class="noite-intro"><h1>Resumo Rápido</h1></div>${htmlCountdownBox(inicioEdicao(), true)}`);
    fetchVotos();
    return;
  }
  /* 3ª coluna: contexto próprio da edição; se vazio, cai nas curiosidades gerais */
  const contexto = String(s.contexto || '').trim();
  let curioHtml;
  if(contexto){
    curioHtml = `<div class="noite-card-synopsis texto-quebras" style="margin-bottom:0;">${esc(contexto)}</div>`;
  } else {
    const curios = (typeof CURIOSIDADES !== 'undefined' && Array.isArray(CURIOSIDADES)) ? CURIOSIDADES : [];
    curioHtml = curios.length
      ? `<ul class="resumo-curios">${curios.slice(0, 5).map(c => `<li>${esc((c && c.texto) || (typeof c === 'string' ? c : ''))}</li>`).join('')}</ul>`
      : `<div class="empty-note">Contexto histórico em construção. Tem uma curiosidade ou lembrança dessa edição? Escreva pra gente: cetecritic@gmail.com</div>`;
  }
  montarShell(`
    <div class="noite-intro">
      <h1>Resumo Rápido</h1>
      <p>Tudo sobre a edição ${ANO} num lugar só: sobre, abertura e o contexto histórico.</p>
    </div>
    <div class="resumo-cols">
      <div class="noite-card resumo-col">
        <div class="resumo-col-head">📖 Sobre</div>
        ${s.banner ? `<img class="sobre-banner" src="${esc(s.banner)}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="noite-card-title" style="margin-bottom:10px; font-size:16px;">${esc(s.titulo || ED.titulo)}</div>
        <div class="noite-card-synopsis texto-quebras" style="margin-bottom:0;">${esc(s.texto || 'Em breve.')}</div>
      </div>
      <div class="noite-card resumo-col">
        <div class="resumo-col-head">🎼 Abertura</div>
        <div class="noite-card-synopsis texto-quebras" style="margin-bottom:${a.spotify ? '18px' : '0'};">${esc(a.texto || 'Em breve.')}</div>
        ${a.spotify ? `<iframe style="border-radius:12px; border:none;" src="${esc(a.spotify)}" width="100%" height="352" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>` : ''}
      </div>
      <div class="noite-card resumo-col">
        <div class="resumo-col-head">💡 Curiosidades e Contexto</div>
        ${curioHtml}
      </div>
    </div>`);
}

/* paginaSobre / paginaAbertura: mantidas por compatibilidade; as rotas agora
   apontam para paginaResumo (unificação do Plano de Ação, Seção 8). */
function paginaSobre(){
  document.title = `${ED.titulo} - Sobre`;
  const s = ED.sobre || {};
  if(edicaoEmBreve()){
    montarShell(`<div class="noite-intro"><h1>Sobre o Festival</h1></div>${htmlEmBreveBox()}`);
    return;
  }
  if(!s.texto && !edicaoComecou() && inicioEdicao()){
    montarShell(`<div class="noite-intro"><h1>Sobre o Festival</h1></div>${htmlCountdownBox(inicioEdicao(), true)}`);
    fetchVotos();
    return;
  }
  montarShell(`
    <div class="noite-intro">
      <h1>Sobre o Festival</h1>
      <p>Contexto e proposta da edição ${ANO} do CETEC Festival.</p>
    </div>
    <div class="noite-card">
      ${s.banner ? `<img class="sobre-banner" src="${esc(s.banner)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="noite-card-title" style="margin-bottom:10px; font-size:16px;">${esc(s.titulo || ED.titulo)}</div>
      <div class="noite-card-synopsis texto-quebras" style="margin-bottom:0;">${esc(s.texto || 'Em breve.')}</div>
    </div>`);
}

/* =====================================================================
   PÁGINA: ABERTURA
   ===================================================================== */
function paginaAbertura(){
  document.title = `${ED.titulo} - Abertura`;
  const a = ED.abertura || {};
  if(edicaoEmBreve()){
    montarShell(`<div class="noite-intro"><h1>Abertura</h1></div>${htmlEmBreveBox()}`);
    return;
  }
  if(!a.texto && !edicaoComecou() && inicioEdicao()){
    montarShell(`<div class="noite-intro"><h1>Abertura</h1></div>${htmlCountdownBox(inicioEdicao(), true)}`);
    fetchVotos();
    return;
  }
  montarShell(`
    <div class="noite-intro">
      <h1>Abertura</h1>
      <p>Um pouco sobre a noite de abertura do festival e as músicas apresentadas.</p>
    </div>
    <div class="noite-card">
      <div class="noite-card-title" style="margin-bottom:10px; font-size:16px;">Sobre a abertura</div>
      <div class="noite-card-synopsis texto-quebras" style="margin-bottom:18px;">${esc(a.texto || 'Em breve.')}</div>
      ${a.spotify ? `
      <div class="noite-card-title" style="margin-bottom:14px; font-size:16px;">Trilha sonora</div>
      <iframe style="border-radius:12px; border:none;" src="${esc(a.spotify)}" width="100%" height="352" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>` : ''}
    </div>`);
}

/* =====================================================================
   PÁGINA: NOITE N
   ===================================================================== */
function paginaNoite(n){
  const nd = ND[n] || {};
  document.title = `${ED.titulo} - Noite ${n}`;
  const intro = `<div class="noite-intro">
    <h1>Noite ${n}</h1>
    <p>${esc(nd.subtitulo || `Turmas que se apresentaram na noite ${n} do festival.`)}</p>
  </div>`;

  /* edição "Em breve": nem mostra a noite ainda */
  if(edicaoEmBreve()){
    montarShell(intro + htmlEmBreveBox());
    return;
  }

  /* noite ainda trancada: só o countdown (baseado na DATA do noite-N.js) */
  if(!noiteLiberada(n)){
    montarShell(intro + htmlCountdownBox(dataNoite(n), true));
    fetchVotos();
    return;
  }

  montarShell(intro + `<div class="noite-share-bar" style="width:100%; max-width:900px; margin:0 0 14px;"><button class="btn btn-ghost" id="shareNoiteBtn">📤 Compartilhar média da noite</button></div><div id="noite-cards" style="width:100%; max-width:900px;"></div>`);

  /* Os cards (com os vídeos) são montados UMA vez só.
     A atualização periódica mexe apenas na caixinha da nota — assim o
     iframe do YouTube nunca é recriado e o vídeo não recarrega. */
  const pecas = nd.pecas || [];

  function renderCards(){
    const container = document.getElementById('noite-cards');
    let html = '';
    pecas.forEach((info, idx) => {
      const key = `s${n}e${idx + 1}`;
      html += `<div class="noite-card" id="peca-${key}">
        <div class="noite-card-head">
          <div>
            <div class="noite-card-title">${esc(info.titulo)} <span class="peca-badges" id="badges-${key}"></span></div>
            <div class="noite-card-turma">Turma ${esc(info.turma)}</div>
          </div>
          <div class="noite-card-right">
            <div class="noite-card-rating" id="nota-${key}"><div class="val empty">–</div><div class="cnt">Sem avaliações</div></div>
            <button class="peca-share" data-key="${key}" data-titulo="${esc(info.titulo)}" data-turma="${esc(info.turma)}" title="Compartilhar a nota desta peça (story)">📤</button>
          </div>
        </div>
        <div class="noite-card-synopsis">${esc(info.sinopse)}</div>
        ${info.youtube
          ? `<iframe class="video-embed-placeholder" src="https://www.youtube.com/embed/${esc(info.youtube)}${info.youtubeInicio ? `?start=${Number(info.youtubeInicio)}` : ''}" title="${esc(info.titulo)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>${!info.youtubeInicio ? `<div class="noite-card-turma" style="font-style:italic; margin-top:8px;">(Esta apresentação ainda não foi sincronizada com o video)</div>` : ''}`
          : `<div class="video-embed-placeholder"><div class="play-icon">▶</div><div>Vídeo da apresentação em breve</div></div>`}
      </div>`;
    });
    container.innerHTML = html || '<div class="empty-note">Nenhuma apresentação cadastrada para esta noite (adicione em noites/noite-' + n + '.js).</div>';
  }

  function atualizarNotas(){
    const bmap = badgesDoAno(submissions); // badges relativas à edição inteira
    pecas.forEach((info, idx) => {
      const key = `s${n}e${idx + 1}`;
      const box = document.getElementById(`nota-${key}`);
      if(!box) return;
      const vals = valoresDaChave(key);
      const avg = media(vals);
      box.innerHTML = avg === null
        ? `<div class="val empty">–</div><div class="cnt">Sem avaliações</div>`
        : `<div class="val" style="background-color:${corDaNota(avg)}">${avg.toFixed(1)}</div><div class="cnt">${vals.length} avaliaç${vals.length === 1 ? 'ão' : 'ões'}</div>`;
      const bx = document.getElementById(`badges-${key}`);
      if(bx) bx.innerHTML = htmlBadges(bmap[key]) +
        (key === chaveMelhorHistoria ? `<span class="badge" title="${BADGES_DEF.melhorHist.nome}">${BADGES_DEF.melhorHist.emoji}</span>` : '') +
        htmlBadges(badgesExtrasDaPeca(ANO, key));
    });
  }

  renderCards();

  /* rolagem automática até a peça, quando o link veio com #sNeM (ex.:
     vindo do Hall, da Home ou da busca). Só na primeira montagem — depois
     disso o usuário pode rolar livremente sem ser puxado de volta. */
  {
    const alvo = /^#s\d+e\d+$/.test(location.hash) ? document.getElementById('peca-' + location.hash.slice(1)) : null;
    if(alvo) requestAnimationFrame(() => alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /* compartilhar a MÉDIA DA NOITE inteira (média de todas as peças da noite) */
  {
    const bn = document.getElementById('shareNoiteBtn');
    if(bn) bn.addEventListener('click', () => {
      const vals = [];
      pecas.forEach((info, idx) => valoresDaChave(`s${n}e${idx + 1}`).forEach(v => vals.push(v)));
      abrirCompartilhamento({
        poster: posterDaEdicao(ANO, (typeof ED !== 'undefined' && ED) ? ED.poster : ''),
        /* a NOITE é o destaque; embaixo, as turmas que subiram no palco */
        titulo: `Noite ${n}`,
        sub: turmasDaNoite(n).join(' · ') || nd.subtitulo || '',
        nota: media(vals),
        legenda: `Média da noite · Cetec Festival ${ANO}`,
        arquivo: `CETECritic_${ANO}_Noite_${n}.png`
      });
    });
  }

  /* compartilhar (story) de uma peça específica: usa a média ao vivo da peça */
  {
    const cont = document.getElementById('noite-cards');
    if(cont) cont.addEventListener('click', ev => {
      const b = ev.target.closest('.peca-share'); if(!b) return;
      const avg = media(valoresDaChave(b.dataset.key));
      abrirCompartilhamento({
        poster: posterDaEdicao(ANO, (typeof ED !== 'undefined' && ED) ? ED.poster : ''),
        /* a PEÇA é o destaque; embaixo, noite e turma */
        titulo: b.dataset.titulo,
        sub: `Noite ${n} · Turma ${b.dataset.turma}`,
        nota: avg,
        legenda: `Nota da plateia · Cetec Festival ${ANO}`,
        arquivo: `CETECritic_${ANO}_${String(b.dataset.titulo).replace(/[^\w]+/g, '_').slice(0, 40)}.png`
      });
    });
  }

  /* badge ⭐: confere se o melhor episódio da HISTÓRIA (todas as edições,
     mínimo de 3 avaliações) é uma peça desta noite */
  let chaveMelhorHistoria = null;
  async function checarMelhorHistoria(){
    try{
      const outros = await Promise.all(EDICOES.filter(e => e.ano !== ANO).map(async e => {
        const r = await fetch(API_URL + '?year=' + e.ano + '&_=' + Date.now(), { cache: 'no-store' });
        const j = await r.json();
        return { ano: e.ano, subs: filtrarVotosDoAno(Array.isArray(j) ? j : (j.submissions || []), e.ano) };
      }));
      const todos = [{ ano: ANO, subs: submissions }, ...outros];
      let best = null;
      todos.forEach(t => {
        const chaves = new Set();
        t.subs.forEach(s => Object.keys(s.grid).forEach(k => chaves.add(k)));
        chaves.forEach(k => {
          const vals = t.subs.map(s => Number(s.grid[k])).filter(v => !isNaN(v));
          const st = statsDeVals(vals);
          if(st && st.n >= 3 && (best === null || st.avg > best.avg)) best = { ano: t.ano, key: k, avg: st.avg };
        });
      });
      if(best && best.ano === ANO && best.key.indexOf(`s${n}e`) === 0) chaveMelhorHistoria = best.key;
    }catch(e){ /* API fora do ar: apenas não mostra a estrela */ }
  }

  fetchVotos().then(() => {
    atualizarNotas();
    checarMelhorHistoria().then(atualizarNotas);
    carregarHallDados().then(atualizarNotas); // badges extras do hall-dados.js
  });
  intervaloVisivel(() => fetchVotos().then(atualizarNotas), 20000);
}

/* =====================================================================
   PÁGINA: MONTE O SEU (pessoal, salvo só no navegador da pessoa)
   ===================================================================== */
function paginaMonte(){
  document.title = `Meu ${ED.titulo}`;

  /* edição "Em breve": trava o Monte o Seu deste ano */
  if(edicaoEmBreve()){
    montarShell(`
      <div id="custom-capture-area">
        <div class="left-panel">
          <div class="poster-box question-mark"><span>?</span></div>
          <div class="title-section"><h1>Meu ${esc(ED.titulo)}</h1><div class="description">-</div></div>
        </div>
        <div class="grid-blur-wrap">
          <div class="grid-panel">${gridVazioHtml()}</div>
          <div class="grid-blur-overlay">${htmlEmBreveBox()}</div>
        </div>
      </div>`);
    return;
  }

  const monteAbre = (CFG_EDICAO && CFG_EDICAO.monteAbreEm) ? new Date(CFG_EDICAO.monteAbreEm) : null;
  if(monteAbre && agora() < monteAbre){
    montarShell(`
      <div id="custom-capture-area">
        <div class="left-panel">
          <div class="poster-box question-mark"><span>?</span></div>
          <div class="title-section"><h1>Meu ${esc(ED.titulo)}</h1><div class="description">-</div></div>
        </div>
        <div class="grid-blur-wrap">
          <div class="grid-panel">${gridVazioHtml()}</div>
          <div class="grid-blur-overlay">${htmlCountdownBox(monteAbre, true)}</div>
        </div>
      </div>`);
    fetchVotos();
    return;
  }

  /* chaves por ano no localStorage (com migração dos dados antigos de 2026) */
  const K = sufixo => `custom-${sufixo}-${ANO}`;
  function lerLegado(sufixo){
    let v = localStorage.getItem(K(sufixo));
    if(v === null && ANO === 2026) v = localStorage.getItem(`custom-${sufixo}`); // versão antiga do site
    return v;
  }

  let customValues = {};
  try{ const cg = lerLegado('grid'); if(cg) customValues = JSON.parse(cg); }catch(e){ customValues = {}; }

  montarShell(`
    <div class="custom-toolbar">
      <p>Monte a sua própria versão da tabela, do jeitinho que você quiser. Isso fica só com você — não entra na página oficial nem nas Avaliações Gerais.</p>
      <div class="topbar-actions">
        <button class="btn btn-ghost" id="clearCustomBtn">Limpar</button>
        <button class="btn btn-ghost" id="shareCustomBtn">📤 Compartilhar média</button>
        <button class="btn btn-solid" id="downloadCustomBtn">Baixar imagem</button>
      </div>
    </div>
    <div id="custom-capture-area">
      <div class="left-panel">
        <label class="poster-box" id="posterBoxCustom">
          <img id="posterImgCustom" alt="">
          <div class="poster-hint"><b>sua-capa.jpg</b>Clique para escolher a imagem de capa</div>
          <input type="file" accept="image/*" class="poster-input" id="posterInputCustom">
        </label>
        <div class="title-section">
          <h1 id="customTitle" contenteditable="true" spellcheck="false">Meu ${esc(ED.titulo)}</h1>
          <div class="description" id="customDescription" contenteditable="true" spellcheck="false">${esc(ED.descricao || 'Clique aqui para escrever sua própria descrição...')}</div>
        </div>
      </div>
      <div class="grid-panel" id="custom-grid-container"></div>
    </div>`);

  const posterBox = document.getElementById('posterBoxCustom');
  const posterImg = document.getElementById('posterImgCustom');
  const posterInput = document.getElementById('posterInputCustom');
  const titleEl = document.getElementById('customTitle');
  const descEl = document.getElementById('customDescription');

  /* poster padrão do ano, se existir na pasta */
  const posterPadrao = posterDaEdicao(ANO, ED.poster);
  const posterIdbKey = 'monte-' + ANO;
  posterImg.addEventListener('load', () => posterBox.classList.add('has-image'));

  /* pôster salvo: agora no IndexedDB (não estoura cota). Migra o base64 antigo
     do localStorage, se existir, e apaga esse peso morto de lá. */
  (async () => {
    let salvo = await idbLerPoster(posterIdbKey);
    if(!salvo){
      const legado = lerLegado('poster');   // versões antigas guardavam base64 no localStorage
      if(legado){ salvo = legado; idbSalvarPoster(posterIdbKey, legado); }
    }
    posterImg.src = salvo || posterPadrao;
    localStorage.removeItem(K('poster'));
    if(ANO === 2026) localStorage.removeItem('custom-poster');
  })();

  /* o clique no label já abre o seletor de arquivo nativamente (sem JS).
     A imagem é reduzida antes de guardar (poucas centenas de KB no IndexedDB). */
  posterInput.addEventListener('change', async () => {
    const file = posterInput.files[0];
    if(!file) return;
    try{
      /* 700px era pouco: esse mesmo pôster é exportado no card de
         compartilhamento a ~1080px de largura, então ele chegava lá já
         ampliado (borrado). Em WebP, 1400px ocupa menos que os 700px em
         JPEG de antes. */
      const dataUrl = await reduzirImagem(file, 1400, 0.86);
      posterImg.src = dataUrl;
      idbSalvarPoster(posterIdbKey, dataUrl);
    }catch(e){ console.warn('Não foi possível processar a imagem', e); }
  });

  const ct = lerLegado('title');
  if(ct) titleEl.textContent = ct;
  titleEl.addEventListener('blur', () => {
    const text = titleEl.textContent.trim() || `Meu ${ED.titulo}`;
    titleEl.textContent = text;
    localStorage.setItem(K('title'), text);
  });

  const cd = lerLegado('description');
  if(cd) descEl.textContent = cd;
  descEl.addEventListener('focus', () => {
    if(descEl.classList.contains('placeholder')){ descEl.textContent = ''; descEl.classList.remove('placeholder'); }
  });
  descEl.addEventListener('blur', () => {
    const text = descEl.textContent.trim();
    if(text === ''){
      descEl.textContent = 'Clique aqui para escrever sua própria descrição...';
      descEl.classList.add('placeholder');
      localStorage.setItem(K('description'), '');
    } else {
      localStorage.setItem(K('description'), text);
    }
  });

  function salvarGrid(){
    try{ localStorage.setItem(K('grid'), JSON.stringify(customValues)); }
    catch(e){ console.error('Falha ao salvar sua tabela', e); }
  }

  function buildCustomGrid(){
    const c = document.getElementById('custom-grid-container');
    let h = `<div class="grid-row"><div class="cell label"></div>`;
    for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell header">S${s}</div>`;
    h += `</div>`;
    h += `<div class="grid-row"><div class="cell label" style="font-size:10px;">MÉDIA</div>`;
    for(let s = 1; s <= NUM_NOITES; s++) h += `<div class="cell cell-avg" id="custom-avg-s${s}">–</div>`;
    h += `</div>`;
    for(let e = 1; e <= MAX_EPS; e++){
      h += `<div class="grid-row"><div class="cell label">E${e}</div>`;
      for(let s = 1; s <= NUM_NOITES; s++){
        if(e > epsDaNoite(s)){ h += `<div class="cell cell-void"></div>`; continue; }
        const key = `s${s}e${e}`;
        const existing = customValues[key];
        h += `<div class="cell cell-input" id="ccell-${key}" style="${existing !== undefined ? `background-color:${corDaNota(existing)}` : ''}">
          <input type="number" min="0" max="${NOTA_MAXIMA}" step="0.1" placeholder="–" data-key="${key}" value="${existing !== undefined ? existing : ''}">
        </div>`;
      }
      h += `</div>`;
    }
    c.innerHTML = h;
    c.querySelectorAll('.cell-input input').forEach(inp => inp.addEventListener('input', () => onCustomInput(inp)));
    atualizarMedias();
  }

  function onCustomInput(inp){
    const key = inp.dataset.key;
    const cellDiv = document.getElementById(`ccell-${key}`);
    if(inp.value === ''){
      delete customValues[key];
      cellDiv.style.backgroundColor = 'var(--surface-2)';
      atualizarMedias();
      salvarGrid();
      return;
    }
    let val = parseFloat(inp.value);
    if(isNaN(val)) return;
    if(val > NOTA_MAXIMA){ val = NOTA_MAXIMA; inp.value = NOTA_MAXIMA; }
    if(val < 0){ val = 0; inp.value = 0; }
    customValues[key] = val;
    cellDiv.style.backgroundColor = corDaNota(val);
    atualizarMedias();
    salvarGrid();
  }

  function atualizarMedias(){
    for(let s = 1; s <= NUM_NOITES; s++){
      const vals = [];
      for(let e = 1; e <= epsDaNoite(s); e++){
        const v = customValues[`s${s}e${e}`];
        if(v !== undefined) vals.push(v);
      }
      const el = document.getElementById(`custom-avg-s${s}`);
      const avg = media(vals);
      if(avg === null){
        el.textContent = '–';
        el.style.backgroundColor = 'var(--surface-2)';
        el.style.borderColor = 'var(--border)';
      } else {
        el.textContent = avg.toFixed(1);
        const c = corDaNota(avg);
        el.style.backgroundColor = c;
        el.style.borderColor = c;
      }
    }
  }

  document.getElementById('clearCustomBtn').addEventListener('click', () => {
    /* notas */
    customValues = {};
    buildCustomGrid();
    /* título e descrição de volta ao padrão */
    titleEl.textContent = `Meu ${ED.titulo}`;
    descEl.textContent = ED.descricao || 'Clique aqui para escrever sua própria descrição...';
    descEl.classList.remove('placeholder');
    /* poster de volta ao padrão do ano */
    posterBox.classList.remove('has-image');
    posterInput.value = '';
    posterImg.removeAttribute('src');
    posterImg.src = posterPadrao;
    /* apaga tudo que estava salvo no navegador */
    ['grid', 'title', 'description', 'poster'].forEach(s => localStorage.removeItem(K(s)));
    idbApagarPoster(posterIdbKey);
    if(ANO === 2026){
      ['custom-grid', 'custom-title', 'custom-description', 'custom-poster'].forEach(k => localStorage.removeItem(k));
    }
  });
  document.getElementById('downloadCustomBtn').addEventListener('click', ev =>
    baixarImagem('custom-capture-area', `Meu_Cetec_Festival_${ANO}.png`, ev.currentTarget));

  /* compartilhar a MÉDIA personalizada que a pessoa montou (card estilo story) —
     antes, pergunta se é a nota do festival inteiro, de uma noite específica
     ou de um episódio específico. */
  document.getElementById('shareCustomBtn').addEventListener('click', async () => {
    const escolha = await abrirEscolhaEscopo(NUM_NOITES, MAX_EPS);
    if(!escolha) return;

    /* Mesma hierarquia dos outros cards: o que está sendo avaliado vira o
       TÍTULO, e o contexto (noite, turma, tema) desce para o texto de apoio. */
    let vals, titulo, sub;
    if(escolha.tipo === 'noite'){
      const s = escolha.valor;
      vals = [];
      for(let e = 1; e <= epsDaNoite(s); e++){
        const v = customValues[`s${s}e${e}`];
        if(v !== undefined) vals.push(v);
      }
      titulo = `Noite ${s}`;
      sub = turmasDaNoite(s).join(' · ') || `Cetec Festival ${ANO}`;
    } else if(escolha.tipo === 'episodio'){
      const s = escolha.noite, e = escolha.valor;
      const v = customValues[`s${s}e${e}`];
      vals = (v !== undefined) ? [v] : [];
      const peca = (ND[s] && Array.isArray(ND[s].pecas)) ? ND[s].pecas[e - 1] : null;
      titulo = (peca && peca.titulo) ? peca.titulo : `Noite ${s} · Episódio ${e}`;
      sub = (peca && peca.turma) ? `Noite ${s} · Turma ${peca.turma}` : `Noite ${s}`;
    } else {
      vals = Object.values(customValues).map(Number).filter(v => !isNaN(v));
      titulo = `Meu ${ED.titulo}`;
      sub = temaDaEdicao(ED) || `Cetec Festival ${ANO}`;
    }

    abrirCompartilhamento({
      poster: posterImg.src || posterPadrao,
      titulo,
      sub,
      nota: media(vals),
      legenda: `Minha média · Cetec Festival ${ANO}`,
      arquivo: `Meu_Cetec_Festival_${ANO}.png`
    });
  });

  buildCustomGrid();
}

/* =====================================================================
   PÁGINA: HALL DA FAMA (estatísticas de todas as edições, Chart.js)
   ===================================================================== */
async function paginaHall(){
  document.title = 'CETECritic - Hall da Fama';

  /* ---- configuração vinda do hall-dados.js ----
     HALL.contagens: quantos itens cada ranking mostra (padrão 10).
     HALL.ordemSecoes: em que ordem as seções abaixo aparecem — lista com os
     nomes das chaves (veja o comentário no topo do hall-dados.js). Seção que
     não estiver na lista aparece no final, na ordem padrão. */
  const CNT = Object.assign({ topPecas: 10, topNoites: 10, rankUsuarios: 10 },
    (typeof HALL !== 'undefined' && HALL.contagens) || {});
  const ORDEM_PADRAO = ['badges','badgesPerfil','topPecas','topNoites','topFestivais','mediaTurmas','comparacaoDestaque','compararEdicoes','evolucao','distribuicao','heatmap','recPecas','recNoites','recEdicoes','recComunidade','rankUsuarios','topReputacao','curiosidades'];
  const ordemCfg = (typeof HALL !== 'undefined' && Array.isArray(HALL.ordemSecoes) && HALL.ordemSecoes.length) ? HALL.ordemSecoes : ORDEM_PADRAO;
  const ordemFinal = [...ordemCfg, ...ORDEM_PADRAO.filter(k => !ordemCfg.includes(k))];

  const SECOES = {
    badges: `<div class="section">
      <h2>🏅 As Badges</h2>
      <div class="sub">Medalhas que as peças conquistam automaticamente (mínimo de ${(typeof HALL !== 'undefined' && HALL.minAvaliacoes) || 3} avaliações; cada peça leva no máximo 1 badge automática por edição — a que mais se encaixa). Elas aparecem ao lado do título da peça, na página da noite dela.</div>
      <div class="badge-legend">${[
        ...Object.values(BADGES_DEF),
        ...(((typeof HALL !== 'undefined' && HALL.badgesExtras) || []).filter((b, i, arr) => arr.findIndex(x => x.nome === b.nome) === i))
      ].map(b => `
        <div class="badge-item">
          <span class="badge-big">${b.emoji}</span>
          <div><div class="rec-title">${b.nome}</div><div class="rec-text">${b.desc || ''}</div></div>
        </div>`).join('')}
      </div>
    </div>`,

    /* Vitrine das badges de PERFIL. A seção acima é das peças; estas são das
       pessoas e, até aqui, só existiam escondidas dentro do próprio perfil —
       não dava pra saber o que havia pra conquistar sem já ter conquistado.

       A lista sai do mesmo catalogoBadges que o perfil usa, então cada edição
       criada no painel aparece aqui como "Veterano de {ano}" sozinha. */
    badgesPerfil: (() => {
      /* esta seção é montada na hora, dentro do template do Hall inteiro:
         se ela lançar, a página toda fica em branco. Só esta some. */
      let cat = [];
      try{ cat = catalogoBadgesPublico() || []; }
      catch(e){ console.warn('Hall: não foi possível listar as badges de perfil', e); return ''; }
      if(!cat.length) return '';
      const ORDEM_CAT = ['Presença', 'Crítico', 'Bolão', 'Comunidade', 'Especial'];
      const grupos = {};
      cat.forEach(b => (grupos[b.cat] = grupos[b.cat] || []).push(b));
      /* categorias conhecidas primeiro, na ordem escolhida; qualquer categoria
         nova que alguém adicione ao catálogo cai no fim em vez de sumir */
      const cats = [
        ...ORDEM_CAT.filter(c => grupos[c]),
        ...Object.keys(grupos).filter(c => ORDEM_CAT.indexOf(c) < 0)
      ];
      const nVet = cat.filter(b => /^Veterano de /.test(b.titulo)).length;
      return `<div class="section">
        <h2>🎖️ Badges de perfil <span class="badge-count">${cat.length} no total</span></h2>
        <div class="sub">Estas são das <b>pessoas</b>, não das peças. O site calcula sozinho a partir das avaliações de cada um, e elas ficam na aba “Badges” do perfil.${nVet ? ` ${nVet} são de veterania: <b>toda edição do festival cria a sua</b> — basta avaliar qualquer peça daquele ano pra desbloquear, inclusive de festivais antigos.` : ''}</div>
        ${cats.map(c => `
          <h3 class="subhead">${esc(c)}</h3>
          <div class="badge-legend">${grupos[c].map(b => `
            <div class="badge-item">
              <span class="badge-big">${b.emoji}</span>
              <div><div class="rec-title">${esc(b.titulo)}</div><div class="rec-text">${esc(b.texto || '')}</div></div>
            </div>`).join('')}</div>`).join('')}
      </div>`;
    })(),

    topPecas: `<div class="section">
      <h2>🏆 Top ${CNT.topPecas} Peças</h2>
      <div class="sub">Clique em uma barra para abrir a página da noite da peça.</div>
      <select class="hall-select" id="hallFiltroPecas"></select>
      <div style="height:360px"><canvas id="chartTopPecas"></canvas></div>
    </div>`,

    topNoites: `<div class="section">
      <h2>🌙 Top ${CNT.topNoites} Noites</h2>
      <div class="sub">Melhor nota média por noite. Clique para abrir a noite.</div>
      <select class="hall-select" id="hallFiltroNoites"></select>
      <div style="height:360px"><canvas id="chartTopNoites"></canvas></div>
    </div>`,

    topFestivais: `<div class="section">
      <h2>🏅 Top Festivais</h2>
      <div class="sub">Ranking das edições pela nota média geral. Clique para abrir a edição.</div>
      <div style="height:240px"><canvas id="chartTopFestivais"></canvas></div>
    </div>`,

    mediaTurmas: `<div class="section">
      <h2>🎓 Média histórica por turma</h2>
      <div class="sub">Nota média de todas as peças de cada turma no período escolhido (mínimo de ${(typeof HALL !== 'undefined' && HALL.minAvaliacoes) || 3} avaliações).</div>
      <select class="hall-select" id="hallFiltroTurmas"></select>
      <div class="record-list" id="recTurmas"><div class="empty-note">Carregando...</div></div>
    </div>`,

    comparacaoDestaque: `<div class="section">
      <h2>⚖️ ${EDICAO_EM_DESTAQUE} vs. história</h2>
      <div class="sub">Nota média por noite: a edição em destaque comparada com quem você escolher.</div>
      <div class="hall-filtros">Comparar com <select class="hall-select" id="hallCompara"><option value="hist">Média histórica</option></select></div>
      <div style="height:240px"><canvas id="chartComparacao"></canvas></div>
    </div>`,

    compararEdicoes: `<div class="section">
      <h2>🆚 Comparar edições</h2>
      <div class="sub">Escolha duas edições para ver as notas gerais e o detalhe noite a noite, episódio por episódio. Clique numa peça para abrir a página dela.</div>
      <div class="hall-filtros">
        <select class="hall-select" id="hallCompA"></select> vs
        <select class="hall-select" id="hallCompB"></select>
      </div>
      <div class="hall-cards" id="compCards"></div>
      <div style="height:240px; margin-bottom:16px"><canvas id="chartCompNoites"></canvas></div>
      <div id="compDetalhe"></div>
    </div>`,

    evolucao: `<div class="section">
      <h2>📈 Evolução do festival</h2>
      <div class="sub">Nota média por edição. Clique num ponto para abrir a edição.</div>
      <div class="hall-filtros">De <select class="hall-select" id="hallDe"></select> até <select class="hall-select" id="hallAte"></select></div>
      <div style="height:240px"><canvas id="chartEvolucao"></canvas></div>
      <h3 class="subhead">Cada nota, edição por edição</h3>
      <div class="sub">Quanto cada nota de 0 a ${NOTA_MAXIMA} representou do total daquele ano. Clique numa nota da legenda para mostrar ou esconder a linha dela.</div>
      <div style="height:280px"><canvas id="chartNotas"></canvas></div>
    </div>`,

    distribuicao: `<div class="section">
      <h2>🍩 Distribuição das notas</h2>
      <div class="sub">Todas as notas já registradas no site, agrupadas de 0 a ${NOTA_MAXIMA}.</div>
      <div style="height:300px"><canvas id="chartDist"></canvas></div>
    </div>`,

    heatmap: `<div class="section">
      <h2>🗓️ Notas por noite ao longo dos anos</h2>
      <div class="sub">Cada célula é a média da noite naquele ano. Clique para abrir.</div>
      <div class="heatmap" id="hallHeatmap"></div>
    </div>`,

    recPecas: `<div class="section"><h2>🏆 Prateleira dos Campeões</h2><div class="sub">Recordes das peças.</div><div class="record-list" id="recPecas"></div></div>`,
    recNoites: `<div class="section"><h2>🌙 A Batalha das Noites</h2><div class="sub">Recordes de programação.</div><div class="record-list" id="recNoites"></div></div>`,
    recEdicoes: `<div class="section"><h2>📅 Linha do Tempo &amp; Edições</h2><div class="sub">Comparativo entre os anos.</div><div class="record-list" id="recEdicoes"></div></div>`,
    recComunidade: `<div class="section"><h2>👥 Números da Comunidade</h2><div class="sub">A escala da plateia do CETECritic.</div><div class="record-list" id="recComunidade"></div></div>`,
    rankUsuarios: `<div class="section"><h2>👤 Ranking de usuários</h2><div class="sub">Os perfis mais ativos do acervo (top ${CNT.rankUsuarios}) — clique num nome para abrir o perfil.</div><div class="rank-cols" id="rankUsuarios"><div class="empty-note">Carregando...</div></div></div>`,
    topReputacao: `<div class="section"><h2>👑 Maiores reputações</h2><div class="sub">Os perfis com mais reputação (votos 👍/👎 da comunidade) e o cargo que ocupam. Clique num nome para abrir o perfil.</div><div class="rep-rank" id="topReputacao"><div class="empty-note">Carregando...</div></div></div>`,
    curiosidades: `<div class="section" id="secCurio" style="display:none"><h2>🎭 Curiosidades</h2><div class="record-list" id="recCurio"></div><button class="btn btn-ghost" id="curioToggle" style="display:none; margin-top:12px;">Ver todas</button></div>`
  };

  montarShell(`
    <div class="noite-intro">
      <h1>Hall da Fama</h1>
      <p>Recordes, rankings e estatísticas de todas as edições. <span class="hall-stamp" id="hallAtualizado"></span></p>
    </div>

    <div class="hall-cards" id="hallCards"><div class="empty-note">Carregando estatísticas...</div></div>

    ${ordemFinal.map(k => SECOES[k] || '').join('')}`);

  /* 👑 Maiores reputações — busca o ranking no servidor e mostra nome + cargo.
     Roda sozinho, independente dos gráficos, e atualiza a cada 20s. */
  (function(){
    const NREP = CNT.rankUsuarios || 10;
    async function renderTopRep(){
      const box = document.getElementById('topReputacao');
      if(!box) return;
      const rk = await fetchRankingReputacao();
      detectarPosicaoHall(rk);   // avisa se o usuário entrou/mudou de posição no Hall
      const lista = rk.filter(x => Number(x.rep) > 0).slice(0, NREP);
      if(!lista.length){ box.innerHTML = '<div class="empty-note">Ainda ninguém recebeu votos de reputação. Vote nos perfis pra começar o ranking!</div>'; return; }
      box.innerHTML = `<div class="record-list">${lista.map((x, i) => {
        const t = tituloPorReputacao(Number(x.rep)).atual || { emoji: '🎟️', nome: 'Fã' };
        const medal = ['🥇','🥈','🥉'][i] || (i + 1) + 'º';
        return `<a class="record-item" href="${BASE}perfil.html?user=${encodeURIComponent(x.user)}">
          <span class="rec-emoji">${medal}</span>
          <div><div class="rec-title">${esc(x.user)} <span class="titulo-chip">${t.emoji} ${esc(t.nome)}</span></div>
          <div class="rec-text">${x.rep} de reputação</div></div></a>`;
      }).join('')}</div>`;
    }
    renderTopRep();
    intervaloVisivel(renderTopRep, 20000);
  })();

  if(typeof Chart !== 'undefined'){
    Chart.defaults.color = '#9a9ea6';
    Chart.defaults.borderColor = '#2c2e33';
    Chart.defaults.font.family = "'Inter', sans-serif";
  }

  /* ---- acervo do Hall via /api/db?hall=1 (um request só) ----
     Antes: N× edicao.js + noites + N× ?year= + N× ?bolao= (centenas de hits).
     Agora o servidor agrega edicoes, pecas, votos e bolaoWins numa resposta.
     A forma { cfg, ed, noites } é a mesma que carregarDadosEdicao devolvia,
     para o resto do Hall (calcular, gráficos, records) não mudar. */
  let hallBolaoWins = [];
  function montarEdicoesDoHall(payload){
    const pecasPorAno = {};
    (payload.pecas || []).forEach(p => {
      const ano = Number(p.ano), noite = Number(p.noite), ep = Number(p.ep);
      if(!ano || !noite || !ep) return;
      if(!pecasPorAno[ano]) pecasPorAno[ano] = {};
      if(!pecasPorAno[ano][noite]) pecasPorAno[ano][noite] = [];
      pecasPorAno[ano][noite].push({ ep, titulo: String(p.titulo || ''), turma: String(p.turma || '') });
    });
    Object.keys(pecasPorAno).forEach(ano => {
      Object.keys(pecasPorAno[ano]).forEach(n => {
        pecasPorAno[ano][n].sort((a, b) => a.ep - b.ep);
      });
    });
    const lista = Array.isArray(payload.edicoes) && payload.edicoes.length
      ? payload.edicoes
      : (typeof EDICOES !== 'undefined' ? EDICOES : []);
    return lista.map(e => {
      const ano = Number(e.ano);
      const byNight = pecasPorAno[ano] || {};
      const noites = {};
      Object.keys(byNight).forEach(n => {
        noites[Number(n)] = { pecas: byNight[n].map(x => ({ titulo: x.titulo, turma: x.turma })) };
      });
      const nNoites = Number(e.noites) || Math.max(0, ...Object.keys(noites).map(Number), 0) || 5;
      return {
        cfg: { ano, noites: nNoites },
        ed: { ano, inicio: e.inicio || null },
        noites
      };
    });
  }

  async function carregarHallAgregado(){
    const r = await fetch(API_URL + '?hall=1&_=' + Date.now(), { cache: 'no-store' });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if(!j || j.ok === false) throw new Error((j && j.error) || 'hall agregada falhou');
    if(j.serverNow) serverTimeOffset = j.serverNow - Date.now();
    hallBolaoWins = Array.isArray(j.bolaoWins) ? j.bolaoWins : [];
    const votos = {};
    const raw = j.votos || {};
    Object.keys(raw).forEach(y => {
      const ano = Number(y);
      votos[ano] = filtrarVotosDoAno(raw[y] || [], ano);
    });
    return { edicoes: montarEdicoesDoHall(j), votos };
  }

  let edicoes = [];
  let votosHallCache = {};
  try{
    const agg = await carregarHallAgregado();
    edicoes = agg.edicoes;
    votosHallCache = agg.votos;
  }catch(e){
    console.warn('Hall: payload agregado falhou, caindo no carregamento legado', e);
    const resultados = await Promise.all(EDICOES.map(cfg => carregarDadosEdicao(cfg)));
    edicoes = resultados.filter(Boolean);
  }
  /* edições futuras (inicio ainda não chegou) ficam fora das contagens,
     dos gráficos e do heatmap — nada de spoiler nem de "3 edições" antes da hora */
  const edRealizadas = edicoes.filter(d => {
    const ini = d.ed && d.ed.inicio ? new Date(d.ed.inicio) : null;
    return !ini || isNaN(ini) || ini <= new Date();
  });
  const minAv = (typeof HALL !== 'undefined' && HALL.minAvaliacoes) || 3;
  const CORES_DIST = ['#7a1f1f','#8c2525','#9e2b2b','#b03131','#c23737','#d93c3c','#e48135','#f3ca4d','#31b96e','#188a53','#0f6b3f'];

  /* gráficos são recriados a cada atualização — o registro evita vazamento */
  const registro = {};
  function desenhar(id, config){
    const el = document.getElementById(id);
    if(!el || typeof Chart === 'undefined') return;
    if(registro[id]) registro[id].destroy();
    registro[id] = new Chart(el.getContext('2d'), config);
  }
  const barraClicavel = (itens, urlDe) => ({
    onClick: (e, els) => { if(els.length) location.href = urlDe(itens[els[0].index]); },
    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; }
  });

  let stats = null;
  let curioTimer = null;
  let filtroPecas = 'all';
  let filtroNoites = 'all';
  let filtroTurmas = 'all';
  let comparaCom = 'hist';

  /* filtros de período (o "último ano" = edição mais recente com votos) */
  const PERIODOS = [
    { v: 'all', txt: 'Todos os tempos' },
    { v: '1',   txt: 'Último ano' },
    { v: '3',   txt: 'Últimos 3 anos' },
    { v: '5',   txt: 'Últimos 5 anos' },
    { v: '10',  txt: 'Últimos 10 anos' },
    { v: '20',  txt: 'Últimos 20 anos' }
  ];
  const selPecas = document.getElementById('hallFiltroPecas');
  const selNoites = document.getElementById('hallFiltroNoites');
  const selTurmas = document.getElementById('hallFiltroTurmas');
  [selPecas, selNoites, selTurmas].forEach(sel => { if(sel) sel.innerHTML = PERIODOS.map(p => `<option value="${p.v}">${p.txt}</option>`).join(''); });
  selPecas.addEventListener('change', () => { filtroPecas = selPecas.value; desenharTopPecas(); });
  selNoites.addEventListener('change', () => { filtroNoites = selNoites.value; desenharTopNoites(); });
  if(selTurmas) selTurmas.addEventListener('change', () => { filtroTurmas = selTurmas.value; desenharTurmas(); });
  document.getElementById('hallCompara').addEventListener('change', ev => { comparaCom = ev.target.value; desenharComparacao(); });
  let compA = null, compB = null;
  document.getElementById('hallCompA').addEventListener('change', ev => { compA = Number(ev.target.value); desenharCompEdicoes(); });
  document.getElementById('hallCompB').addEventListener('change', ev => { compB = Number(ev.target.value); desenharCompEdicoes(); });
  document.getElementById('hallDe').addEventListener('change', desenharEvolucao);
  document.getElementById('hallAte').addEventListener('change', desenharEvolucao);

  function anoReferencia(){
    return stats && stats.anos.length ? Math.max(...stats.anos.map(a => a.ano)) : Math.max(...EDICOES.map(e => e.ano));
  }
  function dentroDoPeriodo(ano, filtro){
    if(filtro === 'all') return true;
    return ano >= anoReferencia() - (Number(filtro) - 1);
  }

  const rItem = r => {
    const inner = `<span class="rec-emoji">${r.emoji}</span><div><div class="rec-title">${esc(r.titulo)}</div><div class="rec-text">${esc(r.texto)}</div></div>`;
    return r.url ? `<a class="record-item" href="${r.url}">${inner}</a>` : `<div class="record-item">${inner}</div>`;
  };
  const preencher = (id, recs) => {
    const el = document.getElementById(id);
    if(el) el.innerHTML = recs.length ? recs.map(rItem).join('') : '<div class="empty-note">Ainda não há avaliações suficientes.</div>';
  };
  const topDe = (lista, f, maior = true) => lista.length ? [...lista].sort((a,b) => maior ? f(b)-f(a) : f(a)-f(b))[0] : null;
  const fmtP = p => `${p.titulo} — ${p.ano}, Noite ${p.noite} (nota ${p.st.avg.toFixed(1)}, ${p.st.n} avaliaç${p.st.n === 1 ? 'ão' : 'ões'})`;

  /* ---------- cálculo de todas as estatísticas ---------- */
  function calcular(votos){
    const pecas = [], noites = [], anos = [], todasNotas = [], todosSubs = [];
    let totalVotos = 0, totalPecas = 0;

    edRealizadas.forEach(d => {
      const subs = votos[d.cfg.ano] || [];
      totalVotos += subs.length;
      subs.forEach(su => {
        todosSubs.push(su);
        Object.values(su.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) todasNotas.push(x); });
      });

      let somaAno = 0, nAno = 0;
      const noitesDoAno = [], pecasDoAno = [];
      for(let n = 1; n <= d.cfg.noites; n++){
        const nd = d.noites[n];
        if(!nd || !(nd.pecas || []).length) continue;
        let somaNoite = 0, nNoite = 0;
        const pecasDaNoite = [];
        nd.pecas.forEach((p, i) => {
          totalPecas++;
          const key = `s${n}e${i+1}`;
          const vals = subs.map(su => Number(su.grid[key])).filter(v => !isNaN(v));
          const st = statsDeVals(vals);
          const item = { ano: d.cfg.ano, noite: n, ep: i+1, titulo: p.titulo, turma: p.turma, st, url: `${BASE}${d.cfg.ano}/noite-${n}.html#${key}` };
          pecas.push(item);
          if(st){ somaNoite += st.avg * st.n; nNoite += st.n; pecasDaNoite.push(item); pecasDoAno.push(item); }
        });
        if(nNoite){
          const nn = { ano: d.cfg.ano, noite: n, avg: somaNoite/nNoite, n: nNoite, pecas: pecasDaNoite, url: `${BASE}${d.cfg.ano}/noite-${n}.html` };
          noites.push(nn); noitesDoAno.push(nn);
          somaAno += somaNoite; nAno += nNoite;
        }
      }
      if(nAno){
        const valsAno = [];
        subs.forEach(su => Object.values(su.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) valsAno.push(x); }));
        const avgs = pecasDoAno.map(p => p.st.avg);
        const ordN = [...noitesDoAno].sort((a,b) => a.noite - b.noite);
        /* quantas notas de cada valor (0 a 10) esta edição recebeu — é o que
           alimenta o gráfico de linhas por nota. Arredonda igual à rosquinha
           da "Distribuição das notas", pra os dois contarem a mesma história. */
        const distAno = Array(11).fill(0);
        valsAno.forEach(v => distAno[Math.max(0, Math.min(10, Math.round(v)))]++);
        anos.push({
          ano: d.cfg.ano,
          avg: somaAno/nAno,
          nVals: nAno,
          subs: subs.length,
          dist: distAno,
          nNotas: valsAno.length,
          polar: avgs.length > 1 ? Math.max(...avgs) - Math.min(...avgs) : null,
          /* `p9` (fatia de notas 9+ do ano) ficava aqui. Só existia pra
             alimentar o gráfico chartP9, que saiu do Hall — a mesma
             informação, e melhor, está no "Cada nota, edição por edição".
             O p9 POR PEÇA continua em statsDeVals, e é ele que sustenta a
             badge 👏 Favorita do público. */
          cresc: ordN.length > 1 ? { d: ordN[ordN.length-1].avg - ordN[0].avg, de: ordN[0], para: ordN[ordN.length-1] } : null,
          avalPorPeca: pecasDoAno.length ? nAno / pecasDoAno.length : null
        });
      }
    });
    return { pecas, noites, anos, todasNotas, totalVotos, totalPecas, todosSubs };
  }

  /* ---------- gráficos que dependem de filtros ---------- */
  function desenharTopPecas(){
    if(!stats) return;
    const lista = stats.pecas.filter(p => p.st && dentroDoPeriodo(p.ano, filtroPecas));
    let elig = lista.filter(p => p.st.n >= minAv);
    if(!elig.length) elig = lista;
    const top = [...elig].sort((a,b) => b.st.avg - a.st.avg || b.st.n - a.st.n).slice(0, CNT.topPecas);
    desenhar('chartTopPecas', {
      type: 'bar',
      data: {
        labels: top.map(p => `${p.titulo} (${p.ano})`),
        datasets: [{ data: top.map(p => Number(p.st.avg.toFixed(2))), backgroundColor: top.map(p => corDaNota(p.st.avg)) }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        ...barraClicavel(top, p => p.url),
        plugins: { legend: { display: false } },
        scales: { x: { min: 0, max: NOTA_MAXIMA } }
      }
    });
  }

  function desenharTopNoites(){
    if(!stats) return;
    const lista = stats.noites.filter(x => dentroDoPeriodo(x.ano, filtroNoites));
    const top = [...lista].sort((a,b) => b.avg - a.avg).slice(0, CNT.topNoites);
    desenhar('chartTopNoites', {
      type: 'bar',
      data: { labels: top.map(x => `Noite ${x.noite} · ${x.ano}`), datasets: [{ data: top.map(x => Number(x.avg.toFixed(2))), backgroundColor: top.map(x => corDaNota(x.avg)) }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        ...barraClicavel(top, x => x.url),
        plugins: { legend: { display: false } },
        scales: { x: { min: 0, max: NOTA_MAXIMA } }
      }
    });
  }

  /* média histórica por turma (respeita o mesmo filtro de período) */
  function desenharTurmas(){
    if(!stats) return;
    const el = document.getElementById('recTurmas');
    if(!el) return;
    const acc = {};
    stats.pecas.forEach(p => {
      if(!p.turma || !p.st || !p.st.n) return;
      if(!dentroDoPeriodo(p.ano, filtroTurmas)) return;
      const t = acc[p.turma] || (acc[p.turma] = { soma: 0, n: 0, anos: new Set(), pecas: 0 });
      t.soma += p.st.avg * p.st.n;  // média ponderada pelo nº de avaliações
      t.n += p.st.n;
      t.anos.add(p.ano);
      t.pecas++;
    });
    const lista = Object.keys(acc)
      .map(t => ({ turma: t, avg: acc[t].soma / acc[t].n, n: acc[t].n, anos: acc[t].anos.size, pecas: acc[t].pecas }))
      .filter(x => x.n >= minAv)
      .sort((a,b) => b.avg - a.avg);
    el.innerHTML = lista.length
      ? lista.map((x, i) => `<div class="record-item">
          <span class="rec-emoji">${['🥇','🥈','🥉'][i] || (i+1) + 'º'}</span>
          <div style="flex:1 1 auto; min-width:0">
            <div class="rec-title">Turma ${esc(x.turma)}</div>
            <div class="rec-text">${x.pecas} peça${x.pecas === 1 ? '' : 's'} · ${x.anos} ediç${x.anos === 1 ? 'ão' : 'ões'} · ${x.n} avaliaç${x.n === 1 ? 'ão' : 'ões'}</div>
          </div>
          <span class="busca-nota" style="background:${corDaNota(x.avg)}">${x.avg.toFixed(2)}</span>
        </div>`).join('')
      : '<div class="empty-note">Ainda não há avaliações suficientes.</div>';
  }

  function desenharComparacao(){
    if(!stats) return;
    const maxN = Math.max(...EDICOES.map(e => e.noites));
    const labelsN = [], destPorNoite = [], outroPorNoite = [];
    for(let nn = 1; nn <= maxN; nn++){
      labelsN.push('Noite ' + nn);
      const dst = stats.noites.find(x => x.noite === nn && x.ano === EDICAO_EM_DESTAQUE);
      destPorNoite.push(dst ? Number(dst.avg.toFixed(2)) : null);
      if(comparaCom === 'hist'){
        const todas = stats.noites.filter(x => x.noite === nn);
        if(todas.length){
          let sm = 0, cnt = 0;
          todas.forEach(x => { sm += x.avg * x.n; cnt += x.n; });
          outroPorNoite.push(Number((sm/cnt).toFixed(2)));
        } else outroPorNoite.push(null);
      } else {
        const outro = stats.noites.find(x => x.noite === nn && x.ano === Number(comparaCom));
        outroPorNoite.push(outro ? Number(outro.avg.toFixed(2)) : null);
      }
    }
    desenhar('chartComparacao', {
      type: 'bar',
      data: { labels: labelsN, datasets: [
        { label: String(EDICAO_EM_DESTAQUE), data: destPorNoite, backgroundColor: '#f5c518' },
        { label: comparaCom === 'hist' ? 'Média histórica' : 'Edição ' + comparaCom, data: outroPorNoite, backgroundColor: '#5a5e66' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: NOTA_MAXIMA } } }
    });
  }

  function desenharCompEdicoes(){
    if(!stats || compA === null || compB === null) return;
    const cfgA = EDICOES.find(e => e.ano === compA) || { noites: 5 };
    const cfgB = EDICOES.find(e => e.ano === compB) || { noites: 5 };
    const anoA = stats.anos.find(a => a.ano === compA);
    const anoB = stats.anos.find(a => a.ano === compB);

    /* cards-resumo: nota geral de cada edição + diferença */
    const cardAno = (ano, info, cor) => `
      <div class="hall-card">
        <div class="big" style="color:${cor}">${info ? info.avg.toFixed(1) : '–'}</div>
        <div class="lbl">${ano}</div>
        <div class="subtxt">${info ? `${info.subs} avaliações · ${info.nVals} notas` : 'sem avaliações'}</div>
      </div>`;
    let diffHtml = '';
    if(anoA && anoB){
      const d = anoA.avg - anoB.avg;
      diffHtml = `<div class="hall-card"><div class="big">${d > 0 ? '+' : ''}${d.toFixed(1)}</div><div class="lbl">Diferença</div><div class="subtxt">${Math.abs(d) < 0.05 ? 'empate técnico' : (d > 0 ? compA : compB) + ' na frente'}</div></div>`;
    }
    document.getElementById('compCards').innerHTML = cardAno(compA, anoA, '#f5c518') + cardAno(compB, anoB, '#8ab4f8') + diffHtml;

    /* barras agrupadas: média por noite das duas edições */
    const maxN = Math.max(cfgA.noites || 5, cfgB.noites || 5);
    const labels = [], dA = [], dB = [];
    for(let n = 1; n <= maxN; n++){
      labels.push('Noite ' + n);
      const xA = stats.noites.find(x => x.ano === compA && x.noite === n);
      const xB = stats.noites.find(x => x.ano === compB && x.noite === n);
      dA.push(xA ? Number(xA.avg.toFixed(2)) : null);
      dB.push(xB ? Number(xB.avg.toFixed(2)) : null);
    }
    desenhar('chartCompNoites', {
      type: 'bar',
      data: { labels, datasets: [
        { label: String(compA), data: dA, backgroundColor: '#f5c518' },
        { label: String(compB), data: dB, backgroundColor: '#8ab4f8' }
      ]},
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: NOTA_MAXIMA } } }
    });

    /* detalhe: episódio por episódio, lado a lado */
    const chip = p => {
      if(!p) return '<div class="comp-side empty">—</div>';
      const nota = p.st ? p.st.avg.toFixed(1) : '–';
      const cor = p.st ? corDaNota(p.st.avg) : 'var(--gray-cell)';
      const corTxt = p.st ? '#14161a' : 'var(--text-muted)';
      return `<a class="comp-side" href="${p.url}">
        <span class="comp-nota" style="background:${cor}; color:${corTxt}">${nota}</span>
        <span class="comp-titulo">${esc(p.titulo)}</span>
      </a>`;
    };
    let html = '';
    for(let n = 1; n <= maxN; n++){
      const pecasA = stats.pecas.filter(p => p.ano === compA && p.noite === n);
      const pecasB = stats.pecas.filter(p => p.ano === compB && p.noite === n);
      if(!pecasA.length && !pecasB.length) continue;
      const xA = stats.noites.find(x => x.ano === compA && x.noite === n);
      const xB = stats.noites.find(x => x.ano === compB && x.noite === n);
      html += `<h3 class="subhead">Noite ${n} — ${compA}: ${xA ? xA.avg.toFixed(1) : '–'} · ${compB}: ${xB ? xB.avg.toFixed(1) : '–'}</h3>`;
      const maxEp = Math.max(pecasA.length, pecasB.length);
      for(let e = 1; e <= maxEp; e++){
        const pA = pecasA.find(p => p.ep === e);
        const pB = pecasB.find(p => p.ep === e);
        html += `<div class="comp-row">${chip(pA)}<div class="comp-ep">E${e}</div>${chip(pB)}</div>`;
      }
    }
    document.getElementById('compDetalhe').innerHTML = html || '<div class="empty-note">Nenhuma peça cadastrada nas edições escolhidas.</div>';
  }

  function desenharEvolucao(){
    if(!stats) return;
    const de = Number(document.getElementById('hallDe').value) || 0;
    const ate = Number(document.getElementById('hallAte').value) || 9999;
    const lista = stats.anos.filter(a => a.ano >= de && a.ano <= ate).sort((a,b) => a.ano - b.ano);
    desenhar('chartEvolucao', {
      type: 'line',
      data: { labels: lista.map(a => a.ano), datasets: [{ label: 'Nota média', data: lista.map(a => Number(a.avg.toFixed(2))), borderColor: '#f5c518', backgroundColor: 'rgba(245,197,24,.15)', fill: true, tension: .3, pointRadius: 5, pointBackgroundColor: '#f5c518' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        ...barraClicavel(lista, a => `${BASE}${a.ano}/index.html`),
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: NOTA_MAXIMA } }
      }
    });
    /* O gráfico "% de notas 9+" (chartP9) ficava aqui. Foi removido quando o
       "Cada nota, edição por edição" logo abaixo entrou: aquele mostra a
       fatia de TODAS as notas ano a ano, então a linha do 9+ virou um recorte
       pobre da mesma informação — e ainda ocupava a altura de um gráfico
       inteiro para dizer menos.

       A estatística em si continua viva: `p9` segue em statsDeVals, alimenta
       a badge 👏 Favorita do público e o recorde correspondente no Hall. */

    /* ---- uma linha por nota (0 a 10) ----------------------------------
       Mesmo formato do gráfico de cima, só que com uma linha para cada
       nota, na cor que ela tem no resto do site (CORES_DIST é a mesma
       paleta da rosquinha "Distribuição das notas").

       Sem `fill`: onze áreas translúcidas empilhadas viram uma mancha e
       ninguém distingue nada. Linha limpa + ponto colorido + legenda
       clicável deixa isolar a nota que interessa.

       As notas que ficaram em 0% no período inteiro nascem escondidas —
       continuam na legenda pra ligar quando quiser, mas não poluem o
       gráfico com dez linhas coladas no chão. */
    const pctDaNota = (a, nota) => (a.nNotas && a.dist) ? Math.round((a.dist[nota] / a.nNotas) * 1000) / 10 : 0;
    const datasetsNotas = CORES_DIST.map((cor, nota) => {
      const serie = lista.map(a => pctDaNota(a, nota));
      return {
        label: 'Nota ' + nota,
        data: serie,
        borderColor: cor,
        backgroundColor: cor,
        pointBackgroundColor: cor,
        pointBorderColor: cor,
        hidden: serie.every(v => v === 0),       // nota que ninguém deu no período
        fill: false, tension: .3, borderWidth: 2.5,
        pointRadius: 3, pointHoverRadius: 6
      };
    });
    desenhar('chartNotas', {
      type: 'line',
      data: { labels: lista.map(a => a.ano), datasets: datasetsNotas },
      options: {
        responsive: true, maintainAspectRatio: false,
        /* passar o mouse mostra TODAS as notas daquele ano de uma vez —
           é assim que dá pra ler a composição da edição num relance */
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 12, padding: 10, usePointStyle: true } },
          tooltip: {
            itemSort: (a, b) => b.parsed.y - a.parsed.y,   // maior fatia primeiro
            callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y}%` }
          }
        },
        scales: { y: { min: 0, ticks: { callback: v => v + '%' } } }
      }
    });
  }

  /* ---------- render completo ---------- */
  function renderTudo(){
    const s = stats;
    const comVotos = s.pecas.filter(p => p.st);
    let elig = comVotos.filter(p => p.st.n >= minAv);
    if(!elig.length) elig = comVotos;

    const total10s = s.todasNotas.filter(v => v >= NOTA_MAXIMA - 0.01).length;
    const mediaHist = s.todasNotas.length ? s.todasNotas.reduce((a,b)=>a+b,0)/s.todasNotas.length : null;
    const anoDest = s.anos.find(a => a.ano === EDICAO_EM_DESTAQUE);
    const melhorAno = topDe(s.anos, a => a.avg);
    const maisPart = topDe(s.anos, a => a.subs);
    const maisPolar = topDe(s.anos.filter(a => a.polar !== null), a => a.polar);

    /* ---- Seção 1: cards ---- */
    const cards = [
      { big: HALL.edicoesRealizadas || String(edRealizadas.length), lbl: 'Edições' },
      { big: String(s.totalPecas), lbl: 'Peças apresentadas' },
      { big: String(s.totalVotos), lbl: 'Avaliações recebidas' },
      { big: mediaHist === null ? '–' : mediaHist.toFixed(1), lbl: 'Média histórica', sub: anoDest ? `vs ${anoDest.avg.toFixed(1)} em ${anoDest.ano}` : '' },
      { big: String(total10s), lbl: `Notas ${NOTA_MAXIMA} dadas` }
    ];
    if(melhorAno) cards.push({ big: String(melhorAno.ano), lbl: 'Melhor edição', sub: `média ${melhorAno.avg.toFixed(1)}`, url: `${BASE}${melhorAno.ano}/index.html` });
    if(maisPart && maisPart.subs) cards.push({ big: String(maisPart.ano), lbl: 'Maior participação', sub: `${maisPart.subs} avaliações` });
    if(maisPolar) cards.push({ big: String(maisPolar.ano), lbl: 'Mais polarizada', sub: `${maisPolar.polar.toFixed(1)} pts entre extremos` });
    if(HALL.publicoEstimado) cards.push({ big: HALL.publicoEstimado, lbl: 'Público estimado' });
    document.getElementById('hallCards').innerHTML = cards.map(c => {
      const inner = `<div class="big">${c.big}</div><div class="lbl">${c.lbl}</div>${c.sub ? `<div class="subtxt">${c.sub}</div>` : ''}`;
      return c.url ? `<a class="hall-card" href="${c.url}">${inner}</a>` : `<div class="hall-card">${inner}</div>`;
    }).join('');

    /* ---- gráficos ---- */
    desenharTopPecas();
    desenharTopNoites();
    desenharTurmas();

    const rankAnos = [...s.anos].sort((a,b) => b.avg - a.avg);
    desenhar('chartTopFestivais', {
      type: 'bar',
      data: { labels: rankAnos.map(a => a.ano), datasets: [{ data: rankAnos.map(a => Number(a.avg.toFixed(2))), backgroundColor: rankAnos.map(a => corDaNota(a.avg)) }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        ...barraClicavel(rankAnos, a => `${BASE}${a.ano}/index.html`),
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: NOTA_MAXIMA } }
      }
    });

    /* opções do "comparar com": média histórica + cada edição com votos (menos a em destaque) */
    const selComp = document.getElementById('hallCompara');
    const vComp = selComp.value;
    selComp.innerHTML = '<option value="hist">Média histórica</option>' +
      [...s.anos].sort((a,b) => b.ano - a.ano)
        .filter(a => a.ano !== EDICAO_EM_DESTAQUE)
        .map(a => `<option value="${a.ano}">Edição ${a.ano}</option>`).join('');
    selComp.value = [...selComp.options].some(o => o.value === vComp) ? vComp : 'hist';
    comparaCom = selComp.value;
    desenharComparacao();

    /* seletores do "Comparar edições" — todas as edições do config.js.
       Padrão: as duas edições mais recentes com votos. */
    const selA = document.getElementById('hallCompA');
    const selB = document.getElementById('hallCompB');
    if(!selA.options.length){
      const anosTodos = [...EDICOES].map(e => e.ano).sort((a,b) => b - a);
      const optsE = anosTodos.map(a => `<option value="${a}">Edição ${a}</option>`).join('');
      selA.innerHTML = optsE; selB.innerHTML = optsE;
      const comVoto = [...s.anos].sort((a,b) => b.ano - a.ano).map(a => a.ano);
      compA = comVoto[0] ?? anosTodos[0];
      compB = comVoto[1] ?? anosTodos.find(a => a !== compA) ?? compA;
      selA.value = String(compA);
      selB.value = String(compB);
    }
    desenharCompEdicoes();

    const maxN = Math.max(...EDICOES.map(e => e.noites));

    /* período do gráfico de evolução (mantém a escolha do usuário) */
    const anosDisp = [...s.anos].sort((a,b) => a.ano - b.ano).map(a => a.ano);
    const selDe = document.getElementById('hallDe'), selAte = document.getElementById('hallAte');
    const vDe = selDe.value, vAte = selAte.value;
    const opts = anosDisp.map(a => `<option value="${a}">${a}</option>`).join('');
    selDe.innerHTML = opts; selAte.innerHTML = opts;
    selDe.value = anosDisp.includes(Number(vDe)) ? vDe : String(anosDisp[0] ?? '');
    selAte.value = anosDisp.includes(Number(vAte)) ? vAte : String(anosDisp[anosDisp.length-1] ?? '');
    desenharEvolucao();

    const dist = Array(11).fill(0);
    s.todasNotas.forEach(v => dist[Math.max(0, Math.min(10, Math.round(v)))]++);
    desenhar('chartDist', {
      type: 'doughnut',
      data: { labels: dist.map((_, i) => 'Nota ' + i), datasets: [{ data: dist, backgroundColor: CORES_DIST, borderColor: '#17181c', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    /* heatmap: anos × noites */
    let hm = '<div class="hm-row"><div class="hm-lbl"></div>' +
      Array.from({ length: maxN }, (_, i) => `<div class="hm-lbl">N${i+1}</div>`).join('') + '</div>';
    edRealizadas.forEach(d => {
      hm += `<div class="hm-row"><div class="hm-lbl">${d.cfg.ano}</div>`;
      for(let nn = 1; nn <= maxN; nn++){
        const x = s.noites.find(v => v.ano === d.cfg.ano && v.noite === nn);
        hm += x
          ? `<a class="hm-cell" href="${x.url}" style="background:${corDaNota(x.avg)}" title="Noite ${nn} de ${x.ano}: ${x.avg.toFixed(1)} (${x.n} notas)">${x.avg.toFixed(1)}</a>`
          : `<div class="hm-cell empty">–</div>`;
      }
      hm += '</div>';
    });
    document.getElementById('hallHeatmap').innerHTML = hm;

    /* ---- 1. Prateleira dos Campeões ---- */
    const recsP = [];
    const goat = topDe(elig, p => p.st.avg);
    if(goat) recsP.push({ emoji:'🏆', titulo:'A peça mais aclamada da história (GOAT)', texto: fmtP(goat), url: goat.url });
    const perfeito = topDe(elig.filter(p => p.st.p10 > 0), p => p.st.p10);
    if(perfeito) recsP.push({ emoji:'💯', titulo:`O "${NOTA_MAXIMA}/${NOTA_MAXIMA}" purista`, texto:`${Math.round(perfeito.st.p10*100)}% dos votos de ${perfeito.titulo} (${perfeito.ano}) foram nota ${NOTA_MAXIMA}`, url: perfeito.url });
    const pol = topDe(elig.filter(p => p.st.std > 0), p => p.st.std);
    if(pol) recsP.push({ emoji:'🔥', titulo:'A mais polêmica (dividiu a plateia)', texto:`${fmtP(pol)} — notas de ${pol.st.min.toFixed(1)} a ${pol.st.max.toFixed(1)}`, url: pol.url });
    const sleepers = [];
    s.noites.forEach(x => { if(x.pecas.length > 1) x.pecas.forEach(p => {
      /* a GOAT (maior média da história) não pode ser "sleeper hit": ela é a
         favorita natural, não uma surpresa que ninguém viu chegar */
      if(goat && p.titulo === goat.titulo && p.ano === goat.ano) return;
      if(p.st.n >= minAv) sleepers.push({ p, margem: p.st.avg - x.avg, noiteAvg: x.avg });
    }); });
    const sl = topDe(sleepers, q => q.margem);
    if(sl && sl.margem > 0.2) recsP.push({ emoji:'😴', titulo:'O "Sleeper Hit" (maior surpresa)', texto:`${fmtP(sl.p)} superou a média da própria noite (${sl.noiteAvg.toFixed(1)}) em ${sl.margem.toFixed(1)} ponto(s)`, url: sl.p.url });
    if(elig.length > 1){
      const cons = topDe(elig, p => p.st.std, false);
      if(cons) recsP.push({ emoji:'🎯', titulo:'A mais consistente', texto:`${fmtP(cons)} — notas entre ${cons.st.min.toFixed(1)} e ${cons.st.max.toFixed(1)}, quase todo mundo concordou`, url: cons.url });
    }
    const fav = topDe(elig.filter(p => p.st.p9 > 0), p => p.st.p9);
    if(fav) recsP.push({ emoji:'👏', titulo:'Favorita do público', texto:`${Math.round(fav.st.p9*100)}% das notas de ${fav.titulo} (${fav.ano}) foram 9+`, url: fav.url });
    const maisAv = topDe(comVotos, p => p.st.n);
    if(maisAv) recsP.push({ emoji:'📊', titulo:'A mais avaliada', texto: fmtP(maisAv), url: maisAv.url });
    if(elig.length > 1){
      const pior = topDe(elig, p => p.st.avg, false);
      recsP.push({ emoji:'🥶', titulo:'A pior avaliada', texto: fmtP(pior), url: pior.url });
    }
    const maxInd = topDe(comVotos, p => p.st.max);
    if(maxInd) recsP.push({ emoji:'🔺', titulo:'Maior nota individual da história', texto:`Alguém deu ${maxInd.st.max.toFixed(1)} para ${maxInd.titulo} (${maxInd.ano})`, url: maxInd.url });
    const minInd = topDe(comVotos, p => p.st.min, false);
    if(minInd) recsP.push({ emoji:'🔻', titulo:'Menor nota individual da história', texto:`Alguém deu ${minInd.st.min.toFixed(1)} para ${minInd.titulo} (${minInd.ano})`, url: minInd.url });
    const perfeitas = comVotos.filter(p => p.st.avg >= NOTA_MAXIMA - 0.05);
    recsP.push({ emoji:'💎', titulo:'Peças com média perfeita', texto: perfeitas.length
      ? `${perfeitas.length}: ${perfeitas.map(p => `${p.titulo} (${p.ano})`).join(', ')}`
      : `Nenhuma média ${NOTA_MAXIMA}.0 ainda${goat ? ` — a mais próxima foi ${goat.titulo} com ${goat.st.avg.toFixed(1)}` : ''}` });
    let cresc = null;
    s.noites.forEach(x => {
      const ord = [...x.pecas].sort((a,b) => a.ep - b.ep);
      for(let i = 1; i < ord.length; i++){
        const dd = ord[i].st.avg - ord[i-1].st.avg;
        if(!cresc || dd > cresc.dd) cresc = { dd, de: ord[i-1], para: ord[i] };
      }
    });
    if(cresc && cresc.dd > 0) recsP.push({ emoji:'📈', titulo:'Maior evolução dentro de uma noite', texto:`De "${cresc.de.titulo}" (${cresc.de.st.avg.toFixed(1)}) para "${cresc.para.titulo}" (${cresc.para.st.avg.toFixed(1)}) — Noite ${cresc.para.noite} de ${cresc.para.ano}`, url: cresc.para.url });
    preencher('recPecas', recsP);

    /* ---- 2. A Batalha das Noites ---- */
    const recsN = [];
    /* guarda as noites (objeto bruto `x`) premiadas aqui embaixo, pra "A Mais
       Repetida" no fim conseguir contar por POSIÇÃO (Noite 1, 2, 3...) sem
       duplicar a lógica de cada recorde */
    const vencedoresNoite = [];

    const ouro = topDe(s.noites, x => x.avg);
    if(ouro){ recsN.push({ emoji:'🌙', titulo:'A Noite Ouro (melhor da história)', texto:`Noite ${ouro.noite} de ${ouro.ano} — média ${ouro.avg.toFixed(1)} com ${ouro.n} notas`, url: ouro.url }); vencedoresNoite.push(ouro); }

    const comVarias = s.noites.filter(x => x.pecas.length > 1);
    const amplitude = x => Math.max(...x.pecas.map(p => p.st.avg)) - Math.min(...x.pecas.map(p => p.st.avg));
    const caos = topDe(comVarias, amplitude);
    if(caos){ recsN.push({ emoji:'🎢', titulo:'A Noite do Caos (montanha-russa)', texto:`Noite ${caos.noite} de ${caos.ano} — ${amplitude(caos).toFixed(1)} pontos entre a melhor e a pior peça do dia`, url: caos.url }); vencedoresNoite.push(caos); }

    /* irmã do Caos: a noite em que a plateia foi mais unânime peça a peça
       (menor distância entre a melhor e a pior nota da programação) */
    const equilibrada = topDe(comVarias, amplitude, false);
    if(equilibrada){ recsN.push({ emoji:'⚖️', titulo:'A Noite Equilibrada', texto:`Noite ${equilibrada.noite} de ${equilibrada.ano} — só ${amplitude(equilibrada).toFixed(1)} ponto(s) entre a melhor e a pior peça do dia`, url: equilibrada.url }); vencedoresNoite.push(equilibrada); }

    s.anos.forEach(a => {
      s.noites.filter(x => x.ano === a.ano && x.pecas.length >= 2 && x.pecas.every(p => p.st.avg >= a.avg))
        .forEach(x => { recsN.push({ emoji:'👑', titulo:'Rolo Compressor (Tripla Coroa)', texto:`Noite ${x.noite} de ${x.ano}: todas as peças acima da média do festival (${a.avg.toFixed(1)})`, url: x.url }); vencedoresNoite.push(x); });
    });

    /* aprovação unânime: toda peça da noite acima de um patamar alto — mais
       simples que o Rolo Compressor, que compara com a média do FESTIVAL */
    const TETO_UNANIME = NOTA_MAXIMA - 2;
    s.noites.filter(x => x.pecas.length >= 2 && x.pecas.every(p => p.st.avg >= TETO_UNANIME))
      .forEach(x => { recsN.push({ emoji:'💯', titulo:'Aprovação Unânime', texto:`Noite ${x.noite} de ${x.ano}: nenhuma peça abaixo de ${TETO_UNANIME.toFixed(1)}`, url: x.url }); vencedoresNoite.push(x); });

    /* votos por peça (engajamento): menor e maior extremo da mesma métrica */
    const votosPorPeca = x => x.n / x.pecas.length;
    const casaVazia = topDe(s.noites, votosPorPeca, false);
    if(casaVazia){ recsN.push({ emoji:'🪑', titulo:'Casa Vazia', texto:`Noite ${casaVazia.noite} de ${casaVazia.ano} — só ${votosPorPeca(casaVazia).toFixed(1)} avaliaç${votosPorPeca(casaVazia) === 1 ? 'ão' : 'ões'} por peça em média`, url: casaVazia.url }); vencedoresNoite.push(casaVazia); }
    const maisEngajada = topDe(s.noites, votosPorPeca);
    if(maisEngajada){ recsN.push({ emoji:'🎟️', titulo:'A Mais Comentada (votos por peça)', texto:`Noite ${maisEngajada.noite} de ${maisEngajada.ano} — ${votosPorPeca(maisEngajada).toFixed(1)} avaliações por peça em média`, url: maisEngajada.url }); vencedoresNoite.push(maisEngajada); }

    /* dispersão média das notas dentro da noite: diferente do Caos (que olha
       só a distância entre extremos), aqui é a média dos desvios-padrão de
       cada peça — mostra se a plateia se dividiu peça a peça, não só no total */
    const diversidade = x => media(x.pecas.map(p => p.st.std));
    const dividida = topDe(s.noites.filter(x => x.pecas.length), diversidade);
    if(dividida){ recsN.push({ emoji:'🌈', titulo:'Diversidade de Opiniões', texto:`Noite ${dividida.noite} de ${dividida.ano} — a plateia se dividiu peça a peça (desvio médio de ${diversidade(dividida).toFixed(2)})`, url: dividida.url }); vencedoresNoite.push(dividida); }

    const maiorLineup = topDe(s.noites, x => x.pecas.length);
    if(maiorLineup) { recsN.push({ emoji:'🎭', titulo:'Maior Line-up', texto:`Noite ${maiorLineup.noite} de ${maiorLineup.ano} — ${maiorLineup.pecas.length} peças na mesma noite`, url: maiorLineup.url }); vencedoresNoite.push(maiorLineup); }

    const maratona = topDe(s.noites, x => x.n);
    if(maratona){ recsN.push({ emoji:'🏃', titulo:'O Dia da Maratona (mais votos)', texto:`Noite ${maratona.noite} de ${maratona.ano} — ${maratona.n} notas registradas`, url: maratona.url }); vencedoresNoite.push(maratona); }

    /* "A Mais Repetida": por POSIÇÃO (Noite 1, 2, 3...), não por ano — conta
       quantas vezes aquela posição da grade apareceu entre os recordes
       acima. Só aparece se alguma posição se repetiu de verdade. */
    if(vencedoresNoite.length){
      const porPosicao = {};
      vencedoresNoite.forEach(x => { porPosicao[x.noite] = (porPosicao[x.noite] || 0) + 1; });
      const [posTop, contagem] = Object.entries(porPosicao).sort((a,b) => b[1] - a[1])[0];
      if(contagem > 1) recsN.push({ emoji:'🕰️', titulo:'A Mais Repetida', texto:`A Noite ${posTop} apareceu ${contagem}× entre os recordes acima — parece ser um horário abençoado (ou amaldiçoado) na grade` });
    }

    preencher('recNoites', recsN);

    /* ---- 3. Linha do Tempo & Edições ---- */
    const recsE = [];
    if(melhorAno) recsE.push({ emoji:'🏆', titulo:'O Festival do Ano (Edição Ouro)', texto:`${melhorAno.ano}, com média geral ${melhorAno.avg.toFixed(1)}`, url:`${BASE}${melhorAno.ano}/index.html` });
    if(rankAnos.length) recsE.push({ emoji:'🏅', titulo:'Ranking das edições', texto: rankAnos.map(a => `${a.ano} (${a.avg.toFixed(1)})`).join(' · ') });
    let e1s = 0, e1n = 0, eUs = 0, eUn = 0;
    s.noites.forEach(x => {
      const ultimoEp = Math.max(...x.pecas.map(q => q.ep));
      x.pecas.forEach(p => {
        if(p.ep === 1){ e1s += p.st.avg * p.st.n; e1n += p.st.n; }
        if(p.ep === ultimoEp && ultimoEp > 1){ eUs += p.st.avg * p.st.n; eUn += p.st.n; }
      });
    });
    if(e1n && eUn) recsE.push({ emoji:'🎬', titulo:'O Efeito Estreia (abertura vs. encerramento)', texto:`Peças que abrem a noite: média ${(e1s/e1n).toFixed(1)} · peças que encerram: média ${(eUs/eUn).toFixed(1)}` });
    const crescFest = topDe(s.anos.filter(a => a.cresc), a => a.cresc.d);
    if(crescFest && crescFest.cresc.d > 0) recsE.push({ emoji:'🚀', titulo:'Maior crescimento durante o festival', texto:`${crescFest.ano}: da Noite ${crescFest.cresc.de.noite} (${crescFest.cresc.de.avg.toFixed(1)}) para a Noite ${crescFest.cresc.para.noite} (${crescFest.cresc.para.avg.toFixed(1)})`, url:`${BASE}${crescFest.ano}/index.html` });
    if(maisPolar) recsE.push({ emoji:'⚡', titulo:'A edição mais polarizada', texto:`${maisPolar.ano} — ${maisPolar.polar.toFixed(1)} pontos entre a peça mais amada e a mais criticada`, url:`${BASE}${maisPolar.ano}/index.html` });
    const decadas = {};
    elig.forEach(p => { const dec = Math.floor(p.ano/10)*10; if(!decadas[dec] || p.st.avg > decadas[dec].st.avg) decadas[dec] = p; });
    Object.keys(decadas).sort().forEach(dec => recsE.push({ emoji:'📆', titulo:`Melhor peça dos anos ${dec}`, texto: fmtP(decadas[dec]), url: decadas[dec].url }));
    preencher('recEdicoes', recsE);

    /* ---- 4. Números da Comunidade ---- */
    const recsC = [];
    recsC.push({ emoji:'🗳️', titulo:'A escala da plateia', texto:`${s.totalVotos} avaliações enviadas, somando ${s.todasNotas.length} notas dadas` });
    if(mediaHist !== null) recsC.push({ emoji:'📈', titulo:'Média histórica do CETEC', texto:`${mediaHist.toFixed(1)}${anoDest ? ` — a edição ${anoDest.ano} fez ${anoDest.avg.toFixed(1)}` : ''}` });
    const buckets = {};
    s.todosSubs.forEach(su => {
      const dt = new Date(Number(su.ts));
      if(isNaN(dt.getTime())) return;
      const k = dt.getDay() + '-' + dt.getHours();
      buckets[k] = (buckets[k] || 0) + 1;
    });
    const pico = Object.entries(buckets).sort((a,b) => b[1]-a[1])[0];
    if(pico){
      const dias = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
      const [dw, hh] = pico[0].split('-').map(Number);
      recsC.push({ emoji:'⏰', titulo:'O horário mais participativo', texto:`O pico de avaliações foi numa ${dias[dw]}, por volta das ${hh}h (${pico[1]} envios nessa faixa)` });
    }
    if(comVotos.length){
      const histApp = s.todasNotas.length / comVotos.length;
      recsC.push({ emoji:'🧮', titulo:'Média de avaliações por peça', texto:`Histórico: ${histApp.toFixed(1)} notas por peça${anoDest && anoDest.avalPorPeca ? ` · ${anoDest.ano}: ${anoDest.avalPorPeca.toFixed(1)}` : ''}` });
    }
    preencher('recComunidade', recsC);

    /* ---- curiosidades UNIFICADAS (mesma lista da Home) ----
       retraído: mostra 5 sorteadas, trocando a cada 8s.
       "Ver todas": expande e mostra todas (para a rotação). */
    const cur = (typeof CURIOSIDADES !== 'undefined' && Array.isArray(CURIOSIDADES) && CURIOSIDADES.length)
      ? CURIOSIDADES : (HALL.curiosidades || []);
    const sec = document.getElementById('secCurio');
    if(cur.length){
      sec.style.display = '';
      const alvo = document.getElementById('recCurio');
      const btn = document.getElementById('curioToggle');
      const POR_VEZ = 5;
      let expandido = false;
      if(curioTimer){ clearInterval(curioTimer); curioTimer = null; }
      const rotacionar = () => {
        const escolhidas = [...cur].sort(() => Math.random() - 0.5).slice(0, POR_VEZ);
        alvo.classList.remove('curio-fade'); void alvo.offsetWidth; alvo.classList.add('curio-fade');
        alvo.innerHTML = escolhidas.map(rItem).join('');
      };
      const ligarRotacao = () => { if(curioTimer){ clearInterval(curioTimer); } curioTimer = setInterval(() => { if(!expandido) rotacionar(); }, 8000); };
      if(cur.length <= POR_VEZ){
        alvo.innerHTML = cur.map(rItem).join('');
        if(btn) btn.style.display = 'none';
      } else {
        rotacionar();
        ligarRotacao();
        if(btn){
          btn.style.display = '';
          btn.textContent = 'Ver todas (' + cur.length + ')';
          btn.onclick = () => {
            expandido = !expandido;
            if(expandido){
              if(curioTimer){ clearInterval(curioTimer); curioTimer = null; }
              alvo.classList.remove('curio-fade');
              alvo.innerHTML = cur.map(rItem).join('');
              btn.textContent = 'Ver menos';
            } else {
              btn.textContent = 'Ver todas (' + cur.length + ')';
              rotacionar(); ligarRotacao();
            }
          };
        }
      }
    }
  }

  /* ---------- atualização automática ---------- */
  async function atualizar(forcarRede){
    try{
      let votos = votosHallCache;
      /* revalida o payload agregado (1 request) em vez de N× ?year= */
      if(forcarRede || !votos || !Object.keys(votos).length){
        try{
          const agg = await carregarHallAgregado();
          edicoes = agg.edicoes;
          votosHallCache = agg.votos;
          votos = votosHallCache;
        }catch(e){
          if(!votos || !Object.keys(votos).length) throw e;
          console.warn('Hall: revalidação agregada falhou, mantendo cache', e);
        }
      }
      stats = calcular(votos);
      renderTudo();
      renderUsuarios(votos);
      const st = document.getElementById('hallAtualizado');
      if(st) st.textContent = '· atualizado às ' + new Date().toLocaleTimeString('pt-BR');
    }catch(e){ console.error('Hall: falha na atualização', e); }
  }

  /* ---- ranking de usuários (perfis mais ativos) ---- */
  async function renderUsuarios(votos){
    const box = document.getElementById('rankUsuarios');
    if(!box) return;
    const anos = Object.keys(votos).map(Number);
    const U = {};
    anos.forEach(y => (votos[y] || []).forEach(s => {
      const u = String(s.user || '').trim(); if(!u) return;
      const key = u.toLowerCase();
      const rec = U[key] || (U[key] = { nome: u, eps: 0, anos: new Set(), notas: [] });
      Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)){ rec.eps++; rec.notas.push(x); } });
      rec.anos.add(y);
    }));
    const lista = Object.keys(U).map(k => {
      const r = U[k];
      const ys = [...r.anos].sort((a,b) => a - b);
      let streak = ys.length ? 1 : 0, best = streak;
      for(let i = 1; i < ys.length; i++){ if(ys[i] === ys[i-1] + 1){ streak++; best = Math.max(best, streak); } else streak = 1; }
      return { nome: r.nome, eps: r.eps, festivais: r.anos.size, streak: best, media: media(r.notas) };
    });

    /* bolões vencidos — conta de 1º lugar já vem em bolaoWins do ?hall=1
       (sem N× ?bolao=). Empate no 1º ainda conta vitória pra todos os empatados. */
    const winList = (hallBolaoWins || []).map(x => ({
      nome: x.user,
      wins: Number(x.wins) || 0
    })).filter(x => x.wins > 0);

    const link = nome => `${BASE}perfil.html?user=${encodeURIComponent(nome)}`;
    const col = (titulo, itens, fmt) => `<div class="rank-col"><h3 class="subhead">${titulo}</h3>${itens.length
      ? `<div class="record-list">${itens.map((x,i) => `<a class="record-item" href="${link(x.nome)}"><span class="rec-emoji">${['🥇','🥈','🥉'][i] || (i+1) + 'º'}</span><div><div class="rec-title">${esc(x.nome)}</div><div class="rec-text">${fmt(x)}</div></div></a>`).join('')}</div>`
      : '<div class="empty-note">Ainda sem dados.</div>'}</div>`;

    box.innerHTML =
      col('🎬 Top avaliadores', [...lista].sort((a,b) => b.eps - a.eps).slice(0, CNT.rankUsuarios), x => `${x.eps} peça${x.eps === 1 ? '' : 's'} avaliada${x.eps === 1 ? '' : 's'}`) +
      col('🏛️ Marcando presença', [...lista].sort((a,b) => b.festivais - a.festivais || b.eps - a.eps).slice(0, CNT.rankUsuarios), x => `${x.festivais} festiva${x.festivais === 1 ? 'l' : 'is'}`) +
      col('🔥 Streak de festivais', [...lista].filter(x => x.streak >= 2).sort((a,b) => b.streak - a.streak || b.festivais - a.festivais).slice(0, CNT.rankUsuarios), x => `${x.streak} edições seguidas`) +
      col('🔮 Gosta do jogo', winList.sort((a,b) => b.wins - a.wins).slice(0, CNT.rankUsuarios), x => `${x.wins} bolão${x.wins === 1 ? '' : 'es'} vencido${x.wins === 1 ? '' : 's'}`);
  }

  await atualizar(false); // usa o cache do payload já baixado
  /* histórico quase não muda: revalida o agregado a cada 2 min (1 request),
     não a cada 20s com dezenas de ?year= */
  intervaloVisivel(() => atualizar(true), 120000);
}

/* =====================================================================
   "HOJE RECOMENDAMOS" — uma peça por dia, do ACERVO INTEIRO
   =====================================================================
   O QUE ESTAVA ERRADO

   A versão anterior sorteava dentro de um conjunto minúsculo e sempre o
   mesmo, por três motivos que se somavam:

   1. O candidato saía só da EDIÇÃO EM DESTAQUE. A lista era montada com um
      laço sobre `ND` (as noites do ano em cartaz), então as outras catorze
      edições do acervo simplesmente não existiam para a recomendação.

   2. Dentro dessa edição, a preferência era "peça com badge" — e
      `badgesDoAno` dá NO MÁXIMO uma badge por peça, com o catálogo inteiro
      somando seis. Na prática o conjunto tinha quatro ou cinco peças.

   3. A escolha era `diaAno % pool.length`. Com cinco peças, o ciclo fecha em
      cinco dias e recomeça igual, para sempre — e, como as badges param de
      mudar depois que a votação fecha, o conjunto congela junto.

   Fora da semana do festival, isso é onze meses girando as mesmas cinco
   peças do ano passado. Era exatamente o sintoma relatado.

   COMO FICOU

   O conjunto passou a ser o acervo inteiro: toda peça de toda edição que
   tenha votos suficientes. Os votos de todos os anos já estavam carregados
   nesta tela (a home usa isso para os números históricos), então o conjunto
   novo não custa nenhuma requisição a mais.

   A ordem é um EMBARALHAMENTO DETERMINÍSTICO semeado pelo ano: todo mundo vê
   a mesma peça no mesmo dia (que era a intenção original e continua sendo),
   mas percorre-se uma permutação completa — cada peça aparece uma vez antes
   de qualquer repetição, e dias seguidos não caem em peças vizinhas.

   Com ~15 edições de ~15 peças, o ciclo passa de cinco dias para mais de
   duzentos, e vira outro a cada ano.
   ===================================================================== */

/* PRNG determinístico (mulberry32). Precisa ser reproduzível: dois
   navegadores diferentes têm que chegar na MESMA ordem, senão a promessa de
   "igual pra todo mundo" cai. Math.random() não serve. */
function _prngSemente(a){
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* Fisher-Yates com semente — permutação completa, sempre a mesma */
function _embaralharComSemente(arr, semente){
  const a = arr.slice();
  const rnd = _prngSemente(semente);
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* candidatos do acervo inteiro, a partir dos votos que a home já carregou.
   Só estatística aqui — título e sinopse vêm depois, e só da edição sorteada. */
function _candidatosRecomendacao(subsDestaque, outros){
  const minAv = (typeof HALL !== 'undefined' && HALL && HALL.minAvaliacoes) || 3;
  const porAno = [{ ano: ANO, subs: subsDestaque }].concat(outros || []);
  const cand = [];

  porAno.forEach(({ ano, subs }) => {
    if(!ano || !(subs || []).length) return;
    const vals = {};
    subs.forEach(sub => {
      const g = sub && sub.grid;
      if(!g) return;
      Object.keys(g).forEach(k => {
        if(!/^s\d+e\d+$/.test(k)) return;
        const v = Number(g[k]);
        if(isNaN(v)) return;
        (vals[k] = vals[k] || []).push(v);
      });
    });
    Object.keys(vals).forEach(key => {
      /* spoiler: na edição em cartaz, noite ainda não liberada fica de fora */
      if(Number(ano) === Number(ANO)){
        const n = Number((/^s(\d+)e/.exec(key) || [])[1]);
        if(n && !noiteLiberada(n)) return;
      }
      const st = statsDeVals(vals[key]);
      if(st && st.n >= minAv) cand.push({ ano: Number(ano), key, st });
    });
  });
  return cand;
}

/* Ordem de preferência. Uma recomendação deve ser algo que vale a pena ver —
   mas restringir demais devolveria sempre as mesmas campeãs, que é o
   problema que estamos consertando. Então: primeiro as bem avaliadas; se não
   houver o bastante para um ciclo decente, afrouxa. */
function _peneirarCandidatos(cand){
  const bem = cand.filter(c => c.st.avg >= 7);
  if(bem.length >= 10) return bem;
  const medianas = cand.filter(c => c.st.avg >= 6);
  if(medianas.length >= 10) return medianas;
  return cand;
}

async function montarRecomendacao(subsDestaque, outros, acervoPecas){
  const elR = document.getElementById('homeRecomenda');
  if(!elR) return;
  try{
    const cand = _peneirarCandidatos(_candidatosRecomendacao(subsDestaque, outros));
    if(!cand.length){
      elR.innerHTML = '<div class="empty-note">A recomendação aparece quando houver peças com votos.</div>';
      return;
    }

    /* chave estável para a ordem não depender da ordem em que as respostas
       da rede chegaram — sem isto, dois navegadores poderiam divergir */
    cand.sort((a, b) => a.ano - b.ano || a.key.localeCompare(b.key));

    const hj = agora();
    const ordem = _embaralharComSemente(cand, hj.getFullYear());
    const diaAno = Math.floor((hj - new Date(hj.getFullYear(), 0, 0)) / 86400000);
    const inicio = diaAno % ordem.length;

    /* Percorre a partir do dia de hoje até achar uma peça exibível. As
       tentativas existem porque a estatística vem dos VOTOS e o título vem do
       ACERVO: uma chave votada pode não ter peça cadastrada (edição antiga
       ainda sendo digitalizada).

       Se `acervoPecas` veio pronto (payload agregado, carregamento único),
       é só consulta em memória — nenhum fetch por tentativa. Sem ele, cai no
       caminho antigo: uma chamada a `carregarDadosEdicao` por tentativa (que
       já guarda o resultado por ano, então o teto baixo ainda protege). */
    const TENTATIVAS = 6;
    let escolhida = null, reserva = null;
    for(let i = 0; i < TENTATIVAS && i < ordem.length; i++){
      const c = ordem[(inicio + i) % ordem.length];
      const cfgAno = EDICOES.find(e => e.ano === c.ano);
      if(!cfgAno || cfgAno.emBreve) continue;

      const m = /^s(\d+)e(\d+)$/.exec(c.key);
      const noite = Number(m[1]), ordemPeca = Number(m[2]);
      let peca = null;
      if(acervoPecas){
        const nd = acervoPecas[c.ano] && acervoPecas[c.ano][noite];
        peca = Array.isArray(nd) ? nd[ordemPeca - 1] : null;
      } else {
        const dados = await carregarDadosEdicao(cfgAno);
        if(!dados) continue;
        const nd = dados.noites && dados.noites[noite];
        peca = nd && Array.isArray(nd.pecas) ? nd.pecas[ordemPeca - 1] : null;
      }
      if(!peca || !String(peca.titulo || '').trim()) continue;

      const item = { ...c, noite, peca, cfgAno };
      /* preferimos uma peça com vídeo: o convite é "assista e deixe a sua
         nota", e mandar a pessoa para uma peça sem gravação é beco sem saída */
      if(String(peca.youtube || '').trim()){ escolhida = item; break; }
      if(!reserva) reserva = item;
    }

    const p = escolhida || reserva;
    if(!p){
      elR.innerHTML = '<div class="empty-note">A recomendação aparece quando houver peças com votos.</div>';
      return;
    }

    /* badges daquela peça, calculadas no ano dela */
    let badges = [];
    try{
      const subsDoAno = (Number(p.ano) === Number(ANO))
        ? subsDestaque
        : ((outros || []).find(o => Number(o.ano) === Number(p.ano)) || {}).subs;
      badges = badgesDoAno(subsDoAno || [])[p.key] || [];
    }catch(e){ badges = []; }

    const url = `${BASE}${p.ano}/noite-${p.noite}.html#${p.key}`;
    const sinopse = String(p.peca.sinopse || '').trim();
    const temVideo = !!String(p.peca.youtube || '').trim();
    elR.innerHTML = `<a class="record-item" href="${url}">
      <span class="rec-emoji">🎭</span>
      <div>
        <div class="rec-title">${esc(p.peca.titulo)} <span class="peca-badges">${htmlBadges(badges)}</span> — nota ${p.st.avg.toFixed(1)}</div>
        <div class="rec-text">${p.ano} · Noite ${p.noite}${p.peca.turma ? ' · Turma ' + esc(p.peca.turma) : ''}${temVideo ? ' · 🎬 tem gravação' : ''}${sinopse ? ' — ' + esc(sinopse.slice(0, 150)) + (sinopse.length > 150 ? '…' : '') : ''}</div>
      </div>
    </a>`;
  }catch(e){
    console.warn('[cetecritic] recomendação do dia falhou', e);
    elR.innerHTML = '<div class="empty-note">A recomendação aparece quando houver peças com votos.</div>';
  }
}

/* =====================================================================
   PÁGINA: INÍCIO (homepage oficial — cetecritic.xyz)
   Engloba a edição em destaque (EDICAO_EM_DESTAQUE do config.js).
   ===================================================================== */
async function paginaHome(){
  document.title = 'CETECritic';
  const slogan = (typeof SLOGAN_HOME !== 'undefined') ? SLOGAN_HOME : 'O Cetec Festival na palma da sua mão';
  const pastaDest = `${EDICAO_EM_DESTAQUE}/`;
  /* resolvido UMA vez: antes a mesma chamada aparecia três vezes na montagem
     do hero, e o `has-image` do container podia discordar do <img> renderizado */
  const posterHome = posterDaEdicao(EDICAO_EM_DESTAQUE, ED && ED.poster);

  /* countdown grandão: começo da edição → fim da votação → próxima edição */
  let cdLabel = '', cdTarget = null, cdExtra = '';
  if(ED && !edicaoComecou() && inicioEdicao()){
    cdLabel = `O ${ED.titulo} começa em`;
    cdTarget = inicioEdicao();
  } else if(ED && !votacaoEncerrada() && FIM_VOTACAO){
    cdLabel = 'Votação aberta! As avaliações fecham em';
    cdTarget = FIM_VOTACAO;
  } else {
    const prox = EDICOES
      .map(e => ({ ano: e.ano, d: e.abreEm ? new Date(e.abreEm) : null }))
      .filter(e => e.d && !isNaN(e.d) && e.d > agora())
      .sort((a,b) => a.d - b.d)[0];
    if(prox){ cdLabel = `Faltam para o CETEC Festival ${prox.ano}`; cdTarget = prox.d; }
    else cdExtra = 'Obrigado a todos que participaram — até a próxima edição! 🎭';
  }

  /* dados manuais da home (home-dados.js) */
  const HD = (typeof HOME_DADOS !== 'undefined') ? HOME_DADOS : {};
  const hoje = new Date();

  /* "nesse dia na história" — só aparece se houver algo para hoje */
  const doDia = (HD.nesteDia || []).filter(x => Number(x.dia) === hoje.getDate() && Number(x.mes) === (hoje.getMonth() + 1));
  const htmlNesteDia = doDia.length ? `
    <div class="section">
      <h2>📅 Nesse dia na história do festival</h2>
      <div class="record-list">${doDia.map(x => {
        const inner = `<span class="rec-emoji">${x.emoji || '🎞️'}</span><div><div class="rec-text" style="font-size:13px; color:var(--text);">${esc(x.texto)}</div></div>`;
        return x.url ? `<a class="record-item" href="${x.url}">${inner}</a>` : `<div class="record-item">${inner}</div>`;
      }).join('')}</div>
    </div>` : '';

  /* linha do tempo: anos do home-dados.js + edições do config.js */
  const notasTl = HD.linhaDoTempo || {};
  const anosTl = [...new Set([...Object.keys(notasTl).map(Number), ...EDICOES.map(e => e.ano)])].sort((a,b) => a - b);
  let htmlTl = '';
  anosTl.forEach((ano, i) => {
    if(i > 0 && ano - anosTl[i-1] > 1)
      htmlTl += `<div class="tl-item gap"><div class="tl-year"></div><div class="tl-line"><div class="tl-dot"></div></div><div class="tl-text tl-sub">···</div></div>`;
    const cfgE = EDICOES.find(e => e.ano === ano);
    const emBreve = cfgE && cfgE.emBreve;
    const futura = cfgE && ((cfgE.abreEm && new Date(cfgE.abreEm) > agora()) || emBreve);
    const destino = emBreve ? `${BASE}em-breve.html?ano=${ano}` : `${BASE}${ano}/index.html`;
    const nome = cfgE ? `<a href="${destino}">Cetec Festival ${ano}</a>` : '';
    const nota = notasTl[ano] ? esc(notasTl[ano]) : (emBreve ? 'Em breve...' : (futura ? 'Em produção...' : ''));
    htmlTl += `<div class="tl-item">
      <div class="tl-year">${ano}</div>
      <div class="tl-line"><div class="tl-dot"></div></div>
      <div class="tl-text">${nome}${nome && nota ? `<div class="tl-sub">${nota}</div>` : nota}</div>
    </div>`;
  });

  /* banner "adicionar à tela inicial" — só na home, toda vez que ela carrega,
     a não ser que tenha sido desligado em Configurações > Aparência ou o site
     já esteja instalado como app */
  const mostrarBannerHome = bannerHomeAtivo() && !(typeof window.pwaEstaInstalado === 'function' && window.pwaEstaInstalado());
  const htmlBannerHome = mostrarBannerHome ? htmlBannerInstalar('homeInstallBanner', true) : '';

  /* "Você sabia?" (Seção 10 do Plano): porta de entrada para o arquivo.
     Reaproveita as CURIOSIDADES do banco — sorteia uma a cada carregamento. */
  const _curiosVS = (typeof CURIOSIDADES !== 'undefined' && Array.isArray(CURIOSIDADES)) ? CURIOSIDADES : [];
  const _vs = _curiosVS.length ? _curiosVS[Math.floor(Math.random() * _curiosVS.length)] : null;
  const _vsTxt = _vs ? String((_vs.texto) || (typeof _vs === 'string' ? _vs : '')).trim() : '';
  const htmlVoceSabia = _vsTxt ? `
    <a class="voce-sabia" href="hall.html">
      <span class="vs-badge">💡 Você sabia?</span>
      <span class="vs-txt">${esc(_vsTxt)}</span>
      <span class="vs-cta">Explorar o Hall da Fama →</span>
    </a>` : '';

  montarShell(`
    ${htmlBannerHome}
    <div class="home-hero">
      <div class="poster-box${posterHome ? ' has-image' : ''} home-poster">
        ${htmlPoster(posterHome, 'Poster da edição')}
        <div class="poster-hint"><b>Sem capa</b>Capa da edição em destaque</div>
      </div>
      <div class="home-info">
        <h1 class="home-title">CETEC<span>Critic</span></h1>
        <p class="home-tagline">${esc(slogan)}</p>
        <div class="home-actions">
          <a class="btn btn-solid" href="${pastaDest}index.html">${ED && edicaoComecou() && !votacaoEncerrada() ? '⭐ Votar agora' : `Ver ${esc(ED ? ED.titulo : 'a edição em destaque')}`}</a>
          <a class="btn btn-ghost" href="hall.html">🏆 Hall da Fama</a>
          <button class="btn btn-ghost" id="homeMonteBtn">🎨 Monte o Seu</button>
          <button class="btn btn-ghost" id="shareBtn">📤 Compartilhar</button>
        </div>
      </div>
    </div>

    ${htmlVoceSabia}

    ${cdTarget ? `<div class="section home-countdown">
      <div class="lbl">${esc(cdLabel)}</div>
      <div class="big-timer" data-count-to="${cdTarget.toISOString()}" data-reload="1">--:--:--</div>
    </div>` : (cdExtra ? `<div class="section home-countdown"><div class="lbl">${esc(cdExtra)}</div></div>` : '')}

    <div class="hall-cards" id="homeStats"></div>

    ${htmlNesteDia}

    <div class="section">
      <h2>🎭 Hoje recomendamos</h2>
      <div class="sub">Uma peça diferente por dia, sorteada de todo o acervo — assista e deixe a sua nota.</div>
      <div class="record-list" id="homeRecomenda"><div class="empty-note">Carregando...</div></div>
    </div>

    <div class="section">
      <h2>🏆 Destaques do ${ED ? ED.ano : ''}</h2>
      <div class="sub">As peças mais bem avaliadas da edição em destaque — atualiza sozinho. Clique para abrir.</div>
      <div class="record-list" id="homeTop"><div class="empty-note">Carregando...</div></div>
    </div>

    <div class="section">
      <h2>💡 Curiosidades</h2>
      <div class="sub">Descubra mais sobre o maior festival de teatro estudantil do Rio Grande do Sul.</div>
      <div class="record-list" id="homeCurio"><div class="empty-note">Carregando...</div></div>
    </div>

    <div class="section">
      <h2>🗓️ Linha do tempo</h2>
      <div class="sub">A história do CETEC Festival, ano a ano.</div>
      <div class="timeline">${htmlTl}</div>
    </div>`);

  /* banner de instalação da home: "Adicionar" reaproveita o fluxo de PWA
     quando o navegador oferece (Android/Chrome); senão, dá a dica certa
     pra iOS ou um aviso genérico. O X só fecha aquela visita — ele volta
     a aparecer da próxima vez que a home carregar. */
  if(mostrarBannerHome) wireBannerInstalar('homeInstallBanner', true);

  /* botão "Monte o Seu" do hero: abre o mesmo seletor de ano do menu */
  const homeMonteBtn = document.getElementById('homeMonteBtn');
  if(homeMonteBtn) homeMonteBtn.addEventListener('click', () => {
    const mo = document.getElementById('monteModalOverlay');
    mo.classList.add('open');
    requestAnimationFrame(() => mo.classList.add('show'));
  });

  /* botão compartilhar: Web Share no celular, copiar link no desktop
     (o link já vai bonito no WhatsApp/Instagram pelas tags Open Graph do index.html) */
  const shareBtn = document.getElementById('shareBtn');
  if(shareBtn) shareBtn.addEventListener('click', async () => {
    const dados = { title: 'CETECritic', text: slogan, url: location.href };
    if(navigator.share){
      try{ await navigator.share(dados); }catch(e){ /* usuário cancelou */ }
    } else {
      try{
        await navigator.clipboard.writeText(dados.url);
        const orig = shareBtn.textContent;
        shareBtn.textContent = '✓ Link copiado!';
        setTimeout(() => { shareBtn.textContent = orig; }, 1600);
      }catch(e){ prompt('Copie o link:', dados.url); }
    }
  });

  async function atualizarHome(){
    await fetchVotos(); /* votos da edição em destaque (sincroniza o relógio também) */

    /* demais edições (números históricos) + acervo de peças (Hoje recomendamos):
       antes disparava N-1 requests de ?year= por edição, mais até 6 requests
       de edicao.js/noites dentro de montarRecomendacao. Agora um request só
       (a mesma rota agregada do Hall) cobre as duas coisas. Se falhar, cai
       no caminho antigo em vez de deixar a home sem números históricos. */
    let outros = [], acervoPecas = null;
    try{
      const agg = await carregarAcervoAgregado();
      const rawVotos = agg.votos || {};
      outros = EDICOES.filter(e => e.ano !== ANO).map(e => ({
        ano: e.ano,
        subs: filtrarVotosDoAno(rawVotos[e.ano] || [], e.ano)
      }));
      acervoPecas = {};
      (agg.pecas || []).forEach(p => {
        const ano = Number(p.ano), noite = Number(p.noite), ep = Number(p.ep);
        if(!ano || !noite || !ep) return;
        if(!acervoPecas[ano]) acervoPecas[ano] = {};
        if(!acervoPecas[ano][noite]) acervoPecas[ano][noite] = [];
        acervoPecas[ano][noite][ep - 1] = {
          titulo: String(p.titulo || ''),
          turma: String(p.turma || ''),
          sinopse: String(p.sinopse || ''),
          youtube: String(p.youtube || '')
        };
      });
    }catch(e){
      console.warn('[cetecritic] home: acervo agregado falhou, caindo no carregamento legado', e);
      outros = await Promise.all(EDICOES.filter(e => e.ano !== ANO).map(async e => {
        try{
          const r = await fetch(API_URL + '?year=' + e.ano + '&_=' + Date.now(), { cache: 'no-store' });
          const j = await r.json();
          return { ano: e.ano, subs: filtrarVotosDoAno(Array.isArray(j) ? j : (j.submissions || []), e.ano) };
        }catch(err){ return { ano: e.ano, subs: [] }; }
      }));
      acervoPecas = null; // sem o agregado, montarRecomendacao volta pro carregarDadosEdicao por tentativa
    }

    const notasDest = [];
    submissions.forEach(s => Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) notasDest.push(x); }));
    const todasNotas = [...notasDest];
    let totalVotos = submissions.length;
    outros.forEach(o => {
      totalVotos += o.subs.length;
      o.subs.forEach(s => Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) todasNotas.push(x); }));
    });

    const mediaDest = media(notasDest);
    const mediaHist = media(todasNotas);
    const cards = [
      { big: mediaDest === null ? '–' : mediaDest.toFixed(1), lbl: `Nota do ${ANO}`, sub: `${submissions.length} avaliaç${submissions.length === 1 ? 'ão' : 'ões'}` },
      { big: String(totalVotos), lbl: 'Avaliações na história' },
      { big: mediaHist === null ? '–' : mediaHist.toFixed(1), lbl: 'Média histórica' },
      { big: String(EDICOES.length), lbl: 'Edições no site' }
    ];
    const el = document.getElementById('homeStats');
    if(el) el.innerHTML = cards.map(c =>
      `<div class="hall-card"><div class="big">${c.big}</div><div class="lbl">${c.lbl}</div>${c.sub ? `<div class="subtxt">${c.sub}</div>` : ''}</div>`).join('');

    /* top 3 da edição em destaque (só noites já liberadas — sem spoiler) */
    const lista = [];
    for(let n = 1; n <= NUM_NOITES; n++){
      const nd = ND[n];
      if(!nd || !(nd.pecas || []).length || !noiteLiberada(n)) continue;
      nd.pecas.forEach((p, i) => {
        const key = `s${n}e${i+1}`;
        const vals = valoresDaChave(key).map(Number).filter(v => !isNaN(v));
        const st = statsDeVals(vals);
        if(st) lista.push({ key, titulo: p.titulo, turma: p.turma, sinopse: p.sinopse || '', noite: n, st, url: `${pastaDest}noite-${n}.html#${key}` });
      });
    }
    const medalhas = ['🥇','🥈','🥉'];
    const top3 = lista.sort((a,b) => b.st.avg - a.st.avg || b.st.n - a.st.n).slice(0, 3);
    const elT = document.getElementById('homeTop');
    if(elT) elT.innerHTML = top3.length
      ? top3.map((p, i) => `<a class="record-item" href="${p.url}">
          <span class="rec-emoji">${medalhas[i]}</span>
          <div><div class="rec-title">${esc(p.titulo)} — nota ${p.st.avg.toFixed(1)}</div>
          <div class="rec-text">Turma ${esc(p.turma)} · Noite ${p.noite} · ${p.st.n} avaliaç${p.st.n === 1 ? 'ão' : 'ões'}</div></div>
        </a>`).join('')
      : '<div class="empty-note">Os destaques aparecem aqui assim que os primeiros votos chegarem.</div>';

    /* ---- hoje recomendamos ---- */
    montarRecomendacao(submissions, outros, acervoPecas);

    /* ---- curiosidades: manuais (home-dados.js) + automáticas ---- */
    const autoCurio = [];
    const anosAvg = [{ ano: ANO, avg: mediaDest, n: notasDest.length }];
    outros.forEach(o => {
      const vals = [];
      o.subs.forEach(s => Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) vals.push(x); }));
      if(vals.length) anosAvg.push({ ano: o.ano, avg: media(vals), n: vals.length });
    });
    const comMedia = anosAvg.filter(a => a.avg !== null && a.n > 0);
    if(comMedia.length > 1){
      const best = comMedia.reduce((a, b) => b.avg > a.avg ? b : a);
      autoCurio.push(`O Festival de ${best.ano} tem a maior média da história (${best.avg.toFixed(1)}).`);
    }
    if(lista.length > 1){
      const ord = [...lista].sort((a, b) => b.st.avg - a.st.avg);
      autoCurio.push(`A diferença entre a primeira e a última colocada em ${ANO} é de ${(ord[0].st.avg - ord[ord.length-1].st.avg).toFixed(1)} ponto(s).`);
    }
    const n10 = todasNotas.filter(v => v >= NOTA_MAXIMA - 0.01).length;
    if(n10 > 0) autoCurio.push(`Já foram dadas ${n10} nota(s) ${NOTA_MAXIMA} na história do site.`);
    const acima9 = lista.filter(p => p.st.avg >= 9).length;
    if(acima9 > 0) autoCurio.push(`${acima9} peça(s) de ${ANO} ${acima9 === 1 ? 'tem' : 'têm'} média 9 ou mais.`);
    if(totalVotos > 0) autoCurio.push(`A plateia já enviou ${totalVotos} avaliaç${totalVotos === 1 ? 'ão' : 'ões'}, somando ${todasNotas.length} notas.`);

    /* curiosidades manuais UNIFICADAS (mesma lista da Home e do Hall) */
    const manuaisCurio = (typeof CURIOSIDADES !== 'undefined' && Array.isArray(CURIOSIDADES)) ? CURIOSIDADES : (HD.curiosidades || []);
    const curios = [
      ...(manuaisCurio.map(c => typeof c === 'string' ? { texto: c } : c)),
      ...autoCurio.map(t => ({ texto: t }))
    ];
    /* mostra só 5 por vez, sorteadas — troca a cada ciclo (20s), igual ao hall */
    const elC = document.getElementById('homeCurio');
    if(elC){
      if(curios.length){
        const POR_VEZ = 5;
        const escolhidas = curios.length <= POR_VEZ
          ? curios
          : [...curios].sort(() => Math.random() - 0.5).slice(0, POR_VEZ);
        elC.classList.remove('curio-fade');
        void elC.offsetWidth; /* reinicia a animação de fade */
        elC.classList.add('curio-fade');
        elC.innerHTML = escolhidas.map(c => {
          const inner = `<span class="rec-emoji">${c.emoji || '💡'}</span><div><div class="rec-text" style="color:var(--text); font-size:13px;">${esc(c.texto)}</div></div>`;
          return c.url ? `<a class="record-item" href="${c.url}">${inner}</a>` : `<div class="record-item">${inner}</div>`;
        }).join('');
      } else {
        elC.innerHTML = '<div class="empty-note">Adicione curiosidades no home-dados.js.</div>';
      }
    }
  }
  atualizarHome();
  intervaloVisivel(atualizarHome, 20000);
}

/* =====================================================================
   PÁGINA: EM BREVE (compartilhada — em-breve.html?ano=XXXX)
   Serve a qualquer edição marcada com emBreve:true no config.js, SEM
   precisar de pasta própria. O ano vem pela URL (PAGINA.ano).
   ===================================================================== */
function paginaEmBreve(){
  const titulo = ANO ? `Cetec Festival ${ANO}` : 'CETEC Festival';
  document.title = `${titulo} — Em breve`;
  montarShell(`
    <div id="capture-area">
      <div class="left-panel">
        <div class="poster-box question-mark"><span>?</span></div>
        <div class="title-section"><h1>${esc(titulo)}</h1><div class="description">-</div></div>
      </div>
      <div class="grid-blur-wrap">
        <div class="grid-panel">${gridVazioHtml()}</div>
        <div class="grid-blur-overlay">${htmlEmBreveBox('Esta edição ainda está sendo reunida')}</div>
      </div>
    </div>`);
}

/* =====================================================================
   PÁGINA: PERFIL (perfil.html) — avaliações, badges e bolão do usuário
   ===================================================================== */
function htmlItemSimples(r){
  const inner = `<span class="rec-emoji">${r.emoji || '🏅'}</span><div><div class="rec-title">${esc(r.titulo)}</div>${r.texto ? `<div class="rec-text">${esc(r.texto)}</div>` : ''}</div>`;
  return r.url ? `<a class="record-item" href="${r.url}">${inner}</a>` : `<div class="record-item">${inner}</div>`;
}

/* card de badge (bloqueada = apagada/cinza) */
function badgeCardHtml(b){
  /* badge concedida à mão pela organização: sinaliza, senão parece que a
     pessoa cumpriu um requisito que ela não cumpriu */
  const marca = b.porAdmin === 'forcada' ? ' · concedida pela organização' : '';
  return `<div class="badge-card${b.unlocked ? '' : ' locked'}" title="${esc(b.titulo)}${b.texto ? ' — ' + esc(b.texto) : ''}${marca}">
    <div class="badge-emoji">${b.emoji}</div>
    <div class="badge-name">${esc(b.titulo)}${b.porAdmin === 'forcada' ? ' <span title="Concedida pela organização">🎗️</span>' : ''}</div>
    <div class="badge-desc">${esc(b.texto || '')}</div>
    ${b.cat ? `<div class="badge-cat">${esc(b.cat)}</div>` : ''}
  </div>`;
}

/* grade de notas de UMA avaliação, para expandir no perfil */
function perfilMiniGridHtml(grid, ano){
  const noites = (EDICOES.find(e => e.ano === ano) || { noites: 5 }).noites;
  let maxE = 1;
  Object.keys(grid).forEach(k => { const m = k.match(/^s\d+e(\d+)$/); if(m) maxE = Math.max(maxE, Number(m[1])); });
  let h = `<div class="grid-row"><div class="cell label"></div>`;
  for(let s = 1; s <= noites; s++) h += `<div class="cell header">S${s}</div>`;
  h += `</div>`;
  for(let e = 1; e <= maxE; e++){
    h += `<div class="grid-row"><div class="cell label">E${e}</div>`;
    for(let s = 1; s <= noites; s++){
      const v = grid[`s${s}e${e}`];
      h += v !== undefined
        ? `<div class="cell" style="background:${corDaNota(v)}; color:#14161a">${Number(v).toFixed(1)}</div>`
        : `<div class="cell empty-cell">–</div>`;
    }
    h += `</div>`;
  }
  return h;
}

/* catálogo de badges completo. Recebe um contexto já calculado (ctx). */
function catalogoBadges(ctx){
  const cat = [];
  /* dinâmicas: Veterano de cada edição real (bloqueada até participar) */
  ctx.reais.map(e => e.ano).sort((a,b) => b - a).forEach(ano => {
    cat.push({ emoji: '🎖️', titulo: `Veterano de ${ano}`, texto: `Avaliar peças da edição ${ano}`, unlocked: ctx.anosSet.has(ano), cat: 'Presença' });
  });

  const S = (emoji, titulo, texto, cond, categoria) => cat.push({ emoji, titulo, texto, unlocked: !!cond, cat: categoria });
  /* Histórico e Presença */
  S('🎬','Primeira Curtain Call','Fazer login e enviar a sua primeira review', ctx.total >= 1, 'Presença');
  S('🏺','Arqueólogo do Passado','Avaliar peças de festivais anteriores a 2020', ctx.pre2020, 'Presença');
  S('🌱','Plateia Raiz',`Marcar presença em ${metaPerfil('plateiaRaiz',4)}+ edições diferentes`, ctx.nAnos >= metaPerfil('plateiaRaiz',4), 'Presença');
  S('🌙','Maratona Noturna','Avaliar em todas as noites de uma mesma edição', ctx.maratonaNoturna, 'Presença');
  S('📜','Historiador',`Avaliar peça de ${metaPerfil('historiador',5)} edições diferentes`, ctx.nAnos >= metaPerfil('historiador',5), 'Presença');
  S('🔥','Sequência','Avaliar duas edições de anos seguidos', ctx.consecutivo, 'Presença');
  /* Comportamento de Crítico */
  S('🏅','Selo Purista','Dar 10 a uma peça recordista (média ≥ 9)', ctx.selopurista, 'Crítico');
  S('🥀','Dedo Podre','Dar a nota mais baixa e discrepante de uma peça', ctx.dedoPodre, 'Crítico');
  S('💗','Coração mole','Ter média das suas notas acima de 9.0', ctx.coracaoMole, 'Crítico');
  S('⚔️','Juiz Severo','Manter suas notas bem abaixo da média da plateia', ctx.juizSevero, 'Crítico');
  S('🌀','Caos em Pessoa','Dar nota extrema numa peça polêmica (muito dividida)', ctx.caos, 'Crítico');
  S('🌈','Paladar variado','Usar 7 valores de nota diferentes', ctx.diversidade >= 7, 'Crítico');
  /* Interação Comunitária */
  S('👯','Gêmeo de Opinião','+90% de afinidade de notas com outro usuário', ctx.gemeo, 'Comunidade');
  S('🦄','Gosto Peculiar','Amar (nota 8+) peças que a plateia rejeitou (média < 6)', ctx.gostoPeculiar, 'Comunidade');
  S('📺','Espectador em Série',`Avaliar ${metaPerfil('espectadorSerie',10)}+ peças no total`, ctx.nNotas >= metaPerfil('espectadorSerie',10), 'Comunidade');
  S('🧾','Metralhadora de notas',`Dar ${metaPerfil('metralhadora',100)} notas no total`, ctx.nNotas >= metaPerfil('metralhadora',100), 'Comunidade');
  S('👑','Lenda do Fórum','Nível alto e presença em todas as edições com votos', ctx.lenda, 'Comunidade');
  /* Especiais / Sazonais */
  S('🥇','Noite de Ouro','Avaliar a noite de maior média de uma edição', ctx.noiteOuroAv, 'Especial');
  S('🎭','Polêmico','Dar nota máxima e mínima na mesma noite', ctx.polemicoNoite, 'Especial');
  S('✨','Revelação','Dar 9+ a uma peça que terminou com média < 7', ctx.revelacao, 'Especial');
  S('🌃','Coruja','Avaliar de madrugada (0h–5h)', ctx.madrugada, 'Especial');
  S('🏆','Ficha completa','Avaliar uma edição inteira (todos os episódios)', ctx.fichaCompleta, 'Especial');
  S('📸','Mestre dos Bastidores','Enviar foto de uma apresentação (em breve)', false, 'Especial');

  /* Bolão — por último de propósito: quem não participa do bolão não tem
     por que ver essas badges logo de cara no meio das outras. */
  S('🔮','O Oráculo','Acertar a média exata de uma peça no bolão (erro < 0.05)', ctx.oraculo, 'Bolão');
  S('🔵','Bola de Cristal','Ficar no Top 3 do bolão de uma edição', ctx.bolaCristal, 'Bolão');
  S('👁️','Visionário','Ser o melhor palpiteiro de um episódio no bolão', ctx.visionario, 'Bolão');
  S('🧮','Cálculo Exato','Erro médio < 0.1 na Noite Ouro do bolão', ctx.calculoExato, 'Bolão');
  S('🎰','Aposta de Risco','Cravar nota extrema (≤2 ou ≥9) com erro < 0.5', ctx.apostaRisco, 'Bolão');
  S('🗳️','Palpiteiro','Entrar em algum bolão', ctx.participouBolao >= 1, 'Bolão');

  /* dinâmicas: pódio do bolão de cada edição que teve bolão. Igual às
     Veterano, nascem da lista de edições cruzada com o resultado apurado —
     automáticas e retroativas, nada salvo no banco.

     Só entram os anos que REALMENTE tiveram bolão: com 15 edições, gerar as
     três colocações pra todas encheria o catálogo de 45 badges mortas e
     ainda estragaria a conta do "Colecionador". */
  const PODIO_BOLAO = [
    { pos: 1, emoji: '🥇', nome: 'Campeão do bolão' },
    { pos: 2, emoji: '🥈', nome: 'Vice do bolão' },
    { pos: 3, emoji: '🥉', nome: 'Terceiro no bolão' }
  ];
  const posBolao = ctx.bolaoPos || {};
  (ctx.anosComBolao || []).slice().sort((a, b) => b - a).forEach(ano => {
    PODIO_BOLAO.forEach(p => {
      cat.push({
        emoji: p.emoji,
        titulo: `${p.nome} ${ano}`,
        texto: `Terminar em ${p.pos}º lugar no bolão de ${ano}`,
        unlocked: posBolao[ano] === p.pos,
        cat: 'Bolão'
      });
    });
  });

  /* Colecionador depende de quantas já foram desbloqueadas */
  const desbloq = cat.filter(b => b.unlocked).length;
  cat.push({ emoji: '🧷', titulo: 'Colecionador', texto: `Ter ${metaPerfil('colecionador',15)}+ badges diferentes`, unlocked: desbloq >= metaPerfil('colecionador',15), cat: 'Comunidade' });
  return cat;
}

/* catálogo SEM contexto de usuário — para vitrine pública (Hall da Fama).
   Volta tudo bloqueado de propósito: ali a lista responde "o que dá pra
   ganhar", não "o que fulano ganhou".

   Reaproveita o catalogoBadges em vez de repetir a lista: assim a vitrine
   nunca envelhece em relação às badges de verdade, e as "Veterano de {ano}"
   entram sozinhas conforme edições novas são criadas no painel.

   O ctx mínimo basta porque todo o resto do catálogo só faz comparação ou
   teste de verdade — campo ausente vira `false`, ou seja, badge bloqueada. */
function catalogoBadgesPublico(){
  const reais = (typeof EDICOES !== 'undefined' ? EDICOES : []).filter(e => !e.emBreve);
  /* pro pódio aparecer na vitrine, listamos os anos que TÊM bolão
     configurado — sem precisar apurar resultado nenhum aqui */
  const anosComBolao = reais.filter(e => e.bolao).map(e => e.ano);
  return catalogoBadges({ reais, anosSet: new Set(), anosComBolao, bolaoPos: {} });
}

/* ---------------------------------------------------------------------
   Exceções de badge definidas pelo admin (perfil.admin_badges).

   Elas viajam no perfil PÚBLICO de propósito: uma badge concedida à mão
   precisa aparecer pra quem visita o perfil, não só pro dono.

   Nota consciente: o "Colecionador" é calculado dentro de catalogoBadges,
   antes destas exceções, então ele continua contando só o que a pessoa
   conquistou de verdade. Isso é intencional — badge dada pelo admin não
   deve destravar outra badge em cascata.
   --------------------------------------------------------------------- */
function aplicarBadgesDoAdmin(cat, perfilCfg){
  const ab = (perfilCfg && perfilCfg.admin_badges && typeof perfilCfg.admin_badges === 'object') ? perfilCfg.admin_badges : null;
  if(!ab) return cat;
  const forcadas   = new Set((Array.isArray(ab.forcadas)   ? ab.forcadas   : []).map(String));
  const bloqueadas = new Set((Array.isArray(ab.bloqueadas) ? ab.bloqueadas : []).map(String));
  if(!forcadas.size && !bloqueadas.size) return cat;
  return cat.map(b => {
    if(forcadas.has(b.titulo))   return Object.assign({}, b, { unlocked: true,  porAdmin: 'forcada' });
    if(bloqueadas.has(b.titulo)) return Object.assign({}, b, { unlocked: false, porAdmin: 'bloqueada' });
    return b;
  });
}

/* ---------------------------------------------------------------------
   Tela de confirmação para ações destrutivas. Devolve uma Promise<boolean>,
   então quem chama escreve `if(!await confirmarAcao({...})) return;`.

   Existe em vez do confirm() do navegador porque ele não dá pra estilizar,
   fica fora do visual do site e, no celular, aparece com o domínio no topo
   parecendo alerta de golpe. Reaproveita o CSS do overlay de onboarding. */
function confirmarAcao(opts){
  const o = opts || {};
  return new Promise(resolve => {
    const antigo = document.getElementById('ccConfirm'); if(antigo) antigo.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="onboarding-overlay" id="ccConfirm" role="dialog" aria-modal="true">
        <div class="onboarding-card">
          <h2>${esc(o.titulo || 'Tem certeza?')}</h2>
          <p class="onboarding-lead">${o.textoHtml || esc(o.texto || '')}</p>
          <div style="display:grid;gap:8px;">
            <button class="btn ${o.perigo ? 'btn-danger' : 'btn-solid'} onboarding-btn" id="ccConfirmSim">${esc(o.confirmar || 'Confirmar')}</button>
            <button class="btn btn-ghost" id="ccConfirmNao" style="width:100%;">${esc(o.cancelar || 'Cancelar')}</button>
          </div>
        </div>
      </div>`);
    const ov = document.getElementById('ccConfirm');
    requestAnimationFrame(() => ov.classList.add('show'));
    const fim = v => { ov.remove(); resolve(v); };
    ov.querySelector('#ccConfirmSim').addEventListener('click', () => fim(true));
    ov.querySelector('#ccConfirmNao').addEventListener('click', () => fim(false));
    ov.addEventListener('click', ev => { if(ev.target === ov) fim(false); });
    document.addEventListener('keydown', function esc(ev){
      if(ev.key === 'Escape'){ document.removeEventListener('keydown', esc); fim(false); }
    });
  });
}

/* card de avaliação (expansível) para o perfil.
   `podeApagar` só vem true no próprio perfil — e o servidor confere a posse
   de novo, então esconder o botão é conveniência, não segurança. */
function reviewCardHtml(s, podeApagar){
  const vals = Object.values(s.grid).map(Number).filter(v => !isNaN(v));
  const avg = media(vals);
  const chips = Object.keys(s.grid).sort().map(k =>
    `<div class="mini-chip" style="background:${corDaNota(s.grid[k])}" title="${esc(k.toUpperCase())}: ${Number(s.grid[k]).toFixed(1)}"></div>`).join('');
  return `<div class="submission-item" data-sub="${esc(String(s.id || ''))}">
    <div class="submission-head">
      <div class="submission-avg" style="background:${corDaNota(avg)}">${avg === null ? '–' : avg.toFixed(1)}</div>
      <div class="submission-meta">
        <div class="submission-name">Cetec Festival ${s.ano}</div>
        <div class="submission-when">${tempoAtras(Number(s.ts))} · ${vals.length} episódio${vals.length === 1 ? '' : 's'} avaliado${vals.length === 1 ? '' : 's'}</div>
      </div>
      <div class="submission-mini">${chips}</div>
      <button class="rev-share" data-ano="${s.ano}" data-avg="${avg === null ? '' : avg.toFixed(1)}" title="Compartilhar esta avaliação (story)" style="background:transparent;border:0;color:#9aa0aa;cursor:pointer;font-size:16px;padding:2px 6px;line-height:1">📤</button>
      ${(podeApagar && s.id) ? `<button class="rev-apagar" data-sub="${esc(String(s.id))}" data-ano="${s.ano}" title="Apagar esta avaliação" style="background:transparent;border:0;color:#9aa0aa;cursor:pointer;font-size:15px;padding:2px 6px;line-height:1">🗑️</button>` : ''}
      <div class="chevron">▾</div>
    </div>
    <div class="submission-detail"><div class="submission-detail-inner">
      <div class="grid-panel mini-grid">${perfilMiniGridHtml(s.grid, s.ano)}</div>
    </div></div>
  </div>`;
}
function ligarExpansao(container){
  container.querySelectorAll('.submission-item').forEach(item => {
    const head = item.querySelector('.submission-head');
    if(head) head.addEventListener('click', (ev) => {
      if(ev.target.closest('.rev-share') || ev.target.closest('.rev-apagar')) return;   // botões de ação não expandem
      const aberto = item.classList.contains('expanded');
      container.querySelectorAll('.submission-item.expanded').forEach(el => { if(el !== item) el.classList.remove('expanded'); });
      item.classList.toggle('expanded', !aberto);
    });
  });
}

async function paginaPerfil(){
  const meuSess = usuarioLogado();
  const alvoUser = (PAGINA.perfilUser || (meuSess && meuSess.user) || '').trim();
  const ehMeu = !!(meuSess && alvoUser && alvoUser.toLowerCase() === meuSess.user.toLowerCase());
  document.title = ehMeu ? 'Meu perfil — CETECritic' : `${alvoUser || 'Perfil'} — CETECritic`;

  if(!alvoUser){
    montarShell(`
      <div class="perfil-head"><h1>Meu perfil</h1></div>
      <div class="noite-card" style="text-align:center;">
        <div class="perfil-vazio">Você ainda não entrou. Crie uma conta para guardar suas avaliações, ganhar badges, entrar no bolão e interagir com outros perfis.</div>
        <button class="btn btn-solid" id="perfilEntrar">Entrar / Criar conta</button>
      </div>`);
    const b = document.getElementById('perfilEntrar');
    if(b) b.addEventListener('click', () => { const e = document.getElementById('btnEntrar'); if(e) e.click(); });
    return;
  }

  const alvo = alvoUser.toLowerCase();
  montarShell(`
    <div class="perfil-head">
      <div class="perfil-avatar" id="perfilAvatar">${esc(alvoUser.slice(0,1).toUpperCase())}</div>
      <div class="perfil-head-info">
        <h1><span id="perfilNome">${esc(alvoUser)}</span><span class="perfil-flags" id="perfilFlags"></span><span class="perfil-nome-real" id="perfilNomeReal" style="display:none;"></span> <span class="nivel-chip" id="nivelChip"></span> <span class="titulo-chip" id="tituloChip" style="display:none;"></span></h1>
        <div class="perfil-sub" id="perfilSub">Carregando...</div>
        <div class="perfil-meta" id="perfilMeta">
          <button class="perfil-meta-chip" type="button" id="chipAmigos" title="Ver amigos">👥 <b id="amigosCount">0</b> amigos</button>
          <span class="perfil-meta-chip" id="chipRep" style="display:none;" title="Sua reputação">👍 <b id="repHeaderN">0</b> reputação</span>
        </div>
        <div class="nivel-bar-wrap slim"><div class="nivel-bar" id="nivelBar"></div></div>
        <div class="nivel-txt" id="nivelTxt"></div>
      </div>
      <div class="perfil-actions" id="perfilActions"></div>
    </div>
    <!-- painel de amigos: abre pelo chip 👥 do cabeçalho -->
    <div class="amigos-panel" id="amigosPanel" style="display:none;">
      <div class="amigos-panel-head">👥 Amigos</div>
      <div id="amigosBox"><div class="empty-note">Carregando...</div></div>
      <div id="amigosAdd"></div>
    </div>
    <div id="perfilShowcase"></div>
    <div class="section" id="favSection">
      <h2>❤️ Edições preferidas <button class="btn btn-ghost btn-mini icon-btn" id="btnEditarFavs" title="Editar preferidas" style="display:none;">✏️</button></h2>
      <div id="favBox"><div class="empty-note">Carregando...</div></div>
    </div>
    <div class="hall-cards" id="perfilStats"></div>

    <!-- comparação (só faz sentido ao visitar OUTRO perfil) -->
    <div class="section" id="compareSection" style="display:none;"><h2>🔗 Comparação</h2><div id="compareBox"></div></div>
    <!-- carimbos: dar/ver ao visitar OUTRO perfil (no seu, aparecem no feed Amigos) -->
    <div class="section" id="carimbosSection" style="display:none;">
      <h2>🏷️ Carimbos <button class="ajuda-btn" id="carimboAjuda" title="O que são os carimbos?">?</button></h2>
      <div class="carimbo-legenda" id="carimboLegenda" style="display:none;"></div>
      <div id="carimbosBox"><div class="empty-note">Carregando...</div></div>
    </div>

    <!-- abas do perfil (Plano de Ação, Seção 7): Atividade / Social / Badges. -->
    <div class="perfil-tabs" id="perfilTabs">
      <button class="perfil-tab active" type="button" data-aba="abaAtividade">📝 Atividade</button>
      <button class="perfil-tab" type="button" data-aba="abaSocial" id="tabSocialBtn">💬 Social</button>
      <button class="perfil-tab" type="button" data-aba="abaBadges">🏅 Badges</button>
    </div>

    <div class="perfil-aba" id="abaAtividade">
      <div class="section"><h2>📝 Avaliações</h2>
        <div class="rev-tabs">
          <button class="rev-tab active" id="tabFest">Por festival</button>
          <button class="rev-tab" id="tabRec">Recentes</button>
        </div>
        <div id="revPorFestival"><div class="empty-note">Carregando...</div></div>
        <div id="revRecentes" style="display:none;"></div>
      </div>
      <div class="section"><h2>🔮 Bolão</h2>
        <div class="sub">Palpites por episódio e como se saiu (o placar aparece depois que a votação daquele ano fecha).</div>
        <div class="record-list" id="perfilBolao"><div class="empty-note">Carregando...</div></div></div>
    </div>

    <div class="perfil-aba" id="abaSocial" style="display:none;">
      <!-- feed social: Amigos (rede pessoal) x Geral (comunidade). Só no próprio perfil. -->
      <div class="rev-tabs social-sub">
        <button class="rev-tab active" type="button" id="socialTabAmigos" data-sub="socialAmigos">👥 Amigos</button>
        <button class="rev-tab" type="button" id="socialTabGeral" data-sub="socialGeral">🌐 Geral</button>
      </div>
      <div class="social-sub-pane" id="socialAmigos">
        <div class="feed" id="feedAmigos"><div class="empty-note">Carregando...</div></div>
      </div>
      <div class="social-sub-pane" id="socialGeral" style="display:none;">
        <div class="feed" id="feedGeral"><div class="empty-note">Carregando...</div></div>
      </div>
    </div>

    <div class="perfil-aba" id="abaBadges" style="display:none;">
      <div class="section">
        <h2>🏅 Badges <span class="badge-count" id="badgeCount"></span></h2>
        <div class="sub">Mostramos 3 de cada vez — trocam a cada reload. As bloqueadas ficam apagadas.</div>
        <div class="badge-grid" id="badgePreview"><div class="empty-note">Carregando...</div></div>
        <button class="btn btn-ghost" id="badgeToggle" style="display:none; margin-top:12px;">Ver todas</button>
        <div class="badge-grid" id="badgeAll" style="display:none; margin-top:12px;"></div>
      </div>
    </div>`);

  /* ações do topo do perfil */
  const actEl = document.getElementById('perfilActions');
  if(actEl && !ehMeu && meuSess){
    /* perfil de outra pessoa, logado: reputação + adicionar amigo + compare */
    actEl.innerHTML = `
      <div class="rep-control" title="Reputação">
        <button class="rep-btn rep-up" id="repUp" title="Dar +1 de reputação">▲</button>
        <span class="rep-count" id="repCount">–</span>
        <button class="rep-btn rep-down" id="repDown" title="Dar -1 de reputação">▼</button>
      </div>
      <button class="btn btn-ghost" id="btnAddFriend">➕ Amigo</button>
      <button class="btn btn-solid" id="btnCompare">🔗 Compare</button>`;
  } else if(actEl && ehMeu){
    actEl.innerHTML = `<button class="btn btn-ghost icon-btn" id="btnEditarShowcase" title="Editar destaques">✏️</button>`;
  }

  /* ---- reputação (karma): estado + UI ---- */
  let repTotal = null, repMeu = 0;
  function atualizarRepUI(){
    const c = document.getElementById('repCount');
    if(c) c.textContent = (repTotal === null ? '–' : repTotal);
    /* reputação também visível no cabeçalho do PRÓPRIO perfil */
    const rh = document.getElementById('repHeaderN'); if(rh) rh.textContent = (repTotal === null ? 0 : repTotal);
    const cr = document.getElementById('chipRep'); if(cr && ehMeu) cr.style.display = '';
    const up = document.getElementById('repUp'), dn = document.getElementById('repDown');
    if(up) up.classList.toggle('ativo', repMeu === 1);
    if(dn) dn.classList.toggle('ativo', repMeu === -1);
    const tc = document.getElementById('tituloChip');
    if(tc){
      const rep = (repTotal === null ? 0 : repTotal);
      const { atual, prox } = tituloPorReputacao(rep);
      if(atual){
        tc.style.display = '';
        tc.textContent = `${atual.emoji} ${atual.nome}`;
        tc.title = `Reputação ${rep}` + (prox ? ` · faltam ${Number(prox.min) - rep} 👍 para "${prox.nome}"` : ' · título máximo! 🎉');
      }
    }
  }
  async function votarRep(valor){
    const up = document.getElementById('repUp'), dn = document.getElementById('repDown');
    if(up) up.disabled = true; if(dn) dn.disabled = true;
    const novo = (repMeu === valor) ? 0 : valor;   // clicar de novo no mesmo tira o voto
    const r = await apiVotarReputacao(alvoUser, novo);
    if(up) up.disabled = false; if(dn) dn.disabled = false;
    if(r && r.ok){
      repMeu = (typeof r.meu === 'number') ? r.meu : novo;
      if(typeof r.total === 'number') repTotal = r.total;
      atualizarRepUI();
    } else {
      const c = document.getElementById('repCount');
      if(c) c.title = (r && r.error) ? r.error : 'não foi possível votar';
    }
  }
  { const up = document.getElementById('repUp'), dn = document.getElementById('repDown');
    if(up) up.addEventListener('click', () => votarRep(1));
    if(dn) dn.addEventListener('click', () => votarRep(-1)); }

  /* ---- adicionar amigo a partir do perfil de outra pessoa ---- */
  const btnAdd = document.getElementById('btnAddFriend');
  if(btnAdd){
    /* estado inicial: checa se já é meu amigo */
    fetchPerfilPublico(meuSess.user).then(meuPub => {
      const amigos = (meuPub && meuPub.perfil && Array.isArray(meuPub.perfil.amigos)) ? meuPub.perfil.amigos : [];
      if(amigos.some(x => String(x).toLowerCase() === alvoUser.toLowerCase())){
        btnAdd.textContent = '✓ Amigo'; btnAdd.disabled = true;
      }
    });
    btnAdd.addEventListener('click', async () => {
      btnAdd.disabled = true; btnAdd.textContent = 'Adicionando...';
      const meuFull = await apiMeuPerfil();
      const meuCfg = (meuFull && meuFull.ok && meuFull.perfil && typeof meuFull.perfil === 'object') ? meuFull.perfil : {};
      const amigos = Array.isArray(meuCfg.amigos) ? meuCfg.amigos.slice() : [];
      if(amigos.some(x => String(x).toLowerCase() === alvoUser.toLowerCase())){
        btnAdd.textContent = '✓ Amigo'; return;
      }
      amigos.push(alvoUser);
      const r = await apiSalvarPerfil(Object.assign({}, meuCfg, { amigos }));
      if(r && r.ok){ btnAdd.textContent = '✓ Amigo'; }
      else { btnAdd.disabled = false; btnAdd.textContent = '➕ Amigo'; }
    });
  }

  /* legenda dos carimbos (o "?") */
  const legendaEl = document.getElementById('carimboLegenda');
  if(legendaEl) legendaEl.innerHTML = Object.keys(CARIMBOS).map(t =>
    `<div class="carimbo-leg-item"><span>${CARIMBOS[t].emoji}</span><div><b>${esc(CARIMBOS[t].nome)}</b> — ${esc(CARIMBOS[t].desc)}</div></div>`).join('');
  const ajudaBtn = document.getElementById('carimboAjuda');
  if(ajudaBtn) ajudaBtn.addEventListener('click', () => {
    legendaEl.style.display = legendaEl.style.display === 'none' ? 'block' : 'none';
  });

  const reais = EDICOES.filter(e => !e.emBreve);
  let previewTitulos = null;
  let visitaRegistrada = false;

  async function carregar(){
    const porAno = await Promise.all(reais.map(async e => {
      try{
        const r = await fetch(API_URL + '?year=' + e.ano + '&_=' + Date.now(), { cache:'no-store' });
        const j = await r.json();
        return { ano: e.ano, subs: filtrarVotosDoAno(Array.isArray(j) ? j : (j.submissions || []), e.ano) };
      }catch(err){ return { ano: e.ano, subs: [] }; }
    }));

    /* perfil público primeiro: precisamos do nome de exibição (pseudônimo, se a
       pessoa for anônima) para casar as avaliações dela no feed já anonimizado */
    const pub = await fetchPerfilPublico(alvoUser, meuSess ? meuSess.user : null) || {};
    const alvoMatch = (pub.anonimo && pub.nomeExib) ? String(pub.nomeExib).trim().toLowerCase() : alvo;

    /* ---- selos: 🔒 privado / 🕶️ anonimo + pseudonimo no lugar do nome ---- */
    {
      const anon = !!pub.anonimo;                                  /* ja vem do servidor respeitando o anon_ate */
      const priv = !!(pub.perfil && pub.perfil.privado);
      const nomeExib = String(pub.nomeExib || alvoUser);
      const elNome  = document.getElementById('perfilNome');
      const elFlags = document.getElementById('perfilFlags');
      const elReal  = document.getElementById('perfilNomeReal');
      const elAv    = document.getElementById('perfilAvatar');

      if(elNome) elNome.textContent = anon ? nomeExib : alvoUser;
      if(elAv)   elAv.textContent   = (anon ? nomeExib : alvoUser).slice(0,1).toUpperCase();

      if(elFlags){
        let h = '';
        if(priv) h += `<span class="perfil-flag priv" title="Perfil privado — fora da busca e da lista de usuários, e o conteúdo do perfil só aparece pro dono">🔒</span>`;
        if(anon) h += `<span class="perfil-flag anon" title="Perfil anônimo — seu nome real fica escondido nos feeds e rankings">🕶️</span>`;
        elFlags.innerHTML = h;
      }

      /* o nome real SÓ aparece pra você — se aparecesse pros visitantes,
         o modo anônimo não serviria pra nada */
      if(elReal && anon && ehMeu){
        elReal.style.display = '';
        elReal.textContent = alvoUser;
        elReal.title = 'Seu nome real — só você enxerga isto aqui';
      }
    }

    /* ---- perfil privado: o servidor não manda mais nada além do nome pra
       quem não é o dono. Mostramos o cadeado e paramos aqui — sem isso a
       página tentaria montar tudo com dados vazios. ---- */
    if(pub.restrito){
      ['perfilActions','amigosPanel','perfilShowcase','favSection','perfilStats',
       'compareSection','carimbosSection','perfilTabs','abaAtividade','abaSocial',
       'abaBadges','perfilMeta','nivelTxt'].forEach(id => {
        const el = document.getElementById(id); if(el) el.style.display = 'none';
      });
      const barra = document.querySelector('.nivel-bar-wrap'); if(barra) barra.style.display = 'none';
      const subEl2 = document.getElementById('perfilSub'); if(subEl2) subEl2.textContent = '';
      const tabs = document.getElementById('perfilTabs');
      if(tabs && tabs.parentNode){
        const aviso = document.createElement('div');
        aviso.className = 'noite-card';
        aviso.style.textAlign = 'center';
        aviso.innerHTML = `<div class="perfil-vazio">🔒 Este perfil é privado.<br>
          <span style="color:var(--text-muted);font-size:13px;">Avaliações, carimbos, badges e visitas de
          ${esc(String(pub.nomeExib || alvoUser))} só aparecem para a própria pessoa.</span></div>`;
        tabs.parentNode.insertBefore(aviso, tabs);
      }
      return;
    }

    /* dataset global + avaliações do dono do perfil + do visitante (p/ compare) */
    const todosSubs = [];
    const alvoSubs = [];
    const minhasSubs = [];
    const meuLower = meuSess ? meuSess.user.trim().toLowerCase() : null;
    porAno.forEach(o => o.subs.forEach(s => {
      const u = String(s.user || '').trim().toLowerCase();
      /* `id` (sub_id) vai junto porque é ele que vira o id do post reagível
         no feed social — ver idPostSub em montarFeeds */
      const reg = { id: s.id, grid: s.grid, year: o.ano, user: s.user, ts: s.ts };
      todosSubs.push(reg);
      if(u === alvoMatch) alvoSubs.push({ ...reg, ano: o.ano });
      if(meuLower && u === meuLower) minhasSubs.push({ ...reg, ano: o.ano });
    }));

    const todasNotas = [];
    alvoSubs.forEach(s => Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) todasNotas.push(x); }));
    const anosPart = [...new Set(alvoSubs.map(s => s.ano))].sort((a,b) => b - a);
    const mediaDada = media(todasNotas);
    const nivel = nivelInfo(todasNotas.length);

    /* header + nível */
    const chip = document.getElementById('nivelChip'); if(chip) chip.textContent = `Nível ${nivel.nivel}`;
    const nbar = document.getElementById('nivelBar'); if(nbar) nbar.style.width = nivel.pct + '%';
    const ntxt = document.getElementById('nivelTxt'); if(ntxt) ntxt.textContent = `${nivel.xp} XP · faltam ${nivel.faltamXp} XP para o nível ${nivel.nivel + 1}`;
    const subEl = document.getElementById('perfilSub');
    if(subEl) subEl.textContent = alvoSubs.length
      ? `${alvoSubs.length} avaliaç${alvoSubs.length === 1 ? 'ão' : 'ões'} · ${anosPart.length} ediç${anosPart.length === 1 ? 'ão' : 'ões'} · membro desde ${new Date(Math.min(...alvoSubs.map(s => Number(s.ts)))).toLocaleDateString('pt-BR')}`
      : (ehMeu ? '' : 'Ainda não tem avaliações públicas.');

    /* ---- cartões de estatística ---- */
    const cards = [
      { big: String(alvoSubs.length), lbl: 'Avaliações' },
      { big: String(todasNotas.length), lbl: 'Notas dadas' },
      { big: mediaDada === null ? '–' : mediaDada.toFixed(1), lbl: 'Nota média' },
      { big: String(anosPart.length), lbl: 'Edições vistas' }
    ];
    const stEl = document.getElementById('perfilStats');
    if(stEl) stEl.innerHTML = cards.map(c => `<div class="hall-card"><div class="big">${c.big}</div><div class="lbl">${c.lbl}</div></div>`).join('');

    /* lista de usuários p/ "adicionar amigo": todos os cadastrados (endpoint novo),
       com fallback para os nomes vindos dos votos antes do redeploy */
    const _us = await fetchUsuarios();
    carregar._usuarios = _us.length ? _us : [...new Set(todosSubs.map(s => String(s.user || '').trim()).filter(Boolean))];

    /* ---- perfil público (já buscado acima): showcase, favoritas, amigos, reputação, visitas, carimbos ---- */
    let perfilCfg = (pub.perfil && typeof pub.perfil === 'object') ? pub.perfil : {};
    /* no MEU perfil, o público vem sem e-mail/notif (privados). Carrego o completo
       para que salvar destaques/favoritas/amigos NÃO apague esses campos. */
    if(ehMeu){ const meuFull = await apiMeuPerfil(); if(meuFull && meuFull.ok && meuFull.perfil) perfilCfg = meuFull.perfil; }
    carregar._perfilCfg = perfilCfg;
    carregar._showcase = perfilCfg.showcase || {};
    renderShowcase(carregar._showcase);
    renderFavs(perfilCfg.edicoesFav || []);
    renderAmigos(perfilCfg.amigos || []);
    montarAmigosAdd();
    renderCarimbos(pub.carimbos || []);
    /* o feed social espelha parte da central 🔔 (ver montarFeeds). Buscamos as
       notificações aqui, junto com o resto — falha na busca não pode derrubar
       o perfil, então cai numa lista vazia e o feed segue só com as ações. */
    if(ehMeu){
      let notifs = [];
      try{ const rn = await apiListarNotificacoes(); if(rn && rn.ok) notifs = rn.notificacoes || []; }catch(e){ notifs = []; }
      await montarFeeds(todosSubs, perfilCfg, pub, notifs);
    }

    /* reputação (karma) + título */
    if(typeof pub.reputacao === 'number') repTotal = pub.reputacao; else if(repTotal === null) repTotal = 0;
    if(typeof pub.meuVoto === 'number') repMeu = pub.meuVoto;
    atualizarRepUI();

    /* (função de visitas removida do perfil) */

    /* ---- estatísticas por episódio / edição (para badges) ---- */
    const epStats = {};
    { const acc = {}; todosSubs.forEach(s => Object.keys(s.grid).forEach(k => { const v = Number(s.grid[k]); if(isNaN(v)) return; const id = s.year + '|' + k; (acc[id] = acc[id] || []).push(v); }));
      Object.keys(acc).forEach(id => epStats[id] = statsDeVals(acc[id])); }
    const noiteOuro = {};
    { const nb = {}; todosSubs.forEach(s => Object.keys(s.grid).forEach(k => { const m = k.match(/^s(\d+)e\d+$/); if(!m) return; const v = Number(s.grid[k]); if(isNaN(v)) return; ((nb[s.year] = nb[s.year] || {})[m[1]] = nb[s.year][m[1]] || []).push(v); }));
      Object.keys(nb).forEach(y => { let best = null, ba = -1; Object.keys(nb[y]).forEach(nt => { const a = media(nb[y][nt]); if(a > ba){ ba = a; best = Number(nt); } }); noiteOuro[y] = best; }); }
    const globalNotas = []; todosSubs.forEach(s => Object.values(s.grid).forEach(v => { const x = Number(v); if(!isNaN(x)) globalNotas.push(x); }));
    const globalAvg = media(globalNotas);

    /* ---- bolão ----
       O placar agora vem calculado do servidor: palpite de terceiro não sai
       de lá, então os sinais que dependiam de ver a grade dos outros
       (Visionário, por exemplo) chegam prontos junto do ranking.
       A comparação peça a peça só monta no PRÓPRIO perfil — ela precisa do
       token do dono pra buscar o palpite. */
    const placares = await Promise.all(porAno.map(o => fetchPlacarBolao(o.ano)));
    const bolaoRes = [];
    let oraculo = false, apostaRisco = false, calculoExato = false, visionario = false;
    placares.forEach((d, i) => {
      if(!d || !d.placar || !d.placar.length) return;
      const ano = porAno[i].ano;
      const linha = d.placar.find(r => String(r.user).trim().toLowerCase() === alvoMatch);
      if(!linha) return;
      bolaoRes.push({
        ano, pos: linha.pos, total: d.placar.length,
        pontos: linha.pontos, apuradas: linha.apuradas,
        cravadas: linha.cravadas, erroMedio: linha.erroMedio
      });
      if(linha.oraculo)      oraculo = true;
      if(linha.apostaRisco)  apostaRisco = true;
      if(linha.visionario)   visionario = true;
      if(linha.calculoExato) calculoExato = true;
    });
    bolaoRes.sort((a,b) => b.ano - a.ano);

    const bEl = document.getElementById('perfilBolao');
    if(bEl) bEl.innerHTML = bolaoRes.length
      ? bolaoRes.map(b => {
          const medal = b.pos === 1 ? '🥇' : b.pos === 2 ? '🥈' : b.pos === 3 ? '🥉' : '🔮';
          const max = b.apuradas * BOLAO_PONTOS_MAX;
          return `<div class="record-item bolao-linha${ehMeu ? ' clicavel' : ''}" data-bolao-ano="${b.ano}">
            <span class="rec-emoji">${medal}</span>
            <div style="flex:1;">
              <div class="rec-title">Bolão ${b.ano} — ${b.pos}º de ${b.total}</div>
              <div class="rec-text"><b style="color:var(--gold)">${b.pontos}</b> de ${max} pontos ·
                ${b.cravadas} cravada${b.cravadas === 1 ? '' : 's'} · erro médio ${b.erroMedio.toFixed(2)}</div>
              <div class="bolao-detalhe" id="bolaoDet-${b.ano}" hidden></div>
            </div>
            ${ehMeu ? '<span class="chevron">▾</span>' : ''}
          </div>`;
        }).join('')
      : `<div class="empty-note">${ehMeu ? 'Você ainda não palpitou. Entre no bolão de uma edição aberta e tente prever as notas — dá badge.' : 'Sem palpites de bolão ainda.'}</div>`;

    /* clicar numa linha abre a comparação com o resultado oficial */
    if(bEl && ehMeu) bEl.querySelectorAll('.bolao-linha.clicavel').forEach(el => {
      el.addEventListener('click', async () => {
        const ano = Number(el.dataset.bolaoAno);
        const det = document.getElementById('bolaoDet-' + ano);
        if(!det) return;
        const abrir = det.hasAttribute('hidden');
        el.classList.toggle('aberto', abrir);
        if(!abrir){ det.setAttribute('hidden', ''); return; }
        det.removeAttribute('hidden');
        if(det.dataset.pronto) return;                 // já carregado antes
        det.innerHTML = '<div class="empty-note">Carregando...</div>';
        const meu = await fetchMeuPalpite(ano);
        det.innerHTML = (meu && meu.temPalpite)
          ? htmlComparacaoBolao(meu.palpites, meu.medias, meu.pontos)
          : '<div class="empty-note">Não foi possível carregar o seu palpite.</div>';
        det.dataset.pronto = '1';
      });
    });

    /* ---- sinais de comportamento (badges) ---- */
    let maratonaNoturna = false, polemicoNoite = false, selopurista = false, revelacao = false, gostoPeculiar = 0, caos = false, dedoPodre = false, noiteOuroAv = false;
    alvoSubs.forEach(s => {
      const noites = (EDICOES.find(e => e.ano === s.ano) || { noites: 5 }).noites;
      const nSet = new Set(); const porNoite = {};
      Object.keys(s.grid).forEach(k => {
        const v = Number(s.grid[k]); if(isNaN(v)) return;
        const m = k.match(/^s(\d+)e\d+$/); if(m){ nSet.add(Number(m[1])); (porNoite[m[1]] = porNoite[m[1]] || []).push(v); }
        const st = epStats[s.year + '|' + k];
        if(st){
          if(v >= NOTA_MAXIMA - 0.01 && st.avg >= 9) selopurista = true;
          if(v >= 9 && st.avg < 7) revelacao = true;
          if(v >= 8 && st.avg < 6) gostoPeculiar++;
          if(st.std >= 2.5 && (v >= 9 || v <= 2)) caos = true;
          if(st.n >= 3 && v <= st.min + 0.001 && (st.avg - v) >= 3) dedoPodre = true;
        }
        if(m && Number(m[1]) === noiteOuro[s.year]) noiteOuroAv = true;
      });
      let todas = noites > 0; for(let n = 1; n <= noites; n++) if(!nSet.has(n)) todas = false;
      if(todas) maratonaNoturna = true;
      Object.keys(porNoite).forEach(nt => { const arr = porNoite[nt]; if(Math.max(...arr) >= NOTA_MAXIMA - 0.01 && Math.min(...arr) <= 0.01) polemicoNoite = true; });
    });

    /* afinidade máxima com outro usuário (Gêmeo de Opinião) */
    const porUser = {};
    todosSubs.forEach(s => { const u = String(s.user || '').trim().toLowerCase(); if(!u || u === alvo) return; (porUser[u] = porUser[u] || []).push({ grid: s.grid, year: s.year }); });
    let bestAfin = 0;
    Object.keys(porUser).forEach(u => { const a = afinidadeGosto(alvoSubs, porUser[u]); if(a.pct !== null && a.shared >= 5 && a.pct > bestAfin) bestAfin = a.pct; });

    const edicoesComVotos = porAno.filter(o => o.subs.length > 0).map(o => o.ano);
    const ctx = {
      reais, anosSet: new Set(anosPart), nAnos: anosPart.length, total: alvoSubs.length, nNotas: todasNotas.length,
      pre2020: anosPart.some(a => a < 2020),
      consecutivo: anosPart.some(a => anosPart.includes(a + 1)),
      diversidade: new Set(todasNotas).size,
      madrugada: alvoSubs.some(s => { const h = new Date(Number(s.ts)).getHours(); return h >= 0 && h < 5; }),
      fichaCompleta: alvoSubs.some(s => { const noites = (EDICOES.find(e => e.ano === s.ano) || { noites: 5 }).noites; return Object.keys(s.grid).length >= noites * 3; }),
      maratonaNoturna, polemicoNoite, selopurista, revelacao, caos, dedoPodre, noiteOuroAv,
      gostoPeculiar: gostoPeculiar >= 2,
      coracaoMole: (mediaDada !== null && todasNotas.length >= 10 && mediaDada > 9.0),
      juizSevero: (globalAvg !== null && mediaDada !== null && todasNotas.length >= 10 && mediaDada < globalAvg - 1.5),
      gemeo: bestAfin >= metaPerfil('gemeoAfinidade', 90),
      oraculo, apostaRisco, calculoExato, visionario,
      bolaCristal: bolaoRes.some(b => b.pos <= 3),
      participouBolao: bolaoRes.length,
      /* pódio do bolão: quais anos tiveram bolão apurado e em que lugar a
         pessoa ficou em cada um — vira "Campeão do bolão 2026" e afins */
      anosComBolao: placares.map((d, i) => (d && d.placar && d.placar.length) ? porAno[i].ano : null).filter(Boolean),
      bolaoPos: bolaoRes.reduce((m, b) => { m[b.ano] = b.pos; return m; }, {}),
      lenda: (nivel.nivel >= metaPerfil('lendaNivel', 5) && edicoesComVotos.length > 0 && edicoesComVotos.every(y => anosPart.includes(y)))
    };
    /* ---- exceções do admin -------------------------------------------
       As badges são CALCULADAS aqui no navegador a partir dos votos, então
       não existe "badge salva no banco" pra editar. O painel admin grava
       uma camada de exceção em perfil.admin_badges e é ela que aplicamos
       por cima do catálogo. `forcada` ganha de `bloqueada` (o servidor já
       garante que a mesma badge não aparece nas duas listas). */
    const cat = aplicarBadgesDoAdmin(catalogoBadges(ctx), perfilCfg);
    const nUnlocked = cat.filter(b => b.unlocked).length;
    if(ehMeu) detectarBadgesNovas(cat);   // avisa badges recém-desbloqueadas (só no seu perfil)
    /* preview: sorteia entre as DESBLOQUEADAS; só completa com bloqueadas se faltar */
    if(previewTitulos === null){
      const unl = cat.filter(b => b.unlocked).sort(() => Math.random() - 0.5);
      const loc = cat.filter(b => !b.unlocked).sort(() => Math.random() - 0.5);
      previewTitulos = [...unl, ...loc].slice(0, BADGES_PREVIEW).map(b => b.titulo);
    }
    const preview = previewTitulos.map(t => cat.find(b => b.titulo === t)).filter(Boolean);
    const countEl = document.getElementById('badgeCount'); if(countEl) countEl.textContent = `${nUnlocked}/${cat.length}`;
    const previewEl = document.getElementById('badgePreview'); if(previewEl) previewEl.innerHTML = preview.map(badgeCardHtml).join('');
    const allEl = document.getElementById('badgeAll'); if(allEl) allEl.innerHTML = cat.map(badgeCardHtml).join('');
    const toggle = document.getElementById('badgeToggle');
    if(toggle){
      toggle.style.display = '';
      if(allEl.style.display === 'none') toggle.textContent = `Ver todas (${cat.length})`;
      toggle.onclick = () => {
        const aberto = allEl.style.display !== 'none';
        allEl.style.display = aberto ? 'none' : 'grid';
        previewEl.style.display = aberto ? 'grid' : 'none';
        toggle.textContent = aberto ? `Ver todas (${cat.length})` : 'Ver menos';
      };
    }

    /* ---- avaliações: por festival + recentes ---- */
    const revFest = document.getElementById('revPorFestival');
    const revRec = document.getElementById('revRecentes');
    if(!alvoSubs.length){
      const vazioAval = ehMeu
        ? '<div class="empty-note">Sua primeira avaliação desbloqueia: 🥇 primeiro badge · ⭐ XP · 📊 estatísticas pessoais. Escolha uma edição no menu e comece.</div>'
        : '<div class="empty-note">Nenhuma avaliação pública ainda.</div>';
      if(revFest) revFest.innerHTML = vazioAval;
      if(revRec) revRec.innerHTML = vazioAval;
    } else {
      if(revFest){
        revFest.innerHTML = anosPart.map(ano => {
          const desse = alvoSubs.filter(s => s.ano === ano).sort((a,b) => Number(b.ts) - Number(a.ts));
          return `<div class="rev-fest-grupo"><div class="rev-fest-titulo">Cetec Festival ${ano} <span>(${desse.length})</span></div>
            <div class="submission-list">${desse.map(s => reviewCardHtml(s, ehMeu)).join('')}</div></div>`;
        }).join('');
        ligarExpansao(revFest);
      }
      if(revRec){
        revRec.innerHTML = `<div class="submission-list">${[...alvoSubs].sort((a,b) => Number(b.ts) - Number(a.ts)).map(s => reviewCardHtml(s, ehMeu)).join('')}</div>`;
        ligarExpansao(revRec);
      }
    }

    /* compartilhar e apagar (delegação única — sobrevive ao refresh de 30s) */
    [revFest, revRec].forEach(cont => {
      if(!cont || cont._shareWired) return;
      cont._shareWired = true;
      cont.addEventListener('click', async ev => {
        const b = ev.target.closest('.rev-share');
        if(b){
          ev.stopPropagation();
          const ano = Number(b.dataset.ano);
          abrirCompartilhamento({
            poster: posterDaEdicao(ano),
            titulo: `Cetec Festival ${ano}`,
            sub: alvoUser,
            nota: b.dataset.avg === '' ? null : Number(b.dataset.avg),
            legenda: 'minha avaliação no CETECritic',
            arquivo: `CETECritic_${alvoUser}_${ano}.png`
          });
          return;
        }

        const del = ev.target.closest('.rev-apagar');
        if(!del) return;
        ev.stopPropagation();
        const subId = del.dataset.sub;
        const ano = del.dataset.ano;
        const ok = await confirmarAcao({
          titulo: '🗑️ Apagar esta avaliação?',
          textoHtml: `Suas notas do <b>Cetec Festival ${esc(String(ano))}</b> serão apagadas de vez.<br><br>
            As médias das peças daquela edição vão ser recalculadas sem elas. Não dá pra desfazer —
            você teria que avaliar tudo de novo.`,
          confirmar: 'Apagar avaliação',
          perigo: true
        });
        if(!ok) return;

        del.disabled = true;
        const r = await apiApagarAvaliacao(subId);
        if(r && r.ok){
          /* tira do DOM nas duas abas: o mesmo id aparece em "por festival"
             e em "recentes" */
          document.querySelectorAll(`.submission-item[data-sub="${CSS.escape(subId)}"]`).forEach(el => el.remove());
          /* o feed daquele ano fica em cache local; sem limpar, a avaliação
             apagada reapareceria no próximo carregamento */
          try{ localStorage.removeItem(cacheVotosKey(ano)); }catch(e){}
        }else{
          del.disabled = false;
          alert((r && r.error) || 'Não foi possível apagar.');
        }
      });
    });

    /* guarda para o compare / showcase */
    carregar._alvoSubs = alvoSubs;
    carregar._minhasSubs = minhasSubs;
  }

  /* ---- salvar perfil SEM apagar o resto ----
     O perfil é UM objeto JSON só (showcase + edicoesFav + amigos). Salvar
     precisa MESCLAR com o que já existe, senão salvar destaques apagaria os
     amigos etc. Só usar no MEU perfil (carregar._perfilCfg = meu perfil). */
  async function salvarPerfilMerge(patch){
    const base = (carregar._perfilCfg && typeof carregar._perfilCfg === 'object') ? carregar._perfilCfg : {};
    const novo = Object.assign({}, base, patch);
    const r = await apiSalvarPerfil(novo);
    if(r && r.ok) carregar._perfilCfg = novo;
    return r;
  }

  /* ---- edições preferidas (estilo Letterboxd) ---- */
  function renderFavs(anos){
    const box = document.getElementById('favBox');
    const btn = document.getElementById('btnEditarFavs');
    if(btn) btn.style.display = ehMeu ? '' : 'none';
    if(!box) return;
    const arr = (Array.isArray(anos) ? anos : []).map(Number).filter(a => reais.some(e => e.ano === a));
    if(!arr.length){
      box.innerHTML = ehMeu
        ? '<div class="empty-note">Escolha suas edições preferidas para exibir aqui (dá pra fixar mais de uma). Clique em "Editar".</div>'
        : '<div class="empty-note">Nenhuma edição preferida ainda.</div>';
      return;
    }
    box.innerHTML = `<div class="fav-grid">${arr.map(ano => {
      const poster = posterDaEdicao(ano);
      /* sem poster cadastrado, mostra o card vazio com as máscaras em vez de
         um background apontando para arquivo inexistente */
      const capa = poster
        ? `<div class="fav-poster" style="background-image:url('${esc(poster)}')"></div>`
        : `<div class="fav-poster fav-poster-vazio">🎭</div>`;
      return `<a class="fav-card" href="${BASE}${ano}/index.html" title="Cetec Festival ${ano}">
        ${capa}
        <div class="fav-ano">${ano}</div></a>`;
    }).join('')}</div>`;
  }
  function abrirEditorFavs(){
    const box = document.getElementById('favBox');
    if(!box) return;
    const max = PERFIL_CFG.maxEdicoesFav || 4;
    let sel = ((carregar._perfilCfg && carregar._perfilCfg.edicoesFav) || []).map(Number).filter(a => reais.some(e => e.ano === a));
    const desc = reais.slice().sort((a,b) => b.ano - a.ano);
    function draw(){
      box.innerHTML = `<div class="fav-editor">
        <div class="fav-editor-hint">Escolha até ${max} — a ordem dos cliques é a ordem que aparece.</div>
        <div class="fav-chip-wrap">${desc.map(e => {
          const i = sel.indexOf(e.ano);
          return `<button class="fav-chip${i >= 0 ? ' sel' : ''}" data-ano="${e.ano}">${e.ano}${i >= 0 ? ` <span>${i+1}</span>` : ''}</button>`;
        }).join('')}</div>
        <div class="showcase-form-actions"><span class="bolao-msg" id="favMsg"></span>
          <button class="submit-btn" id="favSalvar">Salvar preferidas</button></div>
      </div>`;
      box.querySelectorAll('.fav-chip').forEach(b => b.addEventListener('click', () => {
        const ano = Number(b.dataset.ano);
        const i = sel.indexOf(ano);
        if(i >= 0) sel.splice(i, 1);
        else {
          if(sel.length >= max){ const m = document.getElementById('favMsg'); if(m) m.textContent = `Máximo de ${max} edições.`; return; }
          sel.push(ano);
        }
        draw();
      }));
      document.getElementById('favSalvar').addEventListener('click', async () => {
        const bt = document.getElementById('favSalvar'), msg = document.getElementById('favMsg');
        bt.disabled = true; bt.innerHTML = '<span class="spinner"></span>Salvando...';
        const r = await salvarPerfilMerge({ edicoesFav: sel });
        bt.disabled = false; bt.textContent = 'Salvar preferidas';
        if(r && r.ok) renderFavs(sel);
        else if(msg) msg.textContent = (r && r.error) ? r.error : 'Não foi possível salvar.';
      });
    }
    draw();
  }

  /* ---- amigos ---- */
  function renderAmigos(lista){
    const arr = (Array.isArray(lista) ? lista : []).filter(Boolean);
    const cnt = document.getElementById('amigosCount'); if(cnt) cnt.textContent = String(arr.length);
    const box = document.getElementById('amigosBox');
    if(!box) return;
    box.innerHTML = arr.length
      ? `<div class="busca-users">${arr.map(u => `<span class="busca-user amigo-chip">
          <a class="amigo-link" href="${BASE}perfil.html?user=${encodeURIComponent(u)}"><span class="busca-ava">${esc(String(u).slice(0,1).toUpperCase())}</span><span class="busca-user-nome">${esc(u)}</span></a>
          ${ehMeu ? `<button class="amigo-rm" data-u="${esc(u)}" title="Remover amigo">×</button>` : ''}</span>`).join('')}</div>`
      : `<div class="empty-note">${ehMeu ? 'Você ainda não adicionou amigos. Busque abaixo, ou use o botão "➕ Amigo" no perfil de alguém.' : 'Nenhum amigo ainda.'}</div>`;
    if(ehMeu){
      box.querySelectorAll('.amigo-rm').forEach(b => b.addEventListener('click', async () => {
        const u = b.dataset.u;
        const novo = ((carregar._perfilCfg && carregar._perfilCfg.amigos) || []).filter(x => String(x).toLowerCase() !== String(u).toLowerCase());
        b.disabled = true;
        const r = await salvarPerfilMerge({ amigos: novo });
        if(r && r.ok) renderAmigos(novo); else b.disabled = false;
      }));
    }
  }
  function montarAmigosAdd(){
    const add = document.getElementById('amigosAdd');
    if(!add) return;
    if(!ehMeu || !meuSess){ add.innerHTML = ''; return; }
    if(document.getElementById('amigoQ')) return;   // já montado — não recria (não apaga o que a pessoa digita no refresh de 30s)
    add.innerHTML = `<div class="amigo-add">
      <input type="text" id="amigoQ" placeholder="Buscar usuário para adicionar…" autocomplete="off">
      <div class="amigo-sugest" id="amigoSugest"></div></div>`;
    const q = document.getElementById('amigoQ'), sug = document.getElementById('amigoSugest');
    q.addEventListener('input', () => {
      const t = q.value.trim().toLowerCase();
      const meu = meuSess.user.toLowerCase();
      const jaAmigo = new Set(((carregar._perfilCfg && carregar._perfilCfg.amigos) || []).map(x => String(x).toLowerCase()));
      const lista = !t ? [] : (carregar._usuarios || [])
        .filter(u => u.toLowerCase().includes(t) && u.toLowerCase() !== meu && !jaAmigo.has(u.toLowerCase()))
        .slice(0, 8);
      sug.innerHTML = lista.map(u => `<button class="amigo-sug-item" data-u="${esc(u)}"><span class="busca-ava">${esc(u.slice(0,1).toUpperCase())}</span>${esc(u)}</button>`).join('');
      sug.querySelectorAll('.amigo-sug-item').forEach(b => b.addEventListener('click', async () => {
        const u = b.dataset.u;
        const novo = [ ...((carregar._perfilCfg && carregar._perfilCfg.amigos) || []), u ];
        b.disabled = true;
        const r = await salvarPerfilMerge({ amigos: novo });
        if(r && r.ok){ q.value = ''; sug.innerHTML = ''; renderAmigos(novo); }
        else b.disabled = false;
      }));
    });
  }

  /* ---- showcase (destaques do perfil) ----
     As opções vêm SEMPRE dos dados reais do site (peças/noites/edições/
     playlists cadastradas) — o usuário só escolhe, não digita nada solto. */
  function renderShowcase(sc){
    const el = document.getElementById('perfilShowcase');
    if(!el) return;
    const itens = [];
    if(sc.pecaFav) itens.push({ i:'🎭', l:'Peça favorita', v: sc.pecaFav });
    if(sc.anoFav) itens.push({ i:'📅', l:'Edição favorita', v: `Cetec Festival ${sc.anoFav}` });
    if(sc.noiteFav) itens.push({ i:'🌙', l:'Noite favorita', v: sc.noiteFav });
    if(sc.playlist && sc.playlist.url) itens.push({ i:'🎵', l:'Playlist de abertura', v: `Cetec Festival ${sc.playlist.ano}`, url: sc.playlist.url });
    if(!itens.length && !ehMeu){ el.innerHTML = ''; return; }
    el.innerHTML = itens.length
      ? `<div class="showcase-grid">${itens.map(x => {
          const inner = `<div class="sc-ico">${x.i}</div><div><div class="sc-lbl">${x.l}</div><div class="sc-val">${esc(String(x.v))}</div></div>`;
          return x.url ? `<a class="showcase-card" href="${esc(x.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="showcase-card">${inner}</div>`;
        }).join('')}</div>`
      : (ehMeu ? '<div class="empty-note">Você ainda não escolheu destaques. Clique em "Editar destaques" no topo.</div>' : '');
  }

  /* varre edicao.js + noites/*.js de todas as edições reais para montar as
     opções (peças, noites, playlists cadastradas) — igual ao Hall faz */
  let opcoesShowcaseCache = null;
  async function carregarOpcoesShowcase(){
    if(opcoesShowcaseCache) return opcoesShowcaseCache;
    const pecas = [], noites = [], playlists = [];
    /* em paralelo e pelo cache compartilhado: era um for serial que refazia
       o download de tudo mesmo se o Hall já tivesse baixado na mesma sessão */
    const carregadas = await Promise.all(reais.map(cfg => carregarDadosEdicao(cfg)));
    carregadas.forEach(d => {
      if(!d) return;                       // edição sem arquivos ainda: fica de fora
      const cfg = d.cfg, ed = d.ed || {};
      if(ed.abertura && ed.abertura.spotify) playlists.push({ ano: cfg.ano, url: ed.abertura.spotify });
      for(let n = 1; n <= cfg.noites; n++){
        noites.push({ label: `Noite ${n} de ${cfg.ano}` });
        const nd = d.noites && d.noites[n];
        if(nd && Array.isArray(nd.pecas)) nd.pecas.forEach(p => pecas.push({ label: `${p.titulo} — Turma ${p.turma} (${cfg.ano})` }));
      }
    });
    opcoesShowcaseCache = { pecas, noites, playlists };
    return opcoesShowcaseCache;
  }

  async function abrirEditorShowcase(){
    const atual = (carregar._showcase) || {};
    const el = document.getElementById('perfilShowcase');
    el.innerHTML = '<div class="empty-note">Carregando opções...</div>';
    const opts = await carregarOpcoesShowcase();
    const opt = (v, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(v)}</option>`;
    el.innerHTML = `<div class="showcase-form">
      <div class="sf-row"><label>🎭 Peça favorita</label>
        <select id="scPeca"><option value="">—</option>${opts.pecas.map(p => opt(p.label, atual.pecaFav === p.label)).join('') || '<option disabled>Nenhuma peça cadastrada ainda</option>'}</select></div>
      <div class="sf-row"><label>📅 Edição favorita</label>
        <select id="scAno"><option value="">—</option>${reais.map(e => `<option value="${e.ano}"${String(atual.anoFav) === String(e.ano) ? ' selected' : ''}>Cetec Festival ${e.ano}</option>`).join('')}</select></div>
      <div class="sf-row"><label>🌙 Noite favorita</label>
        <select id="scNoite"><option value="">—</option>${opts.noites.map(n => opt(n.label, atual.noiteFav === n.label)).join('')}</select></div>
      <div class="sf-row"><label>🎵 Playlist de abertura</label>
        <select id="scPlaylist"><option value="">—</option>${opts.playlists.map(p => `<option value="${p.ano}"${atual.playlist && String(atual.playlist.ano) === String(p.ano) ? ' selected' : ''}>Cetec Festival ${p.ano}</option>`).join('') || '<option disabled>Nenhuma playlist cadastrada ainda</option>'}</select></div>
      <div class="showcase-form-actions"><span class="bolao-msg" id="scMsg"></span><button class="submit-btn" id="scSalvar">Salvar destaques</button></div>
    </div>`;
    document.getElementById('scSalvar').addEventListener('click', async () => {
      const playlistAno = document.getElementById('scPlaylist').value;
      const playlistObj = playlistAno ? opts.playlists.find(p => String(p.ano) === playlistAno) : null;
      const sc = {
        pecaFav: document.getElementById('scPeca').value,
        anoFav: document.getElementById('scAno').value,
        noiteFav: document.getElementById('scNoite').value,
        playlist: playlistObj ? { ano: playlistObj.ano, url: playlistObj.url } : null
      };
      const bt = document.getElementById('scSalvar'); const msg = document.getElementById('scMsg');
      bt.disabled = true; bt.innerHTML = '<span class="spinner"></span>Salvando...';
      const r = await salvarPerfilMerge({ showcase: sc });
      bt.disabled = false; bt.textContent = 'Salvar destaques';
      if(r && r.ok){ carregar._showcase = sc; renderShowcase(sc); }
      else { msg.textContent = (r && r.error) ? r.error : 'Não foi possível salvar.'; }
    });
  }

  /* ---- carimbos ---- */
  function renderCarimbos(lista){
    const box = document.getElementById('carimbosBox');
    if(!box) return;
    const cont = {};
    lista.forEach(c => { cont[c.tipo] = (cont[c.tipo] || 0) + 1; });
    const recebidos = Object.keys(cont).length
      ? `<div class="carimbo-recebidos">${Object.keys(cont).map(t => {
          const c = CARIMBOS[t] || { emoji:'🏷️', nome:t };
          return `<div class="carimbo-chip" title="${esc(c.nome)}">${c.emoji} <span>${cont[t]}</span></div>`;
        }).join('')}</div>`
      : `<div class="empty-note">${ehMeu ? 'Ainda sem carimbos. Avalie 3 apresentações para começar a receber reconhecimento da comunidade.' : 'Sem carimbos ainda — seja o primeiro a deixar um logo abaixo.'}</div>`;
    let dar = '';
    if(!ehMeu && meuSess){
      dar = `<div class="carimbo-dar"><div class="carimbo-dar-lbl">Deixe um carimbo:</div>
        <div class="carimbo-opcoes">${Object.keys(CARIMBOS).map(t =>
          `<button class="carimbo-btn" data-tipo="${t}" title="${esc(CARIMBOS[t].nome)} — ${esc(CARIMBOS[t].desc)}">${CARIMBOS[t].emoji}</button>`).join('')}</div>
        <div class="bolao-msg" id="carimboMsg"></div></div>`;
    }
    box.innerHTML = recebidos + dar;
    if(!ehMeu && meuSess){
      box.querySelectorAll('.carimbo-btn').forEach(btn => btn.addEventListener('click', async () => {
        const tipo = btn.dataset.tipo; const msg = document.getElementById('carimboMsg');
        box.querySelectorAll('.carimbo-btn').forEach(b => b.disabled = true);
        const r = await apiCarimbar(alvoUser, tipo);
        box.querySelectorAll('.carimbo-btn').forEach(b => b.disabled = false);
        if(r && r.ok){ msg.textContent = 'Carimbo enviado! ✓'; const pub = await fetchPerfilPublico(alvoUser); renderCarimbos((pub && pub.carimbos) || []); }
        else { msg.textContent = (r && r.error) ? r.error : 'Não foi possível carimbar.'; }
      }));
    }
  }

  /* ---- FEED SOCIAL (só no meu perfil) ----
     Amigos: ações da minha rede (reviews de amigos, carimbos que recebi).
     Geral: novidades da comunidade (posts do admin/CETECritic + reviews recentes). */
  /* ---------------------------------------------------------------------
     Barra de reação de um post. O botão mostra o ❤️ (ou a reação que a
     pessoa já deu) e, ao ser clicado, ABRE o seletor com os outros emojis —
     que são os mesmos carimbos do perfil, não um sistema novo.
     Clicar de novo no emoji que já está marcado tira a reação.
     --------------------------------------------------------------------- */
  function barraReacaoHtml(it){
    if(!it.postId) return '';
    const r = (montarFeeds._reacoes && montarFeeds._reacoes[it.postId]) || { total:0, tipos:{}, meu:null };
    const meu = r.meu;
    const info = meu && CARIMBOS[meu] ? CARIMBOS[meu] : null;
    /* os 3 emojis mais usados, pra dar noção do tom da reação sem poluir */
    const topo = Object.keys(r.tipos || {})
      .sort((a,b) => r.tipos[b] - r.tipos[a]).slice(0,3)
      .map(t => (CARIMBOS[t] || {}).emoji || '').filter(Boolean).join('');
    return `<div class="feed-reacoes" data-post="${esc(it.postId)}" data-autor="${esc(it.autorReal || '')}">
      <button type="button" class="reagir-btn${meu ? ' ativo' : ''}" title="${info ? esc(info.nome) : 'Reagir'}">
        <span class="reagir-emoji">${info ? info.emoji : '❤️'}</span>
        <span class="reagir-label">${info ? esc(info.nome) : 'Curtir'}</span>
      </button>
      ${r.total ? `<span class="reagir-contagem" title="${r.total} reação(ões)">${topo} ${r.total}</span>` : ''}
      <div class="reagir-menu" hidden>
        ${Object.keys(CARIMBOS).map(t => `
          <button type="button" class="reagir-op${meu === t ? ' ativo' : ''}" data-tipo="${esc(t)}"
                  title="${esc(CARIMBOS[t].nome)} — ${esc(CARIMBOS[t].desc || '')}">${CARIMBOS[t].emoji}</button>`).join('')}
      </div>
    </div>`;
  }

  function feedItemHtml(it){
    /* item vindo da central de notificações usa o emoji do tipo no lugar da
       inicial do nome — fica claro que é um aviso, não a ação de alguém */
    const letra = it.emojiFeed ? it.emojiFeed : esc(String(it.nome || '?').slice(0,1).toUpperCase());
    const quando = it.ts ? tempoAtras(Number(it.ts)) : '';
    const corpo = `<div class="feed-ava">${letra}</div><div class="feed-body"><div class="feed-text">${it.html || esc(it.texto || '')}</div>${quando ? `<div class="feed-when">${quando}</div>` : ''}</div>`;
    /* o item vira <a> só quando NÃO tem reação: um <button> dentro de <a>
       faz o link disparar junto com o clique no emoji */
    const miolo = it.url
      ? (it.postId ? `<a class="feed-linha" href="${esc(it.url)}">${corpo}</a>` : null)
      : null;
    if(it.postId){
      return `<div class="feed-item feed-item-post">
        ${miolo || `<div class="feed-linha">${corpo}</div>`}
        ${barraReacaoHtml(it)}
      </div>`;
    }
    return it.url ? `<a class="feed-item" href="${esc(it.url)}">${corpo}</a>` : `<div class="feed-item">${corpo}</div>`;
  }

  /* delegação de eventos: os feeds são redesenhados inteiros, então ouvir no
     container evita religar listener a cada render */
  function ligarReacoes(container){
    if(!container || container._reacoesLigadas) return;
    container._reacoesLigadas = true;
    container.addEventListener('click', async ev => {
      const barra = ev.target.closest('.feed-reacoes');
      if(!barra) return;
      const menu = barra.querySelector('.reagir-menu');

      if(ev.target.closest('.reagir-btn')){
        ev.preventDefault();
        /* fecha qualquer outro menu aberto na página */
        document.querySelectorAll('.reagir-menu').forEach(m => { if(m !== menu) m.hidden = true; });
        menu.hidden = !menu.hidden;
        return;
      }

      const op = ev.target.closest('.reagir-op');
      if(!op) return;
      ev.preventDefault();
      const postId = barra.dataset.post;
      const autor = barra.dataset.autor || '';
      const atual = (montarFeeds._reacoes[postId] || {}).meu || null;
      /* clicar no emoji que já está marcado = tirar a reação */
      const tipo = (atual === op.dataset.tipo) ? null : op.dataset.tipo;

      menu.hidden = true;
      barra.querySelectorAll('button').forEach(b => b.disabled = true);
      const r = await apiReagir(postId, tipo, autor);
      barra.querySelectorAll('button').forEach(b => b.disabled = false);

      if(r && r.ok){
        montarFeeds._reacoes[postId] = { total: r.total, tipos: r.tipos, meu: r.meu };
        /* redesenha só esta barra */
        const novo = document.createElement('div');
        novo.innerHTML = barraReacaoHtml({ postId, autorReal: autor });
        barra.replaceWith(novo.firstElementChild);
      }else if(r && r.error){
        const c = barra.querySelector('.reagir-contagem') || barra.querySelector('.reagir-btn');
        if(c) c.title = r.error;
        alert(r.error);
      }
    });
  }
  /* clicar fora fecha o seletor */
  document.addEventListener('click', ev => {
    if(ev.target.closest('.feed-reacoes')) return;
    document.querySelectorAll('.reagir-menu').forEach(m => { m.hidden = true; });
  });
  /* ---------------------------------------------------------------------
     Notificações dentro do feed social.

     A central 🔔 continua sendo a fonte da verdade e não mudou. O que fazemos
     aqui é ESPELHAR parte dela na aba Social, roteando por tipo:

       AMIGOS  o que aconteceu com VOCÊ e com a sua rede — badge destravada,
               posição no Hall da Fama, carimbo recebido, novo amigo.
       GERAL   o que vale pra comunidade inteira — edição nova, noite liberada,
               abertura de votação, resultado do bolão, recado da organização.

     Só espelhamos os tipos abaixo: visitas de perfil, por exemplo, ficariam
     repetitivas demais no feed e continuam só na central. --------------- */
  const NOTIF_FEED_AMIGOS = { badges:1, hall:1, carimbos:1, amigos:1 };
  const NOTIF_FEED_GERAL  = { edicoes:1, noites:1, votacoes:1, bolao:1, admin:1 };
  const NOTIF_EMOJI = { badges:'🏅', hall:'🏆', carimbos:'📮', amigos:'🤝', edicoes:'🎬', noites:'🎭', votacoes:'🗳️', bolao:'🔮', admin:'📣' };

  function notifParaFeed(n){
    const emoji = NOTIF_EMOJI[n.tipo] || '🔔';
    /* o título das notificações já vem com emoji do servidor (ex.: "🏅 Nova
       badge!"); tiramos pra não duplicar com o nosso */
    const titulo = String(n.titulo || '').replace(/^\s*\p{Extended_Pictographic}+\s*/u, '').trim();
    return {
      nome: 'CETECritic', ts: Number(n.criadoEm) || 0, url: n.url || '',
      origem: 'notif',
      html: `<b>${esc(titulo || 'Aviso')}</b>${n.corpo ? ' ' + esc(n.corpo) : ''}`,
      emojiFeed: emoji
    };
  }

  /* id estável de cada post reagível. Precisa sobreviver a recarregar a
     página, porque é ele que vai pra coluna `alvo` da tabela de carimbos.
       feed:<ts>   post publicado pela organização (o ts é fixo na criação)
       sub:<id>    avaliação de alguém (sub_id vem do banco)
     Avisos automáticos (badge, hall) NÃO recebem id — não são reagíveis. */
  const idPostFeed = f => (f && f.ts) ? ('feed:' + f.ts) : null;
  const idPostSub  = s => (s && s.id) ? ('sub:' + s.id) : null;

  /* um evento da atividade pública vira uma linha do feed */
  function atividadeParaFeed(ev){
    const perfil = u => `${BASE}perfil.html?user=${encodeURIComponent(u)}`;
    if(ev.tipo === 'avaliacao'){
      return { nome: ev.quem, ts: ev.ts, url: `${BASE}${ev.ano}/index.html`,
        postId: ev.id, autorReal: ev.quem,
        html: `<b>${esc(ev.quem)}</b> avaliou o <b>Cetec Festival ${ev.ano}</b>` };
    }
    if(ev.tipo === 'badge'){
      return { nome: ev.quem, ts: ev.ts, url: perfil(ev.quem), emojiFeed: '🏅',
        html: `<b>${esc(ev.quem)}</b> desbloqueou a badge <b>${esc(ev.badge)}</b>` };
    }
    if(ev.tipo === 'carimbo'){
      const c = (typeof CARIMBOS !== 'undefined' && CARIMBOS[ev.carimbo]) ? CARIMBOS[ev.carimbo] : { emoji:'🏷️', nome:ev.carimbo };
      return { nome: ev.quem, ts: ev.ts, url: perfil(ev.alvo), emojiFeed: c.emoji,
        html: `<b>${esc(ev.quem)}</b> deu o carimbo <b>${esc(c.nome)}</b> para <b>${esc(ev.alvo)}</b>` };
    }
    if(ev.tipo === 'novo'){
      return { nome: ev.quem, ts: ev.ts, url: perfil(ev.quem), emojiFeed: '👋',
        html: `<b>${esc(ev.quem)}</b> entrou no CETECritic` };
    }
    return null;
  }

  async function montarFeeds(todosSubs, perfilCfg, pub, notifs){
    const lista = Array.isArray(notifs) ? notifs : [];
    /* ---- GERAL ----
       Vitrine da comunidade: o que os OUTROS andaram fazendo. A atividade
       vem do servidor já filtrada (perfil privado fora, anônimo pelo
       pseudônimo), então aqui é só transformar em linha. */
    const geral = [];
    const feedAdmin = (typeof FEED !== 'undefined' && Array.isArray(FEED)) ? FEED : [];
    feedAdmin.forEach(f => geral.push({
      nome: f.autor || 'CETECritic', ts: f.ts, url: f.url || '',
      postId: idPostFeed(f), autorReal: '',   /* post da organização: sem conta por trás */
      html: `<b>${esc(f.autor || 'CETECritic')}</b> ${esc(f.emoji || '')} ${esc(f.texto || '')}`
    }));
    lista.filter(n => NOTIF_FEED_GERAL[n.tipo]).forEach(n => geral.push(notifParaFeed(n)));

    const atividade = await fetchAtividade();
    atividade
      .filter(ev => String(ev.quem || '').trim().toLowerCase() !== alvo)   // o feed é dos outros
      .map(atividadeParaFeed).filter(Boolean)
      .forEach(item => geral.push(item));

    /* se a atividade não vier (rota antiga no ar, rede caindo), o feed ainda
       mostra as avaliações que já temos carregadas em memória */
    if(!atividade.length){
      todosSubs
        .filter(s => { const u = String(s.user || '').trim(); return u && u.toLowerCase() !== alvo; })
        .sort((a,b) => Number(b.ts) - Number(a.ts)).slice(0, 25)
        .forEach(s => geral.push({ nome: s.user, ts: s.ts, url: `${BASE}${s.year}/index.html`,
          postId: idPostSub(s), autorReal: s.user,
          html: `<b>${esc(s.user)}</b> avaliou o <b>Cetec Festival ${s.year}</b>` }));
    }
    geral.sort((a,b) => Number(b.ts || 0) - Number(a.ts || 0));

    /* ---- AMIGOS ---- */
    const amigos = new Set((Array.isArray(perfilCfg.amigos) ? perfilCfg.amigos : []).map(a => String(a).trim().toLowerCase()));
    const amig = [];
    todosSubs
      .filter(s => amigos.has(String(s.user || '').trim().toLowerCase()))
      .forEach(s => amig.push({ nome: s.user, ts: s.ts, url: `${BASE}${s.year}/index.html`,
        postId: idPostSub(s), autorReal: s.user,
        html: `<b>${esc(s.user)}</b> avaliou o <b>Cetec Festival ${s.year}</b>` }));
    (pub.carimbos || []).forEach(c => {
      const cr = (typeof CARIMBOS !== 'undefined' && CARIMBOS[c.tipo]) ? CARIMBOS[c.tipo] : { emoji:'🏷️', nome:c.tipo };
      amig.push({ nome: c.from, ts: c.ts, url: `${BASE}perfil.html?user=${encodeURIComponent(c.from)}`,
        html: `<b>${esc(c.from)}</b> te deu o carimbo ${cr.emoji} <b>${esc(cr.nome)}</b>` });
    });
    /* conquistas pessoais: badge nova, subiu no Hall da Fama, etc.
       `carimbos` já entrou acima pela lista do perfil público — espelhar a
       notificação também duplicaria o mesmo evento no feed. */
    lista.filter(n => NOTIF_FEED_AMIGOS[n.tipo] && n.tipo !== 'carimbos').forEach(n => amig.push(notifParaFeed(n)));
    amig.sort((a,b) => Number(b.ts || 0) - Number(a.ts || 0));

    /* ---- reações -------------------------------------------------------
       Uma requisição só com os ids dos posts que vão aparecer nos dois
       feeds. Se falhar, `_reacoes` fica vazio e os botões nascem zerados —
       o feed nunca deixa de ser desenhado por causa disso. */
    const visiveis = geral.slice(0, 40).concat(amig.slice(0, 40));
    const ids = [...new Set(visiveis.map(i => i.postId).filter(Boolean))];
    const sess = usuarioLogado();
    montarFeeds._reacoes = ids.length ? await fetchReacoes(ids, sess ? sess.user : null) : {};

    const bg = document.getElementById('feedGeral');
    if(bg){
      bg.innerHTML = geral.length ? geral.slice(0, 40).map(feedItemHtml).join('')
        : '<div class="empty-note">Sem novidades por enquanto. Volte depois — o feed enche conforme a comunidade se movimenta.</div>';
      ligarReacoes(bg);
    }
    const ba = document.getElementById('feedAmigos');
    if(ba){
      ba.innerHTML = amig.length ? amig.slice(0, 40).map(feedItemHtml).join('')
        : '<div class="empty-note">Sem atividade de amigos ainda. Adicione amigos pelo 👥 do topo ou pelo perfil deles.</div>';
      ligarReacoes(ba);
    }
  }

  /* botão editar destaques (meu perfil) */
  const btnEditar = document.getElementById('btnEditarShowcase');
  if(btnEditar) btnEditar.addEventListener('click', abrirEditorShowcase);

  /* botão editar edições preferidas (meu perfil) */
  const btnEditarFavs = document.getElementById('btnEditarFavs');
  if(btnEditarFavs) btnEditarFavs.addEventListener('click', abrirEditorFavs);

  /* botão compare (perfil de outra pessoa) */
  const btnCompare = document.getElementById('btnCompare');
  if(btnCompare) btnCompare.addEventListener('click', () => {
    const sec = document.getElementById('compareSection');
    const box = document.getElementById('compareBox');
    const meus = carregar._minhasSubs || [];
    const deles = carregar._alvoSubs || [];
    const af = afinidadeGosto(meus, deles);
    sec.style.display = '';
    if(af.pct === null){
      box.innerHTML = '<div class="empty-note">Vocês ainda não avaliaram nenhuma peça em comum.</div>';
    } else {
      /* concordância / discordância nas peças em comum */
      const mapa = lista => { const m = {}; lista.forEach(s => Object.keys(s.grid).forEach(k => { const v = Number(s.grid[k]); if(!isNaN(v)) m[s.year + '|' + k] = v; })); return m; };
      const A = mapa(meus), B = mapa(deles);
      const comuns = Object.keys(A).filter(k => B[k] !== undefined).map(k => ({ k, a: A[k], b: B[k], dif: Math.abs(A[k] - B[k]) }));
      const iguais = comuns.filter(c => c.dif <= 0.5).length;
      const linha = c => { const [y, key] = c.k.split('|'); return `<div class="record-item"><span class="rec-emoji">${c.dif <= 0.5 ? '🤝' : '⚡'}</span><div><div class="rec-title">${y} · ${key.toUpperCase()}</div><div class="rec-text">você ${c.a.toFixed(1)} · ${esc(alvoUser)} ${c.b.toFixed(1)} (dif ${c.dif.toFixed(1)})</div></div></div>`; };
      const maiores = [...comuns].sort((x,y) => y.dif - x.dif).slice(0, 4);
      box.innerHTML = `<div class="afinidade-wrap">
          <div class="afinidade-num">${af.pct.toFixed(0)}%</div>
          <div class="afinidade-txt">de afinidade de gosto com <b>${esc(alvoUser)}</b><br>${af.shared} peça${af.shared === 1 ? '' : 's'} em comum · vocês deram nota parecida em ${iguais}</div>
        </div>
        <h3 class="subhead">Onde vocês mais divergem</h3>
        <div class="record-list">${maiores.map(linha).join('')}</div>`;
    }
    sec.scrollIntoView({ behavior:'smooth', block:'nearest' });
  });

  /* abas de reviews */
  const tabF = document.getElementById('tabFest'), tabR = document.getElementById('tabRec');
  if(tabF && tabR){
    tabF.addEventListener('click', () => { tabF.classList.add('active'); tabR.classList.remove('active'); document.getElementById('revPorFestival').style.display = ''; document.getElementById('revRecentes').style.display = 'none'; });
    tabR.addEventListener('click', () => { tabR.classList.add('active'); tabF.classList.remove('active'); document.getElementById('revRecentes').style.display = ''; document.getElementById('revPorFestival').style.display = 'none'; });
  }

  /* abas do perfil (Atividade / Social / Badges) — Plano de Ação, Seção 7 */
  function trocarAba(nome){
    document.querySelectorAll('.perfil-tab').forEach(x => x.classList.toggle('active', x.dataset.aba === nome));
    document.querySelectorAll('.perfil-aba').forEach(p => p.style.display = (p.id === nome) ? '' : 'none');
  }
  document.querySelectorAll('.perfil-tab').forEach(t => t.addEventListener('click', () => trocarAba(t.dataset.aba)));

  /* sub-divisão da aba Social: Amigos (rede pessoal) x Geral (comunidade) */
  function trocarSubSocial(nome){
    document.querySelectorAll('.social-sub .rev-tab').forEach(x => x.classList.toggle('active', x.dataset.sub === nome));
    document.querySelectorAll('.social-sub-pane').forEach(p => p.style.display = (p.id === nome) ? '' : 'none');
  }
  document.querySelectorAll('.social-sub .rev-tab').forEach(t => t.addEventListener('click', () => trocarSubSocial(t.dataset.sub)));

  /* chip "amigos" do cabeçalho → abre/fecha o painel de amigos */
  const chipAmigos = document.getElementById('chipAmigos');
  if(chipAmigos) chipAmigos.addEventListener('click', () => {
    const p = document.getElementById('amigosPanel');
    if(p) p.style.display = (!p.style.display || p.style.display === 'none') ? 'block' : 'none';
  });
  /* visibilidade por tipo de perfil: feed Social só no MEU; carimbos só em OUTROS */
  if(ehMeu){
    const cs = document.getElementById('carimbosSection'); if(cs) cs.style.display = 'none';
  } else {
    const tb = document.getElementById('tabSocialBtn'); if(tb) tb.style.display = 'none';
    const ab = document.getElementById('abaSocial'); if(ab) ab.style.display = 'none';
    const cs = document.getElementById('carimbosSection'); if(cs) cs.style.display = '';
  }

  /* ---------------------------------------------------------------------
     Carga ÚNICA — o `setInterval(carregar, 30000)` que existia aqui foi
     removido de propósito.

     Ele redesenhava o perfil inteiro a cada 30s e, junto, jogava fora o que
     a pessoa estava fazendo: a aba aberta voltava pra "Atividade", a
     avaliação expandida fechava, a lista "ver todas as badges" recolhia, o
     menu de reação fechava e a página pulava de scroll no meio de uma
     leitura. E cobrava caro: uma requisição POR EDIÇÃO a cada 30 segundos,
     em toda aba aberta, pra dados que quase não mudam.

     No lugar, atualizamos só quando a pessoa VOLTA pra aba depois de um
     tempo fora — e mesmo assim só se ela não estiver no meio de nada. */
  carregar();

  const INTERVALO_REVALIDACAO = 5 * 60 * 1000;   // 5 min fora da aba
  let ultimaCarga = Date.now();
  let recarregando = false;

  /* "está mexendo em algo?" — se estiver, a atualização espera a próxima
     oportunidade em vez de puxar o tapete */
  function estaOcupado(){
    const a = document.activeElement;
    if(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
    if(document.querySelector('.share-overlay, .modal-overlay.open, .cropper-container')) return true;
    if(window.getSelection && String(window.getSelection()).trim().length > 0) return true;
    return false;
  }

  document.addEventListener('visibilitychange', async () => {
    if(document.hidden || recarregando) return;
    if(Date.now() - ultimaCarga < INTERVALO_REVALIDACAO) return;
    if(estaOcupado()) return;
    recarregando = true;
    try{ await carregar(); ultimaCarga = Date.now(); }
    catch(e){ /* rede caiu: fica com o que já está na tela */ }
    finally{ recarregando = false; }
  });
}

/* =====================================================================
   PÁGINA: BUSCAR (busca.html) — peças, festivais e usuários com filtros
   ===================================================================== */
async function paginaBusca(){
  document.title = 'CETECritic - Buscar';
  montarShell(`
    <div class="noite-intro">
      <h1>🔎 Buscar</h1>
      <p>Ache peças, festivais e usuários do acervo. Filtre por nota, ano, noite e turma.</p>
    </div>
    <div class="busca-barra"><input type="text" id="buscaQ" placeholder="Peça, tema, turma, festival ou usuário…" autocomplete="off"></div>
    <div class="busca-filtros">
      <label>Nota mínima <select class="hall-select" id="fNota"></select></label>
      <label>Ano <select class="hall-select" id="fAno"></select></label>
      <label>Noite <select class="hall-select" id="fNoite"></select></label>
      <label>Turma <select class="hall-select" id="fTurma"></select></label>
    </div>
    <div id="buscaResultados"><div class="empty-note">Carregando o acervo…</div></div>`);

  const reais = EDICOES.filter(e => !e.emBreve);

  /* carrega as peças/festivais de todas as edições (edicao.js + noites/*.js) */
  const pecas = [], festivais = [];
  /* em paralelo e pelo cache compartilhado: este laço era serial — com 15
     edições, a busca só terminava de montar depois de 15 idas e voltas
     encadeadas, e ainda rebaixava tudo o que o Hall já tinha buscado */
  const carregadas = await Promise.all(reais.map(cfg => carregarDadosEdicao(cfg)));
  carregadas.forEach(d => {
    if(!d) return;                        // edição sem arquivos ainda: fica de fora
    const cfg = d.cfg, ed = d.ed || {};
    /* ed.poster hoje costuma ser URL absoluta do bucket — concatenar com a
       pasta do ano geraria "/2026/https://..." */
    const poster = posterDaEdicao(cfg.ano, ed.poster);
    const tema = (ed.sobre && ed.sobre.titulo) || '';   // a "mostra"/tema da edição
    /* texto pesquisável do festival: nome + tema + descrição + texto do sobre */
    const buscaFest = [ed.titulo, tema, ed.descricao, ed.sobre && ed.sobre.texto].filter(Boolean).join(' ').toLowerCase();
    festivais.push({ ano: cfg.ano, titulo: ed.titulo || `Cetec Festival ${cfg.ano}`, tema, poster, url: `${BASE}${cfg.ano}/index.html`, busca: buscaFest });
    for(let n = 1; n <= cfg.noites; n++){
      const nd = d.noites && d.noites[n];
      if(nd && Array.isArray(nd.pecas)) nd.pecas.forEach((p, i) => {
        const sinopse = p.sinopse || '';
        /* texto pesquisável da peça: título + turma + sinopse (o "tema" da peça) */
        const buscaPeca = [p.titulo, p.turma, sinopse].filter(Boolean).join(' ').toLowerCase();
        pecas.push({ ano: cfg.ano, noite: n, key: `s${n}e${i+1}`, titulo: p.titulo || '', turma: p.turma || '', sinopse, poster, url: `${BASE}${cfg.ano}/noite-${n}.html#s${n}e${i+1}`, busca: buscaPeca });
      });
    }
  });

  /* votos → média por peça, média por festival, e lista de usuários */
  const votosPorAno = await Promise.all(reais.map(async e => {
    try{ const r = await fetch(API_URL + '?year=' + e.ano + '&_=' + Date.now(), { cache:'no-store' }); const j = await r.json(); return { ano: e.ano, subs: filtrarVotosDoAno(Array.isArray(j) ? j : (j.submissions || []), e.ano) }; }
    catch(x){ return { ano: e.ano, subs: [] }; }
  }));
  const avgKey = {}, avgFest = {}, usersMap = {};
  votosPorAno.forEach(o => {
    const accKey = {}, accFest = [];
    o.subs.forEach(s => {
      const u = String(s.user || '').trim();
      if(u && !usersMap[u.toLowerCase()]) usersMap[u.toLowerCase()] = { nome: u, eps: 0 };
      Object.keys(s.grid).forEach(k => {
        const v = Number(s.grid[k]); if(isNaN(v)) return;
        (accKey[k] = accKey[k] || []).push(v); accFest.push(v);
        if(u) usersMap[u.toLowerCase()].eps++;
      });
    });
    Object.keys(accKey).forEach(k => avgKey[o.ano + '|' + k] = { avg: media(accKey[k]), n: accKey[k].length });
    avgFest[o.ano] = media(accFest);
  });
  pecas.forEach(p => { const a = avgKey[p.ano + '|' + p.key]; p.avg = a ? a.avg : null; p.nAval = a ? a.n : 0; });
  festivais.forEach(f => { f.avg = (avgFest[f.ano] !== undefined) ? avgFest[f.ano] : null; });
  /* lista de usuários: agora vem do endpoint que traz TODOS os cadastrados
     (mesmo quem nunca votou), já com anônimo/privado aplicados. Se o endpoint
     ainda não existir (antes do redeploy), cai no comportamento antigo. */
  const nomesOficiais = await fetchUsuarios();
  const usuarios = nomesOficiais.length
    ? nomesOficiais.map(nome => ({ nome, eps: (usersMap[nome.toLowerCase()] ? usersMap[nome.toLowerCase()].eps : 0) }))
    : Object.values(usersMap);
  const turmas = [...new Set(pecas.map(p => p.turma).filter(Boolean))].sort();
  const maxNoites = Math.max(...reais.map(e => e.noites), 1);

  const selNota = document.getElementById('fNota'); selNota.innerHTML = `<option value="">qualquer</option>` + [9,8,7,6,5].map(n => `<option value="${n}">${n}+</option>`).join('');
  const selAno = document.getElementById('fAno'); selAno.innerHTML = `<option value="">todos</option>` + reais.map(e => `<option value="${e.ano}">${e.ano}</option>`).join('');
  const selNoite = document.getElementById('fNoite'); selNoite.innerHTML = `<option value="">todas</option>` + Array.from({ length: maxNoites }, (_, i) => `<option value="${i+1}">Noite ${i+1}</option>`).join('');
  const selTurma = document.getElementById('fTurma'); selTurma.innerHTML = `<option value="">todas</option>` + turmas.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');

  const notaBadge = v => (v === null || v === undefined) ? '' : `<span class="busca-nota" style="background:${corDaNota(v)}">${v.toFixed(1)}</span>`;
  const itemCard = (poster, titulo, meta, url, avg) => `<a class="busca-item" href="${url}">
    <div class="busca-poster" style="background-image:url('${esc(poster)}')"></div>
    <div class="busca-info"><div class="busca-titulo">${esc(titulo)} ${notaBadge(avg)}</div><div class="busca-meta">${esc(meta)}</div></div>
  </a>`;

  function render(){
    const q = document.getElementById('buscaQ').value.trim().toLowerCase();
    const notaMin = Number(selNota.value) || 0;
    const ano = selAno.value, noite = selNoite.value, turma = selTurma.value;

    const uMatch = q ? usuarios.filter(u => u.nome.toLowerCase().includes(q)).sort((a,b) => b.eps - a.eps).slice(0, 30) : [];
    const pMatch = pecas.filter(p => {
      if(ano && String(p.ano) !== ano) return false;
      if(noite && String(p.noite) !== noite) return false;
      if(turma && p.turma !== turma) return false;
      if(notaMin && !(p.avg !== null && p.avg >= notaMin)) return false;
      if(q && !p.busca.includes(q)) return false;
      return true;
    }).sort((a,b) => (b.avg || 0) - (a.avg || 0));
    const fMatch = (noite || turma) ? [] : festivais.filter(f => {
      if(ano && String(f.ano) !== ano) return false;
      if(notaMin && !(f.avg !== null && f.avg >= notaMin)) return false;
      if(q && !(f.busca.includes(q) || String(f.ano).includes(q))) return false;
      return true;
    }).sort((a,b) => b.ano - a.ano);

    let html = '';
    if(uMatch.length) html += `<div class="section"><h2>👤 Usuários <span class="badge-count">${uMatch.length}</span></h2>
      <div class="busca-users">${uMatch.map(u => `<a class="busca-user" href="${BASE}perfil.html?user=${encodeURIComponent(u.nome)}"><span class="busca-ava">${esc(u.nome.slice(0,1).toUpperCase())}</span><span class="busca-user-nome">${esc(u.nome)}</span><span class="busca-user-sub">${u.eps} nota${u.eps === 1 ? '' : 's'}</span></a>`).join('')}</div></div>`;
    if(fMatch.length) html += `<div class="section"><h2>🎪 Festivais <span class="badge-count">${fMatch.length}</span></h2>
      <div class="busca-grid">${fMatch.map(f => itemCard(f.poster, f.titulo, f.tema ? `${f.tema} · ${f.ano}` : `Edição de ${f.ano}`, f.url, f.avg)).join('')}</div></div>`;
    if(pMatch.length) html += `<div class="section"><h2>🎭 Peças <span class="badge-count">${pMatch.length}</span></h2>
      <div class="busca-grid">${pMatch.slice(0, 150).map(p => itemCard(p.poster, p.titulo, `Turma ${p.turma} · ${p.ano} · Noite ${p.noite}${p.nAval ? ` · ${p.nAval} aval.` : ''}`, p.url, p.avg)).join('')}</div>
      ${pMatch.length > 150 ? '<div class="empty-note">Mostrando as 150 primeiras — refine os filtros.</div>' : ''}</div>`;
    if(!html) html = '<div class="empty-note">Nada encontrado com esses filtros. Tente afrouxar a busca.</div>';
    document.getElementById('buscaResultados').innerHTML = html;
  }

  document.getElementById('buscaQ').addEventListener('input', render);
  [selNota, selAno, selNoite, selTurma].forEach(s => s.addEventListener('change', render));
  render();
}

/* =====================================================================
   PÁGINA: NOTIFICAÇÕES (notificacoes.html)
   =====================================================================
   Central de notificações: toda vez que um push é enviado pro usuário, o
   backend também guarda um registro aqui — assim quem não viu o push (ou
   desativou nas Configurações) ainda consegue ver depois no site. */
function formatarDataNotif(iso){
  try{
    const d = new Date(iso);
    if(isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) + ' às ' +
      d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  }catch(e){ return ''; }
}

async function paginaNotificacoes(){
  document.title = 'Notificações — CETECritic';
  const sess = usuarioLogado();

  if(!sess){
    montarShell(`
      <div class="perfil-head"><h1>🔔 Notificações</h1></div>
      <div class="noite-card" style="text-align:center;">
        <div class="perfil-vazio">Entre na sua conta para ver suas notificações.</div>
        <button class="btn btn-solid" id="notifEntrar">Entrar / Criar conta</button>
      </div>`);
    const b = document.getElementById('notifEntrar');
    if(b) b.addEventListener('click', () => { const e = document.getElementById('btnEntrar'); if(e) e.click(); });
    return;
  }

  /* cabeçalho próprio em vez de reaproveitar .perfil-head/.perfil-actions:
     aquela classe é declarada duas vezes no CSS e a segunda declaração vem
     depois do media query de celular, atropelando parte dele — o botão
     "Limpar" acabava fora da vista no telefone */
  montarShell(`
    <div class="notif-topo">
      <h1>🔔 Notificações</h1>
      <button class="btn btn-ghost" id="notifMarcarTodas" style="display:none;" title="Zera a bolinha do sino sem apagar o histórico">🧹 Limpar</button>
    </div>
    <div id="notifBox"><div class="empty-note">Carregando…</div></div>`);

  const box = document.getElementById('notifBox');
  const btnTodas = document.getElementById('notifMarcarTodas');
  let notifs = [];

  function render(){
    const naoLidas = notifs.filter(n => !n.lida).length;
    btnTodas.style.display = naoLidas > 0 ? '' : 'none';

    if(!notifs.length){
      box.innerHTML = '<div class="empty-note">Nenhuma notificação por enquanto. Quando algo importante rolar — uma noite abrir, resultados saírem etc — aparece aqui, além do push (se estiver ativado nas Configurações).</div>';
      return;
    }
    const ordenadas = notifs.slice().sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    box.innerHTML = ordenadas.map(n => `
      <a class="notif-item${n.lida ? '' : ' notif-nao-lida'}" href="${n.url ? esc(n.url) : '#'}" data-id="${esc(String(n.id))}">
        <span class="notif-dot"></span>
        <span class="notif-item-body">
          <span class="notif-item-title">${esc(n.titulo || '')}</span>
          ${n.corpo ? `<span class="notif-item-corpo">${esc(n.corpo)}</span>` : ''}
          <span class="notif-item-data">${formatarDataNotif(n.criadoEm)}</span>
        </span>
      </a>`).join('');
  }

  box.addEventListener('click', async ev => {
    const item = ev.target.closest('.notif-item');
    if(!item) return;
    const id = item.dataset.id;
    const n = notifs.find(x => String(x.id) === id);
    if(!n || !n.url) ev.preventDefault();
    if(n && !n.lida){
      const r = await apiMarcarNotifLidas([id]);   // grava no servidor ANTES de mudar a UI
      if(r && r.ok){
        n.lida = true;
        item.classList.remove('notif-nao-lida');
        btnTodas.style.display = notifs.some(x => !x.lida) ? '' : 'none';
        atualizarBadgeNotificacoes();
      }
    }
  });

  btnTodas.addEventListener('click', async () => {
    if(!notifs.some(n => !n.lida)) return;
    const r = await apiMarcarNotifLidas();          // sem ids = servidor marca TODAS as não lidas
    if(!r || !r.ok){ alert('Não deu pra limpar: ' + ((r && r.erro) || (r && r.error) || 'erro de conexão')); return; }
    if(!r.marcadas){ alert('Diagnóstico: o servidor não marcou nada.\nachadas=' + r.achadas + ' · marcadas=' + r.marcadas + '\nMe manda esses dois números.'); }
    notifs.forEach(n => n.lida = true);
    render();
    atualizarBadgeNotificacoes();
  });

  const r = await apiListarNotificacoes();
  notifs = (r && r.ok && Array.isArray(r.notificacoes)) ? r.notificacoes : [];
  render();
  atualizarBadgeNotificacoes();
}

/* =====================================================================
   PÁGINA: CONFIGURAÇÕES (configuracoes.html)
   =====================================================================
   Preferências ficam no JSON 'perfil' (mesma ação já existente) — então
   SALVAR já funciona hoje. O EFEITO no servidor (anonimizar nomes nos feeds,
   sumir da busca, enviar e-mail/push) chega com a Fase 2 / F1 / F2. O tema é
   local (por aparelho). */
function switchHtml(id, on){
  return `<label class="cfg-switch"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="track"></span><span class="thumb"></span></label>`;
}
function wireSwitch(id, cb){
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', () => cb(el.checked));
}

async function paginaConfig(){
  document.title = 'Configurações — CETECritic';
  const sess = usuarioLogado();
  const podeInstalar = !(typeof window.pwaEstaInstalado === 'function' && window.pwaEstaInstalado());

  montarShell(`
    <div class="perfil-head"><h1>⚙️ Configurações</h1></div>
    <div class="cfg-group">
      <h2>Aparência</h2>
      <div class="cfg-group-sub">Vale só neste aparelho.</div>
      ${podeInstalar ? htmlBannerInstalar('cfgInstallBanner', false) : ''}
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Tema</div><div class="cfg-desc">Automático segue o tema do seu sistema.</div></div>
        <div class="cfg-ctrl"><div class="cfg-seg" id="segTema">
          <button data-t="auto">Automático</button>
          <button data-t="claro">Claro</button>
          <button data-t="escuro">Escuro</button>
        </div></div>
      </div>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Banner para adicionar à tela inicial</div>
          <div class="cfg-desc">Mostra um aviso na página inicial sugerindo instalar o CetecFestival na tela inicial do aparelho.</div></div>
        <div class="cfg-ctrl">${switchHtml('cfgBannerHome', bannerHomeAtivo())}</div>
      </div>
    </div>
    <div id="cfgLogado"></div>`);

  if(podeInstalar) wireBannerInstalar('cfgInstallBanner', false);

  /* segmento de tema (funciona logado ou não) */
  const seg = document.getElementById('segTema');
  function marcarTema(){ seg.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.t === temaPref())); }
  marcarTema();
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    localStorage.setItem(TEMA_KEY, b.dataset.t); aplicarTema(b.dataset.t); marcarTema();
  }));

  /* toggle do banner de instalação da home — preferência local, efeito imediato */
  const swBannerHome = document.getElementById('cfgBannerHome');
  if(swBannerHome) swBannerHome.addEventListener('change', () => setBannerHomeAtivo(swBannerHome.checked));

  const box = document.getElementById('cfgLogado');
  if(!sess){
    box.innerHTML = `<div class="noite-card" style="text-align:center;">
      <div class="perfil-vazio">Entre na sua conta para configurar e-mail de recuperação, privacidade e notificações.</div>
      <button class="btn btn-solid" id="cfgEntrar">Entrar / Criar conta</button></div>`;
    const b = document.getElementById('cfgEntrar');
    if(b) b.addEventListener('click', () => { const e = document.getElementById('btnEntrar'); if(e) e.click(); });
    return;
  }

  box.innerHTML = '<div class="empty-note">Carregando suas configurações…</div>';
  const meu = await apiMeuPerfil();
  let cfg = (meu && meu.ok && meu.perfil && typeof meu.perfil === 'object') ? meu.perfil : {};
  const notif = (cfg.notif && typeof cfg.notif === 'object') ? cfg.notif : {};
  salvarPrefsNotifCache(sess.user, notif);   // cache local p/ a detecção de eventos no navegador

  /* tipos que a pessoa liga/desliga individualmente (tudo ligado por padrão) */
  const TIPOS_NOTIF = [
    ['badges',   '🏅 Badges novas',        'Quando você desbloqueia uma nova conquista.'],
    ['amigos',   '🤝 Amigos',              'Quando alguém adiciona você como amigo.'],
    ['visitas',  '👀 Visitas ao perfil',   'Quando alguém visita o seu perfil.'],
    ['carimbos', '📮 Carimbos',            'Quando você recebe um carimbo de outra pessoa.'],
    ['bolao',    '🔮 Resultado do bolão',  'Quando sai o resultado do bolão de uma edição.'],
    ['hall',     '🏆 Hall da Fama',        'Quando você entra ou muda de posição no ranking de reputação.'],
    ['noites',   '🎭 Noites novas',        'Quando uma noite do festival é liberada.'],
    ['votacoes', '🗳️ Abertura de votações','Quando a votação de uma edição abre.'],
    ['edicoes',  '🎬 Novas edições',       'Quando uma edição nova entra no ar.']
  ];

  box.innerHTML = `
    <div class="cfg-group">
      <h2>Conta</h2>
      <div class="cfg-group-sub">Logado como <b>${esc(sess.user)}</b>.</div>
      <div class="cfg-row" style="display:block;">
        <div class="cfg-info"><div class="cfg-label">E-mail de recuperação (opcional)</div>
          <div class="cfg-desc">Use o e-mail que você quiser. Serve só para redefinir a senha.</div></div>
        <div class="cfg-email-row">
          <input type="email" id="cfgEmail" placeholder="seu@email.com" maxlength="120" value="${esc(cfg.email || '')}">
          <button class="btn btn-solid" id="cfgEmailSalvar">Salvar e-mail</button>
        </div>
        <div class="cfg-disclaimer">⚠️ Sem e-mail cadastrado, <b>não há como recuperar a senha se você esquecê-la</b> — a conta fica inacessível. Cadastrar é opcional, mas recomendado.</div>
        <div class="cfg-msg" id="cfgEmailMsg"></div>
      </div>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Modo anônimo</div>
          <div class="cfg-desc">Esconde seu nome nas listas públicas (ranking, busca, carimbos…). Seus votos continuam contando.</div></div>
        <div class="cfg-ctrl">${switchHtml('cfgAnonimo', !!cfg.anonimo)}</div>
      </div>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Perfil privado</div>
          <div class="cfg-desc">Tira você da busca e do "adicionar amigo" — e fecha seu perfil: quem abrir o link direto vê só o seu nome, sem avaliações, carimbos, badges ou visitas.</div></div>
        <div class="cfg-ctrl">${switchHtml('cfgPrivado', !!cfg.privado)}</div>
      </div>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">🔒 Verificação em duas etapas (2FA)</div>
          <div class="cfg-desc">Ao entrar, além da senha pedimos um código enviado pro seu e-mail. Precisa ter um e-mail cadastrado acima.</div></div>
        <div class="cfg-ctrl">${switchHtml('cfg2fa', !!cfg.twofa)}</div>
      </div>
      <div class="cfg-msg" id="cfgContaMsg"></div>
    </div>

    <div class="cfg-group">
      <h2>Notificações</h2>
      <div class="cfg-group-sub">Avisos no aparelho quando algo importante rolar. </div>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Notificações push <span style="color:var(--text-muted);font-weight:400;">(só neste aparelho)</span></div>
          <div class="cfg-desc">Vale <b>só para este dispositivo</b> — dá pra ligar no celular e deixar desligado no PC. No iPhone, só depois de instalar o app na tela inicial. Tudo fica guardado na sua <a href="${BASE}notificacoes.html" style="color:var(--gold);">central de notificações 🔔</a> de qualquer jeito.</div></div>
        <div class="cfg-ctrl">${switchHtml('cfgPush', pushLocalLigado())}</div>
      </div>
      <div class="cfg-group-sub" style="margin-top:14px;">Escolha o que você quer receber (vale para a central 🔔 e para o push):</div>
      ${TIPOS_NOTIF.map(([t, lab, desc]) => `
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">${lab}</div><div class="cfg-desc">${desc}</div></div>
        <div class="cfg-ctrl">${switchHtml('cfgNotif_' + t, notif[t] !== false)}</div>
      </div>`).join('')}
      <div class="cfg-msg" id="cfgNotifMsg"></div>
    </div>

    <div class="cfg-group">
      <h2>Sessão</h2>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Sair da conta</div>
          <div class="cfg-desc">Encerra a sessão neste aparelho. Seus dados continuam salvos — é só entrar de novo depois.</div></div>
        <div class="cfg-ctrl"><button class="btn btn-ghost" id="cfgSair">Sair</button></div>
      </div>
      <div class="cfg-row" style="display:block;">
        <div class="cfg-info"><div class="cfg-label">📱 Aparelhos conectados</div>
          <div class="cfg-desc">Onde sua conta está logada agora. Você pode desconectar qualquer um.</div></div>
        <div id="cfgSessoes" style="margin-top:10px;"><div class="empty-note">Carregando…</div></div>
      </div>
    </div>

    <div class="cfg-group cfg-danger">
      <h2>Zona de perigo</h2>
      <div class="cfg-group-sub">Ação permanente.</div>
      <div class="cfg-row">
        <div class="cfg-info"><div class="cfg-label">Excluir minha conta</div>
          <div class="cfg-desc">Apaga seu perfil, carimbos, visitas, reputação e palpites. Suas notas <b>viram anônimas</b> (as médias das peças continuam). </div></div>
        <div class="cfg-ctrl"><button class="btn-danger" id="cfgExcluir">Excluir conta</button></div>
      </div>
      <div class="cfg-msg" id="cfgExcluirMsg"></div>
    </div>`;

  async function salvarMerge(patch, msgEl){
    const novo = Object.assign({}, cfg, patch);
    if(msgEl) msgEl.textContent = 'Salvando…';
    const r = await apiSalvarPerfil(novo);
    if(r && r.ok){ cfg = novo; if(msgEl) msgEl.textContent = 'Salvo ✓'; }
    else if(msgEl) msgEl.textContent = (r && r.error) ? r.error : 'Não foi possível salvar.';
    return r;
  }

  document.getElementById('cfgEmailSalvar').addEventListener('click', async () => {
    const email = document.getElementById('cfgEmail').value.trim();
    const msg = document.getElementById('cfgEmailMsg');
    if(email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ msg.textContent = 'E-mail inválido.'; return; }
    await salvarMerge({ email }, msg);
  });

  wireSwitch('cfgAnonimo', v => {
    const patch = { anonimo: v };
    /* pseudônimo fixo, gerado uma vez e guardado (fica "Anônimo ####") */
    if(v && !cfg.pseudo) patch.pseudo = 'Anônimo ' + (1000 + Math.floor(Math.random() * 9000));
    return salvarMerge(patch, document.getElementById('cfgContaMsg'));
  });
  wireSwitch('cfgPrivado', v => salvarMerge({ privado: v }, document.getElementById('cfgContaMsg')));
  wireSwitch('cfg2fa', v => {
    const msg = document.getElementById('cfgContaMsg');
    if(v && !String(cfg.email || '').trim()){
      msg.textContent = 'Cadastre um e-mail acima antes de ativar o 2FA.';
      const el = document.getElementById('cfg2fa'); if(el) el.checked = false;
      return;
    }
    return salvarMerge({ twofa: v }, msg);
  });

  function salvarNotif(patch){
    const novoNotif = Object.assign({}, (cfg.notif || {}), patch);
    salvarPrefsNotifCache(sess.user, novoNotif);   // mantém o cache local em dia
    return salvarMerge({ notif: novoNotif }, document.getElementById('cfgNotifMsg'));
  }
  /* liga os interruptores de cada tipo de notificação */
  TIPOS_NOTIF.forEach(([t]) => wireSwitch('cfgNotif_' + t, v => salvarNotif({ [t]: v })));
  /* push é POR APARELHO: liga/desliga só neste dispositivo (flag local), sem
     mexer na conta. Assim dá pra ter ligado no celular e desligado no PC. */
  wireSwitch('cfgPush', async v => {
    const msg = document.getElementById('cfgNotifMsg');
    const el = document.getElementById('cfgPush');
    if(v){
      msg.textContent = 'Ativando neste aparelho…';
      const r = await ativarPush();
      if(!r.ok){
        if(el) el.checked = false; setPushLocal(false);
        const motivo = r.error || 'não foi possível ativar';
        msg.textContent = motivo; alert('Push não ativou:\n\n' + motivo);
        return;
      }
      setPushLocal(true);
      msg.textContent = 'Push ligado neste aparelho ✓';
    } else {
      await desativarPush();
      setPushLocal(false);
      msg.textContent = 'Push desligado neste aparelho ✓';
    }
  });
  /* 1ª vez neste aparelho e o navegador já bloqueou: reflete desligado */
  if(localStorage.getItem('cetec-push-on') === null && typeof Notification !== 'undefined' && Notification.permission === 'denied'){
    const elPush = document.getElementById('cfgPush');
    if(elPush) elPush.checked = false; setPushLocal(false);
  }

  document.getElementById('cfgSair').addEventListener('click', async () => {
    if(!confirm('Sair da sua conta neste aparelho?')) return;
    try{ await apiLogout(); }catch(e){}
    sairSessao();
    location.href = BASE + 'index.html';
  });

  /* lista de aparelhos conectados (sessões) */
  (async () => {
    const box = document.getElementById('cfgSessoes'); if(!box) return;
    const r = await apiListarSessoes();
    const ss = (r && r.sessoes) || [];
    if(!ss.length){ box.innerHTML = '<div class="empty-note">Não foi possível listar (ou só há a sessão antiga). Entre de novo pra registrar este aparelho.</div>'; return; }
    box.innerHTML = ss.map(s => `<div class="sessao-item" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">
      <div><b>${esc(s.dispositivo)}</b>${s.atual ? ' <span style="color:var(--gold);font-size:11px;font-weight:700;">• este aparelho</span>' : ''}
        <div style="font-size:11px;color:var(--text-muted);">entrou ${formatarDataNotif(s.criadoEm)}</div></div>
      ${s.atual ? '' : `<button class="btn btn-ghost" data-sid="${s.id}" style="flex:0 0 auto;">Desconectar</button>`}
    </div>`).join('');
    box.querySelectorAll('[data-sid]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = '…';
      await apiRevogarSessao(Number(b.dataset.sid));
      const it = b.closest('.sessao-item'); if(it) it.remove();
    }));
  })();

  document.getElementById('cfgExcluir').addEventListener('click', async () => {
    const msg = document.getElementById('cfgExcluirMsg');
    if(!confirm('Tem certeza que quer EXCLUIR sua conta? Isso é permanente.')) return;
    const nome = prompt('Para confirmar, digite seu NOME DE USUÁRIO (não a senha):\n\n' + sess.user);
    if(!nome || nome.trim().toLowerCase() !== sess.user.toLowerCase()){
      msg.textContent = 'Nome não confere — cancelado.';
      alert('O que pedimos aqui é o seu NOME DE USUÁRIO (' + sess.user + '), não a senha. Nada foi excluído.');
      return;
    }
    msg.textContent = 'Excluindo…';
    const r = await apiPost({ action:'deletarConta', user:sess.user, token:sess.token });
    if(r && r.ok){ sairSessao(); alert('Conta excluída.'); location.href = BASE + 'index.html'; }
    else {
      /* nunca mais deslogar sem ter certeza que apagou: mostra o motivo real */
      const motivo = (r && r.error) ? r.error : 'não foi possível excluir';
      const det = (r && Array.isArray(r.detalhes) && r.detalhes.length) ? '\n\n' + r.detalhes.join('\n') : '';
      msg.textContent = motivo;
      alert('A conta NÃO foi excluída.\n\n' + motivo + det);
    }
  });
}

/* =====================================================================
   PÁGINA: REDEFINIR SENHA (redefinir-senha.html) — chegada pelo link do e-mail
   ===================================================================== */
function paginaRedefinir(){
  document.title = 'Redefinir senha — CETECritic';
  const params = new URLSearchParams(location.search);
  const user = params.get('user') || '';
  const token = params.get('token') || '';
  montarShell(`
    <div class="perfil-head"><h1>🔑 Redefinir senha</h1></div>
    <div class="cfg-group" style="max-width:460px;">
      ${(!user || !token) ? '<div class="empty-note">Link inválido ou incompleto. Peça um novo pela tela de login (“Esqueci a senha”).</div>' : `
      <div class="cfg-group-sub">Conta: <b>${esc(user)}</b></div>
      <div class="login-form">
        <label for="rsSenha">Nova senha</label>
        <input type="password" id="rsSenha" maxlength="60" placeholder="mínimo 8 caracteres">
        <label for="rsSenha2">Repita a nova senha</label>
        <input type="password" id="rsSenha2" maxlength="60" placeholder="digite de novo">
        <div class="login-erro" id="rsErro"></div>
        <button class="submit-btn" id="rsSubmit">Salvar nova senha</button>
      </div>`}
    </div>`);
  if(!user || !token) return;
  const bt = document.getElementById('rsSubmit');
  async function enviar(){
    const s1 = document.getElementById('rsSenha').value, s2 = document.getElementById('rsSenha2').value;
    const erro = document.getElementById('rsErro');
    if(s1.length < 8){ erro.textContent = 'A senha precisa de pelo menos 8 caracteres.'; return; }
    if(s1 !== s2){ erro.textContent = 'As senhas não conferem.'; return; }
    bt.disabled = true; bt.innerHTML = '<span class="spinner"></span>Salvando...';
    erro.textContent = '';
    try{
      const r = await apiRedefinirSenha(user, token, s1);
      if(r && r.ok){ salvarSessao(r.user, r.token); alert('Senha alterada! Você já está logado.'); location.href = BASE + 'perfil.html'; return; }
      erro.textContent = (r && r.error) ? r.error : 'Não foi possível redefinir.';
    }catch(e){ erro.textContent = 'Falha de conexão. Tente de novo.'; }
    bt.disabled = false; bt.textContent = 'Salvar nova senha';
  }
  bt.addEventListener('click', enviar);
  document.getElementById('rsSenha2').addEventListener('keydown', ev => { if(ev.key === 'Enter') enviar(); });
}

/* volta do redirect do Google? troca o token do Supabase pelo nosso.
   Nao bloqueia a renderizacao: em pagina normal sai na primeira linha. */
checarRetornoOAuth();

/* =====================================================================
   MODERAÇÃO DA CONTA — roda em TODA página, logo depois do OAuth
   =====================================================================
   Três estados vindos do servidor (apiMeuPerfil → moderacao):

     precisaTrocarNome  o admin escondeu o nome (inapropriado). Abre uma tela
                        BLOQUEANTE: a pessoa só volta a usar o site depois de
                        escolher outro nome. O nome antigo já sumiu de todas
                        as telas públicas porque o servidor devolve o
                        pseudônimo no lugar dele.
     banido             a sessão não deveria nem existir (o servidor derruba
                        as sessões ao suspender), mas se sobrou alguma aba
                        aberta, limpamos aqui e explicamos o motivo.
     silenciado         pode navegar e ler; só não interage. Avisa uma vez.

   Só faz a chamada se existe sessão — visitante anônimo não paga esse custo. */
async function checarModeracaoConta(){
  const s = usuarioLogado();
  if(!s) return;
  let r = null;
  try{ r = await apiMeuPerfil(); }catch(e){ return; }
  if(!r || !r.ok || !r.moderacao) return;
  const m = r.moderacao;

  if(m.banido){
    sairSessao();
    mostrarAvisoConta('🚫 Conta suspensa',
      (m.banidoMotivo ? m.banidoMotivo + '<br><br>' : '') +
      (m.banidoAte ? 'A suspensão vale até <b>' + new Date(Number(m.banidoAte)).toLocaleString('pt-BR') + '</b>.'
                   : 'Esta suspensão não tem prazo definido.') +
      '<br><br>Se você acha que foi um engano, fale com a organização por <b>' +
      esc(typeof EMAIL_CONTATO !== 'undefined' ? EMAIL_CONTATO : 'cetecritic@gmail.com') + '</b>.',
      null);
    return;
  }
  if(m.precisaTrocarNome){ abrirTrocaNomeObrigatoria(m); return; }
  if(m.silenciado){
    /* uma vez por período de silêncio por aparelho — repetir a cada página
       seria punição em cima de punição */
    const chave = 'cetec-silencio-' + s.user + '-' + m.silenciadoAte;
    try{
      if(!localStorage.getItem(chave)){
        localStorage.setItem(chave, '1');
        mostrarNotifBanner({
          titulo: '🔇 Interações pausadas',
          corpo: 'Você pode navegar normalmente, mas não dá pra votar, carimbar ou palpitar até ' +
                 new Date(Number(m.silenciadoAte)).toLocaleString('pt-BR') + '.',
          url: ''
        });
      }
    }catch(e){ /* sem storage: não avisa, o servidor barra do mesmo jeito */ }
  }
}

/* overlay simples reaproveitando o CSS do onboarding. `formHtml` null = só
   mensagem (sem saída); com conteúdo = a pessoa precisa resolver algo. */
function mostrarAvisoConta(titulo, corpoHtml, formHtml){
  const antigo = document.getElementById('ccAvisoConta'); if(antigo) antigo.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="onboarding-overlay" id="ccAvisoConta" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="onboarding-card">
        <h2>${esc(titulo)}</h2>
        <p class="onboarding-lead">${corpoHtml}</p>
        ${formHtml || ''}
      </div>
    </div>`);
  const ov = document.getElementById('ccAvisoConta');
  requestAnimationFrame(() => ov.classList.add('show'));
  return ov;
}

/* tela obrigatória de escolher um nome novo */
function abrirTrocaNomeObrigatoria(m){
  const ov = mostrarAvisoConta(
    '✏️ Escolha um novo nome de usuário',
    (m.motivoNome ? esc(m.motivoNome) + '<br><br>' : 'Seu nome de usuário atual foi escondido pela organização.<br><br>') +
    'Escolha outro para continuar. Suas avaliações, badges, reputação e amigos vão junto — nada se perde.',
    `<div style="display:grid;gap:10px;text-align:left;">
       <input type="text" id="tnNome" maxlength="20" placeholder="Novo nome (2 a 20 caracteres)"
              style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--text);font-size:15px;">
       <div class="cfg-msg" id="tnMsg" style="min-height:18px;"></div>
       <button class="btn btn-solid onboarding-btn" id="tnSalvar">Salvar nome</button>
       <button class="btn btn-ghost" id="tnSair" style="width:100%;">Sair da conta</button>
     </div>`);

  const input = document.getElementById('tnNome');
  const msg = document.getElementById('tnMsg');
  const bt = document.getElementById('tnSalvar');
  if(input) input.focus();

  const salvar = async () => {
    const nome = (input.value || '').trim();
    if(nome.length < 2 || nome.length > 20){ msg.textContent = 'O nome deve ter de 2 a 20 caracteres.'; return; }
    if(!/^[A-Za-z0-9_.\- ]+$/.test(nome)){ msg.textContent = 'Use só letras, números, espaço, ponto, hífen ou _.'; return; }
    bt.disabled = true; bt.innerHTML = '<span class="spinner"></span>Salvando...';
    const r = await apiTrocarNome(nome);
    bt.disabled = false; bt.textContent = 'Salvar nome';
    if(r && r.ok){
      /* o servidor emitiu uma sessão nova já no nome novo */
      salvarSessao(r.user, r.token, r.admin);
      ov.remove();
      location.reload();
    }else{
      msg.textContent = (r && r.error) ? r.error : 'Não foi possível trocar o nome.';
    }
  };
  if(bt) bt.addEventListener('click', salvar);
  if(input) input.addEventListener('keydown', ev => { if(ev.key === 'Enter') salvar(); });
  const btSair = document.getElementById('tnSair');
  if(btSair) btSair.addEventListener('click', async () => {
    try{ await apiLogout(); }catch(e){}
    await limparSessaoSupabase(); sairSessao(); location.reload();
  });
}

checarModeracaoConta();

/* =====================================================================
   REDE DE SEGURANÇA — o site não pode virar uma página em branco
   =====================================================================
   `config.js` não é um arquivo estático: é gerado pelo /api/content, que
   lê o banco. Quando ele falha (função caindo, Supabase fora do ar,
   variável de ambiente errada), `EDICOES` e `EDICAO_EM_DESTAQUE` não
   existem — e a primeira linha de `paginaHome()` que os usa lança
   ReferenceError. A execução morre ANTES do `montarShell`, então não sai
   nem sidebar, nem rodapé, nem mensagem: tela branca, sem nenhuma pista
   pra quem está do outro lado.

   Duas defesas aqui:

   1. Se os globais essenciais não chegaram, mostramos uma tela de erro
      honesta com botão de recarregar, em vez de tentar renderizar.
   2. Se a página falhar por qualquer outro motivo, o try/catch em volta do
      dispatcher transforma o erro numa tela legível — e ainda registra no
      console pra quem for investigar. */
function telaDeErro(titulo, detalhe){
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
                font-family:Inter,system-ui,sans-serif;background:#0e0f12;color:#eceef2;text-align:center;">
      <div style="max-width:420px;">
        <img src="${BASE}assets/logo.png" alt="CETECritic" style="max-width:150px;margin-bottom:20px;opacity:.9"
             onerror="this.style.display='none'">
        <h1 style="font-size:20px;margin:0 0 10px;color:#f5c518;">${esc(titulo)}</h1>
        <p style="color:#b9bdc6;font-size:14px;line-height:1.6;margin:0 0 20px;">${esc(detalhe)}</p>
        <button onclick="location.reload()"
                style="background:#f5c518;color:#0b0c0f;border:0;border-radius:10px;padding:11px 26px;
                       font-weight:800;cursor:pointer;font-size:14px;">Tentar de novo</button>
        <p style="color:#6e727a;font-size:12px;margin:22px 0 0;">
          Se continuar assim, avise em
          <a href="mailto:cetecritic@gmail.com" style="color:#f5c518;">cetecritic@gmail.com</a>.
        </p>
      </div>
    </div>`;
}

/* =====================================================================
   MODO MANUTENÇÃO — a tela que o visitante vê
   =====================================================================
   Configurado no painel (aba 🔧 Manutenção) e entregue pelo config.js em
   `MANUTENCAO`. Pode valer pro site inteiro ou só para alguns tipos de
   página — útil quando, por exemplo, o Hall da Fama quebrou mas a votação
   precisa continuar de pé no meio do festival.

   SOBRE O QUE ISTO É E O QUE NÃO É:

   Esta tela é CORTESIA, não cadeado. Quem editar o localStorage passa por
   cima e vê o site — possivelmente quebrado, que é justamente o que a tela
   estava evitando. O cadeado de verdade é a recusa de ESCRITA no /api/db,
   que roda no servidor e confere o papel de quem chama (ver
   bloqueioManutencao em api/db.js). Se a manutenção existe pra proteger
   dado, é aquela que vale.

   Quem é da equipe atravessa a tela e ganha uma tarja fixa no topo, pra
   ninguém esquecer que o site está fora do ar pro resto do mundo — o modo
   manutenção esquecido ligado é um clássico.

   A página de redefinir senha NUNCA é bloqueada: é o caminho de volta de
   quem perdeu o acesso, inclusive da própria equipe. E o /admin.html não
   carrega este arquivo, então o painel continua acessível sempre. */
const _MANUT = (typeof MANUTENCAO !== 'undefined' && MANUTENCAO) ? MANUTENCAO : { ativo:false };

function manutencaoPegaEstaPagina(){
  if(!_MANUT.ativo) return false;
  if(PAGINA.tipo === 'redefinir') return false;          // sempre liberada
  if(_MANUT.escopo === 'paginas'){
    const lista = Array.isArray(_MANUT.paginas) ? _MANUT.paginas : [];
    /* 'edicao' cobre também as telas satélite do ano (sobre/abertura/resumo),
       que são partes da mesma página pro visitante */
    const tipo = (['sobre','abertura','resumo'].indexOf(PAGINA.tipo) >= 0) ? 'edicao' : PAGINA.tipo;
    return lista.indexOf(tipo) >= 0;
  }
  return true;                                            // escopo = site inteiro
}

/* a sessão diz `admin` porque o servidor respondeu isso no login. Serve pra
   decidir o que MOSTRAR; nada que dependa de segurança se apoia nisto. */
function souDaEquipe(){ const s = usuarioLogado(); return !!(s && s.admin); }

function telaManutencao(){
  const titulo = String(_MANUT.titulo || '').trim() || 'Estamos em manutenção';
  const msg = String(_MANUT.mensagem || '').trim()
    || 'Voltamos já. Estamos ajustando uma coisa aqui e preferimos tirar do ar a te mostrar algo quebrado.';
  const volta = _MANUT.volta ? new Date(_MANUT.volta) : null;
  const temVolta = volta && !isNaN(volta) && volta > new Date();
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
                font-family:Inter,system-ui,sans-serif;background:#0e0f12;color:#eceef2;text-align:center;">
      <div style="max-width:460px;">
        <img src="${BASE}assets/logo.png" alt="CETECritic" style="max-width:150px;margin-bottom:22px;opacity:.9"
             onerror="this.style.display='none'">
        <div style="font-size:44px;line-height:1;margin-bottom:14px;">🔧</div>
        <h1 style="font-size:21px;margin:0 0 12px;color:#f5c518;">${esc(titulo)}</h1>
        <p style="color:#b9bdc6;font-size:14px;line-height:1.65;margin:0 0 20px;">${esc(msg)}</p>
        ${temVolta ? `<div style="background:#17181c;border:1px solid #2c2e33;border-radius:12px;padding:14px 18px;margin:0 0 20px;">
            <div style="color:#9a9ea6;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Previsão de volta</div>
            <div style="color:#f5c518;font-size:18px;font-weight:800;" id="manutTimer">--:--:--</div>
          </div>` : ''}
        <button onclick="location.reload()"
                style="background:#f5c518;color:#0b0c0f;border:0;border-radius:10px;padding:11px 26px;
                       font-weight:800;cursor:pointer;font-size:14px;">Tentar de novo</button>
        <p style="margin:26px 0 0;font-size:12px;">
          <a href="${BASE}admin.html" style="color:#6e727a;text-decoration:none;">Sou da equipe →</a>
        </p>
      </div>
    </div>`;
  if(temVolta){
    const el = document.getElementById('manutTimer');
    const tick = () => {
      const falta = volta - new Date();
      if(falta <= 0){ location.reload(); return; }
      el.textContent = formatDuracao(falta);
      setTimeout(tick, 1000);
    };
    tick();
  }
}

/* Tarja da equipe: quem passa pela manutenção precisa lembrar que passou —
   manutenção esquecida ligada é um clássico.

   `position:fixed` no RODAPÉ, e inserida num setTimeout, de propósito: o
   `montarShell` insere a sidebar com `afterbegin`, então qualquer coisa
   posta antes dele acabaria embaixo do menu. Fixa embaixo, a tarja não
   disputa espaço com o cabeçalho nem com o menu do celular. */
function tarjaManutencao(){
  const alvo = (_MANUT.escopo === 'paginas' && (_MANUT.paginas || []).length)
    ? _MANUT.paginas.join(', ')
    : 'o site inteiro';
  setTimeout(() => {
    if(document.getElementById('tarjaManutencao')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="tarjaManutencao"
           style="position:fixed;left:0;right:0;bottom:0;z-index:99998;background:#f5c518;color:#0b0c0f;
                  font-family:Inter,system-ui,sans-serif;font-size:12.5px;font-weight:700;
                  padding:9px 14px;text-align:center;line-height:1.45;
                  box-shadow:0 -6px 20px rgba(0,0,0,.35);">
        🔧 Manutenção LIGADA para ${esc(alvo)} — só a equipe está vendo o site.
        <a href="${BASE}admin.html#secManutencao"
           style="color:#0b0c0f;text-decoration:underline;">desligar no painel</a>
      </div>`);
  }, 0);
}

if(typeof EDICOES === 'undefined' || !Array.isArray(EDICOES)){
  console.error('[cetecritic] config.js não carregou — EDICOES ausente. Confira /config.js no navegador.');
  telaDeErro('Não conseguimos carregar o site',
    'Os dados do festival não chegaram. Costuma ser passageiro — tente recarregar em alguns instantes.');
}else if(manutencaoPegaEstaPagina() && !souDaEquipe()){
  telaManutencao();
}else{
  try{
    if(manutencaoPegaEstaPagina()) tarjaManutencao();
    /* ---------------------- dispatcher ---------------------- */
    despachar();
  }catch(e){
    console.error('[cetecritic] falha ao montar a página', PAGINA && PAGINA.tipo, e);
    telaDeErro('Algo deu errado ao montar esta página',
      'O erro foi registrado no console do navegador. Recarregar costuma resolver.');
  }
}

function despachar(){
switch(PAGINA.tipo){
  case 'edicao':   paginaEdicao(); break;
  case 'sobre':    paginaResumo(); break;
  case 'abertura': paginaResumo(); break;
  case 'resumo':   paginaResumo(); break;
  case 'noite':    paginaNoite(PAGINA.noite); break;
  case 'monte':    paginaMonte(); break;
  case 'bolao':    paginaBolao(); break;
  case 'hall':     paginaHall(); break;
  case 'home':     paginaHome(); break;
  case 'emBreve':  paginaEmBreve(); break;
  case 'perfil':   paginaPerfil(); break;
  case 'notif':    paginaNotificacoes(); break;
  case 'busca':    paginaBusca(); break;
  case 'config':   paginaConfig(); break;
  case 'redefinir': paginaRedefinir(); break;
  default: console.error('PAGINA.tipo desconhecido:', PAGINA.tipo);
}
}

/* =====================================================================
   ONBOARDING — tela de boas-vindas de primeiro acesso (Plano, Seção 6)
   =====================================================================
   O produto precisa explicar a si mesmo: apresenta a missão ANTES dos menus.
   Aparece uma única vez por dispositivo (localStorage). Não bloqueia nada — é
   só uma porta de entrada; qualquer clique fora ou em "Começar" a dispensa. */
function mostrarOnboarding(){
  if(document.getElementById('ccOnboarding')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div class="onboarding-overlay" id="ccOnboarding" role="dialog" aria-modal="true" aria-label="Boas-vindas ao CeteCritic">
      <div class="onboarding-card">
        <img class="onboarding-logo" src="${BASE}assets/logo.png" alt="CETECritic" onerror="this.style.display='none'">
        <h2>Bem-vindo ao CeteCritic</h2>
        <p class="onboarding-lead">O arquivo digital do CETEC Festival. Explore mais de 30 anos de história, descubra as apresentações mais marcantes e participe avaliando as próximas edições.</p>
        <ul class="onboarding-list">
          <li>⭐ Avalie apresentações</li>
          <li>🏆 Descubra os maiores festivais da história</li>
          <li>📚 Explore mais de 30 anos de arquivo</li>
          <li>🙂 Criar uma conta é totalmente opcional</li>
        </ul>
        <button class="btn btn-solid onboarding-btn" id="ccOnboardingStart">Começar</button>
      </div>
    </div>`);
  const ov = document.getElementById('ccOnboarding');
  requestAnimationFrame(() => ov.classList.add('show'));
  const fechar = () => { try{ localStorage.setItem('cc_onboarded', '1'); }catch(e){} ov.classList.remove('show'); setTimeout(() => { if(ov && ov.parentNode) ov.remove(); }, 250); };
  const btn = document.getElementById('ccOnboardingStart');
  if(btn) btn.addEventListener('click', fechar);
  ov.addEventListener('click', ev => { if(ev.target === ov) fechar(); });
}
/* dispara só na HOME e DEPOIS que a página já pintou (não bloqueia o
   carregamento). A checagem do `.sidebar` garante que a página montou de
   verdade: se caiu na tela de erro, não faz sentido dar boas-vindas. */
try{
  if(PAGINA.tipo === 'home' && !localStorage.getItem('cc_onboarded')){
    setTimeout(() => { if(document.querySelector('.sidebar')) mostrarOnboarding(); }, 500);
  }
}catch(e){ /* modo privado sem storage: simplesmente não mostra */ }