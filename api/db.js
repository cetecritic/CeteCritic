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

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }
});

/* ---------------- constantes (iguais ao .gs) ---------------- */
const MAX_RATING = 10;
const CURRENT_EDITION_YEAR = 2026;
const MAX_TENTATIVAS = 5;
const LOCK_MS = 10 * 60 * 1000;
const CARIMBO_COOLDOWN_MS = 5 * 60 * 1000;
const CARIMBOS_VALIDOS = { joia:1, critico:1, parceiro:1, lenda:1, concordo:1, discordo:1, palmas:1, polemico:1 };
const RESET_TTL_MS = 60 * 60 * 1000;
const SITE_URL = process.env.RESET_SITE_URL || 'https://cetecritic.xyz';
const PUSH_SECRET = process.env.PUSH_SECRET || '';

// trava de votação por ano (null = sempre aberta; ano ausente = fechado)
const FESTIVAL_END_BY_YEAR = {
  2027: new Date('2027-07-17T23:59:00-03:00'),
  2026: new Date('2026-07-18T23:59:00-03:00'),
  2025: null, 2024: null, 2023: null, 2022: null, 2021: null, 2020: null,
};
function votingClosed(year){
  const y = Number(year);
  if(!(y in FESTIVAL_END_BY_YEAR)) return true;
  const end = FESTIVAL_END_BY_YEAR[y];
  return end === null ? false : (new Date() >= end);
}

/* ---------------- helpers ---------------- */
const norm = u => String(u || '').trim().toLowerCase();
function hash(senha, salt){ return crypto.createHash('sha256').update(String(salt) + '|' + String(senha)).digest('hex'); }
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
async function verificarToken(usuario, token){
  if(!usuario || !token) return false;
  const u = await acharUsuario(usuario);
  return !!(u && u.token && u.token === String(token));
}
// mapa normUser -> { user, display, anonimo, privado, email }
async function lerPerfisMap(){
  const { data } = await sb.from('usuarios').select('usuario,perfil');
  const map = {};
  (data || []).forEach(r => {
    const usuario = String(r.usuario || ''); if(!usuario) return;
    const p = asObj(r.perfil);
    const anon = !!p.anonimo;
    const display = anon ? (String(p.pseudo || '').trim() || ('Anônimo ' + (hashNum(usuario) % 9000 + 1000))) : usuario;
    map[norm(usuario)] = { user: usuario, display, anonimo: anon, privado: !!p.privado, email: String(p.email || '').trim() };
  });
  return map;
}
function displayFeed(usuario, map){ const m = map[norm(usuario)]; return (m && m.anonimo) ? m.display : String(usuario || ''); }
function perfilPublico(cfg){ const c = {}; for(const k in cfg){ if(k==='email'||k==='notif') continue; c[k] = cfg[k]; } return c; }

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

