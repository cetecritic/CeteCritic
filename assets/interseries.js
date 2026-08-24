/* =====================================================================
   CETEC INTERSÉRIES — BUNDLE DO FRONT (assets/interseries.js)
   =====================================================================
   JavaScript puro, executado direto pelo navegador. SEM etapa de build,
   sem framework, sem biblioteca por CDN. Isto é escolha estrutural do
   projeto, não limitação: o site é mantido por estudantes que se revezam
   a cada ano, e um `npm install` que não roda em julho é um site fora do
   ar em julho.

   Este arquivo NÃO é o core.js e não encosta nele. O core.js tem 426 KB e
   é o item A2 da lista de riscos — acrescentar um caso ao
   `switch(PAGINA.tipo)` dele seria repetir o pecado sabendo qual é.

   ⚠️ CÓPIAS DECLARADAS DO core.js
   As funções do bloco "EMPRESTADO DO core.js" logo abaixo são CÓPIAS, não
   reimplementações. Original: assets/core.js. Foram copiadas porque o
   navegador não faz `require` e porque extrair um assets/comum.js exigiria
   editar o core.js — a única coisa que este projeto combinou não fazer
   agora. Duplicação declarada é dívida; duplicação esquecida é armadilha.
   Se mudar uma regra lá, mude aqui. As cópias são:

       TEMA_KEY / temaPref / aplicarTema        core.js §"TEMA"
       SESSAO_KEY / usuarioLogado / sairSessao  core.js §"CONTAS"
       agora / horarioSincronizado              core.js §"horário oficial"
       intervaloVisivel                         core.js §"polling que respeita a aba"
       esc                                      core.js (utilitário)
       registro do service worker               core.js §"PWA"

   ⚠️ CÓPIA DECLARADA DO api/_interseries_regras.js
   `CRITERIOS_IS`, `confrontoDireto` e `ordenarClassificacao` também moram
   no servidor (que precisa deles para semear o chaveamento). O teste
   "as duas cópias têm o MESMO desempate" é o que impede a divergência.

   Este arquivo também é carregado pelo admin-interseries.html, que reusa
   as funções daqui. Por isso o bloco final só roda se `PAGINA` existir —
   o painel não define `PAGINA` e nada é renderizado por conta própria.
   ===================================================================== */

const IS_API = '/api/interseries';
/* o e-mail de contato do CETECritic vive no config.js do festival, que
   este bundle de propósito não carrega. Cópia declarada. */
const IS_EMAIL = 'cetecritic@gmail.com';
const IS_FILTRO_KEY = 'is-categoria-filtro';
const IS_CACHE_PREFIXO = 'is-cache-';

/* =====================================================================
   EMPRESTADO DO core.js — cópias declaradas (ver o aviso do topo)
   ===================================================================== */
const TEMA_KEY = 'cetec-tema';
function temaPref(){ try{ return localStorage.getItem(TEMA_KEY) || 'escuro'; }catch(e){ return 'escuro'; } }
function aplicarTema(t){
  let efetivo = t;
  if(t === 'auto') efetivo = window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'escuro';
  document.documentElement.dataset.theme = (efetivo === 'claro') ? 'light' : 'dark';
}
try{
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if(temaPref() === 'auto') aplicarTema('auto');
  });
}catch(e){}

const SESSAO_KEY = 'cetec-sessao';
function usuarioLogado(){
  try{ const s = JSON.parse(localStorage.getItem(SESSAO_KEY) || 'null'); return (s && s.user && s.token) ? s : null; }
  catch(e){ return null; }
}
function sairSessao(){ try{ localStorage.removeItem(SESSAO_KEY); }catch(e){} }

/* ---- horário oficial (servidor) ----
   O relógio do visitante pode estar errado, ou alterado de propósito. Toda
   comparação de tempo passa por `agora()`. E, mesmo assim, NENHUMA trava do
   cliente é autoridade: o servidor revalida cada aposta. */
let serverTimeOffset = null;
function agora(){ return serverTimeOffset === null ? new Date() : new Date(Date.now() + serverTimeOffset); }
function horarioSincronizado(){ return serverTimeOffset !== null; }

/* ---- polling que respeita a aba ----
   `setInterval` continua disparando com a aba escondida: quem deixa o site
   aberto num pino do navegador ficava com um cronjob de rede rodando o dia
   inteiro. E o dia de jogo é justamente quando todo mundo deixa a aba
   aberta. */
function intervaloVisivel(fn, ms){
  let ultimo = Date.now();
  let rodando = false;
  async function executar(){
    if(rodando) return;
    rodando = true; ultimo = Date.now();
    try{ await fn(); }catch(e){ console.warn('[interseries] atualização periódica falhou', e); }
    finally{ rodando = false; }
  }
  const id = setInterval(() => { if(!document.hidden) executar(); }, ms);
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden && Date.now() - ultimo >= ms) executar();
  });
  return id;
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* service worker: mesmo registro do core.js, para o interséries também
   abrir instantâneo e sobreviver a um sinal ruim no ginásio */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
  });
}

/* =====================================================================
   REDE
   ===================================================================== */
/* cache SWR: pinta a última resposta boa na hora e a rede atualiza por
   cima. Nunca afeta trava de tempo — apostar continua dependendo do
   relógio do servidor (`horarioSincronizado()`). */
function lerCache(chave){
  try{ return JSON.parse(localStorage.getItem(IS_CACHE_PREFIXO + chave) || 'null'); }catch(e){ return null; }
}
function salvarCache(chave, valor){
  try{ localStorage.setItem(IS_CACHE_PREFIXO + chave, JSON.stringify(valor)); }catch(e){}
}

