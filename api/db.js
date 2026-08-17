/* =====================================================================
   CETECRITIC — API sobre Supabase (substitui o Google Apps Script)
   Caminho: /api/db.js  (função serverless da Vercel, Node)
   =====================================================================
   Mantém o MESMO contrato do Apps Script: roteia POST por `action` e GET por
   querystring, devolvendo o MESMO JSON — então o core.js quase não muda.

   Variáveis de ambiente necessárias na Vercel:
     SUPABASE_URL          = https://xxxx.supabase.co
     SUPABASE_SECRET_KEY   = sb_secret_...   (chave secreta — só no servidor!)
     PUSH_SECRET           = mesmo valor do PUSH_SEND_SECRET (p/ listaPush/remover)
     RESET_SITE_URL        = https://cetecritic.xyz  (link do e-mail de reset)
     RESEND_API_KEY        = (opcional) p/ enviar o e-mail de recuperação
     RESEND_FROM           = (opcional) ex: "CETECritic <no-reply@seudominio>"
   ===================================================================== */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { migrarNomeUsuario, estadoConta, mensagemBloqueio, validarNome, apagarPorNome } = require('./_moderacao');
/* usado pelos avisos automáticos do bolão (abertura/fechamento) */
const { enviarParaTodos } = require('./enviar-push');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }
});

/* ---------------- constantes (iguais ao .gs) ---------------- */
const MAX_RATING = 10;
const MAX_TENTATIVAS = 5;

/* ---------------------------------------------------------------------
   TETO DE LINHAS

   O PostgREST corta o resultado em 1000 linhas por padrão — sem erro, sem
   aviso. Você simplesmente recebe menos dados do que existe, e o código
   segue calculando em cima do pedaço.

   Isso já mordeu este projeto: uma versão do apiDeletarConta usava
   select('*') sem filtro, as linhas do usuário não vinham, a FK barrava o
   delete final, o erro era engolido e a função devolvia ok:true com a conta
   ainda no banco.

   `LIMITE_ALTO` existe para deixar o teto EXPLÍCITO, e `avisarSeTruncou`
   grita no log quando o resultado volta exatamente cheio — que é o sinal de
   que a hora de paginar chegou. Prefira sempre um filtro que garanta poucas
   linhas; o limite é a rede de segurança, não a solução.
   --------------------------------------------------------------------- */
const LIMITE_ALTO = 10000;
function avisarSeTruncou(nome, data, limite){
  const n = (data || []).length;
  if(n >= (limite || LIMITE_ALTO)){
    console.warn('[cetecritic] ATENÇÃO: "' + nome + '" voltou com ' + n +
      ' linhas (no limite). Há dados sendo ignorados — hora de paginar.');
  }
  return data || [];
}
/* uma mensagem só pra "não existe" e "senha errada" — ver apiLogin */
const ERRO_LOGIN = 'usuário ou senha incorretos';
const LOCK_MS = 10 * 60 * 1000;
const CARIMBO_COOLDOWN_MS = 5 * 60 * 1000;
/* `curtida` é o ❤️ — a reação simples e padrão dos posts do feed. Vale também
   como carimbo de perfil: é o mesmo vocabulário nos dois lugares, de propósito. */
const CARIMBOS_VALIDOS = { curtida:1, joia:1, critico:1, parceiro:1, lenda:1, concordo:1, discordo:1, palmas:1, polemico:1 };
/* tamanho máximo do id de post guardado em carimbos.alvo ('feed:<ts>' / 'sub:<id>') */
const ALVO_MAX = 120;
const RESET_TTL_MS = 60 * 60 * 1000;
const SITE_URL = process.env.RESET_SITE_URL || 'https://cetecritic.xyz';
const PUSH_SECRET = process.env.PUSH_SECRET || '';

// trava de votação por ano (null = sempre aberta; ano ausente = fechado)
const FESTIVAL_END_BY_YEAR = {
  2027: new Date('2027-07-17T23:59:00-03:00'),
  2026: new Date('2026-07-18T23:59:00-03:00'),
  2025: null, 2024: null, 2023: null, 2022: null, 2021: null, 2020: null,
};
// datas de fim de votação vindas da tabela `edicoes` (editáveis pelo admin),
// com cache curto; cai no mapa fixo acima se o ano não estiver no banco.
let _fimCache = null, _fimCacheAt = 0;
async function fimVotacaoMap(){
  if(_fimCache && (Date.now() - _fimCacheAt) < 30000) return _fimCache;
  try{
    const { data } = await sb.from('edicoes').select('ano,fim_votacao').limit(LIMITE_ALTO);
    const m = {};
    (data||[]).forEach(r => { m[Number(r.ano)] = r.fim_votacao || null; });
    _fimCache = m; _fimCacheAt = Date.now();
  }catch(e){ _fimCache = _fimCache || {}; }
  return _fimCache;
}

/* ---------------------------------------------------------------------
   EDIÇÃO EM DESTAQUE — lida do banco, não fixada no código.

   ANTES existia aqui um `const CURRENT_EDITION_YEAR = 2026`, usado como
   `year` padrão do voto e do palpite quando o cliente não mandava. Todo o
   resto do sistema já descobria a edição atual pelo `config_site`; só este
   ponto não descobria. Resultado: no ano em que 2027 virasse destaque e
   alguém esquecesse de trocar a constante, um voto sem `year` explícito ia
   parar em 2026 — a classe de bug que aparece uma vez por ano e sempre na
   pior hora.

   O fallback existe para o caso de o banco não responder: melhor um ano
   provavelmente certo do que `NaN` no meio de uma votação.
   --------------------------------------------------------------------- */
const ANO_FALLBACK = 2026;
let _cfgCache = null, _cfgCacheAt = 0;
async function lerConfigSite(){
  if(_cfgCache && (Date.now() - _cfgCacheAt) < 30000) return _cfgCache;
  try{
    const { data } = await sb.from('config_site').select('dados').eq('id', 1).limit(1);
    const d = (data && data[0] && data[0].dados) ? data[0].dados : {};
    _cfgCache = d; _cfgCacheAt = Date.now();
    return d;
  }catch(e){ return _cfgCache || {}; }
}
async function anoEmDestaque(){
  const y = Number((await lerConfigSite()).EDICAO_EM_DESTAQUE);
  return y || ANO_FALLBACK;
}

/* ---------------------------------------------------------------------
   MODO MANUTENÇÃO — o lado do servidor

   A tela de manutenção que o visitante vê é desenhada no core.js, e ela é
   cortesia: quem mexer no localStorage passa por cima e vê o site. Isso é
   aceitável, porque o que a tela protege é a EXPERIÊNCIA de quem chega num
   site meio quebrado.

   O que NÃO é aceitável deixar passar é escrita. Se a manutenção existe
   porque algo está errado com os dados, um voto que entra no meio do
   conserto é um voto que vai ter que ser caçado depois. Por isso esta
   trava mora aqui, é conferida no servidor e não depende do cliente.

   Leitura continua liberada de propósito: quem já está com a página aberta
   consegue terminar de ler, e o próprio painel precisa das rotas de
   consulta pra funcionar.
   --------------------------------------------------------------------- */
const ACOES_BLOQUEADAS_MANUTENCAO = {
  voto:1, palpite:1, carimbo:1, reagir:1, reputacao:1, visita:1,
  perfil:1, trocarNome:1, deletarConta:1, apagarAvaliacao:1, registrar:1
};
/* login, logout, meuPerfil, notificações e reset ficam FORA da lista: a
   equipe precisa conseguir entrar justamente durante a manutenção. */

async function ehEquipe(usuario, token){
  if(!usuario || !token) return false;
  if(!(await verificarToken(usuario, token))) return false;
  const u = await acharUsuario(usuario);
  return !!(u && u.admin === true);
}

async function bloqueioManutencao(action, body){
  if(!ACOES_BLOQUEADAS_MANUTENCAO[action]) return null;
  const m = (await lerConfigSite()).manutencao;
  if(!m || m.ativo !== true || m.bloquearApi === false) return null;
  /* a equipe passa — é ela quem está consertando */
  if(await ehEquipe(body && body.user, body && body.token)) return null;
  return String(m.mensagem || '').trim()
    || 'O site está em manutenção no momento. Tente de novo daqui a pouco.';
}

/* ---------------------------------------------------------------------
   LIMITE DE TAXA (rate limit)

   Janela fixa contada na tabela `rate_limite` (ver migracao-seguranca.sql).
   É deliberadamente simples: uma linha por chave, com um contador e a hora
   em que a janela expira. Não é um algoritmo preciso — duas instâncias da
   Vercel podem incrementar juntas e deixar passar uma chamada a mais. Isso
   é aceitável: o objetivo é impedir automação em massa, não contar de forma
   exata.

   Se a tabela não existir (migração não rodou), tudo é liberado e um aviso
   vai pro log. É o mesmo padrão de degradação que o projeto já usa com as
   colunas `papel` e `sessoes`: uma migração pendente não pode derrubar o
   site no meio do festival.
   --------------------------------------------------------------------- */
let _rateIndisponivel = false;
function hashCurto(s){
  return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 32);
}
/* o IP de quem chamou, do jeito que a Vercel entrega. Guardamos só o HASH:
   serve pra contar sem virar um cadastro de endereços de quem votou. */
function ipDe(req){
  const xf = String((req && req.headers && req.headers['x-forwarded-for']) || '');
  const ip = xf.split(',')[0].trim() || String((req && req.headers && req.headers['x-real-ip']) || '') || 'sem-ip';
  return hashCurto(ip + '|' + (process.env.RATE_SALT || 'cetecritic'));
}
/* devolve { ok } ou { ok:false, esperar } com os segundos que faltam */
async function limiteTaxa(chave, maximo, janelaMs){
  if(_rateIndisponivel) return { ok: true };
  const agora = Date.now();
  try{
    const { data, error } = await sb.from('rate_limite').select('chave,contagem,janela_ate').eq('chave', chave).limit(1);
    if(error){ _rateIndisponivel = true; console.warn('[cetecritic] rate_limite indisponível — rode migracao-seguranca.sql'); return { ok: true }; }
    const linha = (data || [])[0];
    if(!linha || Number(linha.janela_ate) <= agora){
      await sb.from('rate_limite').upsert({ chave, contagem: 1, janela_ate: agora + janelaMs }, { onConflict: 'chave' });
      return { ok: true };
    }
    if(Number(linha.contagem) >= maximo){
      return { ok: false, esperar: Math.ceil((Number(linha.janela_ate) - agora) / 1000) };
    }
    await sb.from('rate_limite').update({ contagem: Number(linha.contagem) + 1 }).eq('chave', chave);
    return { ok: true };
  }catch(e){ return { ok: true }; }   // limite nunca derruba a ação
}
function textoEspera(seg){
  if(seg >= 60) return Math.ceil(seg / 60) + ' minuto(s)';
  return seg + ' segundo(s)';
}
async function votingClosed(year){
  const y = Number(year);
  const m = await fimVotacaoMap();
  if(y in m){
    const end = m[y];
    if(!end) return false;                 // sem data no banco = sempre aberta
    return new Date() >= new Date(end);
  }
  // fallback: mapa fixo (compat)
  if(!(y in FESTIVAL_END_BY_YEAR)) return true;
  const end = FESTIVAL_END_BY_YEAR[y];
  return end === null ? false : (new Date() >= end);
}

/* ==================================================================
   BOLÃO
   ==================================================================
   Regras combinadas:
     - abre junto com o Monte o Seu (edicoes.monte_abre_em);
     - o palpite trava no horário da Noite 1 (ou em extra.bolao.fechaEm);
     - a partir daí ninguém edita e o placar vai se formando conforme as
       notas reais saem;
     - a página some do menu 1 dia depois do fim da votação.

   O palpite individual de terceiro NUNCA sai daqui. O servidor devolve
   placar já calculado; palpite cru só volta pro próprio dono, com token. */

/* pontuação linear, 0 a 5 por peça. A faixa de 5 é 0,1 pra "cravou" valer de
   verdade (palpite 7,5 numa peça que fechou 7,59 conta como exato).
   O epsilon existe porque 7,6 - 7,5 dá 0.10000000000000053 em float. */
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

/* config do bolão de um ano: junta os campos da edição com o extra.bolao */
let _edCache = null, _edCacheAt = 0;
async function lerEdicoesBolao(){
  if(_edCache && (Date.now() - _edCacheAt) < 30000) return _edCache;
  try{
    const { data } = await sb.from('edicoes').select('ano,monte_abre_em,fim_votacao,em_breve,extra').limit(LIMITE_ALTO);
    _edCache = data || []; _edCacheAt = Date.now();
  }catch(e){ _edCache = _edCache || []; }
  return _edCache;
}
/* a Noite 1 é o prazo padrão do palpite */
async function dataNoite1(year){
  try{
    const { data } = await sb.from('noites').select('data').eq('ano', Number(year)).eq('noite', 1).limit(1);
    const d = data && data[0] && data[0].data;
    return d ? new Date(d) : null;
  }catch(e){ return null; }
}
async function estadoBolao(year){
  const y = Number(year);
  const linha = (await lerEdicoesBolao()).find(e => Number(e.ano) === y) || null;
  const extra = asObj(linha && linha.extra);
  const cfg = asObj(extra.bolao);
  const agora = new Date();

  /* desligado explicitamente no painel, ou edição ainda "em breve".

     `existe` reflete a LINHA, não o bolão. ANTES devolvia sempre false aqui,
     e como o apiPalpite testa `existe` antes de `ativo`, quem tentasse
     palpitar numa edição com o bolão desligado recebia "essa edição não
     existe" — a mensagem certa ("o bolão desta edição está desativado")
     ficava na linha seguinte, inalcançável. */
  if(cfg.ativo === false || (linha && linha.em_breve)) {
    return { existe: !!linha, ativo:false, aberto:false, palpiteFechado:true, encerrado:true };
  }

  const abre = (linha && linha.monte_abre_em) ? new Date(linha.monte_abre_em) : null;
  const fimVot = (linha && linha.fim_votacao) ? new Date(linha.fim_votacao) : null;

  /* prazo do palpite: o do painel > horário da Noite 1 > fim da votação.
     O último degrau é rede de segurança pras edições antigas, que podem não
     ter data de noite cadastrada — sem ele o palpite nunca "fecharia" e o
     placar daquele ano jamais apareceria. */
  const fechaCfg = cfg.fechaEm ? new Date(cfg.fechaEm) : null;
  let fechaPalpite = (fechaCfg && !isNaN(fechaCfg)) ? fechaCfg : await dataNoite1(y);
  if(!fechaPalpite || isNaN(fechaPalpite)) fechaPalpite = (fimVot && !isNaN(fimVot)) ? fimVot : null;

  /* a aba sai do menu 1 dia depois das notas fecharem */
  const somePorFim = (fimVot && !isNaN(fimVot)) ? new Date(fimVot.getTime() + 24*60*60*1000) : null;

  const liberado = !abre || isNaN(abre) || agora >= abre;
  const palpiteFechado = !!(fechaPalpite && agora >= fechaPalpite);

  return {
    existe: !!linha,
    ativo: true,
    abreEm: (abre && !isNaN(abre)) ? abre.toISOString() : null,
    fechaPalpiteEm: fechaPalpite ? fechaPalpite.toISOString() : null,
    somePorFimEm: somePorFim ? somePorFim.toISOString() : null,
    liberado,
    aberto: liberado && !palpiteFechado,       // dá pra palpitar agora
    palpiteFechado,
    encerrado: !!(somePorFim && agora >= somePorFim),
    regras: String(cfg.regras || '')
  };
}