async function enviarEmailReset(to, usuario, link){
  if(!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return; // sem provedor: não envia
  try{
    await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ 'Authorization':'Bearer '+process.env.RESEND_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM, to,
        subject: 'CETECritic — redefinir senha',
        html: 'Olá, ' + usuario + '!<br><br>Recebemos um pedido para redefinir a senha da sua conta no CETECritic. ' +
              'Clique no link abaixo (vale por 1 hora):<br><br><a href="'+link+'">'+link+'</a><br><br>' +
              'Se não foi você, ignore este e-mail — sua senha continua a mesma.'
      })
    });
  }catch(e){ /* estourou cota / erro: ainda responde genérico */ }
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
    const disp = who => { const m = pmap[norm(who)]; return (m && m.anonimo) ? m.display : String(who || ''); };
    const { data: vRows } = await sb.from('visitas').select('*').ilike('profile_user', alvo);
    const visitas = (vRows||[]).filter(r => norm(r.profile_user)===norm(alvo))
      .map(r => ({ visitor: disp(r.visitor_user), ts: Number(r.ts), count: Number(r.count)||1 }));
    const totalVisitas = visitas.reduce((a,b)=>a+b.count, 0);
    const { data: cRows } = await sb.from('carimbos').select('*').ilike('profile_user', alvo);
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

  // lista de usuários (busca / adicionar amigo)
  if(q.usuarios){
    const map = await lerPerfisMap();
    const usuarios = Object.keys(map).map(k => map[k]).filter(m => !m.privado).map(m => m.display);
    return res.json({ usuarios });
  }

  // lista de inscrições push (protegida) — mantida por compat
  if(q.listaPush){
    if(String(q.listaPush) !== PUSH_SECRET) return res.json({ ok:false, error:'não autorizado' });
    const { data } = await sb.from('push').select('endpoint,p256dh,auth');
    const subs = (data||[]).filter(r => r.endpoint).map(r => ({ endpoint:r.endpoint, keys:{ p256dh:r.p256dh, auth:r.auth } }));
    return res.json({ ok:true, subs });
  }

  // broadcasts (público)
  if(q.broadcasts){
    const desde = Date.now() - 7*24*60*60*1000;
    const { data } = await sb.from('broadcasts').select('*').gt('ts', desde).order('ts', { ascending:false }).limit(10);
    return res.json({ ok:true, broadcasts: (data||[]).map(b => ({ id:b.bc_id, titulo:b.titulo, corpo:b.corpo, url:b.url, ts:b.ts, dur:b.dur||0 })) });
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
    if(!votingClosed(y)) return res.json({ open:true, palpites:[] });
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
  return res.json({ serverNow: Date.now(), votingClosed: votingClosed(year), submissions });
}

/* ==================================================================
   POST — ações
   ================================================================== */
async function apiRegistrar(body){
  const usuario = String(body.user||'').trim();
  const senha = String(body.senha||'');
  if(usuario.length<2||usuario.length>20) return { ok:false, error:'usuário deve ter de 2 a 20 caracteres' };
  if(!/^[A-Za-z0-9_.\- ]+$/.test(usuario)) return { ok:false, error:'usuário tem caracteres inválidos' };
  if(senha.length<4) return { ok:false, error:'a senha precisa de pelo menos 4 caracteres' };
  if(await acharUsuario(usuario)) return { ok:false, error:'esse usuário já existe' };
  const salt = novoToken().slice(0,8);
  const token = novoToken();
  const email = String(body.email||'').trim();
  const perfil = (email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) ? { email } : {};
  const { error } = await sb.from('usuarios').insert({ usuario, senha_hash: hash(senha,salt), salt, token, criado_em: Date.now(), tentativas:0, lock_until:0, perfil });
  if(error) return { ok:false, error:'esse usuário já existe' };
  return { ok:true, user:usuario, token };
}

async function apiLogin(body){
  const usuario = String(body.user||'').trim();
  const senha = String(body.senha||'');
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const agora = Date.now();
  if((u.lock_until||0) > agora){ const min = Math.ceil((u.lock_until-agora)/60000); return { ok:false, error:'muitas tentativas — espere '+min+' min e tente de novo' }; }
  if(hash(senha, u.salt) !== u.senha_hash){
    const tent = (u.tentativas||0)+1;
    if(tent >= MAX_TENTATIVAS){ await sb.from('usuarios').update({ tentativas:0, lock_until: agora+LOCK_MS }).eq('usuario', u.usuario); return { ok:false, error:'muitas tentativas — bloqueado por 10 minutos' }; }
    await sb.from('usuarios').update({ tentativas: tent }).eq('usuario', u.usuario);
    return { ok:false, error:'senha incorreta ('+(MAX_TENTATIVAS-tent)+' tentativa(s) restante(s))' };
  }
  const token = novoToken();
  await sb.from('usuarios').update({ token, tentativas:0, lock_until:0 }).eq('usuario', u.usuario);
  return { ok:true, user:u.usuario, token };
}