async function apiGet(params){
  const qs = Object.keys(params).filter(k => params[k] != null && params[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  const r = await fetch(IS_API + '?' + qs + '&_=' + Date.now(), { cache: 'no-store' });
  const j = await r.json();
  if(typeof j.serverNow === 'number') serverTimeOffset = j.serverNow - Date.now();
  if(typeof j.proximaAtualizacao === 'number') CADENCIA = j.proximaAtualizacao;
  return j;
}
async function apiIS(payload){
  const s = usuarioLogado();
  const corpo = Object.assign({}, payload);
  if(s){ corpo.user = s.user; corpo.token = s.token; }
  const r = await fetch(IS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request: sem preflight CORS
    body: JSON.stringify(corpo)
  });
  return await r.json();
}

/* =====================================================================
   ESTADO DA PÁGINA
   ===================================================================== */
let ESTADO = { config: {}, temporada: null, categorias: [], equipes: [], ativo: true };
let EU = null;               // { saldo, apostas, ... } de ?meu=1
let CADENCIA = 20000;
let EQUIPES_POR_ID = {};

function filtroCategoria(){
  try{ return localStorage.getItem(IS_FILTRO_KEY) || ''; }catch(e){ return ''; }
}
function definirFiltro(slug){
  try{ if(slug) localStorage.setItem(IS_FILTRO_KEY, slug); else localStorage.removeItem(IS_FILTRO_KEY); }catch(e){}
}
function categoriaPorSlug(slug){ return ESTADO.categorias.find(c => c.slug === slug) || null; }
function categoriaPorId(id){ return ESTADO.categorias.find(c => String(c.id) === String(id)) || null; }
function equipe(id){ return EQUIPES_POR_ID[String(id)] || null; }

/* =====================================================================
   DATAS — tudo no fuso do evento, -03:00 fixo
   ===================================================================== */
const FUSO_MS = 3 * 60 * 60 * 1000;
function diaDoEvento(ms){ return new Date(Number(ms) - FUSO_MS).toISOString().slice(0, 10); }
const DIAS = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
function horaCurta(iso){
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function dataLonga(iso){
  const d = new Date(iso);
  return DIAS[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
function tituloDoDia(iso){
  const hoje = diaDoEvento(agora().getTime());
  const dia = diaDoEvento(Date.parse(iso));
  if(dia === hoje) return 'Hoje';
  if(dia === diaDoEvento(agora().getTime() - 86400000)) return 'Ontem';
  if(dia === diaDoEvento(agora().getTime() + 86400000)) return 'Amanhã';
  const d = new Date(iso);
  return DIAS[d.getDay()] + ', ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
function contagem(ateIso){
  const resto = Date.parse(ateIso) - agora().getTime();
  if(resto <= 0) return 'fechado';
  const s = Math.floor(resto / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if(h >= 24) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  if(h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'min';
  if(m > 0) return m + 'min';
  return s + 's';
}

/* =====================================================================
   A LINHA DE PARTIDA — a unidade atômica
   =====================================================================
   Cinco telas, um componente, um CSS. Ver o desenho em interseries.css.
   ===================================================================== */
function rotuloEstado(p){
  if(p.status === 'ao_vivo') return { txt: 'AO VIVO', classe: 'vivo', ponto: true };
  if(p.status === 'cancelada') return { txt: 'CANC', classe: '' };
  if(p.status === 'wo') return { txt: 'WO', classe: '' };
  if(!p.comeca_em) return { txt: '—', classe: '' };
  const hoje = diaDoEvento(agora().getTime());
  const dia = diaDoEvento(Date.parse(p.comeca_em));
  if(p.status === 'encerrada'){
    if(dia === hoje) return { txt: 'FIM', classe: '' };
    if(dia === diaDoEvento(agora().getTime() - 86400000)) return { txt: 'ONT', classe: '' };
    const d = new Date(p.comeca_em);
    const dias = Math.round((agora().getTime() - Date.parse(p.comeca_em)) / 86400000);
    if(dias < 7) return { txt: DIAS[d.getDay()], classe: '' };
    return { txt: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), classe: '' };
  }
  return dia === hoje
    ? { txt: horaCurta(p.comeca_em), classe: '' }
    : { txt: dataLonga(p.comeca_em), classe: '' };
}

function htmlEquipe(eq, lado, resultado, origemTexto){
  const dir = lado === 'b' ? ' dir' : '';
  const cls = resultado === 'venceu' ? ' venceu' : (resultado === 'perdeu' ? ' perdeu' : '');
  if(!eq){
    const txt = origemTexto || 'A definir';
    return '<span class="is-time' + dir + '"><span class="indef">' + esc(txt) + '</span></span>';
  }
  /* a cor da equipe entra AQUI, inline, numa faixa de 3px — e em nenhum
     outro lugar. Cor de turma não tem compromisso com contraste. */
  const faixa = '<i class="is-faixa"' + (eq.cor ? ' style="background:' + esc(eq.cor) + '"' : '') + '></i>';
  const brasao = eq.escudo
    ? '<img class="is-escudo" src="' + esc(eq.escudo) + '" alt="" loading="lazy" onerror="this.outerHTML=\'<span class=&quot;is-iniciais&quot;>' + esc(eq.sigla || '').slice(0, 3) + '</span>\'">'
    : '<span class="is-iniciais">' + esc(String(eq.sigla || '').slice(0, 3)) + '</span>';
  const nome = '<span class="nome">' + esc(eq.nome || eq.sigla) + '</span>';
  return lado === 'b'
    ? '<span class="is-time dir' + cls + '">' + nome + brasao + faixa + '</span>'
    : '<span class="is-time' + cls + '">' + faixa + brasao + nome + '</span>';
}

/* `cotacao` (opcional) = { a: 68, b: 32 } — a cotação implícita do mercado
   de vencedor, que se produz sozinha e é bonita de mostrar */
function linhaPartida(p, opts){
  const o = opts || {};
  const est = rotuloEstado(p);
  const cat = categoriaPorId(p.categoria_id);
  const ea = p.equipe_a_obj || equipe(p.equipe_a);
  const eb = p.equipe_b_obj || equipe(p.equipe_b);

  let resA = '', resB = '';
  const temPlacar = p.placar_a != null && p.placar_b != null;
  if(p.status === 'encerrada' && temPlacar){
    const venc = p.vencedor_id || (Number(p.placar_a) > Number(p.placar_b) ? p.equipe_a
                : (Number(p.placar_b) > Number(p.placar_a) ? p.equipe_b : null));
    if(venc){
      resA = String(venc) === String(p.equipe_a) ? 'venceu' : 'perdeu';
      resB = String(venc) === String(p.equipe_b) ? 'venceu' : 'perdeu';
    }
  }

  let marcador;
  if(temPlacar && (p.status === 'encerrada' || p.status === 'ao_vivo')){
    marcador = '<span class="is-marcador">' +
      '<span class="' + (resA === 'perdeu' ? 'perdeu' : '') + '">' + Number(p.placar_a) + '</span>' +
      '<span class="x">×</span>' +
      '<span class="' + (resB === 'perdeu' ? 'perdeu' : '') + '">' + Number(p.placar_b) + '</span></span>';
  } else if(o.cotacao){
    marcador = '<span class="is-cotacao"><b>' + o.cotacao.a + '%</b> · ' + o.cotacao.b + '%</span>';
  } else {
    marcador = '<span class="is-marcador aberto">–</span>';
  }

  /* confronto ainda indefinido mostra a ORIGEM em itálico — vem de graça do
     modelo de origem do chaveamento, e é melhor do que "A definir" */
  const rotuloOrigem = (id, tipo) => id ? ((tipo === 'perdedor' ? 'Perdedor' : 'Vencedor') + ' de #' + id) : null;
  const origemA = rotuloOrigem(p.origem_a_partida, p.origem_a_tipo);
  const origemB = rotuloOrigem(p.origem_b_partida, p.origem_b_tipo);
  const meta = (cat ? cat.nome : '') + (o.fase ? ' · ' + o.fase : '');

  return '<a class="is-linha" href="/interseries/partida/' + p.id + '">' +
    '<span class="is-estado ' + est.classe + '">' + (est.ponto ? '<i class="ponto"></i>' : '') + esc(est.txt) + '</span>' +
    '<span class="is-confronto">' +
      htmlEquipe(ea, 'a', resA, origemA) + marcador + htmlEquipe(eb, 'b', resB, origemB) +
    '</span>' +
    '<span class="is-meta">' + esc(meta) + '</span>' +
  '</a>';
}

function listaPorDia(partidas, opts){
  if(!partidas.length) return '<div class="is-vazio">Nenhuma partida por aqui ainda.</div>';
  const grupos = {};
  partidas.forEach(p => {
    const chave = p.comeca_em ? diaDoEvento(Date.parse(p.comeca_em)) : 'sem-data';
    (grupos[chave] = grupos[chave] || []).push(p);
  });
  return Object.keys(grupos).sort().map(dia =>
    '<div class="is-dia">' + (dia === 'sem-data' ? 'Sem data' : tituloDoDia(grupos[dia][0].comeca_em)) + '</div>' +
    grupos[dia].map(p => linhaPartida(p, opts)).join('')
  ).join('');
}

/* =====================================================================
   DESEMPATE — ⚠️ CÓPIA DECLARADA de api/_interseries_regras.js
   =====================================================================
   O gêmeo mora no servidor, que precisa da mesma ordem para semear o
   chaveamento. Um teste confere que as duas dão o mesmo resultado. Se
   alterar aqui, altere lá.

   `confronto` só vale entre DUAS equipes: com três empatadas o critério
   pode até ciclar (A ganha de B, B de C, C de A). Nesse caso o grupo é
   marcado e a tela mostra um asterisco — não se inventa uma regra.
   `sorteio` é o id da equipe: determinístico, nunca Math.random().
   ===================================================================== */
const CRITERIOS_IS = {
  pontos:    (a, b) => (b.pontos     || 0) - (a.pontos     || 0),
  vitorias:  (a, b) => (b.vitorias   || 0) - (a.vitorias   || 0),
  saldo:     (a, b) => (b.saldo      || 0) - (a.saldo      || 0),
  pro:       (a, b) => (b.pontos_pro || 0) - (a.pontos_pro || 0),
  contra:    (a, b) => (a.pontos_contra || 0) - (b.pontos_contra || 0),
  jogos:     (a, b) => (a.jogos      || 0) - (b.jogos      || 0),
  sorteio:   (a, b) => Number(a.equipe_id) - Number(b.equipe_id)
};
function confrontoDireto(a, b, ctx){
  const partidas = (ctx && ctx.partidas) || [];
  const pv = Number((ctx && ctx.pontos_vitoria) != null ? ctx.pontos_vitoria : 3);
  const pe = Number((ctx && ctx.pontos_empate)  != null ? ctx.pontos_empate  : 1);
  const pd = Number((ctx && ctx.pontos_derrota) != null ? ctx.pontos_derrota : 0);
  let ptsA = 0, ptsB = 0, golsA = 0, golsB = 0, jogos = 0;
  for(const p of partidas){
    if(p.status !== 'encerrada') continue;
    if(p.placar_a == null || p.placar_b == null) continue;
    let ma, mb;
    if(String(p.equipe_a) === String(a.equipe_id) && String(p.equipe_b) === String(b.equipe_id)){
      ma = Number(p.placar_a); mb = Number(p.placar_b);
    } else if(String(p.equipe_a) === String(b.equipe_id) && String(p.equipe_b) === String(a.equipe_id)){
      ma = Number(p.placar_b); mb = Number(p.placar_a);
    } else continue;
    jogos++; golsA += ma; golsB += mb;
    if(ma > mb){ ptsA += pv; ptsB += pd; }
    else if(ma < mb){ ptsA += pd; ptsB += pv; }
    else { ptsA += pe; ptsB += pe; }
  }
  if(!jogos) return 0;
  if(ptsA !== ptsB) return ptsB - ptsA;
  return golsB - golsA;
}
function ordenarClassificacao(linhas, criterios, ctx){
  const lista = (Array.isArray(linhas) ? linhas : []).map(l => Object.assign({}, l));
  const crits = (Array.isArray(criterios) && criterios.length) ? criterios.slice()
    : ['pontos','vitorias','saldo','pro','confronto'];
  function refinar(grupo, i){
    if(grupo.length <= 1 || i >= crits.length) return grupo.slice().sort(CRITERIOS_IS.sorteio);
    const nome = crits[i];
    if(nome === 'confronto'){
      if(grupo.length === 2){
        const r = confrontoDireto(grupo[0], grupo[1], ctx);
        if(r !== 0) return r < 0 ? [grupo[0], grupo[1]] : [grupo[1], grupo[0]];
        return refinar(grupo, i + 1);
      }
      grupo.forEach(l => { l.confrontoInconclusivo = true; });
      return refinar(grupo, i + 1);
    }
    const cmp = CRITERIOS_IS[nome];
    if(!cmp) return refinar(grupo, i + 1);
    const ordenado = grupo.slice().sort(cmp);
    const saida = [];
    let bloco = [ordenado[0]];
    for(let k = 1; k < ordenado.length; k++){
      if(cmp(bloco[0], ordenado[k]) === 0) bloco.push(ordenado[k]);
      else { saida.push(...refinar(bloco, i + 1)); bloco = [ordenado[k]]; }
    }
    saida.push(...refinar(bloco, i + 1));
    return saida;
  }
  return refinar(lista, 0).map((l, idx) => Object.assign(l, { posicao: idx + 1 }));
}

/* =====================================================================
   PARSER DE CSV — ~60 linhas, à mão, de propósito
   =====================================================================
   Não vale trazer biblioteca por CDN para isto: é código que você vai
   querer poder LER no dia em que ele errar, com o ginásio cheio e a
   planilha aberta na outra aba.

   Mora aqui, e não no painel, por duas razões: o painel carrega este
   bundle (é a mesma cópia, não uma segunda), e assim o parser fica
   testável — testes/interseries.test.js carrega este arquivo num `vm`.

   O item 1 não é preciosismo. O Excel salva UTF-8 COM BOM, e sem comer o
   BOM a primeira coluna do cabeçalho nunca casa com nada — o projeto já
   perdeu uma noite com um problema da mesma família no sitemap.xml.
   ===================================================================== */
function normalizarCabecalho(s){
  return String(s || '').trim().toLowerCase()
    /* \u0300-\u036f é a faixa dos acentos combinantes, escrita com escape
       de propósito: caractere invisível em código-fonte é o tipo de coisa
       que um editor "conserta" sozinho e ninguém percebe */
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function lerCsv(texto){
  let t = String(texto == null ? '' : texto);
  if(t.charCodeAt(0) === 0xFEFF) t = t.slice(1);                  // 1. come o BOM
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  /* 2. autodetecta o separador contando FORA das aspas na primeira linha.
     O Excel brasileiro exporta com ';' e ninguém vai lembrar disso. */
  let ponto = 0, virgula = 0, dentro = false;
  for(let i = 0; i < t.length; i++){
    const ch = t[i];
    if(ch === '"'){ dentro = !dentro; continue; }
    if(dentro) continue;
    if(ch === '\n') break;
    if(ch === ';') ponto++;
    if(ch === ',') virgula++;
  }
  const sep = ponto >= virgula && ponto > 0 ? ';' : ',';

  /* 3 e 4. máquina de estados: aspas duplas protegem separador e quebra de
     linha; "" dentro de campo entre aspas vira uma aspa literal */
  const linhas = [];
  let campo = '', linha = [];
  dentro = false;
  for(let i = 0; i < t.length; i++){
    const ch = t[i];
    if(dentro){
      if(ch === '"'){
        if(t[i + 1] === '"'){ campo += '"'; i++; }
        else dentro = false;
      } else campo += ch;
      continue;
    }
    if(ch === '"'){ dentro = true; continue; }
    if(ch === sep){ linha.push(campo); campo = ''; continue; }
    if(ch === '\n'){ linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    campo += ch;
  }
  linha.push(campo); linhas.push(linha);

  /* 6. ignora linhas totalmente vazias */
  const uteis = linhas.filter(l => l.some(c => String(c).trim() !== ''));
  if(!uteis.length) return { colunas: [], linhas: [], separador: sep };

  const colunas = uteis[0].map(normalizarCabecalho);              // 5 e 7
  const objetos = uteis.slice(1).map(l => {
    const o = {};
    colunas.forEach((c, i) => { if(c) o[c] = String(l[i] == null ? '' : l[i]).trim(); });
    return o;
  });
  return { colunas, linhas: objetos, separador: sep };
}

/* Aceita AAAA-MM-DD (o formato oficial) e DD/MM/AAAA (gentileza barata).
   RECUSA formato americano em vez de chutar: 09/14/2026 devolve erro, e
   14/09/2026 vira 2026-09-14. Chutar aqui remarcaria jogo em silêncio. */
function normalizarData(v){
  const s = String(v || '').trim();
  if(!s) return { erro: 'data vazia' };
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return { data: s };
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if(m){
    const dia = Number(m[1]), mes = Number(m[2]);
    if(mes > 12) return { erro: 'data "' + s + '" parece estar no formato americano (MM/DD/AAAA). Use AAAA-MM-DD.' };
    if(dia > 31 || dia < 1 || mes < 1) return { erro: 'data "' + s + '" não existe' };
    return { data: m[3] + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0') };
  }
  return { erro: 'data "' + s + '" fora do formato AAAA-MM-DD' };
}

/* =====================================================================
   CASCA DA PÁGINA
   ===================================================================== */
const MENU = [
  { tipo: 'inicio',   rot: 'Hoje',     href: '/interseries/' },
  { tipo: 'partidas', rot: 'Partidas', href: '/interseries/partidas' },
  { tipo: 'apostas',  rot: 'Apostas',  href: '/interseries/apostas' },
  { tipo: 'placar',   rot: 'Placar',   href: '/interseries/placar' },
  { tipo: 'regras',   rot: 'Regras',   href: '/interseries/regras' }
];

function montarCasca(){
  const s = usuarioLogado();
  document.body.insertAdjacentHTML('afterbegin',
    '<header class="is-topo">' +
      '<div class="is-topo-linha">' +
        '<a class="is-marca" href="/interseries/">INTERSÉRIES<small>CETECRITIC</small></a>' +
        '<nav class="is-nav">' + MENU.map(m =>
          '<a href="' + m.href + '"' + (PAGINA.tipo === m.tipo ? ' class="ativo"' : '') + '>' + m.rot + '</a>'
        ).join('') + '</nav>' +
        '<div class="is-saldo" id="isSaldo">' +
          (s ? '<span class="lbl">carregando…</span>'
             : '<a class="is-entrar" href="/perfil.html">Entrar</a>') +
        '</div>' +
      '</div>' +
    '</header>' +
    '<div class="is-chips" id="isChips"><div class="is-chips-in"></div></div>' +
    '<main class="is-wrap" id="isMain"><div class="is-carregando">Carregando…</div></main>');
}

function pintarChips(){
  const box = document.querySelector('#isChips .is-chips-in');
  if(!box) return;
  /* o filtro não faz sentido nas telas que já são de UMA categoria */
  if(['categoria','partida','equipe','regras','apostas','placar'].indexOf(PAGINA.tipo) >= 0){
    document.getElementById('isChips').style.display = 'none';
    return;
  }
  const atual = filtroCategoria();
  box.innerHTML = '<button class="is-chip' + (!atual ? ' ativo' : '') + '" data-slug="">Todas</button>' +
    ESTADO.categorias.map(c =>
      '<button class="is-chip' + (atual === c.slug ? ' ativo' : '') + '" data-slug="' + esc(c.slug) + '">' + esc(c.nome) + '</button>'
    ).join('');
  box.querySelectorAll('.is-chip').forEach(b => {
    b.addEventListener('click', () => { definirFiltro(b.dataset.slug); despacharIS(); });
  });
}

function pintarSaldo(){
  const box = document.getElementById('isSaldo');
  if(!box) return;
  const s = usuarioLogado();
  if(!s){ box.innerHTML = '<a class="is-entrar" href="/perfil.html">Entrar</a>'; return; }
  if(!EU){ box.innerHTML = '<span class="lbl">carregando…</span>'; return; }
  box.innerHTML = '<span class="lbl">' + esc(s.user) + '</span>' +
    '<a href="/interseries/apostas">' + Number(EU.saldo).toLocaleString('pt-BR') + ' fichas</a>';
}

function telaDeErroIS(titulo, texto){
  const main = document.getElementById('isMain') || document.body;
  main.innerHTML = '<div class="is-erro">' +
    '<h2>' + esc(titulo) + '</h2>' +
    '<p>' + esc(texto) + '</p>' +
    '<button class="btn btn-solid" onclick="location.reload()">Recarregar</button>' +
    '<p style="margin-top:14px">Se continuar assim, avise em <a href="mailto:' + IS_EMAIL + '">' + IS_EMAIL + '</a>.</p>' +
  '</div>';
}

function telaDesligada(){
  const main = document.getElementById('isMain') || document.body;
  main.innerHTML = '<div class="is-erro">' +
    '<h2>O Interséries está fora do ar</h2>' +
    '<p>Voltamos já. Enquanto isso, o resto do CETECritic continua funcionando normalmente.</p>' +
    '<a class="btn btn-ghost" href="/">Ir para a home</a>' +
  '</div>';
}

/* =====================================================================
   PÁGINAS
   ===================================================================== */
async function paginaInicio(){
  const main = document.getElementById('isMain');
  const slug = filtroCategoria();
  const [jp, jm] = await Promise.all([
    apiGet({ partidas: 1, categoria: slug || null, limite: 400 }),
    apiGet({ mercados: 1, status: 'aberto' })
  ]);
  if(!jp.ok) throw new Error(jp.error || 'não consegui carregar as partidas');

  const todas = jp.partidas || [];
  const hoje = diaDoEvento(agora().getTime());
  const aoVivo = todas.filter(p => p.status === 'ao_vivo');
  const deHoje = todas.filter(p => p.comeca_em && diaDoEvento(Date.parse(p.comeca_em)) === hoje && p.status !== 'ao_vivo');
  const proximas = todas.filter(p => p.status === 'agendada' && p.comeca_em && Date.parse(p.comeca_em) > agora().getTime()
                                  && diaDoEvento(Date.parse(p.comeca_em)) !== hoje).slice(0, 8);
  const ultimos = todas.filter(p => p.status === 'encerrada')
    .sort((a, b) => Date.parse(b.comeca_em || 0) - Date.parse(a.comeca_em || 0)).slice(0, 8);

  /* cotação implícita: quanto do bolo está em cada lado. Se produz sozinha
     e é a informação mais bonita que este site tem de graça. */
  const cotacaoPorPartida = {};
  (jm.mercados || []).forEach(m => {
    if(m.tipo !== 'vencedor' || !m.partida_id || !m.bolo) return;
    const p = (m.partida || {});
    const oa = (m.opcoes || []).find(o => String(o.equipe_id) === String(p.equipe_a));
    const ob = (m.opcoes || []).find(o => String(o.equipe_id) === String(p.equipe_b));
    if(oa && ob) cotacaoPorPartida[String(m.partida_id)] = { a: Math.round(oa.percentual), b: Math.round(ob.percentual) };
  });
  const comCotacao = p => ({ cotacao: cotacaoPorPartida[String(p.id)] });

  const fechando = (jm.mercados || [])
    .filter(m => Date.parse(m.fecha_em) > agora().getTime())
    .sort((a, b) => Date.parse(a.fecha_em) - Date.parse(b.fecha_em)).slice(0, 5);

  main.innerHTML =
    (ESTADO.temporada ? '' : '<div class="is-avisos"><div class="is-aviso"><b>Ainda não há temporada ativa.</b> Assim que a equipe publicar o calendário, ele aparece aqui.</div></div>') +
    (aoVivo.length ? '<section class="is-secao"><h2>Ao vivo <span class="cont">' + aoVivo.length + '</span></h2>' +
      '<div class="is-card">' + aoVivo.map(p => linhaPartida(p, comCotacao(p))).join('') + '</div></section>' : '') +
    '<section class="is-secao"><h2>Hoje</h2><div class="is-card">' +
      (deHoje.length ? deHoje.map(p => linhaPartida(p, comCotacao(p))).join('')
                     : '<div class="is-vazio">Nenhuma partida hoje.</div>') +
    '</div></section>' +
    (proximas.length ? '<section class="is-secao"><h2>A seguir</h2><div class="is-card">' +
      listaPorDia(proximas, {}) + '</div></section>' : '') +
    (fechando.length ? '<section class="is-secao"><h2>Fechando em breve</h2><div class="is-card">' +
      fechando.map(m => '<a class="is-linha" href="' + (m.partida_id ? '/interseries/partida/' + m.partida_id : '/interseries/apostas') + '">' +
        '<span class="is-estado">' + esc(contagem(m.fecha_em)) + '</span>' +
        '<span class="is-confronto" style="display:block"><b>' + esc(m.titulo) + '</b></span>' +
        '<span class="is-meta">' + Number(m.bolo || 0).toLocaleString('pt-BR') + ' fichas no bolo</span></a>').join('') +
      '</div></section>' : '') +
    '<section class="is-secao"><h2>Últimos resultados</h2><div class="is-card">' +
      (ultimos.length ? ultimos.map(p => linhaPartida(p, {})).join('') : '<div class="is-vazio">Nada encerrado ainda.</div>') +
    '</div></section>';
}

async function paginaPartidas(){
  const main = document.getElementById('isMain');
  const slug = filtroCategoria();
  const j = await apiGet({ partidas: 1, categoria: slug || null, limite: 1000 });
  if(!j.ok) throw new Error(j.error || 'não consegui carregar as partidas');

  const filtroStatus = (window.__isFiltroStatus || 'todas');
  let lista = j.partidas || [];
  if(filtroStatus === 'agendadas') lista = lista.filter(p => p.status === 'agendada' || p.status === 'ao_vivo');
  if(filtroStatus === 'encerradas') lista = lista.filter(p => p.status === 'encerrada');

  main.innerHTML =
    '<section class="is-secao">' +
      '<div class="is-abas" id="isFiltroStatus">' +
        ['todas','agendadas','encerradas'].map(f =>
          '<button class="is-aba' + (filtroStatus === f ? ' ativo' : '') + '" data-f="' + f + '">' +
            f.charAt(0).toUpperCase() + f.slice(1) + '</button>').join('') +
      '</div>' +
      '<div class="is-card" style="margin-top:10px">' + listaPorDia(lista, {}) + '</div>' +
    '</section>';

  main.querySelectorAll('#isFiltroStatus .is-aba').forEach(b => {
    b.addEventListener('click', () => { window.__isFiltroStatus = b.dataset.f; paginaPartidas(); });
  });
}

async function paginaPartida(){
  const main = document.getElementById('isMain');
  const j = await apiGet({ partida: PAGINA.arg });
  if(!j.ok) throw new Error(j.error || 'partida não encontrada');
  const p = j.partida, cat = j.categoria || {};
  const ea = p.equipe_a_obj, eb = p.equipe_b_obj;
  const est = rotuloEstado(p);

  const corrigido = p.corrigido_em
    ? '<div class="is-avisos"><div class="is-aviso"><b>Resultado corrigido</b> em ' +
      esc(new Date(p.corrigido_em).toLocaleString('pt-BR')) + (p.corrigido_por ? ' por ' + esc(p.corrigido_por) : '') +
      '. Quem tinha prêmio recebeu estorno e o novo valor — dá para conferir no seu extrato.</div></div>' : '';

  main.innerHTML = corrigido +
    '<section class="is-secao"><div class="is-card">' +
      '<div class="is-dia">' + esc(cat.nome || '') + (j.fase ? ' · ' + esc(j.fase.nome) : '') +
        (p.local ? ' · ' + esc(p.local) : '') + (p.comeca_em ? ' · ' + esc(tituloDoDia(p.comeca_em)) + ' ' + horaCurta(p.comeca_em) : '') + '</div>' +
      linhaPartida(p, {}) +
      (p.status === 'encerrada' && p.vencedor_id && Number(p.placar_a) === Number(p.placar_b)
        ? '<div class="is-nota">Terminou empatado no tempo normal. Avançou: <b>' +
          esc((equipe(p.vencedor_id) || {}).nome || '') + '</b>. O mercado de <b>vencedor</b> paga por quem avançou; o de <b>margem</b>, pelo placar do tempo normal.</div>' : '') +
    '</div></section>' +
    '<section class="is-secao"><h2>Mercados</h2><div class="is-card" id="isMercados">' +
      (j.mercados && j.mercados.length ? '' : '<div class="is-vazio">Nenhum mercado para esta partida.</div>') +
    '</div></section>' +
    (j.eventos && j.eventos.length ? '<section class="is-secao"><h2>Eventos</h2><div class="is-card">' +
      j.eventos.map(ev => {
        const at = (j.escalacoes || []).find(a => String(a.id) === String(ev.atleta_id));
        return '<div class="is-linha" style="grid-template-columns:62px 1fr">' +
          '<span class="is-estado">' + (ev.minuto != null ? esc(ev.minuto) + "'" : '—') + '</span>' +
          '<span class="is-confronto" style="display:block">' + esc(ev.tipo) + (at ? ' · ' + esc(at.nome) : '') + '</span></div>';
      }).join('') + '</div></section>' : '') +
    (j.escalacoes && j.escalacoes.length ? '<section class="is-secao"><h2>Elencos</h2><div class="is-card">' +
      [ea, eb].filter(Boolean).map(e =>
        '<div class="is-dia">' + esc(e.nome) + '</div>' +
        (j.escalacoes.filter(a => String(a.equipe_id) === String(e.id)).map(a =>
          '<div class="is-linha" style="grid-template-columns:62px 1fr">' +
            '<span class="is-estado">' + (a.numero != null ? esc(a.numero) : '—') + '</span>' +
            '<span class="is-confronto" style="display:block">' + esc(a.nome) +
              (a.posicao ? ' <span class="is-cotacao">' + esc(a.posicao) + '</span>' : '') + '</span></div>'
        ).join('') || '<div class="is-vazio">Elenco não cadastrado.</div>')
      ).join('') + '</div></section>' : '');

  pintarMercados(j.mercados || [], document.getElementById('isMercados'));
}

/* ---- mercados e o formulário de aposta ---- */
function pintarMercados(mercados, box){
  if(!box || !mercados.length) return;
  const s = usuarioLogado();
  const minhas = {};
  if(EU) (EU.apostas || []).forEach(a => { minhas[String(a.mercado_id)] = a; });

  box.innerHTML = mercados.map(m => {
    const minha = minhas[String(m.id)];
    const fechado = m.status !== 'aberto' || Date.parse(m.fecha_em) <= agora().getTime();
    const vencedora = m.opcao_vencedora;
    return '<div class="is-mercado" data-mercado="' + m.id + '">' +
      '<div class="is-mercado-topo">' +
        '<span class="is-mercado-titulo">' + esc(m.titulo) + '</span>' +
        '<span class="is-mercado-sub">' + Number(m.bolo || 0).toLocaleString('pt-BR') + ' fichas · ' +
          Number(m.apostadores || 0) + ' apostador(es)</span>' +
      '</div>' +
      /* ⚠️ as opções vêm do `resumoDoBolo` do servidor, onde o id chama
         `opcao_id` (e não `id`) porque a linha carrega também o bolo
         daquele lado. Confundir os dois faz a aposta da pessoa parar de
         aparecer marcada — sem erro nenhum na tela. */
      '<div class="is-opcoes">' + (m.opcoes || []).map(o =>
        '<button class="is-opcao' + (minha && String(minha.opcao_id) === String(o.opcao_id) ? ' minha' : '') +
          (String(vencedora) === String(o.opcao_id) ? ' minha' : '') + '"' +
          ' data-opcao="' + o.opcao_id + '" data-mercado="' + m.id + '"' + (fechado ? ' disabled' : '') + '>' +
          '<span class="rot">' + esc(o.rotulo) + (String(vencedora) === String(o.opcao_id) ? ' ✓' : '') + '</span>' +
          '<span class="is-barra"><i style="width:' + Number(o.percentual || 0) + '%"></i></span>' +
          '<span class="num">' + Number(o.fichas || 0).toLocaleString('pt-BR') + ' fichas · ' + Number(o.percentual || 0) + '%</span>' +
        '</button>').join('') + '</div>' +
      '<div class="is-fecha">' + (m.status === 'liquidado' ? 'Liquidado.' :
         m.status === 'cancelado' ? 'Cancelado — as apostas foram estornadas.' :
         fechado ? 'Fechado, aguardando resultado.' :
         'Fecha em <b data-conta-ate="' + esc(m.fecha_em) + '">' + esc(contagem(m.fecha_em)) + '</b>') + '</div>' +
      (minha ? '<div class="is-minha-aposta">Sua aposta: <b>' + Number(minha.valor).toLocaleString('pt-BR') + ' fichas</b>' +
        (!fechado ? ' <button class="btn btn-ghost btn-mini" data-cancelar="' + m.id + '">Cancelar</button>' : '') + '</div>' : '') +
      (!fechado && s ? '<div class="is-form-aposta" data-form="' + m.id + '" hidden>' +
        '<input type="number" min="1" step="1" placeholder="fichas" data-valor="' + m.id + '">' +
        '<button class="btn btn-solid" data-confirmar="' + m.id + '">Apostar</button>' +
        '<span class="is-dica" data-dica="' + m.id + '"></span></div>' : '') +
      (!s && !fechado ? '<div class="is-dica" style="margin-top:8px"><a href="/perfil.html">Entre</a> para apostar.</div>' : '') +
    '</div>';
  }).join('');

  box.querySelectorAll('.is-opcao').forEach(b => {
    b.addEventListener('click', () => {
      const form = box.querySelector('[data-form="' + b.dataset.mercado + '"]');
      if(!form) return;
      form.hidden = false;
      form.dataset.opcao = b.dataset.opcao;
      box.querySelectorAll('.is-opcao[data-mercado="' + b.dataset.mercado + '"]').forEach(x => x.classList.remove('minha'));
      b.classList.add('minha');
      const dica = form.querySelector('[data-dica]');
      if(dica && EU) dica.textContent = 'seu teto neste mercado: ' + Number(EU.teto || 0).toLocaleString('pt-BR') + ' fichas';
      const inp = form.querySelector('input'); if(inp) inp.focus();
    });
  });
  box.querySelectorAll('[data-confirmar]').forEach(b => {
    b.addEventListener('click', async () => {
      const id = b.dataset.confirmar;
      const form = box.querySelector('[data-form="' + id + '"]');
      const valor = Number(form.querySelector('input').value);
      const dica = form.querySelector('[data-dica]');
      b.disabled = true; b.textContent = 'Apostando…';
      const r = await apiIS({ action: 'apostar', mercado_id: Number(id), opcao_id: Number(form.dataset.opcao), valor });
      b.disabled = false; b.textContent = 'Apostar';
      if(!r.ok){ if(dica) dica.textContent = r.error; return; }
      await carregarEu();
      despacharIS();
    });
  });
  box.querySelectorAll('[data-cancelar]').forEach(b => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await apiIS({ action: 'cancelarAposta', mercado_id: Number(b.dataset.cancelar) });
      b.disabled = false;
      if(!r.ok){ alert(r.error); return; }
      await carregarEu();
      despacharIS();
    });
  });
}

/* ---- página da categoria: abas ---- */
async function paginaCategoria(){
  const main = document.getElementById('isMain');
  const j = await apiGet({ categoria: PAGINA.arg });
  if(!j.ok) throw new Error(j.error || 'categoria não encontrada');
  const cat = j.categoria;
  const aba = window.__isAbaCategoria || 'classificacao';

  const abas = [
    { id: 'classificacao', rot: 'Classificação' },
    { id: 'chaveamento',   rot: 'Chaveamento' },
    { id: 'partidas',      rot: 'Partidas' },
    { id: 'artilharia',    rot: 'Artilharia' },
    { id: 'equipes',       rot: 'Equipes' }
  ];

  main.innerHTML =
    '<section class="is-secao"><h2>' + esc(cat.nome) + ' <span class="cont">' + esc(cat.status) + '</span></h2>' +
      '<div class="is-abas" id="isAbas">' + abas.map(a =>
        '<button class="is-aba' + (aba === a.id ? ' ativo' : '') + '" data-aba="' + a.id + '">' + a.rot + '</button>').join('') +
      '</div>' +
      '<div id="isAbaConteudo" style="margin-top:12px"></div>' +
    '</section>';

  main.querySelectorAll('#isAbas .is-aba').forEach(b => {
    b.addEventListener('click', () => { window.__isAbaCategoria = b.dataset.aba; paginaCategoria(); });
  });

  const alvo = document.getElementById('isAbaConteudo');
  if(aba === 'classificacao') alvo.innerHTML = htmlClassificacao(j);
  else if(aba === 'chaveamento') alvo.innerHTML = htmlChaveamento(j);
  else if(aba === 'partidas') alvo.innerHTML = '<div class="is-card">' + listaPorDia(j.partidas || [], {}) + '</div>';
  else if(aba === 'artilharia') alvo.innerHTML = htmlArtilharia(j);
  else alvo.innerHTML = htmlEquipesDaCategoria(j);
}

function htmlClassificacao(j){
  const cat = j.categoria;
  const ctx = { partidas: j.partidas || [], pontos_vitoria: cat.pontos_vitoria,
                pontos_empate: cat.pontos_empate, pontos_derrota: cat.pontos_derrota };
  const grupos = j.grupos || [];
  const blocos = grupos.length
    ? grupos.map(g => ({ nome: 'Grupo ' + g.nome, linhas: (j.classificacao || []).filter(l => String(l.grupo_id) === String(g.id)) }))
    : [{ nome: cat.nome, linhas: (j.classificacao || []).filter(l => l.grupo_id == null) }];

  return blocos.map(b => {
    if(!b.linhas.length) return '';
    const ord = ordenarClassificacao(b.linhas, cat.desempate, ctx);
    const temAsterisco = ord.some(l => l.confrontoInconclusivo);
    const zerada = ord.every(l => !l.jogos);
    return '<div class="is-card" style="margin-bottom:12px">' +
      '<div class="is-dia">' + esc(b.nome) + '</div>' +
      '<table class="is-tabela"><thead><tr>' +
        '<th>Equipe</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th>' +
        '<th class="so-desktop">GP</th><th class="so-desktop">GC</th><th>SG</th>' +
      '</tr></thead><tbody>' +
      ord.map(l => {
        const e = equipe(l.equipe_id) || {};
        return '<tr>' +
          '<td class="equipe"><span class="pos">' + l.posicao + '</span>' +
            '<i class="is-faixa"' + (e.cor ? ' style="background:' + esc(e.cor) + '"' : '') + '></i>' +
            (e.escudo ? '<img class="is-escudo" src="' + esc(e.escudo) + '" alt="" loading="lazy">'
                      : '<span class="is-iniciais">' + esc(String(e.sigla || '').slice(0, 3)) + '</span>') +
            '<span>' + esc(e.nome || '—') + '</span>' +
            (l.confrontoInconclusivo ? '<span class="is-ast" title="empate de três ou mais: o confronto direto não decide">*</span>' : '') +
          '</td>' +
          '<td class="pts">' + l.pontos + '</td><td>' + l.jogos + '</td><td>' + l.vitorias + '</td>' +
          '<td>' + l.empates + '</td><td>' + l.derrotas + '</td>' +
          '<td class="so-desktop">' + l.pontos_pro + '</td><td class="so-desktop">' + l.pontos_contra + '</td>' +
          '<td>' + (l.saldo > 0 ? '+' : '') + l.saldo + '</td></tr>';
      }).join('') +
      '</tbody></table>' +
      (zerada ? '<div class="is-nota">Ainda não houve partida nesta chave — a tabela começa zerada de propósito.</div>' : '') +
      (temAsterisco ? '<div class="is-nota"><span class="is-ast">*</span> Três ou mais equipes empatadas: o confronto direto não define ordem entre elas, então o critério seguinte decidiu.</div>' : '') +
      '<div class="is-nota">Desempate: ' + esc((cat.desempate || []).join(' → ')) + '</div>' +
    '</div>';
  }).join('') || '<div class="is-card"><div class="is-vazio">Sem grupos cadastrados nesta categoria.</div></div>';
}

/* ---- chaveamento: CSS Grid, sem biblioteca ---- */
function htmlChaveamento(j){
  const fases = (j.fases || []).filter(f => f.tipo === 'mata_mata')
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  if(!fases.length) return '<div class="is-card"><div class="is-vazio">Esta categoria ainda não tem mata-mata.</div></div>';

  const terceiro = fases.filter(f => /3|terceiro/i.test(f.nome));
  const principais = fases.filter(f => terceiro.indexOf(f) < 0);
  const porFase = id => (j.partidas || []).filter(p => String(p.fase_id) === String(id))
    .sort((a, b) => (a.chave_ordem || 0) - (b.chave_ordem || 0));

  const cardDe = p => {
    const ea = p.equipe_a_obj, eb = p.equipe_b_obj;
    const tem = p.placar_a != null && p.placar_b != null;
    const venc = p.vencedor_id || (tem && Number(p.placar_a) !== Number(p.placar_b)
      ? (Number(p.placar_a) > Number(p.placar_b) ? p.equipe_a : p.equipe_b) : null);
    const lado = (e, id, placar, origemPartida, origemTipo) => {
      const cls = venc ? (String(venc) === String(id) ? ' venceu' : ' perdeu') : '';
      const nome = e ? esc(e.nome || e.sigla)
        : '<span class="indef">' + (origemPartida ? (origemTipo === 'perdedor' ? 'Perdedor' : 'Vencedor') + ' de #' + origemPartida : 'A definir') + '</span>';
      return '<div class="is-ch-lado' + cls + '">' +
        '<i class="is-faixa"' + (e && e.cor ? ' style="background:' + esc(e.cor) + '"' : '') + '></i>' +
        (e && e.escudo ? '<img class="is-escudo" src="' + esc(e.escudo) + '" alt="" loading="lazy">'
                       : '<span class="is-iniciais">' + esc(String((e && e.sigla) || '').slice(0, 3)) + '</span>') +
        '<span class="nome">' + nome + '</span>' +
        '<span class="pl">' + (placar != null ? placar : '–') + '</span></div>';
    };
    return '<a class="is-ch-card" href="/interseries/partida/' + p.id + '">' +
      lado(ea, p.equipe_a, p.placar_a, p.origem_a_partida, p.origem_a_tipo) +
      lado(eb, p.equipe_b, p.placar_b, p.origem_b_partida, p.origem_b_tipo) + '</a>';
  };

  /* campeão: se a final encerrou, ele ganha um card só dele */
  const final = principais[principais.length - 1];
  const pf = final ? porFase(final.id)[0] : null;
  const campeao = pf && pf.status === 'encerrada'
    ? equipe(pf.vencedor_id || (Number(pf.placar_a) > Number(pf.placar_b) ? pf.equipe_a : pf.equipe_b)) : null;

  return '<div class="is-card"><div class="is-chave-rolo"><div class="is-chave">' +
    principais.map(f =>
      '<div class="is-rodada"><div class="is-rodada-nome">' + esc(f.nome) + '</div>' +
      porFase(f.id).map(cardDe).join('') + '</div>').join('') +
    (campeao ? '<div class="is-rodada" style="justify-content:center"><div class="is-campeao">' +
      '<div class="lbl">Campeão</div><div class="nome">' + esc(campeao.nome) + '</div></div></div>' : '') +
  '</div></div>' +
  (terceiro.length ? '<div class="is-terceiro" style="padding:0 12px 12px">' +
    terceiro.map(f => '<div class="is-rodada-nome" style="text-align:left">' + esc(f.nome) + '</div>' +
      '<div style="max-width:var(--is-card-w)">' + porFase(f.id).map(cardDe).join('') + '</div>').join('') +
    '</div>' : '') +
  '</div>';
}

function htmlArtilharia(j){
  const lista = (j.artilharia || []);
  if(!lista.length) return '<div class="is-card"><div class="is-vazio">Ninguém marcou ainda — ou os gols não estão sendo anotados.</div></div>';
  const nomeAtleta = id => ((j.atletas || []).find(a => String(a.id) === String(id)) || {}).nome || '—';
  return '<div class="is-card"><table class="is-tabela"><thead><tr><th>Atleta</th><th>Equipe</th><th>Gols</th></tr></thead><tbody>' +
    lista.map((a, i) => {
      const e = equipe(a.equipe_id) || {};
      return '<tr><td class="equipe"><span class="pos">' + (i + 1) + '</span>' + esc(nomeAtleta(a.atleta_id)) + '</td>' +
        '<td>' + esc(e.sigla || '') + '</td><td class="pts">' + a.gols + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function htmlEquipesDaCategoria(j){
  const ids = (j.categoria_equipes || []).map(x => x.equipe_id);
  if(!ids.length) return '<div class="is-card"><div class="is-vazio">Nenhuma equipe inscrita nesta categoria.</div></div>';
  return '<div class="is-card">' + ids.map(id => {
    const e = equipe(id) || {};
    return '<a class="is-linha" href="/interseries/equipe/' + id + '" style="grid-template-columns:1fr">' +
      '<span class="is-time">' +
        '<i class="is-faixa"' + (e.cor ? ' style="background:' + esc(e.cor) + '"' : '') + '></i>' +
        (e.escudo ? '<img class="is-escudo" src="' + esc(e.escudo) + '" alt="" loading="lazy">'
                  : '<span class="is-iniciais">' + esc(String(e.sigla || '').slice(0, 3)) + '</span>') +
        '<span class="nome">' + esc(e.nome || '') + '</span></span></a>';
  }).join('') + '</div>';
}

async function paginaEquipe(){
  const main = document.getElementById('isMain');
  const j = await apiGet({ equipe: PAGINA.arg });
  if(!j.ok) throw new Error(j.error || 'equipe não encontrada');
  const e = j.equipe, ap = j.aproveitamento || {};
  const futuras = (j.partidas || []).filter(p => p.status === 'agendada' || p.status === 'ao_vivo');
  const passadas = (j.partidas || []).filter(p => p.status === 'encerrada').reverse();

  main.innerHTML =
    '<section class="is-secao"><h2>' + esc(e.nome) + ' <span class="cont">' + esc(e.sigla) + '</span></h2>' +
      '<div class="is-card"><table class="is-tabela"><thead><tr>' +
        '<th>Aproveitamento</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>%</th>' +
      '</tr></thead><tbody><tr><td class="equipe">' + esc(e.nome) + '</td>' +
        '<td>' + (ap.jogos || 0) + '</td><td>' + (ap.vitorias || 0) + '</td><td>' + (ap.empates || 0) + '</td>' +
        '<td>' + (ap.derrotas || 0) + '</td><td>' + (ap.gols_pro || 0) + '</td><td>' + (ap.gols_contra || 0) + '</td>' +
        '<td>' + (ap.saldo > 0 ? '+' : '') + (ap.saldo || 0) + '</td><td class="pts">' + (ap.percentual || 0) + '%</td>' +
      '</tr></tbody></table></div></section>' +
    (futuras.length ? '<section class="is-secao"><h2>Próximas</h2><div class="is-card">' + listaPorDia(futuras, {}) + '</div></section>' : '') +
    (passadas.length ? '<section class="is-secao"><h2>Resultados</h2><div class="is-card">' + passadas.map(p => linhaPartida(p, {})).join('') + '</div></section>' : '') +
    '<section class="is-secao"><h2>Elenco</h2><div class="is-card">' +
      ((j.elenco || []).length ? j.elenco.map(a =>
        '<div class="is-linha" style="grid-template-columns:62px 1fr">' +
          '<span class="is-estado">' + (a.numero != null ? esc(a.numero) : '—') + '</span>' +
          '<span class="is-confronto" style="display:block">' + esc(a.nome) +
            (a.posicao ? ' <span class="is-cotacao">' + esc(a.posicao) + '</span>' : '') + '</span></div>').join('')
      : '<div class="is-vazio">Elenco não cadastrado.</div>') +
    '</div></section>';
}

async function paginaApostas(){
  const main = document.getElementById('isMain');
  const s = usuarioLogado();
  if(!s){
    main.innerHTML = '<div class="is-erro"><h2>Entre para apostar</h2>' +
      '<p>As fichas são fictícias e a conta é a mesma do CETECritic.</p>' +
      '<a class="btn btn-solid" href="/perfil.html">Entrar</a></div>';
    return;
  }
  await carregarEu();
  const jm = await apiGet({ mercados: 1, status: 'aberto' });

  const porMercado = {};
  (EU.mercados || []).forEach(m => { porMercado[String(m.id)] = m; });
  const porOpcao = {};
  (EU.opcoes || []).forEach(o => { porOpcao[String(o.id)] = o; });

  const abertas = (EU.apostas || []).filter(a => (porMercado[String(a.mercado_id)] || {}).status === 'aberto'
                                              || (porMercado[String(a.mercado_id)] || {}).status === 'fechado');
  const resolvidas = (EU.apostas || []).filter(a => abertas.indexOf(a) < 0);

  const linhaAposta = a => {
    const m = porMercado[String(a.mercado_id)] || {};
    const o = porOpcao[String(a.opcao_id)] || {};
    const acertou = m.opcao_vencedora && String(m.opcao_vencedora) === String(a.opcao_id);
    return '<a class="is-linha" href="' + (m.partida_id ? '/interseries/partida/' + m.partida_id : '/interseries/apostas') + '" style="grid-template-columns:1fr 110px">' +
      '<span class="is-confronto" style="display:block"><b>' + esc(m.titulo || '') + '</b>' +
        '<span class="is-cotacao"> · ' + esc(o.rotulo || '') + '</span>' +
        (m.status === 'liquidado' ? (acertou ? ' <span class="is-ast">✓ acertou</span>' : ' <span class="is-cotacao">não foi dessa vez</span>') : '') +
      '</span>' +
      '<span class="is-meta">' + Number(a.valor).toLocaleString('pt-BR') + ' fichas</span></a>';
  };

  main.innerHTML =
    '<section class="is-secao"><h2>Suas fichas</h2><div class="is-card">' +
      '<div class="is-linha" style="grid-template-columns:1fr auto">' +
        '<span class="is-confronto" style="display:block">Saldo</span>' +
        '<span class="is-meta" style="font-size:15px;font-weight:800;color:var(--gold)">' +
          Number(EU.saldo).toLocaleString('pt-BR') + '</span></div>' +
      '<div class="is-nota">Teto por mercado: <b>' + Number(EU.teto || 0).toLocaleString('pt-BR') + '</b> fichas (' +
        Number(ESTADO.config.teto_percentual || 25) + '% do saldo). ' +
        (EU.mesadaCreditada ? 'Sua mesada de hoje já foi creditada.' : 'A mesada entra na primeira visita do dia.') + '</div>' +
    '</div></section>' +
    '<section class="is-secao"><h2>Mercados abertos</h2><div class="is-card" id="isMercadosAbertos"></div></section>' +
    '<section class="is-secao"><h2>Suas apostas <span class="cont">' + abertas.length + ' em jogo</span></h2><div class="is-card">' +
      (abertas.length ? abertas.map(linhaAposta).join('') : '<div class="is-vazio">Nenhuma aposta em jogo.</div>') +
      (resolvidas.length ? '<div class="is-dia">Resolvidas</div>' + resolvidas.map(linhaAposta).join('') : '') +
    '</div></section>' +
    '<section class="is-secao"><h2>Extrato</h2><div class="is-card is-extrato">' +
      ((EU.extrato || []).length ? EU.extrato.map(l =>
        '<div class="linha"><div><div>' + esc(l.motivo || l.tipo) + '</div>' +
          '<div class="quando">' + esc(new Date(l.ts).toLocaleString('pt-BR')) + ' · ' + esc(l.tipo) + '</div></div>' +
          '<div class="valor ' + (Number(l.valor) >= 0 ? 'mais' : 'menos') + '">' +
            (Number(l.valor) > 0 ? '+' : '') + Number(l.valor).toLocaleString('pt-BR') + '</div></div>').join('')
      : '<div class="is-vazio">Sem lançamentos ainda.</div>') +
    '</div></section>';

  pintarMercados(jm.mercados || [], document.getElementById('isMercadosAbertos'));
}

async function paginaPlacar(){
  const main = document.getElementById('isMain');
  const por = window.__isPlacarPor || 'individual';
  const j = await apiGet({ placar: 1, por });
  if(!j.ok) throw new Error(j.error || 'não consegui carregar o placar');
  const lista = j.placar || [];

  main.innerHTML =
    '<section class="is-secao"><h2>Placar de apostadores</h2>' +
      '<div class="is-abas" id="isPlacarAbas">' +
        '<button class="is-aba' + (por === 'individual' ? ' ativo' : '') + '" data-por="individual">Individual</button>' +
        '<button class="is-aba' + (por === 'turma' ? ' ativo' : '') + '" data-por="turma">Por turma</button>' +
      '</div>' +
      (lista.length >= 3 ? '<div class="is-podio" style="margin-top:12px">' + lista.slice(0, 3).map((l, i) =>
        '<div class="p' + (i === 0 ? ' um' : '') + '"><div class="lugar">' + (i + 1) + 'º</div>' +
        '<div class="quem">' + esc(l.usuario || l.turma) + '</div>' +
        '<div class="fichas">' + Number(l.saldo).toLocaleString('pt-BR') + '</div></div>').join('') + '</div>' : '') +
      '<div class="is-card"><table class="is-tabela"><thead><tr>' +
        '<th>' + (por === 'turma' ? 'Turma' : 'Apostador') + '</th>' +
        (por === 'turma' ? '<th>Pessoas</th>' : '') + '<th>Fichas</th>' +
      '</tr></thead><tbody>' +
        (lista.length ? lista.map(l =>
          '<tr><td class="equipe"><span class="pos">' + l.posicao + '</span>' + esc(l.usuario || l.turma) + '</td>' +
          (por === 'turma' ? '<td>' + l.pessoas + '</td>' : '') +
          '<td class="pts">' + Number(l.saldo).toLocaleString('pt-BR') + '</td></tr>').join('')
        : '<tr><td colspan="3"><div class="is-vazio">Ninguém apostou ainda.</div></td></tr>') +
      '</tbody></table>' +
      (por === 'turma' && j.sem_turma ? '<div class="is-nota">' + j.sem_turma +
        ' apostador(es) sem turma cadastrada aparecem só no placar individual.</div>' : '') +
      '</div>' +
    '</section>';

  main.querySelectorAll('#isPlacarAbas .is-aba').forEach(b => {
    b.addEventListener('click', () => { window.__isPlacarPor = b.dataset.por; paginaPlacar(); });
  });
}

/* ---------------------------------------------------------------------
   REGRAS — não é enfeite, é o que evita discussão depois.

   Em especial as duas linhas sobre pênaltis: qualquer que fosse a escolha,
   metade das pessoas ia supor a outra. Estar escrito ANTES da primeira
   aposta é o que faz a regra valer.
   --------------------------------------------------------------------- */
function paginaRegras(){
  const c = ESTADO.config || {};
  const main = document.getElementById('isMain');
  main.innerHTML = '<section class="is-secao"><h2>Como funciona</h2><div class="is-card" style="padding:16px"><div class="is-regras">' +
    '<h3>As fichas</h3>' +
    '<p>As fichas são <strong>fictícias</strong>. Não valem dinheiro, não são compráveis, não são conversíveis em nada, e não existe prêmio material atrelado ao saldo.</p>' +
    '<ul>' +
      '<li>Todo mundo começa com <strong>' + Number(c.saldo_inicial || 1000).toLocaleString('pt-BR') + ' fichas</strong>.</li>' +
      '<li>Durante o evento, cada dia rende <strong>' + Number(c.mesada_diaria || 250).toLocaleString('pt-BR') + ' fichas</strong>, creditadas na primeira vez que você abre o site naquele dia.</li>' +
      '<li><strong>Não existe recarga.</strong> Quem zera espera a mesada do dia seguinte.</li>' +
      '<li><strong>Não existe transferência entre contas</strong>, sob nenhum nome.</li>' +
      '<li>Você pode apostar no máximo <strong>' + Number(c.teto_percentual || 25) + '% do seu saldo</strong> em cada mercado, e no mínimo ' + Number(c.aposta_minima || 10) + ' fichas.</li>' +
    '</ul>' +
    '<h3>Como o prêmio é calculado</h3>' +
    '<p>É <strong>aposta mútua</strong>: todas as apostas de um mercado entram num bolo, e o bolo se divide entre quem acertou, proporcional ao valor apostado. Ninguém define cotação, e a casa nunca paga mais do que entrou.</p>' +
    '<div class="is-exemplo">Um mercado recebe 1.000 fichas no total. Na opção vencedora havia duas apostas: 200 suas e 300 de outra pessoa (500 no total).<br>' +
      'Seu prêmio = 1.000 × 200 ÷ 500 = <strong>400 fichas</strong>. A outra pessoa leva 600.</div>' +
    '<ul>' +
      '<li><strong>Ninguém acertou?</strong> Devolve tudo — estorno integral para todos os apostadores.</li>' +
      '<li><strong>Todos acertaram?</strong> Cada um recebe de volta o que apostou.</li>' +
      '<li><strong>Sobrou ficha do arredondamento?</strong> A sobra fica registrada na conta do sistema. Nunca some.</li>' +
      '<li><strong>Partida cancelada ou W.O.?</strong> O mercado é cancelado e todas as apostas voltam.</li>' +
      '<li>Com poucos apostadores o bolo é irregular e os prêmios saem em números estranhos. Isso é característica da aposta mútua, não erro de conta.</li>' +
    '</ul>' +
    '<h3>Pênaltis, e por que dois mercados da mesma partida podem discordar</h3>' +
    '<p>Numa partida de mata-mata que termina empatada e é decidida nos pênaltis (ou por critério de regulamento):</p>' +
    '<ul>' +
      '<li>o mercado de <strong>vencedor</strong> paga por <strong>quem avançou</strong> — os pênaltis contam;</li>' +
      '<li>o mercado de <strong>margem</strong> paga pelo <strong>placar do tempo normal</strong> — então sai "Empate".</li>' +
    '</ul>' +
    '<p>As duas regras estão aqui desde antes da primeira aposta, de propósito.</p>' +
    '<h3>Quando um mercado fecha</h3>' +
    '<p>Pelo que vier <strong>primeiro</strong>: o horário de fechamento do mercado ou o horário marcado da partida. A conferência é feita no servidor — adiantar o relógio do computador não libera nada. Mercados de futuro (campeão da categoria, campeão geral) fecham <strong>antes da primeira partida do evento</strong>, para que todo mundo aposte com a mesma informação.</p>' +
    '<h3>Se um resultado for corrigido</h3>' +
    '<p>Nada é apagado. O prêmio antigo recebe um <strong>estorno</strong> e o novo prêmio é creditado — as três linhas aparecem no seu extrato, e dá para entender o que aconteceu sem abrir chamado.</p>' +
    '<h3>Transparência da apuração</h3>' +
    '<p>O extrato de cada mercado é público: dá para ver quanto entrou no bolo, quantos acertaram e quanto cada opção pagou. Não é preciso confiar — dá para conferir. Quem cadastra resultado e quem apura fichas são papéis separados no painel, e a recomendação é que <strong>quem apura não aposte</strong>.</p>' +
    '<h3>A competição</h3>' +
    '<ul>' +
      '<li>Cada categoria (ex.: vôlei feminino) tem regulamento, tabela e campeão próprios.</li>' +
      '<li>A classificação é <strong>calculada</strong> a partir das partidas encerradas da fase classificatória. Jogo de mata-mata não entra na tabela.</li>' +
      '<li>Os critérios de desempate são os que aparecem no rodapé de cada tabela. Quando três ou mais equipes empatam, o confronto direto não define ordem entre elas — a tabela marca isso com <span class="is-ast">*</span> e usa o critério seguinte.</li>' +
    '</ul>' +
    '<p style="margin-top:16px">Dúvida ou erro? Escreva para <a href="mailto:' + IS_EMAIL + '">' + IS_EMAIL + '</a>.</p>' +
  '</div></div></section>';
}

/* =====================================================================
   CARGA E DISPATCHER
   ===================================================================== */
async function carregarEstado(){
  const j = await apiGet({ estado: 1 });
  if(j.ativo === false){ ESTADO.ativo = false; return; }
  if(!j.ok) throw new Error(j.error || 'não consegui carregar o interséries');
  ESTADO = { config: j.config || {}, temporada: j.temporada || null,
             categorias: j.categorias || [], equipes: j.equipes || [], ativo: true };
  EQUIPES_POR_ID = {};
  ESTADO.equipes.forEach(e => { EQUIPES_POR_ID[String(e.id)] = e; });
  salvarCache('estado', ESTADO);
}

async function carregarEu(){
  const s = usuarioLogado();
  if(!s){ EU = null; return; }
  const j = await apiGet({ meu: 1, user: s.user, token: s.token });
  if(j.ok) EU = j;
  else if(j.error && /sessão/i.test(j.error)) { sairSessao(); EU = null; }
  pintarSaldo();
}

async function despacharIS(){
  if(!ESTADO.ativo){ telaDesligada(); return; }
  pintarChips();
  pintarSaldo();
  switch(PAGINA.tipo){
    case 'inicio':    return paginaInicio();
    case 'partidas':  return paginaPartidas();
    case 'partida':   return paginaPartida();
    case 'categoria': return paginaCategoria();
    case 'equipe':    return paginaEquipe();
    case 'atleta':    return paginaEquipe();          // Fase 3: por enquanto cai na equipe
    case 'apostas':   return paginaApostas();
    case 'placar':    return paginaPlacar();
    case 'regras':    return paginaRegras();
    default:
      telaDeErroIS('Página não encontrada', 'Este endereço do interséries não existe. Talvez o link esteja incompleto.');
  }
}

async function iniciarIS(){
  montarCasca();
  /* SWR: pinta a última versão conhecida antes de a rede responder */
  const cache = lerCache('estado');
  if(cache && cache.categorias){ ESTADO = cache; EQUIPES_POR_ID = {}; (cache.equipes || []).forEach(e => { EQUIPES_POR_ID[String(e.id)] = e; }); }

  try{
    await carregarEstado();
    await carregarEu();
    await despacharIS();
  }catch(e){
    /* A lição já aprendida no core.js: nunca uma página em branco. */
    console.error('[interseries] falha ao montar a página', PAGINA && PAGINA.tipo, e);
    telaDeErroIS('Não conseguimos carregar o Interséries',
      'Os dados não chegaram. Costuma ser passageiro — tente recarregar em alguns instantes.');
    return;
  }

  /* atualização automática: o intervalo vem do servidor, então dá para
     afrouxar em produção sem deploy */
  intervaloVisivel(async () => {
    /* ⚠️ não redesenha por cima de quem está digitando uma aposta. O
       refresh recria o DOM inteiro; fazer isso no meio da única interação
       que mexe com ficha apagaria o valor digitado sem explicação. */
    if(document.querySelector('.is-form-aposta:not([hidden])')) return;
    try{
      await carregarEstado();
      if(usuarioLogado()) await carregarEu();
      await despacharIS();
    }catch(e){ /* uma falha de rede não pode limpar a tela que já está boa */ }
  }, Math.max(Number(CADENCIA) || 20000, 5000));

  /* contagens regressivas: um tick por segundo, parado com a aba oculta */
  setInterval(() => {
    if(document.hidden) return;
    document.querySelectorAll('[data-conta-ate]').forEach(el => {
      el.textContent = contagem(el.dataset.contaAte);
    });
  }, 1000);
}

/* =====================================================================
   BOOT
   =====================================================================
   Só roda se a página definir `PAGINA` (é o que o interseries-template.html
   faz). O admin-interseries.html carrega este mesmo arquivo para reusar as
   funções e NÃO define `PAGINA` — então nada é renderizado por conta
   própria, e o painel monta a interface dele.
   ===================================================================== */
if(typeof PAGINA !== 'undefined' && PAGINA && PAGINA.tipo){
  iniciarIS();
}