/* média real de cada peça do ano — é contra ela que o palpite é medido */
async function mediasReaisDoAno(year){
  const { data } = await sb.from('submissions').select('grid').eq('year', Number(year)).limit(LIMITE_ALTO);
  avisarSeTruncou('mediasReaisDoAno ' + year, data);
  const soma = {}, cont = {};
  (data||[]).forEach(r => {
    const g = asObj(r.grid);
    if(hasInvalidRating(g)) return;              // mesma limpeza do feed público
    Object.keys(g).forEach(k => {
      const v = Number(g[k]);
      if(isNaN(v)) return;
      soma[k] = (soma[k] || 0) + v;
      cont[k] = (cont[k] || 0) + 1;
    });
  });
  const medias = {};
  Object.keys(soma).forEach(k => { medias[k] = soma[k] / cont[k]; });
  return medias;
}

/* ---- avisos automáticos de abertura e fechamento ----
   No plano Hobby o cron da Vercel roda ~1x/dia, grosso demais pra um bolão
   que abre num horário marcado. Então quem dispara é o próprio tráfego do
   site: a cada request do feed conferimos se passou da hora.

   O `bc_id` determinístico é o que garante o "uma vez só": gravamos o
   broadcast ANTES de enviar o push, então uma segunda instância que entre
   junto encontra a linha e desiste. O índice único em broadcasts(bc_id)
   (ver migracao-bolao.sql) fecha a janela de corrida de vez.

   CUIDADO: a linha do broadcast é a ÚNICA memória de "este aviso já saiu".
   Excluí-la de verdade faz o servidor achar que nunca avisou — ele recria o
   banner e reenvia o push pra todo mundo. Por isso o painel ARQUIVA os ids
   `bolao-*` em vez de apagar (ver deletarBanner em /api/content.js). Se um
   dia surgir outro aviso automático, ele precisa do mesmo tratamento. */
async function avisarUmaVez(bcId, titulo, corpo, url){
  const { data } = await sb.from('broadcasts').select('bc_id').eq('bc_id', bcId).limit(1);
  if(data && data.length) return false;
  const ins = await sb.from('broadcasts').insert({
    bc_id: bcId, titulo, corpo, url, ts: Date.now(), dur: 25
  });
  if(ins.error) return false;                 // perdeu a corrida: a outra instância já mandou
  try{ await enviarParaTodos({ title: titulo, body: corpo, url, semBroadcast: true }); }
  catch(e){ /* o banner já está no ar mesmo se o push falhar */ }
  return true;
}

/* Um aviso automático só faz sentido PERTO da hora dele.

   Esta janela existe porque o guard antigo (`estado.encerrado`) não segurava
   nada nas edições históricas, e o site acabou publicando "O bolão de 2017
   fechou", "de 2018 fechou", "de 2019 fechou"... um banner (e um push) para
   cada ano do acervo.

   Por que `encerrado` falhava: ele depende de `fim_votacao`, e as edições
   antigas têm esse campo VAZIO — que o resto do código lê como "votação
   sempre aberta". Sem `fim_votacao` não há `somePorFim`, logo `encerrado` é
   false, logo a edição de 2017 passava batido. E como a Noite 1 dela é de
   2017, `palpiteFechado` era true: o servidor anunciava, com toda a razão
   interna, que o palpite acabava de travar.

   A janela resolve isso pela raiz e não depende de nenhum campo estar
   preenchido: um aviso atrasado mais de 48h simplesmente não sai. Serve
   também para o futuro — um deploy meses depois do festival não ressuscita
   o anúncio, e uma edição adicionada ao acervo já com as datas no passado
   entra caladinha. */
const AVISO_JANELA_MS = 48 * 60 * 60 * 1000;
function momentoRecente(quando){
  if(!quando) return false;
  const t = new Date(quando).getTime();
  if(!isFinite(t)) return false;
  const d = Date.now() - t;
  return d >= 0 && d <= AVISO_JANELA_MS;
}

let _bolaoAvisoAt = 0;
async function dispararAvisosBolao(){
  if(Date.now() - _bolaoAvisoAt < 60000) return;   // no máximo 1 verificação por minuto
  _bolaoAvisoAt = Date.now();
  try{
    for(const linha of await lerEdicoesBolao()){
      const y = Number(linha.ano);
      if(!y) continue;
      const estado = await estadoBolao(y);
      if(!estado.ativo || !estado.existe) continue;
      if(estado.encerrado) continue;
      const t = asObj(asObj(asObj(linha.extra).bolao).textos);

      /* `abreEm` nulo = bolão sem hora marcada de abertura (nasce aberto).
         Nesse caso não há momento nenhum para anunciar, e a janela devolve
         false de propósito: para ter o aviso de abertura, preencha o
         "Monte o Seu abre em" da edição no painel. */
      if(estado.liberado && !estado.palpiteFechado && momentoRecente(estado.abreEm)){
        await avisarUmaVez('bolao-abre:' + y,
          String(t.abreTitulo || '').trim() || ('🔮 O bolão de ' + y + ' abriu!'),
          String(t.abreCorpo || '').trim() || 'Palpite a nota de cada peça antes da primeira noite começar. Vale preencher tudo.',
          '/' + y + '/bolao.html');
      }
      if(estado.palpiteFechado && momentoRecente(estado.fechaPalpiteEm)){
        await avisarUmaVez('bolao-fecha:' + y,
          String(t.fechaTitulo || '').trim() || ('🔒 O bolão de ' + y + ' fechou'),
          String(t.fechaCorpo || '').trim() || 'Os palpites estão travados. Acompanhe o placar conforme as notas vão saindo!',
          '/' + y + '/bolao.html');
      }
    }
  }catch(e){ /* aviso é acessório: nunca derruba o request de quem está lendo */ }
}

/* ranking do bolão de um ano. Só nomes e pontos — nunca o palpite de ninguém.
   Desempate: mais pontos → menor erro médio → quem palpitou primeiro.
   Quem empata em pontos E erro divide a mesma posição (ambos levam a badge). */
async function placarBolao(year){
  const y = Number(year);
  const medias = await mediasReaisDoAno(y);
  const { data } = await sb.from('palpites').select('usuario,palpites,ts').eq('year', y).limit(LIMITE_ALTO);
  avisarSeTruncou('palpites do ano ' + y, data);
  const pmap = await lerPerfisMap();
  const linhasBrutas = (data || []).filter(r => r.usuario);

  /* menor erro de cada peça entre TODOS — base da badge "Visionário".
     Precisa ser calculado aqui porque o cliente não vê mais palpite alheio. */
  const melhorErroPorPeca = {};
  linhasBrutas.forEach(r => {
    const pal = asObj(r.palpites);
    Object.keys(pal).forEach(k => {
      if(medias[k] === undefined) return;
      const er = Math.abs(Number(pal[k]) - medias[k]);
      if(isNaN(er)) return;
      if(melhorErroPorPeca[k] === undefined || er < melhorErroPorPeca[k]) melhorErroPorPeca[k] = er;
    });
  });

  /* "noite ouro" = a de maior média do ano — base da badge "Cálculo Exato" */
  const somaNoite = {}, contNoite = {};
  Object.keys(medias).forEach(k => {
    const m = /^s(\d+)e\d+$/.exec(k);
    if(!m) return;
    const n = Number(m[1]);
    somaNoite[n] = (somaNoite[n] || 0) + medias[k];
    contNoite[n] = (contNoite[n] || 0) + 1;
  });
  let noiteOuro = null, melhorMedia = -Infinity;
  Object.keys(somaNoite).forEach(n => {
    const avg = somaNoite[n] / contNoite[n];
    if(avg > melhorMedia){ melhorMedia = avg; noiteOuro = Number(n); }
  });

  const linhas = linhasBrutas.map(r => {
    const pal = asObj(r.palpites);
    let pontos = 0, apuradas = 0, somaErro = 0, cravadas = 0;
    let oraculo = false, apostaRisco = false, visionario = false;
    let somaOuro = 0, nOuro = 0;
    Object.keys(pal).forEach(k => {
      if(medias[k] === undefined) return;        // peça sem nota ainda: fora da conta
      const p = Number(pal[k]);
      const er = Math.abs(p - medias[k]);
      const pts = pontosBolao(p, medias[k]);
      pontos += pts;
      if(pts === BOLAO_PONTOS_MAX) cravadas++;
      somaErro += er;
      apuradas++;
      /* sinais finos que viram badge no perfil */
      if(er < 0.05) oraculo = true;
      if((p <= 2 || p >= 9) && er < 0.5) apostaRisco = true;
      if(linhasBrutas.length >= 3 && melhorErroPorPeca[k] !== undefined && er <= melhorErroPorPeca[k] + 1e-9) visionario = true;
      const mn = /^s(\d+)e\d+$/.exec(k);
      if(mn && noiteOuro !== null && Number(mn[1]) === noiteOuro){ somaOuro += er; nOuro++; }
    });
    return {
      user: displayFeed(String(r.usuario), pmap),   // respeita o modo anônimo
      pontos, apuradas, cravadas,
      erroMedio: apuradas ? somaErro / apuradas : null,
      oraculo, apostaRisco, visionario,
      calculoExato: !!(nOuro && (somaOuro / nOuro) < 0.1),
      ts: Number(r.ts) || 0
    };
  }).filter(l => l.apuradas > 0);

  linhas.sort((a, b) => b.pontos - a.pontos || a.erroMedio - b.erroMedio || a.ts - b.ts);
  let pos = 0, chaveAnt = null;
  linhas.forEach((l, i) => {
    const chave = l.pontos + '|' + (l.erroMedio === null ? '' : l.erroMedio.toFixed(4));
    if(chave !== chaveAnt){ pos = i + 1; chaveAnt = chave; }
    l.pos = pos;
    delete l.ts;                                  // detalhe interno, não vai pro cliente
  });
  return { placar: linhas, pecasApuradas: Object.keys(medias).length, pontosPorPeca: BOLAO_PONTOS_MAX };
}

/* ---------------- helpers ---------------- */
const norm = u => String(u || '').trim().toLowerCase();

/* ---------------- senhas ----------------------------------------------
   Antes: sha256(salt|senha), UMA rodada. É rápido demais de propósito —
   se o banco vazar, uma GPU testa bilhões de tentativas por segundo e as
   senhas caem em minutos.

   Agora: scrypt (memory-hard, vem no core do Node — sem dependência nova).
   O hash novo é gravado no formato  s2$N$r$p$<hex>  pra dar pra mudar os
   parâmetros depois sem quebrar nada.

   COMPATIBILIDADE: contas antigas continuam com o hash sha256 e são
   migradas pra scrypt sozinhas no próximo login correto (ver apiLogin).
   Ninguém precisa trocar de senha. ---------------------------------- */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function igualSeguro(a, b){
  const ba = Buffer.from(String(a), 'utf8'), bb = Buffer.from(String(b), 'utf8');
  if(ba.length !== bb.length) return false;               // length já vaza pouco e é inevitável
  try{ return crypto.timingSafeEqual(ba, bb); }catch(e){ return false; }
}
function hashLegado(senha, salt){ return crypto.createHash('sha256').update(String(salt) + '|' + String(senha)).digest('hex'); }
function hashSenha(senha, salt){
  const dk = crypto.scryptSync(String(senha), String(salt), SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return 's2$' + SCRYPT.N + '$' + SCRYPT.r + '$' + SCRYPT.p + '$' + dk.toString('hex');
}
/* devolve { ok, migrar } — migrar=true quer dizer "a senha está certa, mas o
   hash guardado ainda é do formato antigo; regrave em scrypt" */
function conferirSenha(senha, salt, guardado){
  const g = String(guardado || '');
  if(g.indexOf('s2$') === 0){
    const partes = g.split('$');            // ['s2', N, r, p, hex]
    const hex = partes[4] || '';
    try{
      const dk = crypto.scryptSync(String(senha), String(salt), Buffer.from(hex, 'hex').length,
        { N: Number(partes[1]), r: Number(partes[2]), p: Number(partes[3]) });
      return { ok: igualSeguro(dk.toString('hex'), hex), migrar: false };
    }catch(e){ return { ok: false, migrar: false }; }
  }
  return { ok: igualSeguro(hashLegado(senha, salt), g), migrar: true };
}
/* usuário inexistente tem que custar o mesmo tempo de um scrypt real, senão
   dá pra descobrir quem existe cronometrando a resposta */
function gastarTempoSenha(){ try{ hashSenha('tempo-constante', 'tempo-constante'); }catch(e){} }

/* confere um segredo de servidor. Exige que ele EXISTA — antes, se a variável
   de ambiente não estivesse configurada, `String(body.secret||'') !== ''` dava
   verdadeiro pra quem mandasse a string vazia e a rota abria sozinha. */
function segredoOk(recebido, esperado){
  const e = String(esperado || '');
  if(!e) return false;
  return igualSeguro(String(recebido || ''), e);
}

function novoToken(){ return crypto.randomUUID().replace(/-/g, ''); }
function hashNum(s){ s = String(s).toLowerCase(); let h = 0; for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; } return h; }
function asObj(v){ if(!v) return {}; if(typeof v === 'object') return v; try{ return JSON.parse(v); }catch(e){ return {}; } }
function hasInvalidRating(grid){
  if(!grid) return true;
  return Object.keys(grid).some(k => { const v = Number(grid[k]); return v < 1 || isNaN(v) || v > MAX_RATING; });
}

