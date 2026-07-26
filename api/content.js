/* =====================================================================
   CETECRITIC — API DE CONTEÚDO (/api/content)  [Vercel + Supabase]
   =====================================================================
   Substitui os arquivos estáticos config.js / ANO/edicao.js / ANO/noites/*.js:
   o conteúdo agora vive no banco e é editável pelo painel admin.

   GET (público) — gera JAVASCRIPT pro site (mesmos globais de antes):
     ?file=config              -> const EDICAO_EM_DESTAQUE, EDICOES, textos, API_URL, VAPID_PUBLIC_KEY
     ?file=edicao&ano=2026     -> const EDICAO = {...}; const NOITES = {};
     ?file=noites&ano=2026     -> NOITES[1]={...}; NOITES[2]={...}; ...

   GET (admin, JSON) — pro painel ler:
     ?q=config | ?q=edicoes | ?q=edicao&ano=2026

   POST (admin) — precisa de user+token de um usuário com admin=true:
     salvarConfig, salvarEdicao, deletarEdicao, salvarEdicaoCompleta,
     criarBanner, deletarBanner, listarBanners

   Variáveis de ambiente: SUPABASE_URL, SUPABASE_SECRET_KEY
   ===================================================================== */
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const norm = u => String(u || '').trim().toLowerCase();

/* ---- push (para notificações direcionadas do admin) ---- */
function limparSubject(s) {
  s = String(s || '').trim();
  const m = s.match(/([^\s<>]+@[^\s<>]+)/);
  if (m) return 'mailto:' + m[1];
  if (/^https?:\/\//.test(s)) return s;
  return 'mailto:cetecritic@gmail.com';
}
async function enviarPushPara(usuarios, payloadObj) {
  try { webpush.setVapidDetails(limparSubject(process.env.VAPID_SUBJECT), process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY); }
  catch (e) { return 0; }
  const nset = new Set(usuarios.map(norm));
  const { data } = await sb.from('push').select('endpoint,p256dh,auth,usuario');
  const subs = (data || []).filter(r => nset.has(norm(r.usuario)));
  const payload = JSON.stringify(payloadObj);
  let ok = 0; const mortos = [];
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); ok++; }
    catch (e) { if (e && (e.statusCode === 410 || e.statusCode === 404)) mortos.push(s.endpoint); }
  }));
  if (mortos.length) await sb.from('push').delete().in('endpoint', mortos);
  return ok;
}

async function ehAdmin(usuario, token) {
  if (!usuario || !token) return false;
  const nu = norm(usuario);
  // token válido? checa sessoes (vários aparelhos) + legado usuarios.token
  let tokenOk = false;
  try {
    const { data } = await sb.from('sessoes').select('usuario').eq('token', String(token)).limit(5);
    if ((data || []).some(r => norm(r.usuario) === nu)) tokenOk = true;
  } catch (e) { /* sem tabela sessoes: cai no legado */ }
  const { data: us } = await sb.from('usuarios').select('usuario,token,admin').ilike('usuario', usuario).limit(10);
  const u = (us || []).find(r => norm(r.usuario) === nu);
  if (!u) return false;
  if (!tokenOk && u.token && u.token === String(token)) tokenOk = true;   // legado
  return tokenOk && u.admin === true;
}

/* ---------- montar objetos a partir do banco ---------- */
async function lerConfig() {
  const { data } = await sb.from('config_site').select('dados').eq('id', 1).limit(1);
  return (data && data[0] && data[0].dados) ? data[0].dados : {};
}
async function lerEdicoesLista() {
  const { data } = await sb.from('edicoes').select('*').order('ordem', { ascending: false });
  return data || [];
}
// monta o EDICOES do config.js (só os campos do menu)
function edicoesParaMenu(rows) {
  return rows.map(e => {
    const o = { ano: e.ano, noites: e.noites || 5 };
    if (e.abre_em) o.abreEm = e.abre_em;
    if (e.monte_abre_em) o.monteAbreEm = e.monte_abre_em;
    if (e.em_breve) o.emBreve = true;
    return o;
  });
}
// monta o objeto EDICAO (edicao.js) de um ano
function edicaoObj(e) {
  if (!e) return null;
  return {
    ano: e.ano,
    titulo: e.titulo || ('Cetec Festival ' + e.ano),
    descricao: e.descricao || '',
    episodiosPorNoite: e.episodios_por_noite || 3,
    inicio: e.inicio || null,
    fimVotacao: e.fim_votacao || null,
    poster: e.poster || '',
    mensagemFim: e.mensagem_fim || '',
    sobre: e.sobre || {},
    abertura: e.abertura || {}
  };
}

