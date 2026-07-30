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
const { migrarNomeUsuario, estadoConta, mensagemBloqueio, validarNome } = require('./_moderacao');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }
});

/* ---------------- constantes (iguais ao .gs) ---------------- */
const MAX_RATING = 10;
const CURRENT_EDITION_YEAR = 2026;
const MAX_TENTATIVAS = 5;
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
    const { data } = await sb.from('edicoes').select('ano,fim_votacao');
    const m = {};
    (data||[]).forEach(r => { m[Number(r.ano)] = r.fim_votacao || null; });
    _fimCache = m; _fimCacheAt = Date.now();
  }catch(e){ _fimCache = _fimCache || {}; }
  return _fimCache;
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
  const { data } = await sb.from('usuarios').select('usuario,perfil');
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
  const { data } = await sb.from('notificacoes').select('id').ilike('usuario', usuario).eq('notif_id', chave).limit(1);
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
    const { data } = await sb.from('push').select('endpoint,p256dh,auth');
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

  // ranking de reputação
  if(q.ranking === 'reputacao'){
    const { data: rRows } = await sb.from('reputacao').select('profile_user,valor');
    const pmap = await lerPerfisMap();
    const soma = {};
    (rRows||[]).forEach(r => { const key = norm(r.profile_user); if(!key) return; if(!soma[key]) soma[key] = { user:String(r.profile_user), rep:0 }; soma[key].rep += Number(r.valor)||0; });
    const ranking = Object.keys(soma).map(k => { const m = pmap[k]; return { user:(m&&m.anonimo)?m.display:soma[k].user, rep:soma[k].rep }; }).sort((a,b)=>b.rep-a.rep);
    return res.json({ ranking });
  }

  // bolão (só depois de fechar)
  if(q.palpites){
    const y = Number(q.palpites);
    if(!(await votingClosed(y))) return res.json({ open:true, palpites:[] });
    const { data } = await sb.from('palpites').select('*').eq('year', y);
    const palpites = (data||[]).filter(r => r.usuario).map(r => ({ user:String(r.usuario), year:Number(r.year), palpites: asObj(r.palpites), ts:Number(r.ts) }));
    return res.json({ closed:true, palpites });
  }

  // feed de votos (default)
  const year = q.year ? Number(q.year) : CURRENT_EDITION_YEAR;
  const { data } = await sb.from('submissions').select('*').eq('year', year);
  const pmap = await lerPerfisMap();
  const submissions = (data||[]).filter(r => r.sub_id).map(r => ({
    id:String(r.sub_id), ts:Number(r.ts), name:String(r.name||''), grid: asObj(r.grid),
    year: r.year?Number(r.year):CURRENT_EDITION_YEAR, user: displayFeed(String(r.usuario||''), pmap)
  })).filter(s => !hasInvalidRating(s.grid)).filter(s => s.year === year);
  return res.json({ serverNow: Date.now(), votingClosed: await votingClosed(year), submissions });
}

/* ==================================================================
   POST — ações
   ================================================================== */
async function apiRegistrar(body){
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

async function apiLogin(body){
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

async function apiVoto(body){
  if(!body || !body.id || !body.grid) return { ok:false, error:'dados inválidos' };
  const year = body.year ? Number(body.year) : CURRENT_EDITION_YEAR;
  if(await votingClosed(year)) return { ok:false, error:'votação encerrada' };
  if(hasInvalidRating(body.grid)) return { ok:true };
  let usuario = null;
  if(body.user && await verificarToken(body.user, body.token)){
    const bloq = await barreiraModeracao(body.user, 'interagir');
    if(bloq) return { ok:false, error: bloq };
    usuario = String(body.user);
  }
  await sb.from('submissions').insert({ sub_id:String(body.id), ts:Number(body.ts)||Date.now(), name:String(body.name||'').slice(0,40), grid:body.grid, year, usuario });
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

async function apiPalpite(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login para palpitar' };
  { const bloq = await barreiraModeracao(usuario, 'interagir'); if(bloq) return { ok:false, error: bloq }; }
  const year = body.year ? Number(body.year) : CURRENT_EDITION_YEAR;
  if(await votingClosed(year)) return { ok:false, error:'o bolão desse ano já fechou' };
  const entrada = (body.palpites && typeof body.palpites==='object') ? body.palpites : null;
  if(!entrada) return { ok:false, error:'nenhum palpite enviado' };
  const limpos = {};
  Object.keys(entrada).forEach(k => { const v = Number(entrada[k]); if(!isNaN(v) && v>=0 && v<=MAX_RATING) limpos[k]=v; });
  if(!Object.keys(limpos).length) return { ok:false, error:'palpites inválidos' };
  const { data } = await sb.from('palpites').select('id,usuario,year').eq('year', year);
  const existente = (data||[]).find(r => norm(r.usuario)===norm(usuario));
  if(existente) await sb.from('palpites').update({ palpites: limpos, ts: Date.now() }).eq('id', existente.id);
  else await sb.from('palpites').insert({ usuario, year, palpites: limpos, ts: Date.now() });
  return { ok:true };
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
  for(const a of depois){
    const na = norm(a);
    if(na && na !== norm(usuario) && antes.indexOf(na) < 0 && await acharUsuario(a)){
      await criarNotif(a, 'amigos', 'amigo:'+norm(usuario), '🤝 Novo amigo', dispU + ' adicionou você como amigo.', '/perfil.html?user=' + encodeURIComponent(dispU));
    }
  }
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

  /* 1) anonimiza os votos (as médias das peças continuam) */
  {
    const { data, error } = await sb.from('submissions').select('row_id,usuario').ilike('usuario', usuario);
    anota('ler submissions', error);
    const ids = (data||[]).filter(r => norm(r.usuario)===nu).map(r => r.row_id);
    if(ids.length){
      const { error: e2 } = await sb.from('submissions').update({ usuario: null }).in('row_id', ids);
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
  { const { error } = await sb.from('login_codes').delete().ilike('usuario', usuario); anota('apagar login_codes', error); }

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
  await sb.from('sessoes').delete().ilike('usuario', novo);
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

async function apiPedirReset(body){
  const conta = String(body.conta||'').trim();
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
  try{ await sb.from('sessoes').delete().ilike('usuario', u.usuario); }catch(e){}   // desloga todos os dispositivos
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
  const fn = rotas[action] || apiVoto;
  return res.json(await fn(body));
}

module.exports = async (req, res) => {
  try{
    if(req.method === 'GET') return await handleGet(req, res);
    if(req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok:false, error:'método não suportado' });
  }catch(e){ res.status(500).json({ ok:false, error:String((e && e.message) || e) }); }
};