async function acharUsuario(usuario){
  const alvo = norm(usuario);
  if(!alvo) return null;
  const { data } = await sb.from('usuarios').select('*').ilike('usuario', usuario).limit(10);
  return (data || []).find(r => norm(r.usuario) === alvo) || null;
}
/* Valida a sessão E o direito de usá-la.

   A checagem de banimento mora AQUI, no ponto por onde toda ação autenticada
   passa, e não espalhada rota a rota. Antes ela existia só no login e nas
   ações de interação — quem já tinha uma sessão aberta continuava editando
   perfil, registrando visita e salvando push mesmo suspenso.

   Custo: uma leitura a mais do usuário quando o token bate na tabela
   `sessoes`. É barato perto de deixar conta suspensa agindo. */
async function verificarToken(usuario, token){
  if(!usuario || !token) return false;
  const nu = norm(usuario);
  let tokenOk = false;
  // 1) sessões novas (múltiplos dispositivos)
  try{
    const { data } = await sb.from('sessoes').select('usuario').eq('token', String(token)).limit(5);
    if((data||[]).some(r => norm(r.usuario) === nu)) tokenOk = true;
  }catch(e){ /* tabela sessoes ainda não existe: cai no legado */ }
  const u = await acharUsuario(usuario);
  if(!u) return false;
  // 2) legado: token único guardado em usuarios (sessões antigas continuam válidas)
  if(!tokenOk && u.token && u.token === String(token)) tokenOk = true;
  if(!tokenOk) return false;
  // 3) conta suspensa não tem sessão válida, venha o token de onde vier
  if(estadoConta(u.perfil).banido) return false;
  return true;
}
// cria uma sessão (1 token por dispositivo). Se a tabela 'sessoes' não existir,
// cai no comportamento antigo (token único em usuarios) — login nunca quebra.
async function criarSessao(usuario, dispositivo){
  const token = novoToken();
  const now = Date.now();
  const { error } = await sb.from('sessoes').insert({ usuario, token, dispositivo: String(dispositivo || '').slice(0, 120), criado_em: now, ultimo_uso: now });
  if(error){ try{ await sb.from('usuarios').update({ token }).eq('usuario', usuario); }catch(e){} }
  return token;
}
/* ---------------------------------------------------------------------
   Barreira de moderação. Dois níveis, porque as regras são diferentes:
     'login'     -> só bloqueia conta SUSPENSA (banida)
     'interagir' -> bloqueia suspensa E silenciada (votar, carimbar, palpitar,
                    dar reputação — qualquer coisa que afete outras pessoas)
   Editar o próprio perfil e ler notificações continuam liberados para quem
   está só silenciado: a punição é sobre interação, não sobre a própria conta.
   --------------------------------------------------------------------- */
function bloqueioDe(u, nivel){
  if(!u) return null;
  const est = estadoConta(u.perfil);
  if(est.banido) return mensagemBloqueio(est);
  if(nivel === 'interagir' && est.silenciado) return mensagemBloqueio(est);
  return null;
}
async function barreiraModeracao(usuario, nivel){
  const u = await acharUsuario(usuario);
  return bloqueioDe(u, nivel);
}

// mapa normUser -> { user, display, anonimo, privado, email }
async function lerPerfisMap(){
  const { data } = await sb.from('usuarios').select('usuario,perfil').limit(LIMITE_ALTO);
  avisarSeTruncou('lerPerfisMap (usuarios)', data);
  const map = {};
  (data || []).forEach(r => {
    const usuario = String(r.usuario || ''); if(!usuario) return;
    const p = asObj(r.perfil);
    // anonimato "por período": se anon_ate passou, volta a ser não-anônimo
    // (expira sozinho na leitura, sem precisar de job). "sempre" = anon_ate null/ausente.
    const expirou = !!(p.anon_ate && Date.now() > Number(p.anon_ate));
    /* nome_bloqueado força anonimato aqui, no ponto que TODAS as telas
       públicas usam. Sem isso a pessoa desligaria o "modo anônimo" nas
       configurações e o nome escondido voltaria a aparecer. */
    const anon = (!!p.anonimo && !expirou) || !!p.nome_bloqueado;
    const display = anon ? (String(p.pseudo || '').trim() || ('Anônimo ' + (hashNum(usuario) % 9000 + 1000))) : usuario;
    map[norm(usuario)] = { user: usuario, display, anonimo: anon, privado: !!p.privado, email: String(p.email || '').trim(), verificado: p.email_verificado === true };
  });
  return map;
}
function displayFeed(usuario, map){ const m = map[norm(usuario)]; return (m && m.anonimo) ? m.display : String(usuario || ''); }
/* campos que NUNCA saem numa resposta pública (GET ?perfil=) — o `oauth`
   carrega o supabase_uid e o `email_verificado` é sinal interno */
const PERFIL_PRIVADO = [
  'email', 'notif', 'oauth', 'email_verificado', 'anon_modo', 'anon_ate',
  /* moderação: `nomes_antigos` guarda justamente o nome que foi escondido —
     vazar isso no perfil público anularia o motivo de ter escondido. E o
     estado de punição não é da conta de quem visita. */
  'banido', 'silenciado_ate', 'nome_bloqueado', 'nomes_antigos', 'nota_admin'
];
function perfilPublico(cfg){ const c = {}; for(const k in cfg){ if(PERFIL_PRIVADO.indexOf(k) >= 0) continue; c[k] = cfg[k]; } return c; }

/* ---------------------------------------------------------------------
   Campos do `perfil` que só o SERVIDOR (ou o admin) escreve. Antes o objeto
   `perfil` inteiro vinha do body do cliente e era gravado como veio, então
   dava pra qualquer usuário logado sobrescrever o próprio vínculo `oauth`
   ou apagar o `anon_ate` que o admin tinha posto. Agora esses campos são
   sempre recopiados do que já estava no banco. ------------------------ */
const PERFIL_SO_SERVIDOR = [
  'oauth', 'anon_modo', 'anon_ate', 'email_verificado',
  /* moderação: só o painel admin escreve estes. Se o cliente pudesse mandá-los
     no `perfil`, qualquer usuário logado se desbaniria sozinho. */
  'banido', 'silenciado_ate', 'nome_bloqueado', 'nomes_antigos', 'admin_badges', 'nota_admin'
];

function sanitizarPerfil(cfg, antigo){
  const limpo = {};
  for(const k in cfg){ if(PERFIL_SO_SERVIDOR.indexOf(k) < 0) limpo[k] = cfg[k]; }

  const emailNovo = String(limpo.email || '').trim().toLowerCase();
  if(emailNovo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNovo)) return { erro: 'e-mail inválido' };
  if(emailNovo) limpo.email = emailNovo; else delete limpo.email;

  /* limites de tamanho: sem isso dá pra enfiar megabytes de JSON na linha */
  if(limpo.pseudo != null){ limpo.pseudo = String(limpo.pseudo).slice(0, 40).trim(); if(!limpo.pseudo) delete limpo.pseudo; }
  if(Array.isArray(limpo.amigos)) limpo.amigos = limpo.amigos.slice(0, 500).map(a => String(a).slice(0, 20));

  /* devolve os campos protegidos exatamente como estavam */
  PERFIL_SO_SERVIDOR.forEach(k => { if(antigo[k] !== undefined) limpo[k] = antigo[k]; });
  /* com o nome bloqueado, o anonimato não é opcional: a pessoa não pode
     desligá-lo nas configurações e trazer o nome escondido de volta */
  if(antigo.nome_bloqueado){
    limpo.anonimo = true;
    if(!String(limpo.pseudo || '').trim()) limpo.pseudo = String(antigo.pseudo || '').trim() || 'Usuário';
  }
  /* trocou de e-mail? a verificação do anterior não vale mais */
  if(String(antigo.email || '').trim().toLowerCase() !== emailNovo) delete limpo.email_verificado;

  if(JSON.stringify(limpo).length > 20000) return { erro: 'perfil grande demais' };
  return { perfil: limpo };
}

/* marca o e-mail do perfil como PROVADO (a pessoa demonstrou ter acesso à
   caixa de entrada). Só um e-mail provado pode ser usado pra ligar uma conta
   antiga ao login do Google — ver apiLoginOAuth. */
async function marcarEmailVerificado(u){
  try{
    const p = asObj(u.perfil);
    if(!String(p.email || '').trim() || p.email_verificado === true) return;
    p.email_verificado = true;
    await sb.from('usuarios').update({ perfil: p }).eq('usuario', u.usuario);
  }catch(e){ /* não é motivo pra derrubar o login */ }
}

// preferências de notificação do alvo (default ligado)
async function prefNotifAtiva(usuario, tipo){
  if(!tipo) return true;
  const u = await acharUsuario(usuario);
  if(!u) return false;
  const notif = asObj(u.perfil).notif || {};
  return notif[tipo] !== false;
}
// cria notificação sem duplicar pelo par (usuario, notif_id)
async function criarNotif(usuario, tipo, id, titulo, corpo, url){
  usuario = String(usuario || ''); if(!usuario) return false;
  if(!(await prefNotifAtiva(usuario, tipo))) return false;
  const chave = String(id || (String(tipo||'n') + ':' + Date.now()));
  /* selecionamos `notif_id`, não `id`: em algumas instalações a tabela não
     tem coluna `id` (o apiMarcarNotifLidas logo abaixo já contava com isso).
     Com `select('id')` o PostgREST devolvia erro, `data` vinha indefinido, a
     checagem de duplicata não acontecia — e as notificações duplicavam. */
  const { data, error } = await sb.from('notificacoes').select('notif_id').ilike('usuario', usuario).eq('notif_id', chave).limit(1);
  if(error){ console.warn('[cetecritic] criarNotif: não deu pra conferir duplicata —', error.message); }
  if(data && data.length) return false;
  await sb.from('notificacoes').insert({
    usuario, notif_id: chave, tipo: String(tipo||''), titulo: String(titulo||''),
    corpo: String(corpo||''), url: String(url||''), ts: Date.now(), lida: false
  });
  return true;
}

function codigo6(){ return String(Math.floor(100000 + Math.random() * 900000)); }

// molde do e-mail com a identidade do site: logo no topo, fundo escuro, amarelo
// padrão (#f5c518) e o mesmo rodapé do site. `inner` é o miolo de cada e-mail.
const RODAPE_EMAIL = 'Esse site não é filiado, ou mantém qualquer relação de forma oficial com nenhuma mantida da FUCS';
function emailWrap(inner){
  return `<div style="background:#0e0f12;margin:0;padding:16px 0;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;">
      <div style="text-align:center;padding:22px 20px 10px;">
        <img src="${SITE_URL}/assets/logo.png" alt="CETECritic" width="140" style="display:inline-block;max-width:170px;height:auto;">
      </div>
      <div style="height:3px;background:#f5c518;margin:0 18px;border-radius:3px;"></div>
      <div style="background:#17181c;border:1px solid #2c2e33;border-radius:12px;margin:16px 16px 0;padding:24px 22px;color:#eceef2;font-size:15px;line-height:1.55;">
        ${inner}
      </div>
      <div style="background:#0e0f12;text-align:center;padding:22px 20px 30px;color:#9a9ea6;font-size:12px;line-height:1.7;">
        <img src="${SITE_URL}/assets/logo-rodape.png" alt="" width="90" style="max-width:110px;height:auto;opacity:.85;margin-bottom:8px;"><br>
        <div>${RODAPE_EMAIL}</div>
        <div>Contato e contribuições: <a href="mailto:cetecritic@gmail.com" style="color:#f5c518;text-decoration:none;">cetecritic@gmail.com</a></div>
        <div><a href="${SITE_URL}/termos.pdf" style="color:#f5c518;text-decoration:none;">Termos de Serviço e Política de Privacidade</a></div>
      </div>
    </div></div>`;
}
async function enviarEmailResend(to, subject, inner){
  if(!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return;
  try{
    await fetch('https://api.resend.com/emails', {
      method:'POST', headers:{ 'Authorization':'Bearer '+process.env.RESEND_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM, to, subject, html: emailWrap(inner) })
    });
  }catch(e){ /* cota/erro: silencioso */ }
}
async function enviarEmail2fa(to, usuario, code){
  const inner = `<p style="margin:0 0 10px;">Olá, <b>${usuario}</b>!</p>
    <p style="margin:0 0 6px;color:#b9bdc6;">Use este código para entrar na sua conta. Ele é essencial para garantir a segurança da sua conta.</p>
    <div style="background:#0e0f12;border:1px solid #2c2e33;border-radius:10px;text-align:center;font-size:34px;font-weight:800;letter-spacing:8px;padding:20px;margin:18px 0;color:#f5c518;">${code}</div>
    <p style="margin:0 0 6px;color:#9a9ea6;">O código tem validade de <b style="color:#eceef2;">5 minutos</b>.</p>
    <p style="margin:0;color:#7e828b;font-size:13px;">Se não reconhece essa solicitação, ignore este e-mail — sua senha continua a mesma.</p>`;
  await enviarEmailResend(to, 'CETECritic — seu código de acesso', inner);
}
async function enviarEmailReset(to, usuario, link){
  const inner = `<p style="margin:0 0 10px;">Olá, <b>${usuario}</b>!</p>
    <p style="margin:0 0 14px;color:#b9bdc6;">Recebemos um pedido para redefinir a senha da sua conta no CETECritic. Clique no botão abaixo (o link vale por 1 hora):</p>
    <div style="text-align:center;margin:18px 0;"><a href="${link}" style="display:inline-block;background:#f5c518;color:#0b0c0f;font-weight:800;text-decoration:none;padding:12px 26px;border-radius:10px;">Redefinir senha</a></div>
    <p style="margin:0 0 6px;color:#7e828b;font-size:12px;word-break:break-all;">Ou copie este link: <a href="${link}" style="color:#f5c518;">${link}</a></p>
    <p style="margin:8px 0 0;color:#7e828b;font-size:13px;">Se não foi você, ignore este e-mail — sua senha continua a mesma.</p>`;
  await enviarEmailResend(to, 'CETECritic — redefinir senha', inner);
}