/* ---------- GET ---------- */
function jsResp(res, js) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
  res.status(200).send(js);
}

async function handleGet(req, res) {
  const q = req.query || {};

  // ----- JS pro site -----
  if (q.file === 'config') {
    const cfg = await lerConfig();
    const edicoes = edicoesParaMenu(await lerEdicoesLista());
    const js =
      `/* gerado por /api/content (config) */\n` +
      `const EDICAO_EM_DESTAQUE = ${JSON.stringify(cfg.EDICAO_EM_DESTAQUE || null)};\n` +
      `const EDICOES = ${JSON.stringify(edicoes)};\n` +
      `const API_URL = ${JSON.stringify(cfg.API_URL || '/api/db')};\n` +
      `const NOTA_MAXIMA = ${JSON.stringify(cfg.NOTA_MAXIMA != null ? cfg.NOTA_MAXIMA : 10)};\n` +
      `const ANO_VOTOS_ANTIGOS = ${JSON.stringify(cfg.ANO_VOTOS_ANTIGOS != null ? cfg.ANO_VOTOS_ANTIGOS : 2026)};\n` +
      `const EMAIL_CONTATO = ${JSON.stringify(cfg.EMAIL_CONTATO || 'cetecritic@gmail.com')};\n` +
      `const ANO_EDICAO_HISTORICA = ${JSON.stringify(cfg.ANO_EDICAO_HISTORICA != null ? cfg.ANO_EDICAO_HISTORICA : 2009)};\n` +
      `const SLOGAN_HOME = ${JSON.stringify(cfg.SLOGAN_HOME || '')};\n` +
      `const COOLDOWN_MINUTOS = ${JSON.stringify(cfg.COOLDOWN_MINUTOS != null ? cfg.COOLDOWN_MINUTOS : 5)};\n` +
      `const RODAPE = ${JSON.stringify(cfg.RODAPE || '')};\n` +
      `const VAPID_PUBLIC_KEY = ${JSON.stringify(cfg.VAPID_PUBLIC_KEY || '')};\n`;
    return jsResp(res, js);
  }

  if (q.file === 'hall') { const cfg = await lerConfig(); return jsResp(res, `/* gerado por /api/content (hall) */\nconst HALL = ${JSON.stringify(cfg.HALL || {})};\n`); }
  if (q.file === 'perfil') { const cfg = await lerConfig(); return jsResp(res, `/* gerado por /api/content (perfil) */\nconst PERFIL = ${JSON.stringify(cfg.PERFIL || {})};\n`); }
  if (q.file === 'home') { const cfg = await lerConfig(); return jsResp(res, `/* gerado por /api/content (home) */\nconst HOME_DADOS = ${JSON.stringify(cfg.HOME_DADOS || {})};\n`); }

  if (q.file === 'edicao') {
    const ano = Number(q.ano);
    const { data } = await sb.from('edicoes').select('*').eq('ano', ano).limit(1);
    const e = data && data[0];
    const js =
      `/* gerado por /api/content (edicao ${ano}) */\n` +
      `const EDICAO = ${JSON.stringify(edicaoObj(e))};\n` +
      `const NOITES = {};\n`;
    return jsResp(res, js);
  }

  if (q.file === 'noites') {
    const ano = Number(q.ano);
    const soUmaNoite = q.noite ? Number(q.noite) : null;   // rewrite de noite-N.js pede só a noite N
    let qn = sb.from('noites').select('*').eq('ano', ano);
    if (soUmaNoite) qn = qn.eq('noite', soUmaNoite);
    const { data: noites } = await qn.order('noite');
    const { data: pecas } = await sb.from('pecas').select('*').eq('ano', ano).order('noite').order('ordem');
    let js = `/* gerado por /api/content (noites ${ano}${soUmaNoite ? ' n' + soUmaNoite : ''}) */\n`;
    (noites || []).forEach(nd => {
      const ps = (pecas || []).filter(p => p.noite === nd.noite).map(p => ({
        titulo: p.titulo || '', turma: p.turma || '', sinopse: p.sinopse || '',
        youtube: p.youtube || '', youtubeInicio: Number(p.youtube_inicio) || 0
      }));
      js += `NOITES[${nd.noite}] = ${JSON.stringify({ data: nd.data || null, subtitulo: nd.subtitulo || '', pecas: ps })};\n`;
    });
    return jsResp(res, js);
  }

  // ----- JSON pro painel admin -----
  if (q.q === 'config') { res.status(200).json({ ok: true, dados: await lerConfig() }); return; }
  if (q.q === 'indice') {   // índice de busca do admin: edições + todas as peças
    const { data: eds } = await sb.from('edicoes').select('ano,titulo,em_breve').order('ano', { ascending: false });
    const { data: pcs } = await sb.from('pecas').select('ano,noite,ordem,titulo').order('ano', { ascending: false });
    res.status(200).json({ ok: true, edicoes: eds || [], pecas: pcs || [] });
    return;
  }
  if (q.q === 'edicoes') { res.status(200).json({ ok: true, edicoes: await lerEdicoesLista() }); return; }
  if (q.q === 'edicao') {
    const ano = Number(q.ano);
    const { data: ed } = await sb.from('edicoes').select('*').eq('ano', ano).limit(1);
    const { data: noites } = await sb.from('noites').select('*').eq('ano', ano).order('noite');
    const { data: pecas } = await sb.from('pecas').select('*').eq('ano', ano).order('noite').order('ordem');
    res.status(200).json({ ok: true, edicao: (ed && ed[0]) || null, noites: noites || [], pecas: pecas || [] });
    return;
  }
  res.status(400).json({ ok: false, error: 'parâmetro inválido' });
}