async function apiVoto(body){
  if(!body || !body.id || !body.grid) return { ok:false, error:'dados inválidos' };
  const year = body.year ? Number(body.year) : CURRENT_EDITION_YEAR;
  if(votingClosed(year)) return { ok:false, error:'votação encerrada' };
  if(hasInvalidRating(body.grid)) return { ok:true };
  let usuario = null;
  if(body.user && await verificarToken(body.user, body.token)) usuario = String(body.user);
  await sb.from('submissions').insert({ sub_id:String(body.id), ts:Number(body.ts)||Date.now(), name:String(body.name||'').slice(0,40), grid:body.grid, year, usuario });
  return { ok:true };
}

async function apiPalpite(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login para palpitar' };
  const year = body.year ? Number(body.year) : CURRENT_EDITION_YEAR;
  if(votingClosed(year)) return { ok:false, error:'o bolão desse ano já fechou' };
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
  const cfg = (body.perfil && typeof body.perfil==='object') ? body.perfil : {};
  const antigo = asObj(u.perfil);
  const antes = Array.isArray(antigo.amigos) ? antigo.amigos.map(norm) : [];
  const depois = Array.isArray(cfg.amigos) ? cfg.amigos : [];
  await sb.from('usuarios').update({ perfil: cfg }).eq('usuario', u.usuario);
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
  const alvo = String(body.alvo||''), tipo = String(body.tipo||'');
  if(!alvo || norm(alvo)===norm(usuario)) return { ok:false, error:'não dá pra carimbar seu próprio perfil' };
  if(!CARIMBOS_VALIDOS[tipo]) return { ok:false, error:'carimbo inválido' };
  if(!(await acharUsuario(alvo))) return { ok:false, error:'perfil não encontrado' };
  const { data } = await sb.from('carimbos').select('*').ilike('profile_user', alvo);
  let ultima = 0;
  (data||[]).forEach(r => { if(norm(r.profile_user)===norm(alvo) && norm(r.from_user)===norm(usuario)) ultima = Math.max(ultima, Number(r.ts)||0); });
  const restante = CARIMBO_COOLDOWN_MS - (Date.now() - ultima);
  if(restante > 0) return { ok:false, error:'espere '+Math.ceil(restante/60000)+' min para carimbar este perfil de novo' };
  const agoraTs = Date.now();
  await sb.from('carimbos').insert({ profile_user: alvo, from_user: usuario, tipo, ts: agoraTs });
  const pmap = await lerPerfisMap();
  const dispF = (pmap[norm(usuario)] && pmap[norm(usuario)].display) || usuario;
  await criarNotif(alvo, 'carimbos', 'carimbo:'+norm(usuario)+':'+tipo+':'+agoraTs, '📮 Novo carimbo', dispF + ' te deu o carimbo "'+tipo+'".', '/perfil.html');
  return { ok:true };
}