/* ==================================================================
   GET — leituras públicas
   ================================================================== */

/* ==================================================================
   HALL DA FAMA (e HOME) — payload agregado
   ==================================================================
   O Hall pedia, no browser, edicao.js+noites de TODOS os anos, votos de
   cada ano e placar de bolão de cada ano — centenas de hits em serverless.
   Esta rota devolve tudo o que a página precisa numa resposta só:

     edicoes[]   metadados mínimos (ano, noites, inicio, emBreve)
     pecas[]     catálogo (ano, noite, ep, titulo, turma, sinopse, youtube)
     votos{}     submissions por ano (mesmo formato do ?year=)
     bolaoWins[] contagem de 1º lugar no bolão (sem expor palpite)

   A Home reaproveita esta MESMA rota (carregamento único, ver core.js
   `carregarAcervoAgregado`): sinopse/youtube foram adicionados aqui porque
   o "Hoje recomendamos" precisa deles, e o Hall só usava titulo/turma.

   Com ~centenas de submissions o payload continua pequeno. Se um dia
   passar de ~8–10k linhas, agregar médias no SQL em vez de mandar grid. */
async function apiDadosHall(){
  const [edQ, pecQ, subQ, palQ] = await Promise.all([
    sb.from('edicoes').select('ano,noites,inicio,em_breve').order('ano', { ascending: true }).limit(LIMITE_ALTO),
    sb.from('pecas').select('ano,noite,ordem,titulo,turma,sinopse,youtube,youtube_inicio').order('ano', { ascending: true }).limit(LIMITE_ALTO),
    sb.from('submissions').select('sub_id,ts,name,grid,year,usuario').limit(LIMITE_ALTO),
    sb.from('palpites').select('usuario,palpites,year,ts').limit(LIMITE_ALTO)
  ]);
  if(edQ.error) throw new Error(edQ.error.message);
  if(pecQ.error) throw new Error(pecQ.error.message);
  if(subQ.error) throw new Error(subQ.error.message);
  /* palpites é opcional pro Hall — se a tabela falhar, seguimos sem wins */
  avisarSeTruncou('hall edicoes', edQ.data);
  avisarSeTruncou('hall pecas', pecQ.data);
  avisarSeTruncou('hall submissions', subQ.data);
  if(!palQ.error) avisarSeTruncou('hall palpites', palQ.data);

  const edicoes = (edQ.data || []).map(e => ({
    ano: Number(e.ano),
    noites: Number(e.noites) || 5,
    inicio: e.inicio || null,
    emBreve: e.em_breve === true
  }));

  const pecas = (pecQ.data || [])
    .filter(p => p.ano && p.noite && p.ordem)
    .map(p => ({
      ano: Number(p.ano),
      noite: Number(p.noite),
      ep: Number(p.ordem),
      titulo: String(p.titulo || ''),
      turma: String(p.turma || ''),
      sinopse: String(p.sinopse || ''),
      youtube: String(p.youtube || ''),
      youtubeInicio: p.youtube_inicio || null
    }));

  const pmap = await lerPerfisMap();
  const votos = {};
  (subQ.data || []).forEach(r => {
    if(!r.sub_id) return;
    const year = r.year != null ? Number(r.year) : null;
    if(!year) return;
    const grid = asObj(r.grid);
    if(hasInvalidRating(grid)) return;
    const dono = String(r.usuario || '');
    const p = dono ? pmap[norm(dono)] : null;
    const nomeExib = (p && p.anonimo) ? p.display : String(r.name || '');
    const sub = {
      id: String(r.sub_id),
      ts: Number(r.ts) || 0,
      name: nomeExib,
      grid,
      year,
      user: displayFeed(dono, pmap)
    };
    if(!votos[year]) votos[year] = [];
    votos[year].push(sub);
  });

  /* bolão: vitórias (pos === 1) por usuário, usando as médias já derivadas
     das submissions — sem N idas ao banco via placarBolao(). */
  const bolaoWins = [];
  try{
    const mediasPorAno = {};
    Object.keys(votos).forEach(y => {
      const soma = {}, cont = {};
      (votos[y] || []).forEach(s => {
        Object.keys(s.grid || {}).forEach(k => {
          const v = Number(s.grid[k]);
          if(isNaN(v)) return;
          soma[k] = (soma[k] || 0) + v;
          cont[k] = (cont[k] || 0) + 1;
        });
      });
      const m = {};
      Object.keys(soma).forEach(k => { m[k] = soma[k] / cont[k]; });
      mediasPorAno[y] = m;
    });

    const porAno = {};
    (palQ.error ? [] : (palQ.data || [])).forEach(r => {
      const y = Number(r.year);
      if(!y || !r.usuario) return;
      if(!porAno[y]) porAno[y] = [];
      porAno[y].push(r);
    });

    const wins = {};
    Object.keys(porAno).forEach(y => {
      const medias = mediasPorAno[y] || {};
      if(!Object.keys(medias).length) return;
      const linhas = porAno[y].map(r => {
        const pal = asObj(r.palpites);
        let pontos = 0, apuradas = 0, somaErro = 0;
        Object.keys(pal).forEach(k => {
          if(medias[k] === undefined) return;
          const p = Number(pal[k]);
          const er = Math.abs(p - medias[k]);
          if(isNaN(er)) return;
          pontos += pontosBolao(p, medias[k]);
          somaErro += er;
          apuradas++;
        });
        return {
          user: displayFeed(String(r.usuario), pmap),
          pontos,
          apuradas,
          erroMedio: apuradas ? somaErro / apuradas : null,
          ts: Number(r.ts) || 0
        };
      }).filter(l => l.apuradas > 0);
      linhas.sort((a, b) => b.pontos - a.pontos || a.erroMedio - b.erroMedio || a.ts - b.ts);
      let pos = 0, chaveAnt = null;
      linhas.forEach((l, i) => {
        const chave = l.pontos + '|' + (l.erroMedio === null ? '' : l.erroMedio.toFixed(4));
        if(chave !== chaveAnt){ pos = i + 1; chaveAnt = chave; }
        l.pos = pos;
      });
      linhas.filter(l => l.pos === 1).forEach(l => {
        const key = norm(l.user);
        if(!key) return;
        if(!wins[key]) wins[key] = { user: l.user, wins: 0 };
        wins[key].wins++;
      });
    });
    Object.keys(wins).forEach(k => bolaoWins.push(wins[k]));
    bolaoWins.sort((a, b) => b.wins - a.wins);
  }catch(e){
    console.warn('[cetecritic] hall bolaoWins falhou', e && e.message);
  }

  return {
    ok: true,
    serverNow: Date.now(),
    edicoes,
    pecas,
    votos,
    bolaoWins
  };
}