/* ---------- POST (admin) ---------- */
async function handlePost(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (!(await ehAdmin(body.user, body.token))) { res.status(403).json({ ok: false, error: 'acesso restrito a administradores' }); return; }
  const action = String(body.action || '');

  if (action === 'ping') return res.status(200).json({ ok: true, admin: true });

  // ----- gestão de usuários -----
  if (action === 'listarUsuarios') {
    const busca = norm(body.busca || '');
    const { data } = await sb.from('usuarios').select('usuario,admin,criado_em,perfil');
    let lista = (data || []).map(u => {
      const p = (u.perfil && typeof u.perfil === 'object') ? u.perfil : {};
      return { usuario: u.usuario, admin: u.admin === true, criadoEm: u.criado_em || 0, email: String(p.email || ''), anonimo: !!p.anonimo, privado: !!p.privado };
    });
    if (busca) lista = lista.filter(u => norm(u.usuario).includes(busca) || norm(u.email).includes(busca));
    lista.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    return res.status(200).json({ ok: true, usuarios: lista.slice(0, 200) });
  }
  if (action === 'tornarAdmin') {
    const alvo = String(body.alvo || '');
    const { data } = await sb.from('usuarios').select('usuario').ilike('usuario', alvo);
    const real = (data || []).find(r => norm(r.usuario) === norm(alvo));
    if (!real) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    await sb.from('usuarios').update({ admin: !!body.valor }).eq('usuario', real.usuario);
    return res.status(200).json({ ok: true });
  }
  if (action === 'moderarPerfil') {
    const nu = norm(body.alvo || ''); const op = body.opcoes || {};
    const limpar = async (table) => {
      const { data } = await sb.from(table).select('id,profile_user');
      const ids = (data || []).filter(r => norm(r.profile_user) === nu).map(r => r.id);
      if (ids.length) await sb.from(table).delete().in('id', ids);
    };
    if (op.carimbos) await limpar('carimbos');
    if (op.visitas) await limpar('visitas');
    if (op.reputacao) await limpar('reputacao');
    if (op.showcase) {
      const { data } = await sb.from('usuarios').select('usuario,perfil').ilike('usuario', body.alvo);
      const real = (data || []).find(r => norm(r.usuario) === nu);
      if (real) { const p = (real.perfil && typeof real.perfil === 'object') ? Object.assign({}, real.perfil) : {}; delete p.destaques; delete p.favoritas; delete p.showcase; await sb.from('usuarios').update({ perfil: p }).eq('usuario', real.usuario); }
    }
    return res.status(200).json({ ok: true });
  }
  if (action === 'deletarUsuario') {
    const alvo = String(body.alvo || ''); const nu = norm(alvo);
    if (!nu) return res.status(400).json({ ok: false, error: 'usuário inválido' });
    const { data: subs } = await sb.from('submissions').select('row_id,usuario');
    const meus = (subs || []).filter(r => norm(r.usuario) === nu).map(r => r.row_id);
    if (meus.length) await sb.from('submissions').update({ usuario: null }).in('row_id', meus);
    const delWhere = async (table, cols) => {
      const { data } = await sb.from(table).select('*');
      const ids = (data || []).filter(r => cols.some(c => norm(r[c]) === nu)).map(r => r.id).filter(x => x != null);
      if (ids.length) await sb.from(table).delete().in('id', ids);
    };
    await delWhere('carimbos', ['profile_user', 'from_user']);
    await delWhere('visitas', ['profile_user', 'visitor_user']);
    await delWhere('reputacao', ['profile_user', 'from_user']);
    await delWhere('palpites', ['usuario']);
    await delWhere('resets', ['usuario']);
    await delWhere('notificacoes', ['usuario']);
    const { data: pu } = await sb.from('push').select('endpoint,usuario');
    const eps = (pu || []).filter(r => norm(r.usuario) === nu).map(r => r.endpoint);
    if (eps.length) await sb.from('push').delete().in('endpoint', eps);
    const { data: us } = await sb.from('usuarios').select('usuario').ilike('usuario', alvo);
    const real = (us || []).find(r => norm(r.usuario) === nu);
    if (real) await sb.from('usuarios').delete().eq('usuario', real.usuario);
    return res.status(200).json({ ok: true });
  }

  if (action === 'salvarConfig') {
    const dados = (body.dados && typeof body.dados === 'object') ? body.dados : {};
    await sb.from('config_site').upsert({ id: 1, dados }, { onConflict: 'id' });
    return res.status(200).json({ ok: true });
  }

  if (action === 'deletarEdicao') {
    const ano = Number(body.ano);
    await sb.from('pecas').delete().eq('ano', ano);
    await sb.from('noites').delete().eq('ano', ano);
    await sb.from('edicoes').delete().eq('ano', ano);
    return res.status(200).json({ ok: true });
  }

  // salva a edição inteira (dados da edição + noites + peças) de uma vez
  if (action === 'salvarEdicaoCompleta') {
    const e = body.edicao || {};
    const ano = Number(e.ano);
    if (!ano) return res.status(400).json({ ok: false, error: 'ano inválido' });
    const row = {
      ano,
      ordem: e.ordem != null ? Number(e.ordem) : ano,
      noites: Number(e.noites) || 5,
      em_breve: !!e.em_breve,
      abre_em: e.abre_em || null,
      monte_abre_em: e.monte_abre_em || null,
      titulo: e.titulo || ('Cetec Festival ' + ano),
      descricao: e.descricao || null,
      episodios_por_noite: Number(e.episodios_por_noite) || 3,
      inicio: e.inicio || null,
      fim_votacao: e.fim_votacao || null,
      poster: e.poster || null,
      mensagem_fim: e.mensagem_fim || null,
      sobre: e.sobre || {},
      abertura: e.abertura || {},
      extra: e.extra || {}
    };
    await sb.from('edicoes').upsert(row, { onConflict: 'ano' });

    // noites + peças (substitui tudo do ano pelo que veio)
    if (Array.isArray(body.noites)) {
      await sb.from('pecas').delete().eq('ano', ano);
      await sb.from('noites').delete().eq('ano', ano);
      for (const nd of body.noites) {
        const noite = Number(nd.noite);
        if (!noite) continue;
        await sb.from('noites').insert({ ano, noite, data: nd.data || null, subtitulo: nd.subtitulo || null });
        const pecas = Array.isArray(nd.pecas) ? nd.pecas : [];
        if (pecas.length) {
          await sb.from('pecas').insert(pecas.map((p, i) => ({
            ano, noite, ordem: i + 1,
            titulo: p.titulo || '', turma: p.turma || '', sinopse: p.sinopse || '',
            youtube: p.youtube || '', youtube_inicio: Number(p.youtubeInicio ?? p.youtube_inicio) || 0
          })));
        }
      }
    }
    return res.status(200).json({ ok: true });
  }

  // ----- envio de notificações direcionadas (central 🔔 + push opcional) -----
  if (action === 'enviarNotif') {
    const titulo = String(body.titulo || '').trim(), corpo = String(body.corpo || '').trim();
    const url = String(body.url || '/index.html'), tipo = String(body.tipo || 'admin');
    if (!titulo && !corpo) return res.status(400).json({ ok: false, error: 'notificação vazia' });
    let alvos = [];
    if (body.alvoTipo === 'usuario') {
      const { data } = await sb.from('usuarios').select('usuario').ilike('usuario', body.alvo);
      const real = (data || []).find(r => norm(r.usuario) === norm(body.alvo));
      if (!real) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
      alvos = [real.usuario];
    } else { // todos os usuários cadastrados
      const { data } = await sb.from('usuarios').select('usuario');
      alvos = (data || []).map(r => r.usuario).filter(Boolean);
    }
    const id = 'admin:' + Date.now();
    const rows = alvos.map(u => ({ usuario: u, notif_id: id, tipo, titulo, corpo, url, ts: Date.now(), lida: false }));
    for (let i = 0; i < rows.length; i += 500) await sb.from('notificacoes').insert(rows.slice(i, i + 500));
    let pushEnviados = 0;
    if (body.push) pushEnviados = await enviarPushPara(alvos, { title: titulo || 'CETECritic', body: corpo, url });
    return res.status(200).json({ ok: true, alvos: alvos.length, pushEnviados });
  }

  // ----- moderação de votos (excluir notas com filtros) -----
  if (action === 'listarVotos' || action === 'deletarVotos') {
    if (action === 'deletarVotos') {
      const ids = Array.isArray(body.row_ids) ? body.row_ids : [];
      if (ids.length) await sb.from('submissions').delete().in('row_id', ids);
      return res.status(200).json({ ok: true, apagados: ids.length });
    }
    // listarVotos com filtros
    const ano = body.ano ? Number(body.ano) : null;
    const usuarioF = norm(body.usuario || '');
    const noite = body.noite ? Number(body.noite) : null;
    const ep = body.episodio ? Number(body.episodio) : null;
    const notaF = (body.nota !== '' && body.nota != null) ? Number(body.nota) : null;
    const chave = (noite && ep) ? ('s' + noite + 'e' + ep) : null;
    let q = sb.from('submissions').select('row_id,sub_id,usuario,year,grid,ts');
    if (ano) q = q.eq('year', ano);
    const { data } = await q.limit(3000);
    let rows = (data || []);
    if (usuarioF) rows = rows.filter(r => norm(r.usuario) === usuarioF);
    rows = rows.filter(r => {
      const g = (r.grid && typeof r.grid === 'object') ? r.grid : {};
      if (chave) { if (!(chave in g)) return false; if (notaF != null && Number(g[chave]) !== notaF) return false; return true; }
      if (notaF != null) return Object.values(g).some(v => Number(v) === notaF);
      return true;
    });
    const votos = rows.slice(0, 400).map(r => {
      const g = (r.grid && typeof r.grid === 'object') ? r.grid : {};
      return { row_id: r.row_id, sub_id: r.sub_id, usuario: r.usuario || '(anônimo)', year: r.year, ts: r.ts, nota: chave ? g[chave] : null, notas: Object.keys(g).length };
    });
    return res.status(200).json({ ok: true, votos, total: rows.length });
  }

  // ----- upload de imagem (poster / banner) pro Supabase Storage -----
  if (action === 'uploadImagem') {
    const b64 = String(body.data || '');
    const m = b64.match(/^data:(.+?);base64,(.*)$/);
    const contentType = m ? m[1] : 'image/jpeg';
    const raw = m ? m[2] : b64;
    if (!raw) return res.status(400).json({ ok: false, error: 'sem imagem' });
    const buffer = Buffer.from(raw, 'base64');
    const nomeLimpo = String(body.nome || 'img.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    const pasta = String(body.pasta || 'geral').replace(/[^a-zA-Z0-9_-]/g, '');
    const path = pasta + '/' + Date.now() + '_' + nomeLimpo;
    const { error } = await sb.storage.from('conteudo').upload(path, buffer, { contentType, upsert: true });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    const { data } = sb.storage.from('conteudo').getPublicUrl(path);
    return res.status(200).json({ ok: true, url: data.publicUrl });
  }

  // ----- agendamento de banner / push -----
  if (action === 'agendar') {
    const quando = Number(body.quando) || 0;
    if (!quando) return res.status(400).json({ ok: false, error: 'informe a data/hora' });
    const titulo = String(body.titulo || '').trim(), corpo = String(body.corpo || '').trim();
    if (!titulo && !corpo) return res.status(400).json({ ok: false, error: 'aviso vazio' });
    let dur = Number(body.dur) || 0; if (dur < 0) dur = 0; if (dur > 120) dur = 120;
    await sb.from('agendados').insert({
      tipo: body.push ? 'push' : 'banner', titulo, corpo, url: String(body.url || '/index.html'),
      dur, push: !!body.push, quando, enviado: false, criado_em: Date.now()
    });
    return res.status(200).json({ ok: true });
  }
  if (action === 'listarAgendados') {
    const { data } = await sb.from('agendados').select('*').order('quando', { ascending: true }).limit(100);
    return res.status(200).json({ ok: true, agendados: data || [] });
  }
  if (action === 'cancelarAgendado') {
    await sb.from('agendados').delete().eq('id', body.id);
    return res.status(200).json({ ok: true });
  }

  // ----- banners (broadcasts) -----
  if (action === 'listarBanners') {
    const { data } = await sb.from('broadcasts').select('*').order('ts', { ascending: false }).limit(50);
    return res.status(200).json({ ok: true, banners: data || [] });
  }
  if (action === 'criarBanner') {
    const titulo = String(body.titulo || '').trim(), corpo = String(body.corpo || '').trim();
    if (!titulo && !corpo) return res.status(400).json({ ok: false, error: 'aviso vazio' });
    let dur = Number(body.dur) || 0; if (dur < 0) dur = 0; if (dur > 120) dur = 120;
    const inicio = body.inicio ? Number(body.inicio) : null;   // período opcional
    const fim = body.fim ? Number(body.fim) : null;
    const modo = ['uma_vez', 'sessao', 'sempre'].indexOf(String(body.modo)) >= 0 ? String(body.modo) : 'uma_vez';
    await sb.from('broadcasts').insert({ bc_id: 'bc:' + Date.now(), titulo, corpo, url: String(body.url || '/index.html'), ts: Date.now(), dur, inicio, fim, modo });
    return res.status(200).json({ ok: true });
  }
  if (action === 'deletarBanner') {
    await sb.from('broadcasts').delete().eq('bc_id', String(body.bc_id || ''));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: 'ação desconhecida: ' + action });
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok: false, error: 'método não suportado' });
  } catch (e) { res.status(500).json({ ok: false, error: String((e && e.message) || e) }); }
};