async function apiReputacao(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
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

async function apiDeletarConta(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const nu = norm(usuario);
  // anonimiza votos (zera usuario)
  const { data: subs } = await sb.from('submissions').select('row_id,usuario');
  const meus = (subs||[]).filter(r => norm(r.usuario)===nu).map(r => r.row_id);
  if(meus.length) await sb.from('submissions').update({ usuario: null }).in('row_id', meus);
  // remove rastros nas tabelas com PK 'id'
  const delWhere = async (table, cols) => {
    const { data } = await sb.from(table).select('*');
    const ids = (data||[]).filter(r => cols.some(c => norm(r[c])===nu)).map(r => r.id).filter(x => x!=null);
    if(ids.length) await sb.from(table).delete().in('id', ids);
  };
  await delWhere('carimbos', ['profile_user','from_user']);
  await delWhere('visitas', ['profile_user','visitor_user']);
  await delWhere('reputacao', ['profile_user','from_user']);
  await delWhere('palpites', ['usuario']);
  await delWhere('resets', ['usuario']);
  await delWhere('notificacoes', ['usuario']);
  // push (chave é endpoint)
  const { data: pu } = await sb.from('push').select('endpoint,usuario');
  const eps = (pu||[]).filter(r => norm(r.usuario)===nu).map(r => r.endpoint);
  if(eps.length) await sb.from('push').delete().in('endpoint', eps);
  // usuário por último
  const u = await acharUsuario(usuario);
  if(u) await sb.from('usuarios').delete().eq('usuario', u.usuario);
  return { ok:true };
}

async function apiMeuPerfil(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false, error:'faça login' };
  const u = await acharUsuario(usuario);
  return { ok:true, user: u?u.usuario:usuario, perfil: u?asObj(u.perfil):{} };
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
  if(String(body.secret||'') !== PUSH_SECRET) return { ok:false, error:'não autorizado' };
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
  if(conta.indexOf('@') >= 0){ const el = conta.toLowerCase(); for(const k in map){ if(map[k].email && map[k].email.toLowerCase()===el){ alvo = map[k]; break; } } }
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
  if(nova.length < 4) return { ok:false, error:'a senha precisa de pelo menos 4 caracteres' };
  const { data } = await sb.from('resets').select('*').eq('token', token);
  const linha = (data||[]).find(r => norm(r.usuario)===norm(usuario));
  if(!linha) return { ok:false, error:'link inválido' };
  if(linha.usado === true) return { ok:false, error:'este link já foi usado' };
  if(Date.now() > Number(linha.exp)) return { ok:false, error:'este link expirou — peça outro' };
  const u = await acharUsuario(usuario);
  if(!u) return { ok:false, error:'usuário não encontrado' };
  const salt = novoToken().slice(0,8); const novoTok = novoToken();
  await sb.from('usuarios').update({ senha_hash: hash(nova,salt), salt, token: novoTok, tentativas:0, lock_until:0 }).eq('usuario', u.usuario);
  await sb.from('resets').update({ usado:true }).eq('id', linha.id);
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
  if(!(await verificarToken(usuario, body.token))) return { ok:false };
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
  const { data } = await sb.from('notificacoes').select('id,usuario,notif_id,lida').ilike('usuario', usuario);
  const alvos = (data||[]).filter(r => norm(r.usuario)===norm(usuario) && r.lida!==true && (!ids || ids.indexOf(String(r.notif_id))>=0)).map(r => r.id);
  if(alvos.length) await sb.from('notificacoes').update({ lida:true }).in('id', alvos);
  return { ok:true };
}
async function apiCriarNotif(body){
  const usuario = String(body.user||'');
  if(!(await verificarToken(usuario, body.token))) return { ok:false };
  const criada = await criarNotif(usuario, String(body.tipo||''), String(body.id||''), String(body.titulo||''), String(body.corpo||''), String(body.url||''));
  return { ok:true, criada };
}
async function apiCriarBroadcast(body){
  if(String(body.secret||'') !== PUSH_SECRET) return { ok:false, error:'não autorizado' };
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
    registrar: apiRegistrar, login: apiLogin, palpite: apiPalpite, perfil: apiPerfil,
    visita: apiVisita, carimbo: apiCarimbo, reputacao: apiReputacao, deletarConta: apiDeletarConta,
    meuPerfil: apiMeuPerfil, salvarPush: apiSalvarPush, removerPush: apiRemoverPush,
    pedirReset: apiPedirReset, redefinirSenha: apiRedefinirSenha,
    listarNotificacoes: apiListarNotificacoes, contarNotifNaoLidas: apiContarNotifNaoLidas,
    marcarNotifLidas: apiMarcarNotifLidas, criarNotif: apiCriarNotif,
    removerPushMorto: apiRemoverPushMorto, criarBroadcast: apiCriarBroadcast, voto: apiVoto
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