async function handleGet(req, res){
  const q = req.query || {};

  // perfil público
  if(q.perfil){
    const alvo = String(q.perfil);
    const u = await acharUsuario(alvo);
    const cfg = u ? asObj(u.perfil) : {};
    const pmap = await lerPerfisMap();
    const meMap = pmap[norm(alvo)] || null;

    /* ---- PERFIL PRIVADO -------------------------------------------------
       Antes o `privado` só tirava a pessoa da busca e do "adicionar amigo":
       quem soubesse o nome abria /perfil.html?user=NOME e via visitas,
       carimbos e reputação inteiros. Agora, se o perfil é privado, só o DONO
       recebe os dados — e ele prova isso mandando o token da sessão. */
    const ehDono = !!(q.por && q.token && norm(q.por) === norm(alvo) && await verificarToken(String(q.por), String(q.token)));
    if(u && cfg.privado === true && !ehDono){
      return res.json({
        user: u.usuario, nomeExib: meMap ? meMap.display : alvo,
        anonimo: !!(meMap && meMap.anonimo), existe: true,
        privado: true, restrito: true,
        perfil: { privado: true }, totalVisitas: 0, visitas: [], carimbos: [], reputacao: 0, meuVoto: 0
      });
    }

    const disp = who => { const m = pmap[norm(who)]; return (m && m.anonimo) ? m.display : String(who || ''); };
    const { data: vRows } = await sb.from('visitas').select('*').ilike('profile_user', alvo);
    const visitas = (vRows||[]).filter(r => norm(r.profile_user)===norm(alvo))
      .map(r => ({ visitor: disp(r.visitor_user), ts: Number(r.ts), count: Number(r.count)||1 }));
    const totalVisitas = visitas.reduce((a,b)=>a+b.count, 0);
    /* `alvo IS NULL` = carimbo de PERFIL. As linhas com alvo preenchido são
       reações a posts do feed e não entram na lista do perfil. */
    const { data: cRows } = await sb.from('carimbos').select('*').ilike('profile_user', alvo).is('alvo', null);
    const carimbos = (cRows||[]).filter(r => norm(r.profile_user)===norm(alvo))
      .map(r => ({ from: disp(r.from_user), tipo: String(r.tipo), ts: Number(r.ts) }));
    const { data: rRows } = await sb.from('reputacao').select('*').ilike('profile_user', alvo);
    const por = q.por ? norm(q.por) : null;
    let reputacao = 0, meuVoto = 0;
    (rRows||[]).forEach(r => {
      if(norm(r.profile_user)===norm(alvo)){ const v = Number(r.valor)||0; reputacao += v; if(por && norm(r.from_user)===por) meuVoto = v; }
    });
    return res.json({ user: u?u.usuario:alvo, nomeExib: meMap?meMap.display:alvo, anonimo: !!(meMap&&meMap.anonimo),
      existe: !!u, perfil: perfilPublico(cfg), totalVisitas, visitas, carimbos, reputacao, meuVoto });
  }

  /* ---- reações dos posts do feed (público) ----------------------------
     O feed pede as contagens de VÁRIOS posts numa tacada só: ?reacoes=a,b,c
     `por` é opcional e serve pra devolver qual foi a reação daquela pessoa,
     pro botão já nascer marcado. Não exige token: reação é informação
     pública, igual ao `meuVoto` do ?perfil=. */
  if(q.reacoes){
    const ids = String(q.reacoes).split(',').map(s => s.trim()).filter(Boolean).slice(0, 120);
    if(!ids.length) return res.json({ ok:true, reacoes:{} });
    const { data } = await sb.from('carimbos').select('alvo,tipo,from_user').in('alvo', ids);
    const por = q.por ? norm(q.por) : null;
    const out = {};
    ids.forEach(id => { out[id] = { total:0, tipos:{}, meu:null }; });
    (data||[]).forEach(r => {
      const o = out[r.alvo]; if(!o) return;
      o.total++;
      o.tipos[r.tipo] = (o.tipos[r.tipo] || 0) + 1;
      if(por && norm(r.from_user) === por) o.meu = String(r.tipo);
    });
    return res.json({ ok:true, reacoes: out });
  }

  /* ---- atividade pública da comunidade (aba Social > Geral) -----------
     Serve para as pessoas se descobrirem: quem avaliou o quê, quem ganhou
     badge, quem carimbou quem, quem chegou agora.

     Só entra aqui o que JÁ é público em outro lugar do site. Perfis
     privados ficam de fora por completo, e quem está anônimo aparece pelo
     pseudônimo — a mesma regra do resto do site, aplicada no servidor.

     As badges saem da tabela `notificacoes` (tipo 'badges'), onde o
     notif_id é 'badge:<título>'. Reconstruímos o texto na terceira pessoa a
     partir do id, em vez de repassar o corpo original, que é escrito para o
     dono ("Você desbloqueou..."). */
  if(q.atividade){
    const pmap = await lerPerfisMap();
    const visivel = who => {
      const m = pmap[norm(who)];
      if(!m) return null;              // conta apagada
      if(m.privado) return null;       // perfil privado não entra no feed
      return m.display;                // já é o pseudônimo quando anônimo
    };
    const eventos = [];

    /* avaliações recentes */
    try{
      const { data } = await sb.from('submissions')
        .select('sub_id,usuario,year,ts').order('ts', { ascending:false }).limit(60);
      (data||[]).forEach(r => {
        const nome = visivel(r.usuario); if(!nome) return;
        eventos.push({ tipo:'avaliacao', quem:nome, ano:Number(r.year), ts:Number(r.ts)||0, id:'sub:'+r.sub_id });
      });
    }catch(e){ /* uma fonte falhar não derruba o feed */ }

    /* badges desbloqueadas */
    try{
      const { data } = await sb.from('notificacoes')
        .select('usuario,notif_id,tipo,ts').eq('tipo','badges')
        .order('ts', { ascending:false }).limit(40);
      (data||[]).forEach(r => {
        const nome = visivel(r.usuario); if(!nome) return;
        const badge = String(r.notif_id||'').indexOf('badge:') === 0 ? String(r.notif_id).slice(6) : '';
        if(!badge) return;
        eventos.push({ tipo:'badge', quem:nome, badge, ts:Number(r.ts)||0, id:'bdg:'+r.usuario+':'+badge });
      });
    }catch(e){}

    /* carimbos entre perfis (os dois lados precisam ser públicos) */
    try{
      const { data } = await sb.from('carimbos')
        .select('profile_user,from_user,tipo,ts').is('alvo', null)
        .order('ts', { ascending:false }).limit(40);
      (data||[]).forEach(r => {
        const de = visivel(r.from_user), para = visivel(r.profile_user);
        if(!de || !para) return;
        eventos.push({ tipo:'carimbo', quem:de, alvo:para, carimbo:String(r.tipo||''), ts:Number(r.ts)||0, id:'car:'+r.from_user+':'+r.profile_user+':'+r.ts });
      });
    }catch(e){}

    /* gente nova na comunidade */
    try{
      const { data } = await sb.from('usuarios')
        .select('usuario,criado_em').order('criado_em', { ascending:false }).limit(20);
      (data||[]).forEach(r => {
        const nome = visivel(r.usuario); if(!nome) return;
        eventos.push({ tipo:'novo', quem:nome, ts:Number(r.criado_em)||0, id:'novo:'+r.usuario });
      });
    }catch(e){}

    eventos.sort((a,b) => b.ts - a.ts);
    return res.json({ ok:true, atividade: eventos.slice(0, 60) });
  }

  // lista de usuários (busca / adicionar amigo)
  if(q.usuarios){
    const map = await lerPerfisMap();
    const usuarios = Object.keys(map).map(k => map[k]).filter(m => !m.privado).map(m => m.display);
    return res.json({ usuarios });
  }

  // lista de inscrições push (protegida) — mantida por compat
  if(q.listaPush){
    /* se PUSH_SECRET não estiver configurado, o `!==` de antes deixava passar
       quem mandasse a string vazia — agora sem segredo ninguém entra */
    if(!segredoOk(q.listaPush, PUSH_SECRET)) return res.json({ ok:false, error:'não autorizado' });
    const { data } = await sb.from('push').select('endpoint,p256dh,auth').limit(LIMITE_ALTO);
    const subs = (data||[]).filter(r => r.endpoint).map(r => ({ endpoint:r.endpoint, keys:{ p256dh:r.p256dh, auth:r.auth } }));
    return res.json({ ok:true, subs });
  }

  // broadcasts (público)
  if(q.broadcasts){
    const agora = Date.now();
    const desde = agora - 7 * 24 * 60 * 60 * 1000;
    const { data } = await sb.from('broadcasts').select('*').order('ts', { ascending:false }).limit(100);
    const ativos = (data||[]).filter(b => {
      const ini = b.inicio ? Number(b.inicio) : null;
      const fim = b.fim ? Number(b.fim) : null;
      if(ini || fim){                                  // banner com período: ativo dentro do intervalo
        if(ini && agora < ini) return false;
        if(fim && agora > fim) return false;
        return true;
      }
      return Number(b.ts) >= desde;                    // sem período: transitório (últimos 7 dias)
    }).slice(0, 15);
    return res.json({ ok:true, broadcasts: ativos.map(b => ({ id:b.bc_id, titulo:b.titulo, corpo:b.corpo, url:b.url, ts:b.ts, dur:b.dur||0, modo:b.modo||'uma_vez' })) });
  }

  // Hall da Fama — payload único (edicoes + pecas + votos + bolaoWins)
  if(q.hall){
    try{
      const payload = await apiDadosHall();
      res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
      return res.json(payload);
    }catch(e){
      return res.status(500).json({ ok:false, error:String((e && e.message) || e) });
    }
  }

  // ranking de reputação
  if(q.ranking === 'reputacao'){
    const { data: rRows } = await sb.from('reputacao').select('profile_user,valor').limit(LIMITE_ALTO);
    const pmap = await lerPerfisMap();
    const soma = {};
    (rRows||[]).forEach(r => { const key = norm(r.profile_user); if(!key) return; if(!soma[key]) soma[key] = { user:String(r.profile_user), rep:0 }; soma[key].rep += Number(r.valor)||0; });
    const ranking = Object.keys(soma).map(k => { const m = pmap[k]; return { user:(m&&m.anonimo)?m.display:soma[k].user, rep:soma[k].rep }; }).sort((a,b)=>b.rep-a.rep);
    return res.json({ ranking });
  }

  /* ---- bolão: estado + placar (público) ----
     Devolve ranking já calculado. O palpite de terceiro não sai daqui em
     nenhuma hipótese — antes o endpoint entregava a grade inteira de todo
     mundo assim que a votação fechava. */
  if(q.bolao){
    const y = Number(q.bolao);
    if(!y) return res.json({ ok:false, error:'ano inválido' });
    const estado = await estadoBolao(y);
    /* enquanto dá pra palpitar, ninguém vê placar: os palpites ainda mudam e
       mostrar parcial entregaria informação de quem já enviou */
    if(!estado.palpiteFechado) return res.json({ ok:true, estado, placar:[], pecasApuradas:0 });
    const r = await placarBolao(y);
    return res.json({ ok:true, estado, ...r });
  }

  /* ---- bolão: o SEU palpite (precisa de token) ----
     Serve pra montar a comparação palpite × nota oficial no perfil. Vem com
     as médias reais e os pontos já calculados, pra conta bater exatamente
     com a do placar. */
  if(q.palpites){
    const y = Number(q.palpites);
    const usuario = String(q.user || '');
    if(!y || !usuario) return res.json({ ok:false, palpites:{}, medias:{} });
    if(!(await verificarToken(usuario, q.token))) return res.json({ ok:false, error:'faça login', palpites:{}, medias:{} });

    const { data } = await sb.from('palpites').select('usuario,palpites,ts').eq('year', y).limit(LIMITE_ALTO);
    const meu = (data || []).find(r => norm(r.usuario) === norm(usuario));
    if(!meu) return res.json({ ok:true, temPalpite:false, palpites:{}, medias:{}, pontos:{} });

    const pal = asObj(meu.palpites);
    const estado = await estadoBolao(y);
    /* as médias reais só entram depois que o palpite trava — antes disso
       elas seriam uma cola em tempo real pra quem ainda está preenchendo */
    const medias = estado.palpiteFechado ? await mediasReaisDoAno(y) : {};
    const pontos = {};
    Object.keys(pal).forEach(k => { if(medias[k] !== undefined) pontos[k] = pontosBolao(pal[k], medias[k]); });
    return res.json({ ok:true, temPalpite:true, estado, palpites: pal, medias, pontos, ts: Number(meu.ts) || 0 });
  }

  // feed de votos (default)
  /* pendura aqui a verificação dos avisos do bolão: é a rota que todo mundo
     chama o tempo todo, e ela mesma se limita a 1 checagem por minuto */
  await dispararAvisosBolao();

  const year = q.year ? Number(q.year) : await anoEmDestaque();
  const { data } = await sb.from('submissions').select('*').eq('year', year).limit(LIMITE_ALTO);
  avisarSeTruncou('submissions do ano ' + year, data);
  const pmap = await lerPerfisMap();
  const submissions = (data||[]).filter(r => r.sub_id).map(r => {
    const dono = String(r.usuario || '');
    /* `user` já saía mascarado pelo displayFeed, mas `name` ia cru — e é o
       `name` que a lista "Avaliações recebidas" mostra na tela. Como quem
       vota logado grava o nome real NAS DUAS colunas, o modo anônimo (e o
       nome bloqueado pela moderação) não escondia nada ali: o pseudônimo
       aparecia no feed e o nome verdadeiro logo abaixo, na mesma página.
       Agora o pseudônimo vale nos dois lugares. */
    const p = dono ? pmap[norm(dono)] : null;
    const nomeExib = (p && p.anonimo) ? p.display : String(r.name || '');
    return {
      id:String(r.sub_id), ts:Number(r.ts), name: nomeExib, grid: asObj(r.grid),
      year: r.year?Number(r.year):year, user: displayFeed(dono, pmap)
    };
  }).filter(s => !hasInvalidRating(s.grid)).filter(s => s.year === year);
  return res.json({ serverNow: Date.now(), votingClosed: await votingClosed(year), submissions });
}

/* ==================================================================
   POST — ações
   ================================================================== */
async function apiRegistrar(body, req){
  /* teto por origem: sem isto, criar contas em massa é um laço de curl */
  { const r = await limiteTaxa('reg:ip:' + ipDe(req), 5, 60*60*1000);
    if(!r.ok) return { ok:false, error:'muitas contas criadas deste aparelho — espere ' + textoEspera(r.esperar) }; }
  const usuario = String(body.user||'').trim();
  const senha = String(body.senha||'');
  if(usuario.length<2||usuario.length>20) return { ok:false, error:'usuário deve ter de 2 a 20 caracteres' };
  if(!/^[A-Za-z0-9_.\- ]+$/.test(usuario)) return { ok:false, error:'usuário tem caracteres inválidos' };
  if(senha.length<8) return { ok:false, error:'a senha precisa de pelo menos 8 caracteres' };
  if(await acharUsuario(usuario)) return { ok:false, error:'esse usuário já existe' };
  const salt = novoToken().slice(0,8);
  const email = String(body.email||'').trim().toLowerCase();
  /* e-mail cadastrado aqui ainda NÃO está provado: só vira email_verificado
     depois que a pessoa abrir um link de redefinição ou usar um código 2FA */
  const perfil = (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) ? { email } : {};
  const { error } = await sb.from('usuarios').insert({ usuario, senha_hash: hashSenha(senha,salt), salt, token: null, criado_em: Date.now(), tentativas:0, lock_until:0, perfil });
  if(error) return { ok:false, error:'esse usuário já existe' };
  const token = await criarSessao(usuario, body.dispositivo);
  return { ok:true, user:usuario, token };
}

async function apiLogin(body, req){
  /* a trava por CONTA (5 erros -> 10 min) já existia, e continua logo abaixo.
     Esta é por ORIGEM: sem ela, dava pra varrer a lista de contas testando
     uma senha comum em cada, sem nunca esbarrar em nada. */
  { const r = await limiteTaxa('login:ip:' + ipDe(req), 30, 10*60*1000);
    if(!r.ok) return { ok:false, error:'muitas tentativas deste aparelho — espere ' + textoEspera(r.esperar) }; }
  const usuario = String(body.user||'').trim();
  const senha = String(body.senha||'');
  const u = await acharUsuario(usuario);
  /* mensagem GENÉRICA e mesmo custo de CPU: antes "usuário não encontrado" vs
     "senha incorreta" entregava quem tem conta no site (enumeração), e sem o
     scrypt falso dava pra descobrir o mesmo cronometrando a resposta. */
  if(!u){ gastarTempoSenha(); return { ok:false, error: ERRO_LOGIN }; }
  /* conta criada pelo Google nunca teve senha: dizer isso em vez de "senha incorreta" */
  { const p = asObj(u.perfil); if(p.oauth && p.oauth.semSenha) return { ok:false, error:'essa conta entra pelo Google — use o botão "Entrar com Google"' }; }
  const agora = Date.now();
  if((u.lock_until||0) > agora){ const min = Math.ceil((u.lock_until-agora)/60000); return { ok:false, error:'muitas tentativas — espere '+min+' min e tente de novo' }; }
  const conf = conferirSenha(senha, u.salt, u.senha_hash);
  if(!conf.ok){
    const tent = (u.tentativas||0)+1;
    if(tent >= MAX_TENTATIVAS){ await sb.from('usuarios').update({ tentativas:0, lock_until: agora+LOCK_MS }).eq('usuario', u.usuario); return { ok:false, error:'muitas tentativas — bloqueado por 10 minutos' }; }
    await sb.from('usuarios').update({ tentativas: tent }).eq('usuario', u.usuario);
    return { ok:false, error: ERRO_LOGIN };
  }
  /* senha certa e hash ainda no formato antigo: regrava em scrypt agora,
     de forma transparente (a pessoa não percebe nada) */
  if(conf.migrar){
    try{ await sb.from('usuarios').update({ senha_hash: hashSenha(senha, u.salt) }).eq('usuario', u.usuario); }catch(e){}
  }
  /* conta suspensa: a senha até está certa, mas não emitimos sessão. A checagem
     vem DEPOIS da senha de propósito — antes, virava um jeito de descobrir
     quem está banido sem saber a senha. */
  { const bloq = bloqueioDe(u, 'login'); if(bloq) return { ok:false, error: bloq, banido:true }; }
  // senha certa: se a conta tem 2FA ligado e e-mail, manda o código e NÃO emite token ainda
  const perfil = asObj(u.perfil);
  if(perfil.twofa === true && String(perfil.email || '').trim()){
    const code = codigo6();
    await sb.from('login_codes').upsert({ usuario: u.usuario, code, exp: Date.now() + 5*60*1000, tentativas: 0 }, { onConflict: 'usuario' });
    await enviarEmail2fa(String(perfil.email).trim(), u.usuario, code);
    await sb.from('usuarios').update({ tentativas:0, lock_until:0 }).eq('usuario', u.usuario);
    return { ok:false, need2fa:true, user:u.usuario };
  }
  await sb.from('usuarios').update({ tentativas:0, lock_until:0 }).eq('usuario', u.usuario);
  const token = await criarSessao(u.usuario, body.dispositivo);
  return { ok:true, user:u.usuario, token, admin: u.admin === true };
}

// segunda etapa: confere o código de 6 dígitos e só então emite o token
async function apiLogin2fa(body){
  const usuario = String(body.user||'').trim();
  const code = String(body.code||'').trim();
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const { data } = await sb.from('login_codes').select('*').ilike('usuario', usuario);
  const row = (data||[]).find(r => norm(r.usuario) === norm(usuario));
  if(!row) return { ok:false, error:'peça um novo código (entre de novo)' };
  if((row.tentativas||0) >= 5){ await sb.from('login_codes').delete().eq('usuario', row.usuario); return { ok:false, error:'muitas tentativas — entre de novo' }; }
  if(Date.now() > Number(row.exp)){ await sb.from('login_codes').delete().eq('usuario', row.usuario); return { ok:false, error:'código expirado — entre de novo' }; }
  if(!igualSeguro(String(row.code), code)){ await sb.from('login_codes').update({ tentativas:(row.tentativas||0)+1 }).eq('usuario', row.usuario); return { ok:false, error:'código incorreto' }; }
  { const bloq = bloqueioDe(u, 'login'); if(bloq){ await sb.from('login_codes').delete().eq('usuario', row.usuario); return { ok:false, error: bloq, banido:true }; } }
  await sb.from('login_codes').delete().eq('usuario', row.usuario);
  await sb.from('usuarios').update({ tentativas:0, lock_until:0 }).eq('usuario', u.usuario);
  /* a pessoa leu um código que só chegou naquela caixa de entrada: o e-mail
     do perfil está PROVADO. É isso que libera o vínculo com o Google depois. */
  await marcarEmailVerificado(u);
  const token = await criarSessao(u.usuario, body.dispositivo);
  return { ok:true, user:u.usuario, token, admin: u.admin === true };
}

