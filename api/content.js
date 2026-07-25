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
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const norm = u => String(u || '').trim().toLowerCase();

async function ehAdmin(usuario, token) {
  if (!usuario || !token) return false;
  const { data } = await sb.from('usuarios').select('usuario,token,admin').ilike('usuario', usuario).limit(10);
  const u = (data || []).find(r => norm(r.usuario) === norm(usuario));
  return !!(u && u.admin === true && u.token && u.token === String(token));
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

  // ----- banners (broadcasts) -----
  if (action === 'listarBanners') {
    const { data } = await sb.from('broadcasts').select('*').order('ts', { ascending: false }).limit(50);
    return res.status(200).json({ ok: true, banners: data || [] });
  }
  if (action === 'criarBanner') {
    const titulo = String(body.titulo || '').trim(), corpo = String(body.corpo || '').trim();
    if (!titulo && !corpo) return res.status(400).json({ ok: false, error: 'aviso vazio' });
    let dur = Number(body.dur) || 0; if (dur < 0) dur = 0; if (dur > 120) dur = 120;
    await sb.from('broadcasts').insert({ bc_id: 'bc:' + Date.now(), titulo, corpo, url: String(body.url || '/index.html'), ts: Date.now(), dur });
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