/* ---------------------------------------------------------------------
   VOTO

   Esta rota decide a única coisa que o site realmente produz: a nota de cada
   peça. Por isso ela concentra três defesas que ANTES não existiam.

   1. TRAVA DE ENVIO NO SERVIDOR.
      O cooldown vivia só no localStorage do navegador. Limpar o storage —
      ou simplesmente chamar a API com `curl` num laço — permitia enviar
      milhares de avaliações e mover a média de qualquer peça para onde se
      quisesse. Agora há dois tetos, um por conta e outro por origem.

   2. NOME LIVRE.
      `name` vinha do cliente sem conferência, e num voto sem login é ele
      que aparece na lista pública. Dava pra enviar uma avaliação anônima
      assinada com o nome de outra pessoa. Agora um nome que colide com uma
      conta existente é recusado quando não há token que prove a identidade.

   3. `ts` DO CLIENTE.
      Era gravado como veio, então dava pra forjar a data de um voto (e, com
      isso, o desempate de "quem chegou primeiro"). Agora o carimbo é do
      servidor; só se aceita o do cliente quando ele é plausível.
   --------------------------------------------------------------------- */
const VOTO_MAX_POR_JANELA = 3;                 // por conta E por origem
const VOTO_JANELA_MS = 5 * 60 * 1000;

async function apiVoto(body, req){
  if(!body || !body.id || !body.grid) return { ok:false, error:'dados inválidos' };
  const year = body.year ? Number(body.year) : await anoEmDestaque();
  if(await votingClosed(year)) return { ok:false, error:'votação encerrada' };
  if(hasInvalidRating(body.grid)) return { ok:true };

  let usuario = null;
  if(body.user && await verificarToken(body.user, body.token)){
    const bloq = await barreiraModeracao(body.user, 'interagir');
    if(bloq) return { ok:false, error: bloq };
    usuario = String(body.user);
  }

  const nome = String(body.name||'').trim().slice(0,40);

  /* --- defesa 2: nome de terceiro em voto sem login ---
     Quem está logado pode usar o próprio nome à vontade. Quem não está não
     pode assinar com um nome que pertence a alguém. */
  if(!usuario && nome){
    const dono = await acharUsuario(nome);
    if(dono) return { ok:false, error:'esse nome pertence a uma conta do site — entre nela para avaliar com ele' };
  }

  /* --- defesa 1: teto de envios ---
     Duas chaves independentes. A da conta é a que pega o caso comum; a da
     origem pega o voto sem login, que não tem identidade nenhuma. */
  if(usuario){
    const r = await limiteTaxa('voto:u:' + norm(usuario) + ':' + year, VOTO_MAX_POR_JANELA, VOTO_JANELA_MS);
    if(!r.ok) return { ok:false, error:'você enviou avaliações demais em pouco tempo — espere ' + textoEspera(r.esperar) };
  }
  {
    const r = await limiteTaxa('voto:ip:' + ipDe(req) + ':' + year, VOTO_MAX_POR_JANELA, VOTO_JANELA_MS);
    if(!r.ok) return { ok:false, error:'muitas avaliações deste aparelho em pouco tempo — espere ' + textoEspera(r.esperar) };
  }

  /* --- defesa 3: carimbo de tempo confiável ---
     Aceita o do cliente só se estiver a menos de 5 min do relógio real; do
     contrário usa o do servidor. Evita voto "do futuro" e voto antedatado. */
  const tsCliente = Number(body.ts) || 0;
  const tsServidor = Date.now();
  const ts = (tsCliente && Math.abs(tsServidor - tsCliente) < 5*60*1000) ? tsCliente : tsServidor;

  const { error } = await sb.from('submissions').insert({
    sub_id: String(body.id).slice(0, 80), ts, name: nome, grid: body.grid, year, usuario
  });
  if(error) return { ok:false, error:'não deu pra registrar a avaliação — tente de novo' };
  return { ok:true };
}

/* Apagar a PRÓPRIA avaliação.

   Confere a posse no servidor comparando o dono da linha com o usuário do
   token — mandar o id de outra pessoa não adianta. Continua permitido depois
   da votação fechar: o voto é da pessoa, e recusar aqui só faria ela pedir
   pro admin apagar. */
async function apiApagarAvaliacao(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const subId = String(body.id||'').trim();
  if(!subId) return { ok:false, error:'avaliação inválida' };

  const { data, error } = await sb.from('submissions').select('row_id,sub_id,usuario').eq('sub_id', subId).limit(10);
  if(error) return { ok:false, error: error.message };
  const minha = (data||[]).find(r => norm(r.usuario) === norm(usuario));
  if(!minha) return { ok:false, error:'essa avaliação não é sua' };

  const { error: e2 } = await sb.from('submissions').delete().eq('row_id', minha.row_id);
  if(e2) return { ok:false, error: e2.message };
  return { ok:true };
}

/* chaves (s{noite}e{ordem}) de todas as peças cadastradas num ano — é a
   lista que o palpite precisa cobrir inteira */
async function chavesDoAno(year){
  const set = new Set();
  try{
    const { data } = await sb.from('pecas').select('noite,ordem').eq('ano', Number(year));
    (data || []).forEach(p => {
      const n = Number(p.noite), o = Number(p.ordem);
      if(n && o) set.add('s' + n + 'e' + o);
    });
  }catch(e){ /* sem tabela de peças: cai na validação leve lá embaixo */ }
  return set;
}

async function apiPalpite(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login para palpitar' };
  { const bloq = await barreiraModeracao(usuario, 'interagir'); if(bloq) return { ok:false, error: bloq }; }
  const year = body.year ? Number(body.year) : await anoEmDestaque();

  /* o prazo agora é o horário da Noite 1 (ou o que o painel definir), não mais
     o fim da votação: o bolão é uma aposta ANTES de ver qualquer peça */
  const estado = await estadoBolao(year);
  if(!estado.existe)         return { ok:false, error:'essa edição não existe' };
  if(!estado.ativo)          return { ok:false, error:'o bolão desta edição está desativado' };
  if(!estado.liberado)       return { ok:false, error:'o bolão desta edição ainda não abriu' };
  if(estado.palpiteFechado)  return { ok:false, error:'o prazo de palpite já fechou — ele encerra quando a primeira noite começa' };

  const entrada = (body.palpites && typeof body.palpites==='object') ? body.palpites : null;
  if(!entrada) return { ok:false, error:'nenhum palpite enviado' };

  const exigidas = await chavesDoAno(year);
  const limpos = {};
  Object.keys(entrada).forEach(k => {
    /* chave fora do formato ou peça que não existe no ano: ignora */
    if(!/^s\d+e\d+$/.test(k)) return;
    if(exigidas.size && !exigidas.has(k)) return;
    const v = Number(entrada[k]);
    if(!isNaN(v) && v>=0 && v<=MAX_RATING) limpos[k]=v;
  });
  if(!Object.keys(limpos).length) return { ok:false, error:'palpites inválidos' };

  /* obrigatório palpitar em TODAS as peças: meio bolão não vale, senão quem
     palpita pouco leva vantagem no erro médio do desempate */
  if(exigidas.size){
    const faltam = [...exigidas].filter(k => limpos[k] === undefined).length;
    if(faltam) return { ok:false, error:'falta palpitar em ' + faltam + ' peça(s) — o bolão só vale preenchido inteiro' };
  }

  const { data } = await sb.from('palpites').select('id,usuario,year').eq('year', year);
  const existente = (data||[]).find(r => norm(r.usuario)===norm(usuario));
  if(existente) await sb.from('palpites').update({ palpites: limpos, ts: Date.now() }).eq('id', existente.id);
  else await sb.from('palpites').insert({ usuario, year, palpites: limpos, ts: Date.now() });
  return { ok:true, pecas: Object.keys(limpos).length };
}

async function apiPerfil(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const cfg = (body.perfil && typeof body.perfil==='object' && !Array.isArray(body.perfil)) ? body.perfil : {};
  const antigo = asObj(u.perfil);
  const san = sanitizarPerfil(cfg, antigo);
  if(san.erro) return { ok:false, error: san.erro };
  const novo = san.perfil;
  const antes = Array.isArray(antigo.amigos) ? antigo.amigos.map(norm) : [];
  const depois = Array.isArray(novo.amigos) ? novo.amigos : [];
  await sb.from('usuarios').update({ perfil: novo }).eq('usuario', u.usuario);
  const pmap = await lerPerfisMap();
  const dispU = (pmap[norm(usuario)] && pmap[norm(usuario)].display) || usuario;

  /* ---- notifica só os amigos RECÉM-adicionados ----
     ANTES este laço fazia `await acharUsuario(a)` dentro do `for`, ou seja,
     uma ida ao banco por amigo, em série. Como `amigos` aceita até 500
     entradas, adicionar muitos de uma vez virava centenas de consultas
     sequenciais dentro de um request com timeout.

     Agora o `pmap` (que já foi carregado logo acima) responde quem existe
     sem custo nenhum, e só as notificações de fato novas vão pro banco.
     O teto de 30 evita que uma importação em massa vire enxurrada na caixa
     de ninguém. */
  const novos = depois
    .map(a => norm(a))
    .filter(na => na && na !== norm(usuario) && antes.indexOf(na) < 0 && pmap[na])
    .slice(0, 30);
  await Promise.all(novos.map(na => criarNotif(
    pmap[na].user, 'amigos', 'amigo:'+norm(usuario), '🤝 Novo amigo',
    dispU + ' adicionou você como amigo.', '/perfil.html?user=' + encodeURIComponent(dispU)
  )));
  return { ok:true };
}

async function apiVisita(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false };
  const alvo = String(body.alvo||'');
  if(!alvo || norm(alvo)===norm(usuario)) return { ok:true };
  const pmap = await lerPerfisMap();
  const dispV = (pmap[norm(usuario)] && pmap[norm(usuario)].display) || usuario;
  const hoje = new Date().toISOString().slice(0,10);
  await criarNotif(alvo, 'visitas', 'visita:'+norm(usuario)+':'+hoje, '👀 Nova visita', dispV + ' visitou seu perfil.', '/perfil.html');
  const { data } = await sb.from('visitas').select('*').ilike('profile_user', alvo);
  const linha = (data||[]).find(r => norm(r.profile_user)===norm(alvo) && norm(r.visitor_user)===norm(usuario));
  if(linha) await sb.from('visitas').update({ ts: Date.now(), count: (Number(linha.count)||0)+1 }).eq('id', linha.id);
  else await sb.from('visitas').insert({ profile_user: alvo, visitor_user: usuario, ts: Date.now(), count: 1 });
  return { ok:true };
}

async function apiCarimbo(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  { const bloq = await barreiraModeracao(usuario, 'interagir'); if(bloq) return { ok:false, error: bloq }; }
  const alvo = String(body.alvo||''), tipo = String(body.tipo||'');
  if(!alvo || norm(alvo)===norm(usuario)) return { ok:false, error:'não dá pra carimbar seu próprio perfil' };
  if(!CARIMBOS_VALIDOS[tipo]) return { ok:false, error:'carimbo inválido' };
  if(!(await acharUsuario(alvo))) return { ok:false, error:'perfil não encontrado' };
  /* só carimbos de PERFIL entram no cooldown — reagir a posts do feed grava
     na mesma tabela (com `alvo` preenchido) e não deve travar isto aqui */
  const { data } = await sb.from('carimbos').select('*').ilike('profile_user', alvo).is('alvo', null);
  let ultima = 0;
  (data||[]).forEach(r => { if(norm(r.profile_user)===norm(alvo) && norm(r.from_user)===norm(usuario)) ultima = Math.max(ultima, Number(r.ts)||0); });
  const restante = CARIMBO_COOLDOWN_MS - (Date.now() - ultima);
  if(restante > 0) return { ok:false, error:'espere '+Math.ceil(restante/60000)+' min para carimbar este perfil de novo' };
  const agoraTs = Date.now();
  await sb.from('carimbos').insert({ profile_user: alvo, from_user: usuario, tipo, ts: agoraTs, alvo: null });
  const pmap = await lerPerfisMap();
  const dispF = (pmap[norm(usuario)] && pmap[norm(usuario)].display) || usuario;
  await criarNotif(alvo, 'carimbos', 'carimbo:'+norm(usuario)+':'+tipo+':'+agoraTs, '📮 Novo carimbo', dispF + ' te deu o carimbo "'+tipo+'".', '/perfil.html');
  return { ok:true };
}

/* ---------------------------------------------------------------------
   Reação a um post do feed. Grava na MESMA tabela `carimbos`, com a coluna
   `alvo` preenchida — é o mesmo vocabulário de emojis, não um sistema novo.

   Diferenças de regra em relação ao carimbo de perfil, todas propositais:
     - sem cooldown: reagir é gesto leve, não elogio formal
     - UMA reação por pessoa por post (trocar de emoji faz UPDATE)
     - tipo null = tirar a reação (o mesmo botão liga e desliga)
     - dá pra reagir ao próprio post (curtir a própria avaliação é inofensivo,
       diferente de carimbar o próprio perfil, que inflaria a vitrine)
   --------------------------------------------------------------------- */
async function apiReagir(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login para reagir' };
  { const bloq = await barreiraModeracao(usuario, 'interagir'); if(bloq) return { ok:false, error: bloq }; }

  const alvo = String(body.postId||'').trim().slice(0, ALVO_MAX);
  if(!alvo) return { ok:false, error:'post inválido' };
  const tipo = body.tipo ? String(body.tipo) : null;
  if(tipo && !CARIMBOS_VALIDOS[tipo]) return { ok:false, error:'reação inválida' };

  /* o autor só é gravado quando é uma conta de verdade — post da organização
     tem autor livre ("CETECritic"), que não existe em `usuarios` */
  const autorInformado = String(body.autor||'').trim();
  const autorReal = autorInformado ? await acharUsuario(autorInformado) : null;

  const { data } = await sb.from('carimbos').select('id,from_user,tipo').eq('alvo', alvo);
  const minha = (data||[]).find(r => norm(r.from_user) === norm(usuario));

  if(!tipo){
    if(minha) await sb.from('carimbos').delete().eq('id', minha.id);
  }else if(minha){
    await sb.from('carimbos').update({ tipo, ts: Date.now() }).eq('id', minha.id);
  }else{
    await sb.from('carimbos').insert({
      profile_user: autorReal ? autorReal.usuario : null,
      from_user: usuario, tipo, ts: Date.now(), alvo
    });
    /* avisa o autor — mas só quando ele é outra pessoa */
    if(autorReal && norm(autorReal.usuario) !== norm(usuario)){
      const pmap = await lerPerfisMap();
      const dispF = (pmap[norm(usuario)] && pmap[norm(usuario)].display) || usuario;
      await criarNotif(autorReal.usuario, 'carimbos', 'reacao:'+alvo+':'+norm(usuario),
        '❤️ Reação no seu post', dispF + ' reagiu a uma publicação sua.', '/perfil.html');
    }
  }

  const { data: d2 } = await sb.from('carimbos').select('tipo,from_user').eq('alvo', alvo);
  const tipos = {}; let meu = null;
  (d2||[]).forEach(r => {
    tipos[r.tipo] = (tipos[r.tipo] || 0) + 1;
    if(norm(r.from_user) === norm(usuario)) meu = String(r.tipo);
  });
  return { ok:true, total: (d2||[]).length, tipos, meu };
}

async function apiReputacao(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  { const bloq = await barreiraModeracao(usuario, 'interagir'); if(bloq) return { ok:false, error: bloq }; }
  const alvo = String(body.alvo||'');
  if(!alvo || norm(alvo)===norm(usuario)) return { ok:false, error:'não dá pra votar no seu próprio perfil' };
  if(!(await acharUsuario(alvo))) return { ok:false, error:'perfil não encontrado' };
  let valor = Number(body.valor); if(valor!==1 && valor!==-1 && valor!==0) valor = 0;
  const { data } = await sb.from('reputacao').select('*').ilike('profile_user', alvo);
  const minha = (data||[]).find(r => norm(r.profile_user)===norm(alvo) && norm(r.from_user)===norm(usuario));
  if(minha){
    if(valor===0) await sb.from('reputacao').delete().eq('id', minha.id);
    else await sb.from('reputacao').update({ valor, ts: Date.now() }).eq('id', minha.id);
  } else if(valor!==0){
    await sb.from('reputacao').insert({ profile_user: alvo, from_user: usuario, valor, ts: Date.now() });
  }
  const { data: d2 } = await sb.from('reputacao').select('*').ilike('profile_user', alvo);
  let total = 0, meu = 0;
  (d2||[]).forEach(r => { if(norm(r.profile_user)===norm(alvo)){ const v = Number(r.valor)||0; total += v; if(norm(r.from_user)===norm(usuario)) meu = v; } });
  return { ok:true, total, meu };
}

/* Apaga a conta de vez.
   ATENÇÃO ao histórico deste trecho: a versão antiga fazia select('*') SEM filtro,
   e o PostgREST corta em 1000 linhas — em tabelas grandes (visitas, notificacoes)
   as linhas do usuário nem apareciam, a FK bloqueava o delete final em `usuarios`,
   o erro era ignorado e a função devolvia ok:true com a conta ainda no banco.
   Agora: filtro no servidor + checagem de erro em cada passo + confirmação no fim. */
async function apiDeletarConta(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const nu = norm(usuario);

  const avisos = [];
  const anota = (etapa, error) => { if(error) avisos.push(etapa + ': ' + (error.message || String(error))); };

  /* 1) anonimiza os votos (as médias das peças continuam)

     `name` PRECISA ir junto com `usuario`. Quem vota logado grava o próprio
     nome nas DUAS colunas (ver apiEnviarVoto), e é o `name` que aparece na
     lista pública de avaliações. Zerando só o `usuario`, a conta sumia do
     perfil mas o nome continuava estampado no site — ou seja, apagar a
     conta não apagava o nome de verdade. */
  {
    const { data, error } = await sb.from('submissions').select('row_id,usuario').ilike('usuario', usuario);
    anota('ler submissions', error);
    const ids = (data||[]).filter(r => norm(r.usuario)===nu).map(r => r.row_id);
    if(ids.length){
      const { error: e2 } = await sb.from('submissions').update({ usuario: null, name: '' }).in('row_id', ids);
      anota('anonimizar votos', e2);
    }
  }

  /* 2) apaga os rastros — uma consulta FILTRADA por coluna */
  const delWhere = async (table, cols) => {
    const ids = new Set();
    for(const c of cols){
      const { data, error } = await sb.from(table).select('*').ilike(c, usuario);
      if(error){ anota('ler ' + table + '.' + c, error); continue; }
      (data||[]).forEach(r => { if(norm(r[c])===nu && r.id != null) ids.add(r.id); });
    }
    if(ids.size){
      const { error } = await sb.from(table).delete().in('id', [...ids]);
      anota('apagar ' + table, error);
    }
  };
  await delWhere('carimbos',     ['profile_user','from_user']);
  await delWhere('visitas',      ['profile_user','visitor_user']);
  await delWhere('reputacao',    ['profile_user','from_user']);
  await delWhere('palpites',     ['usuario']);
  await delWhere('resets',       ['usuario']);
  await delWhere('notificacoes', ['usuario']);
  await delWhere('sessoes',      ['usuario']);

  /* login_codes tem a PK na própria coluna usuario */
  { const { error } = await apagarPorNome(sb, 'login_codes', 'usuario', usuario); anota('apagar login_codes', error); }

  /* push (a chave é o endpoint, não id) */
  {
    const { data, error } = await sb.from('push').select('endpoint,usuario').ilike('usuario', usuario);
    anota('ler push', error);
    const eps = (data||[]).filter(r => norm(r.usuario)===nu).map(r => r.endpoint);
    if(eps.length){ const { error: e2 } = await sb.from('push').delete().in('endpoint', eps); anota('apagar push', e2); }
  }

  /* 3b) se a conta veio do Google, apaga também o usuário no Supabase Auth —
     senão a pessoa exclui a conta, clica em "Entrar com Google" e ela ressuscita */
  {
    const uid = (asObj(u.perfil).oauth || {}).supabase_uid;
    if(uid){ try{ await sb.auth.admin.deleteUser(String(uid)); }catch(e){ anota('apagar login social', e); } }
  }

  /* 3) o usuário por último — agora COM checagem de erro */
  const { error: erroFinal } = await sb.from('usuarios').delete().eq('usuario', u.usuario);
  if(erroFinal) return { ok:false, error:'não deu pra apagar a conta — ' + (erroFinal.message || erroFinal), detalhes: avisos };

  /* 4) confirma que sumiu mesmo (nunca mais devolver ok:true sem checar) */
  if(await acharUsuario(usuario)) return { ok:false, error:'a conta continua no banco (alguma tabela ainda referencia ela)', detalhes: avisos };

  return { ok:true, avisos };
}

/* =====================================================================
   LOGIN SOCIAL (Google) — o Supabase Auth entra SÓ como "provador de identidade".
   =====================================================================
   O sistema de sessão/token daqui continua exatamente o mesmo: o navegador faz
   o OAuth, manda o access_token pra cá, a gente valida com o Supabase e emite
   um token NOSSO com criarSessao(). Nada a jusante (perfil, votos, badges)
   precisa saber que existe OAuth.

   A identidade do site continua sendo o NOME DE USUÁRIO. Por isso quem entra
   pelo Google sem ter conta recebe { precisaNome:true } e escolhe um nome antes
   de existir na tabela `usuarios`. */

/* valida o access_token do Supabase Auth e devolve o usuário do provedor */
async function validarTokenOAuth(accessToken){
  const jwt = String(accessToken || '');
  if(!jwt) return { erro: 'token ausente' };
  let data, error;
  try{ ({ data, error } = await sb.auth.getUser(jwt)); }
  catch(e){ return { erro: 'não deu pra validar o login' }; }
  if(error || !data || !data.user) return { erro: 'login expirado — tente de novo' };
  const au = data.user;
  const email = String(au.email || '').trim().toLowerCase();
  const meta = au.user_metadata || {};
  /* só aceitamos e-mail VERIFICADO pelo provedor. Sem isso, casar contas por
     e-mail vira vetor de tomada de conta (eu cadastro com o seu e-mail e espero
     você entrar pelo Google). */
  const verificado = !!(au.email_confirmed_at || meta.email_verified === true);
  if(!email || !verificado) return { erro: 'o provedor não confirmou seu e-mail' };
  return {
    uid: String(au.id),
    email,
    provider: String((au.app_metadata && au.app_metadata.provider) || 'google'),
    nomeSugerido: String(meta.full_name || meta.name || email.split('@')[0] || '')
  };
}

/* acha a conta já ligada a este uid do Supabase Auth (filtro em JSON, sem varrer a tabela) */
async function acharUsuarioPorOAuth(uid){
  const { data } = await sb.from('usuarios').select('*').eq('perfil->oauth->>supabase_uid', String(uid)).limit(1);
  return (data || [])[0] || null;
}
/* acha a conta pelo e-mail salvo no perfil (para LIGAR uma conta antiga ao
   Google). Devolve { linha, verificado } porque quem CHAMA precisa saber se
   aquele e-mail foi provado — um e-mail que a própria pessoa digitou nas
   configurações não prova nada (ver apiLoginOAuth). */
async function acharUsuarioPorEmail(email){
  const alvo = String(email || '').trim().toLowerCase();
  if(!alvo) return null;
  const { data } = await sb.from('usuarios').select('*').ilike('perfil->>email', alvo).limit(20);
  const iguais = (data || []).filter(r => String(asObj(r.perfil).email || '').trim().toLowerCase() === alvo);
  if(!iguais.length) return null;
  /* se houver mais de uma conta com o mesmo e-mail, a verificada ganha */
  const verificada = iguais.find(r => asObj(r.perfil).email_verificado === true);
  return verificada ? { linha: verificada, verificado: true } : { linha: iguais[0], verificado: false };
}

/* transforma um nome qualquer (vindo do Google) numa sugestão válida pro site */
function sugerirNome(bruto){
  let n = String(bruto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  n = n.replace(/[^A-Za-z0-9_.\- ]/g, '').trim().slice(0, 20);
  return n.length >= 2 ? n : '';
}

async function apiLoginOAuth(body){
  const info = await validarTokenOAuth(body.accessToken);
  if(info.erro) return { ok:false, error: info.erro };

  /* 1) já entrou pelo Google antes: só emite a sessão */
  let u = await acharUsuarioPorOAuth(info.uid);

  /* 2) tem conta antiga com esse e-mail: liga as duas — MAS só se aquele
     e-mail já tiver sido provado do nosso lado (link de redefinição aberto,
     código de 2FA usado, ou conta nascida do próprio Google).

     Sem essa checagem existe um ataque de "pré-sequestro": eu crio uma conta
     aqui, ponho o SEU e-mail nas configurações (ninguém confere) e espero.
     Quando você entra pelo Google pela primeira vez, o e-mail bate, o sistema
     liga o seu Google à MINHA conta e te entrega uma sessão dentro dela — e
     eu, que sei a senha, passo a ver tudo o que você faz. */
  if(!u){
    const achado = await acharUsuarioPorEmail(info.email);
    if(achado && achado.verificado){
      const antigo = achado.linha;
      const p = asObj(antigo.perfil);
      p.oauth = Object.assign({}, p.oauth, { supabase_uid: info.uid, provider: info.provider });
      p.email_verificado = true;
      await sb.from('usuarios').update({ perfil: p }).eq('usuario', antigo.usuario);
      u = antigo;
    }else if(achado){
      return { ok:false, error:'já existe uma conta usando esse e-mail. Entre com usuário e senha e confirme o e-mail (é só pedir "Esqueci minha senha" e abrir o link) — depois disso o botão do Google liga nessa conta.' };
    }
  }

  /* 3) ninguém: precisa escolher um nome de usuário antes de existir aqui */
  if(!u){
    let sug = sugerirNome(info.nomeSugerido);
    if(sug && await acharUsuario(sug)) sug = '';
    return { ok:false, precisaNome:true, email: info.email, sugestao: sug };
  }

  { const bloq = bloqueioDe(u, 'login'); if(bloq) return { ok:false, error: bloq, banido:true }; }
  const token = await criarSessao(u.usuario, body.dispositivo);
  return { ok:true, user: u.usuario, token, admin: u.admin === true };
}

/* segunda etapa: a pessoa escolheu o nome de usuário */
async function apiFinalizarOAuth(body){
  const info = await validarTokenOAuth(body.accessToken);
  if(info.erro) return { ok:false, error: info.erro };

  /* corrida/duplicata: se nesse meio-tempo já ligou, só devolve a sessão */
  const jaLigado = await acharUsuarioPorOAuth(info.uid);
  if(jaLigado){
    const bloq = bloqueioDe(jaLigado, 'login'); if(bloq) return { ok:false, error: bloq, banido:true };
    const token = await criarSessao(jaLigado.usuario, body.dispositivo);
    return { ok:true, user: jaLigado.usuario, token, admin: jaLigado.admin === true };
  }

  const usuario = String(body.user || '').trim();
  if(usuario.length < 2 || usuario.length > 20) return { ok:false, error:'usuário deve ter de 2 a 20 caracteres' };
  if(!/^[A-Za-z0-9_.\- ]+$/.test(usuario)) return { ok:false, error:'usuário tem caracteres inválidos' };
  if(await acharUsuario(usuario)) return { ok:false, error:'esse usuário já existe — escolha outro' };

  /* conta sem senha: gravamos um hash aleatório impossível de adivinhar e
     marcamos semSenha, para o login por senha recusar com uma mensagem útil */
  const salt = novoToken().slice(0, 8);
  const senhaImpossivel = novoToken() + novoToken();
  /* email_verificado: o e-mail veio do provedor e já foi conferido em
     validarTokenOAuth (email_confirmed_at / email_verified) */
  const perfil = { email: info.email, email_verificado: true, oauth: { supabase_uid: info.uid, provider: info.provider, semSenha: true } };

  const { error } = await sb.from('usuarios').insert({
    usuario, senha_hash: hashSenha(senhaImpossivel, salt), salt, token: null,
    criado_em: Date.now(), tentativas: 0, lock_until: 0, perfil
  });
  if(error) return { ok:false, error:'esse usuário já existe — escolha outro' };

  const token = await criarSessao(usuario, body.dispositivo);
  return { ok:true, user: usuario, token, admin: false };
}

async function apiMeuPerfil(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const u = await acharUsuario(usuario);
  /* `moderacao` é o que o front usa pra decidir se abre a tela obrigatória de
     troca de nome ou o aviso de conta silenciada. Vai só pro DONO da conta —
     esta rota já exige token — e nunca pro perfil público. */
  const est = u ? estadoConta(u.perfil) : null;
  return {
    ok:true, user: u?u.usuario:usuario, perfil: u?asObj(u.perfil):{},
    admin: !!(u && u.admin === true),
    moderacao: est ? {
      precisaTrocarNome: est.precisaTrocarNome,
      motivoNome: est.nomeBloqueadoMotivo,
      banido: est.banido, banidoAte: est.banidoAte, banidoMotivo: est.banidoMotivo,
      silenciado: est.silenciado, silenciadoAte: est.silenciadoAte
    } : null
  };
}

/* ---------------------------------------------------------------------
   Troca de nome pedida pelo PRÓPRIO usuário. Hoje só é liberada quando o
   admin marcou `nome_bloqueado` no perfil (nome inapropriado): a pessoa é
   obrigada a escolher outro antes de continuar usando o site.

   A renomeação em si mora em _moderacao.js porque o painel admin também a
   usa — a regra de "quem pode renomear" é que muda entre os dois.
   --------------------------------------------------------------------- */
async function apiTrocarNome(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };

  const est = estadoConta(u.perfil);
  if(est.banido) return { ok:false, error: mensagemBloqueio(est) };
  if(!est.precisaTrocarNome) return { ok:false, error:'sua conta não precisa trocar de nome' };

  const novo = String(body.novoNome||'').trim();
  const erro = validarNome(novo);
  if(erro) return { ok:false, error: erro };

  const r = await migrarNomeUsuario(sb, u.usuario, novo, { limparAnonimato: true, motivo: est.nomeBloqueadoMotivo });
  if(!r.ok) return r;

  /* todas as sessões antigas migraram junto com a linha de `sessoes`, mas o
     token do aparelho atual agora aponta pro nome novo — devolvemos um token
     novo mesmo assim, para o localStorage do cliente ficar coerente */
  await apagarPorNome(sb, 'sessoes', 'usuario', novo);
  const token = await criarSessao(novo, body.dispositivo);
  await criarNotif(novo, 'admin', 'nome:'+Date.now(), '✏️ Nome atualizado',
    'Seu nome de usuário agora é ' + novo + '.', '/perfil.html');
  return { ok:true, user: novo, token, admin: u.admin === true, avisos: r.avisos || [] };
}

async function apiSalvarPush(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const sub = body.sub || {}; const keys = sub.keys || {};
  const endpoint = String(sub.endpoint||'');
  if(!endpoint || !keys.p256dh || !keys.auth) return { ok:false, error:'inscrição inválida' };
  await sb.from('push').upsert({ endpoint, usuario, p256dh:String(keys.p256dh), auth:String(keys.auth), ts:Date.now() }, { onConflict:'endpoint' });
  return { ok:true };
}
async function apiRemoverPush(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const endpoint = String(body.endpoint||'');
  if(!endpoint) return { ok:false };
  await sb.from('push').delete().eq('endpoint', endpoint);
  return { ok:true };
}
async function apiRemoverPushMorto(body){
  if(!segredoOk(body.secret, PUSH_SECRET)) return { ok:false, error:'não autorizado' };
  const eps = Array.isArray(body.endpoints) ? body.endpoints.map(String) : [];
  if(!eps.length) return { ok:true, removidos:0 };
  await sb.from('push').delete().in('endpoint', eps);
  return { ok:true, removidos: eps.length };
}

async function apiPedirReset(body, req){
  const conta = String(body.conta||'').trim();
  /* Esta rota DISPARA E-MAIL a cada chamada. Sem teto, um laço queima a cota
     da Resend e transforma o site em ferramenta de spam contra a caixa da
     vítima. Dois tetos: um por origem, outro pela conta pedida. */
  { const r = await limiteTaxa('reset:ip:' + ipDe(req), 5, 60*60*1000);
    if(!r.ok) return { ok:false, error:'muitos pedidos deste aparelho — espere ' + textoEspera(r.esperar) }; }
  if(conta){
    const r = await limiteTaxa('reset:c:' + hashCurto(norm(conta)), 3, 60*60*1000);
    if(!r.ok) return { ok:true, msg:'Se houver um e-mail cadastrado para essa conta, enviamos um link de redefinição.' };
  }
  const generico = { ok:true, msg:'Se houver um e-mail cadastrado para essa conta, enviamos um link de redefinição.' };
  if(!conta) return { ok:false, error:'informe seu usuário ou e-mail' };
  const map = await lerPerfisMap();
  let alvo = null;
  if(conta.indexOf('@') >= 0){
    /* pode haver mais de uma conta com o mesmo e-mail digitado (ninguém
       conferia até aqui). A VERIFICADA tem prioridade — senão alguém que
       cadastrasse o seu e-mail te deixava sem conseguir recuperar a sua. */
    const el = conta.toLowerCase();
    const candidatos = Object.keys(map).map(k => map[k]).filter(m => m.email && m.email.toLowerCase() === el);
    alvo = candidatos.find(m => m.verificado) || candidatos[0] || null;
  }
  else alvo = map[norm(conta)] || null;
  if(!alvo || !alvo.email) return generico;
  const token = novoToken();
  await sb.from('resets').insert({ usuario: alvo.user, token, exp: Date.now()+RESET_TTL_MS, usado:false });
  const link = SITE_URL + '/redefinir-senha.html?user=' + encodeURIComponent(alvo.user) + '&token=' + token;
  await enviarEmailReset(alvo.email, alvo.user, link);
  return generico;
}
async function apiRedefinirSenha(body){
  const usuario = String(body.user||''), token = String(body.token||''), nova = String(body.novaSenha||'');
  if(nova.length < 8) return { ok:false, error:'a senha precisa de pelo menos 8 caracteres' };
  if(!token || !usuario) return { ok:false, error:'link inválido' };
  const { data } = await sb.from('resets').select('*').eq('token', token);
  const linha = (data||[]).find(r => norm(r.usuario)===norm(usuario));
  if(!linha) return { ok:false, error:'link inválido' };
  if(linha.usado === true) return { ok:false, error:'este link já foi usado' };
  if(Date.now() > Number(linha.exp)) return { ok:false, error:'este link expirou — peça outro' };
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const salt = novoToken().slice(0,8);
  await sb.from('usuarios').update({ senha_hash: hashSenha(nova,salt), salt, token: null, tentativas:0, lock_until:0 }).eq('usuario', u.usuario);
  /* abriu o link que só chegou naquela caixa de entrada => e-mail provado */
  await marcarEmailVerificado(u);
  try{ await apagarPorNome(sb, 'sessoes', 'usuario', u.usuario); }catch(e){}   // desloga todos os dispositivos
  await sb.from('resets').update({ usado:true }).eq('id', linha.id);
  const novoTok = await criarSessao(u.usuario, body.dispositivo);
  return { ok:true, user:u.usuario, token:novoTok };
}

async function apiListarNotificacoes(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, notificacoes:[] };
  const { data } = await sb.from('notificacoes').select('*').ilike('usuario', usuario).order('ts', { ascending:false }).limit(100);
  const notificacoes = (data||[]).filter(r => norm(r.usuario)===norm(usuario)).map(r => ({ id:String(r.notif_id), tipo:String(r.tipo), titulo:String(r.titulo), corpo:String(r.corpo), url:String(r.url), criadoEm:Number(r.ts)||0, lida: r.lida===true }));
  return { ok:true, notificacoes };
}
async function apiContarNotifNaoLidas(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, total:0 };
  const { data } = await sb.from('notificacoes').select('usuario,lida').ilike('usuario', usuario);
  const total = (data||[]).filter(r => norm(r.usuario)===norm(usuario) && r.lida!==true).length;
  return { ok:true, total };
}
async function apiMarcarNotifLidas(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
  const nu = norm(usuario);
  // a tabela pode não ter coluna 'id' — usamos (usuario + notif_id) como alvo
  const { data, error: errSel } = await sb.from('notificacoes').select('usuario,notif_id,lida').ilike('usuario', usuario).limit(1000);
  const meus = (data||[]).filter(r => norm(r.usuario) === nu);
  const alvos = meus.filter(r => r.lida !== true && (!ids || ids.indexOf(String(r.notif_id)) >= 0)).map(r => String(r.notif_id));
  const usuariosExatos = [...new Set(meus.map(r => r.usuario))];   // valores exatos p/ o update preciso
  let erro = errSel ? String(errSel.message) : null;
  if(alvos.length && usuariosExatos.length){
    const up = await sb.from('notificacoes').update({ lida: true }).in('usuario', usuariosExatos).in('notif_id', alvos);
    if(up.error) erro = String(up.error.message);
  }
  return { ok: !erro, marcadas: alvos.length, achadas: (data||[]).length, erro };
}
async function apiCriarNotif(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false };
  const criada = await criarNotif(usuario, String(body.tipo||''), String(body.id||''), String(body.titulo||''), String(body.corpo||''), String(body.url||''));
  return { ok:true, criada };
}
async function apiListarSessoes(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, sessoes:[] };
  const { data } = await sb.from('sessoes').select('*').ilike('usuario', usuario).order('criado_em', { ascending:false });
  const sessoes = (data||[]).filter(r => norm(r.usuario) === norm(usuario)).map(r => ({
    id: r.id, dispositivo: r.dispositivo || 'Dispositivo', criadoEm: Number(r.criado_em)||0,
    ultimoUso: Number(r.ultimo_uso)||0, atual: String(r.token) === String(body.token)
  }));
  return { ok:true, sessoes };
}
async function apiRevogarSessao(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false };
  const { data } = await sb.from('sessoes').select('id,usuario').eq('id', body.id).limit(1);
  const s = (data||[])[0];
  if(s && norm(s.usuario) === norm(usuario)) await sb.from('sessoes').delete().eq('id', body.id);
  return { ok:true };
}
async function apiLogout(body){
  const token = String(body.token||'');
  if(token){ try{ await sb.from('sessoes').delete().eq('token', token); }catch(e){} }
  return { ok:true };
}
// consome o anonimato "de uma vez só": o front chama isso logo depois que a
// ação anônima (post/voto/comentário etc.) foi publicada, aí volta ao normal.
async function apiConsumirAnonUmaVez(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const p = asObj(u.perfil);
  if(p.anon_modo === 'uma_vez'){
    p.anonimo = false; delete p.anon_modo; delete p.anon_ate;
    await sb.from('usuarios').update({ perfil: p }).eq('usuario', u.usuario);
  }
  return { ok:true, anonimo: !!p.anonimo };
}

async function apiCriarBroadcast(body){
  if(!segredoOk(body.secret, PUSH_SECRET)) return { ok:false, error:'não autorizado' };
  const titulo = String(body.titulo||'').trim(), corpo = String(body.corpo||'').trim();
  if(!titulo && !corpo) return { ok:false, error:'aviso vazio' };
  const id = String(body.id || ('bc:'+Date.now()));
  let dur = Number(body.dur)||0; if(dur<0) dur=0; if(dur>120) dur=120;
  await sb.from('broadcasts').insert({ bc_id:id, titulo, corpo, url:String(body.url||'/index.html'), ts:Date.now(), dur });
  return { ok:true, id };
}

async function handlePost(req, res){
  let body = req.body;
  if(typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  body = body || {};
  const action = body.action ? String(body.action) : 'voto';
  const rotas = {
    registrar: apiRegistrar, login: apiLogin, login2fa: apiLogin2fa,
    loginOAuth: apiLoginOAuth, finalizarOAuth: apiFinalizarOAuth, palpite: apiPalpite, perfil: apiPerfil,
    visita: apiVisita, carimbo: apiCarimbo, reputacao: apiReputacao, deletarConta: apiDeletarConta,
    meuPerfil: apiMeuPerfil, salvarPush: apiSalvarPush, removerPush: apiRemoverPush,
    pedirReset: apiPedirReset, redefinirSenha: apiRedefinirSenha,
    listarNotificacoes: apiListarNotificacoes, contarNotifNaoLidas: apiContarNotifNaoLidas,
    marcarNotifLidas: apiMarcarNotifLidas, criarNotif: apiCriarNotif,
    removerPushMorto: apiRemoverPushMorto, criarBroadcast: apiCriarBroadcast, voto: apiVoto,
    listarSessoes: apiListarSessoes, revogarSessao: apiRevogarSessao, logout: apiLogout,
    consumirAnonUmaVez: apiConsumirAnonUmaVez, trocarNome: apiTrocarNome,
    reagir: apiReagir, apagarAvaliacao: apiApagarAvaliacao
  };
  /* manutenção: recusa escrita ANTES de rotear (ver bloqueioManutencao) */
  { const bloq = await bloqueioManutencao(action, body);
    if(bloq) return res.json({ ok:false, manutencao:true, error: bloq }); }

  const fn = rotas[action] || apiVoto;
  /* `req` vai junto porque as rotas com limite de taxa precisam da origem da
     chamada (apiVoto, apiRegistrar, apiPedirReset). As demais ignoram. */
  return res.json(await fn(body, req));
}

module.exports = async (req, res) => {
  try{
    if(req.method === 'GET') return await handleGet(req, res);
    if(req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok:false, error:'método não suportado' });
  }catch(e){ res.status(500).json({ ok:false, error:String((e && e.message) || e) }); }
};
