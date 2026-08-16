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
const {
  migrarNomeUsuario, estadoConta, validarNome,
  PAPEIS, MAX_DIAS_BAN_MODERADOR, LIMPEZAS_SO_ADMIN, ITENS_SO_ADMIN, podeExecutar,
  apagarPorNome
} = require('./_moderacao');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const norm = u => String(u || '').trim().toLowerCase();

/* Teto explícito de linhas. O PostgREST corta em 1000 por padrão, em
   silêncio — ver o bloco equivalente em api/db.js. */
const LIMITE_ALTO = 10000;

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

/* ---------- parser de link Spotify/YouTube (item 4) ---------- */
// converte "1h2m3s" / "90s" / "90" em segundos
function parseTimestampYT(str) {
  if (!str) return 0;
  str = String(str);
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const m = str.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (!m) return 0;
  const h = parseInt(m[1] || 0, 10), mi = parseInt(m[2] || 0, 10), s = parseInt(m[3] || 0, 10);
  return h * 3600 + mi * 60 + s;
}
// aceita qualquer link de compartilhar do YouTube ou Spotify e devolve o link
// "limpo" + o tipo. Se o YouTube tiver timestamp (?t= ou &start=) no final,
// isso vira o "início da apresentação" (youtubeInicio).
function parseLinkMusica(urlStr) {
  const url = String(urlStr || '').trim();
  if (!url) return { tipo: 'vazio' };
  let u;
  try { u = new URL(url); } catch (e) { return { tipo: 'invalido', erro: 'link inválido' }; }
  const host = u.hostname.replace(/^www\./, '');

  // ---- YouTube ----
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\//, '').split('/')[0];
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    return { tipo: 'youtube_video', id, youtube: 'https://www.youtube.com/watch?v=' + id, youtubeInicio: parseTimestampYT(t) };
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (u.searchParams.get('list') && !u.searchParams.get('v')) {
      const id = u.searchParams.get('list');
      return { tipo: 'youtube_playlist', id, youtube: 'https://www.youtube.com/playlist?list=' + id };
    }
    let id = u.searchParams.get('v');
    if (!id) { const m = u.pathname.match(/\/(embed|shorts|live)\/([^/?]+)/); if (m) id = m[2]; }
    if (id) {
      const t = u.searchParams.get('t') || u.searchParams.get('start');
      return { tipo: 'youtube_video', id, youtube: 'https://www.youtube.com/watch?v=' + id, youtubeInicio: parseTimestampYT(t) };
    }
  }

  // ---- Spotify ----
  if (host === 'open.spotify.com') {
    const partes = u.pathname.split('/').filter(Boolean); // ex: ['playlist','ID'] ou ['intl-br','playlist','ID']
    const tiposValidos = ['playlist', 'track', 'album', 'episode', 'show'];
    let tipo = null, id = null;
    for (let i = 0; i < partes.length - 1; i++) {
      if (tiposValidos.includes(partes[i])) { tipo = partes[i]; id = partes[i + 1].split('?')[0]; break; }
    }
    if (tipo && id) return { tipo: 'spotify_' + tipo, id, spotify: 'https://open.spotify.com/' + tipo + '/' + id, embedUrl: 'https://open.spotify.com/embed/' + tipo + '/' + id };
  }
  if (url.startsWith('spotify:')) {
    const m = url.match(/^spotify:(playlist|track|album|episode|show):([a-zA-Z0-9]+)/);
    if (m) return { tipo: 'spotify_' + m[1], id: m[2], spotify: 'https://open.spotify.com/' + m[1] + '/' + m[2], embedUrl: 'https://open.spotify.com/embed/' + m[1] + '/' + m[2] };
  }

  return { tipo: 'desconhecido', link: url };
}

/* Identifica quem está chamando e QUAL o papel dele.
   Devolve null se não tem acesso ao painel; senão { usuario, papel }.

   `admin=true` continua sendo a chave da porta; `papel` decide o que a
   pessoa faz depois de entrar. Conta com admin=true e papel vazio é tratada
   como 'admin' — é o estado das contas antigas, antes da migração. */
async function identificarEquipe(usuario, token) {
  if (!usuario || !token) return null;
  const nu = norm(usuario);
  let tokenOk = false;
  try {
    const { data } = await sb.from('sessoes').select('usuario').eq('token', String(token)).limit(5);
    if ((data || []).some(r => norm(r.usuario) === nu)) tokenOk = true;
  } catch (e) { /* sem tabela sessoes: cai no legado */ }
  /* Se o SQL dos papéis ainda não rodou, a coluna `papel` não existe e o
     select inteiro falha — o que trancaria TODO MUNDO fora do painel, você
     inclusive. Por isso a leitura tem plano B: sem a coluna, quem tem
     admin=true continua entrando como 'admin', igual antes. */
  let us = null;
  {
    const r1 = await sb.from('usuarios').select('usuario,token,admin,papel').ilike('usuario', usuario).limit(10);
    if (r1.error) {
      const r2 = await sb.from('usuarios').select('usuario,token,admin').ilike('usuario', usuario).limit(10);
      us = r2.data;
    } else us = r1.data;
  }
  const u = (us || []).find(r => norm(r.usuario) === nu);
  if (!u) return null;
  if (!tokenOk && u.token && u.token === String(token)) tokenOk = true;   // legado
  if (!tokenOk || u.admin !== true) return null;
  const papel = PAPEIS.indexOf(String(u.papel || '')) >= 0 ? String(u.papel) : 'admin';
  return { usuario: u.usuario, papel };
}

/* ---------- montar objetos a partir do banco ---------- */
async function lerConfig() {
  const { data } = await sb.from('config_site').select('dados').eq('id', 1).limit(1);
  return (data && data[0] && data[0].dados) ? data[0].dados : {};
}
/* ---------------------------------------------------------------------
   GRAVAÇÃO DO CONFIG COM CONCORRÊNCIA OTIMISTA

   Toda a configuração do site é UMA linha de jsonb, e salvar é
   ler-alterar-regravar. ANTES não havia controle nenhum: dois admins
   salvando ao mesmo tempo — coisa nada rara na véspera do festival, com
   três pessoas mexendo — e um perdia a alteração, sem aviso.

   A versão mora dentro do próprio jsonb (`dados._versao`), então não houve
   migração: o filtro `dados->>_versao` é aplicado no UPDATE, e o Postgres
   resolve a corrida. Se a linha mudou desde a leitura, o update não
   encontra nada e devolvemos 409 pedindo pra recarregar.
   --------------------------------------------------------------------- */
async function gravarConfig(dados, versaoEsperada) {
  const proxima = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  const novo = Object.assign({}, dados, { _versao: proxima });

  /* linha ainda não existe: cria */
  const atualQ = await sb.from('config_site').select('dados').eq('id', 1).limit(1);
  const atual = atualQ.data && atualQ.data[0];
  if (!atual) {
    const { error } = await sb.from('config_site').insert({ id: 1, dados: novo });
    return { ok: !error, error: error ? error.message : null, versao: proxima };
  }

  const versaoAtual = (atual.dados && atual.dados._versao) ? String(atual.dados._versao) : null;

  /* sem versão esperada = chamada antiga (ou primeira depois desta mudança):
     grava sem conferir, pra não travar ninguém */
  let q = sb.from('config_site').update({ dados: novo }).eq('id', 1);
  if (versaoEsperada && versaoAtual) q = q.eq('dados->>_versao', String(versaoEsperada));

  const { data, error } = await q.select('id');
  if (error) return { ok: false, error: error.message };
  if (versaoEsperada && versaoAtual && (!data || !data.length)) {
    return { ok: false, conflito: true, error: 'alguém salvou a configuração enquanto você editava. Recarregue o painel e refaça a alteração — o que você digitou NÃO foi gravado.' };
  }
  return { ok: true, versao: proxima };
}

async function lerEdicoesLista() {
  const { data } = await sb.from('edicoes').select('*').order('ordem', { ascending: false });
  return data || [];
}
/* ---- janela do bolão de uma edição ----
   Resolvida aqui pra o cliente não precisar adivinhar:
     abre   = junto com o Monte o Seu (monte_abre_em)
     fecha  = horário da Noite 1, ou o `fechaEm` definido no painel
     some   = 1 dia depois do fim da votação (aí sai do menu lateral)
   A config fica em edicoes.extra.bolao — coluna jsonb que já existia, por
   isso o bolão não precisou de migração de esquema. */
function infoBolao(e, dataNoite1) {
  const extra = (e.extra && typeof e.extra === 'object') ? e.extra : {};
  const cfg = (extra.bolao && typeof extra.bolao === 'object') ? extra.bolao : {};
  if (cfg.ativo === false) return null;                    // desligado no painel
  const abreEm = e.monte_abre_em || null;
  /* prazo: painel > Noite 1 > fim da votação. O último degrau é rede de
     segurança pras edições antigas sem data de noite cadastrada — a mesma
     ordem usada no estadoBolao() do api/db.js, senão cliente e servidor
     discordariam sobre quando o palpite fecha. */
  const fechaEm = cfg.fechaEm || dataNoite1 || e.fim_votacao || null;
  if (!abreEm && !fechaEm) return null;                    // edição sem datas: sem bolão
  const someEm = e.fim_votacao
    ? new Date(new Date(e.fim_votacao).getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;
  return { abreEm, fechaEm, someEm };
}
// data/hora da Noite 1 de cada ano — o prazo padrão do palpite
async function mapaNoite1() {
  const m = {};
  try {
    const { data } = await sb.from('noites').select('ano,data').eq('noite', 1);
    (data || []).forEach(n => { if (n.data) m[Number(n.ano)] = n.data; });
  } catch (e) { /* sem noites cadastradas: o bolão fica sem prazo padrão */ }
  return m;
}

// monta o EDICOES do config.js (só os campos do menu)
function edicoesParaMenu(rows, noite1 = {}) {
  return rows.map(e => {
    const o = { ano: e.ano, noites: e.noites || 5 };
    if (e.abre_em) o.abreEm = e.abre_em;
    if (e.monte_abre_em) o.monteAbreEm = e.monte_abre_em;
    if (e.em_breve) o.emBreve = true;
    /* o menu lateral decide sozinho se mostra o link do bolão, e ele precisa
       disso em TODA página — por isso a janela viaja no config.js */
    if (!e.em_breve) { const b = infoBolao(e, noite1[Number(e.ano)]); if (b) o.bolao = b; }
    /* O poster viaja junto do menu porque paginas fora da pasta do ano
       (perfil, busca, home) precisam dele e nao carregam o edicao.js daquela
       edicao. Antes elas montavam "ANO/poster.jpg" na mao — o que quebrou
       quando os posters passaram a morar no Supabase Storage. */
    if (e.poster) o.poster = e.poster;
    return o;
  });
}
// mensagem de fim padrão (usada quando o campo fica em branco no admin)
function mensagemFimPadrao(ano) {
  const proximoAno = (Number(ano) || new Date().getFullYear()) + 1;
  return 'Agradecemos o apoio de todos e parabenizamos todas as apresentações! 🎉 Nós vemos em ' + proximoAno;
}

// monta o objeto EDICAO (edicao.js) de um ano
function edicaoObj(e, dataNoite1) {
  if (!e) return null;
  const extra = (e.extra && typeof e.extra === 'object') ? e.extra : {};
  const cfgBolao = (extra.bolao && typeof extra.bolao === 'object') ? extra.bolao : {};
  const janela = infoBolao(e, dataNoite1);
  return {
    ano: e.ano,
    titulo: e.titulo || ('Cetec Festival ' + e.ano),
    descricao: e.descricao || '',
    episodiosPorNoite: e.episodios_por_noite || 3,
    inicio: e.inicio || null,
    fimVotacao: e.fim_votacao || null,
    poster: e.poster || '',
    mensagemFim: (e.mensagem_fim && String(e.mensagem_fim).trim()) || mensagemFimPadrao(e.ano),
    sobre: e.sobre || {},
    abertura: e.abertura || {},
    /* a página do bolão precisa do texto das regras além da janela */
    bolao: janela ? Object.assign({}, janela, { regras: String(cfgBolao.regras || '') }) : null
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
    const edicoes = edicoesParaMenu(await lerEdicoesLista(), await mapaNoite1());
    // curiosidades UNIFICADAS (Home + Hall): usa cfg.curiosidades; se ainda não
    // existir, junta as antigas de HOME_DADOS + HALL (sem duplicar por texto)
    let curios = Array.isArray(cfg.curiosidades) ? cfg.curiosidades : null;
    if (!curios) {
      const h = (cfg.HOME_DADOS && Array.isArray(cfg.HOME_DADOS.curiosidades)) ? cfg.HOME_DADOS.curiosidades : [];
      const l = (cfg.HALL && Array.isArray(cfg.HALL.curiosidades)) ? cfg.HALL.curiosidades : [];
      const vistos = {}; curios = [];
      [].concat(h, l).forEach(c => { const t = (c && c.texto) || (typeof c === 'string' ? c : ''); if (t && !vistos[t]) { vistos[t] = 1; curios.push(typeof c === 'string' ? { texto: c } : c); } });
    }
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
      `const VAPID_PUBLIC_KEY = ${JSON.stringify(cfg.VAPID_PUBLIC_KEY || '')};\n` +
      `const CURIOSIDADES = ${JSON.stringify(curios)};\n` +
      `const FEED = ${JSON.stringify((Array.isArray(cfg.feed) ? cfg.feed : []).slice(0, 40))};\n`;
    return jsResp(res, js);
  }

  /* ---------------------------------------------------------------------
     SITEMAP GERADO A PARTIR DO BANCO

     O `sitemap.xml` do repositório é escrito à mão. Como uma edição criada
     no painel já fica navegável sem deploy, ela nascia invisível pro Google
     até alguém lembrar de editar o XML — e ninguém lembra.

     Esta rota monta o sitemap a partir de `edicoes` e `noites`, então ele
     nunca envelhece. Para ativá-la, apague o `sitemap.xml` estático do
     repositório: na Vercel os rewrites só valem DEPOIS da checagem do
     sistema de arquivos, então enquanto o arquivo existir ele é quem
     responde, e esta rota fica dormindo sem atrapalhar nada.
     --------------------------------------------------------------------- */
  if (q.file === 'sitemap') {
    const base = (process.env.RESET_SITE_URL || 'https://cetecritic.xyz').replace(/\/$/, '');
    const { data: eds } = await sb.from('edicoes').select('ano,noites,em_breve').order('ano', { ascending: false }).limit(LIMITE_ALTO);
    const url = (caminho, freq, prio) =>
      '  <url><loc>' + base + caminho + '</loc><changefreq>' + freq + '</changefreq><priority>' + prio + '</priority></url>';

    const linhas = [
      url('/', 'weekly', '1.0'),
      url('/hall.html', 'weekly', '0.9'),
      url('/busca.html', 'monthly', '0.6')
    ];
    (eds || []).forEach(e => {
      const ano = Number(e.ano);
      if (!ano) return;
      if (e.em_breve) { linhas.push(url('/em-breve.html?ano=' + ano, 'weekly', '0.5')); return; }
      linhas.push(url('/' + ano, 'monthly', '0.8'));
      linhas.push(url('/' + ano + '/sobre.html', 'yearly', '0.6'));
      linhas.push(url('/' + ano + '/abertura.html', 'yearly', '0.5'));
      const n = Number(e.noites) || 5;
      for (let i = 1; i <= n; i++) linhas.push(url('/' + ano + '/noite-' + i + '.html', 'yearly', '0.6'));
    });

    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<!-- gerado por /api/content (sitemap) a partir da tabela `edicoes` -->\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + linhas.join('\n') + '\n</urlset>\n';
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, must-revalidate');
    res.status(200).send(xml);
    return;
  }

  if (q.file === 'hall') { const cfg = await lerConfig(); return jsResp(res, `/* gerado por /api/content (hall) */\nconst HALL = ${JSON.stringify(cfg.HALL || {})};\n`); }
  if (q.file === 'perfil') { const cfg = await lerConfig(); return jsResp(res, `/* gerado por /api/content (perfil) */\nconst PERFIL = ${JSON.stringify(cfg.PERFIL || {})};\n`); }
  if (q.file === 'home') { const cfg = await lerConfig(); return jsResp(res, `/* gerado por /api/content (home) */\nconst HOME_DADOS = ${JSON.stringify(cfg.HOME_DADOS || {})};\n`); }

  if (q.file === 'edicao') {
    const ano = Number(q.ano);
    const { data } = await sb.from('edicoes').select('*').eq('ano', ano).limit(1);
    const e = data && data[0];
    const { data: n1 } = await sb.from('noites').select('data').eq('ano', ano).eq('noite', 1).limit(1);
    const js =
      `/* gerado por /api/content (edicao ${ano}) */\n` +
      `const EDICAO = ${JSON.stringify(edicaoObj(e, n1 && n1[0] && n1[0].data))};\n` +
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

  /* ===================================================================
     JSON pro painel admin — DAQUI PRA BAIXO, SÓ COM CREDENCIAL
     ===================================================================
     ANTES estas rotas não verificavam nada: `identificarEquipe` só era
     chamado no handlePost. Um `curl .../api/content?q=config` devolvia o
     `config_site.dados` inteiro pra qualquer pessoa — e é justamente esse o
     balde onde um admin naturalmente cola uma chave, um webhook ou um texto
     interno.

     As rotas `?file=` acima continuam públicas de propósito: são elas que o
     site carrega em toda visita, sem login. */
  const eu = await identificarEquipe(q.user, q.token);
  if (!eu) { res.status(403).json({ ok: false, error: 'acesso restrito à equipe' }); return; }

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
/* Só para o `ping` conseguir dizer o que este build sabe fazer. Não é usado
   pra rotear nada — o roteamento continua sendo a sequência de `if` abaixo. */
const ACOES_CONHECIDAS = {
  ping: 1, listarUsuarios: 1, usuarioDetalhe: 1, salvarUsuarioAdmin: 1,
  forcarTrocaNome: 1, cancelarTrocaNome: 1, renomearUsuario: 1,
  definirBanimento: 1, definirSilencio: 1, deslogarTudo: 1, ajustarBadges: 1,
  notificarUsuario: 1, apagarItemUsuario: 1, editarVoto: 1, parseLink: 1,
  anonimizarUsuario: 1, removerAnonimato: 1, tornarAdmin: 1, definirPapel: 1, lerReputacao: 1,
  ajustarReputacao: 1, moderarPerfil: 1, deletarUsuario: 1, salvarConfig: 1,
  postarFeed: 1, deletarEdicao: 1, salvarEdicaoCompleta: 1, enviarNotif: 1,
  listarVotos: 1, deletarVotos: 1, uploadImagem: 1, agendar: 1,
  listarAgendados: 1, cancelarAgendado: 1, listarBanners: 1, criarBanner: 1,
  deletarBanner: 1, anonimizarVoto: 1, restaurarNomeVoto: 1
};

async function handlePost(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const eu = await identificarEquipe(body.user, body.token);
  if (!eu) { res.status(403).json({ ok: false, error: 'acesso restrito à equipe' }); return; }
  const action = String(body.action || '');

  /* A interface esconde o que o papel não usa, mas quem MANDA é isto aqui:
     esconder botão não impede ninguém de chamar a API na mão. */
  if (!podeExecutar(eu.papel, action)) {
    res.status(403).json({ ok: false, error: 'seu papel (' + eu.papel + ') não permite esta ação' });
    return;
  }

  /* `versao` serve pra conferir, em 2 segundos, se o que está no ar é mesmo o
     build atual — sem isso a gente fica adivinhando quando uma ação nova
     responde "ação desconhecida". Ao adicionar ações, suba o número. */
  if (action === 'ping') return res.status(200).json({
    ok: true, admin: true,
    papel: eu.papel,
    versao: 5,
    acoes: Object.keys(ACOES_CONHECIDAS).filter(a => podeExecutar(eu.papel, a))
  });

  // ----- gestão de usuários -----
  if (action === 'listarUsuarios') {
    const busca = norm(body.busca || '');
    /* mesmo plano B do identificarEquipe: sem a coluna `papel`, a lista ainda
       carrega e todo admin aparece como 'admin' */
    let data = null;
    {
      const r1 = await sb.from('usuarios').select('usuario,admin,papel,criado_em,perfil');
      if (r1.error) { const r2 = await sb.from('usuarios').select('usuario,admin,criado_em,perfil'); data = r2.data; }
      else data = r1.data;
    }
    let lista = (data || []).map(u => {
      const p = (u.perfil && typeof u.perfil === 'object') ? u.perfil : {};
      // pseudônimo do anônimo (o número que aparece no site); mesma regra do db.js
      const expirou = !!(p.anon_ate && Date.now() > Number(p.anon_ate));
      const anonimoEfetivo = !!p.anonimo && !expirou;
      const pseudo = anonimoEfetivo ? (String(p.pseudo || '').trim() || ('Anônimo ' + ((function(s){s=String(s).toLowerCase();let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))>>>0;}return h;})(u.usuario) % 9000 + 1000))) : '';
      // nomeReal: só pro painel admin (essa rota já exige ehAdmin) — mostra quem está por trás do anônimo
      const est = estadoConta(p);
      return {
        usuario: u.usuario, nomeReal: u.usuario, admin: u.admin === true,
        papel: u.admin === true ? (PAPEIS.indexOf(String(u.papel || '')) >= 0 ? String(u.papel) : 'admin') : null,
        criadoEm: u.criado_em || 0,
        email: String(p.email || ''), emailVerificado: p.email_verificado === true,
        anonimo: anonimoEfetivo, privado: !!p.privado, pseudo,
        anonModo: p.anon_modo || null, anonAte: p.anon_ate || null,
        /* estado de moderação: alimenta as tags coloridas da lista do admin */
        banido: est.banido, banidoAte: est.banidoAte, banidoMotivo: est.banidoMotivo,
        silenciado: est.silenciado, silenciadoAte: est.silenciadoAte,
        precisaTrocarNome: est.precisaTrocarNome
      };
    });
    // busca casa também pelo pseudônimo (nº do anônimo) — perfis privados TAMBÉM aparecem aqui
    if (busca) lista = lista.filter(u => norm(u.usuario).includes(busca) || norm(u.email).includes(busca) || norm(u.pseudo).includes(busca));
    lista.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    return res.status(200).json({ ok: true, usuarios: lista.slice(0, 200) });
  }
  /* ===================================================================
     PAINEL DO USUÁRIO (modal do admin) — leitura e escrita completas
     ===================================================================
     Todas as ações abaixo já passaram pelo `ehAdmin` lá em cima. Elas
     existem para o admin abrir UM usuário e mexer em qualquer parâmetro
     dele sem precisar de SQL no painel do Supabase. */

  /* acha a linha exata do usuário (o nome é case-insensitive no site, mas a
     chave no banco é o texto original — sempre resolver antes de escrever) */
  async function acharLinhaUsuario(nome) {
    const { data } = await sb.from('usuarios').select('*').ilike('usuario', String(nome || '')).limit(10);
    return (data || []).find(r => norm(r.usuario) === norm(nome)) || null;
  }
  /* mescla um patch no perfil preservando o resto. O admin PODE escrever os
     campos que o usuário não pode (banido, admin_badges…) — é justamente o
     ponto deste painel. */
  async function patchPerfil(linha, patch) {
    const p = (linha.perfil && typeof linha.perfil === 'object') ? Object.assign({}, linha.perfil) : {};
    Object.keys(patch).forEach(k => {
      if (patch[k] === undefined || patch[k] === null) delete p[k];
      else p[k] = patch[k];
    });
    const { error } = await sb.from('usuarios').update({ perfil: p }).eq('usuario', linha.usuario);
    return { erro: error ? (error.message || String(error)) : null, perfil: p };
  }

  const ADMIN_REP = '__admin__';

  /* ---- 1) tudo sobre um usuário, para montar o modal ---- */
  if (action === 'usuarioDetalhe') {
    const alvo = String(body.alvo || '');
    const linha = await acharLinhaUsuario(alvo);
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const nome = linha.usuario;
    const p = (linha.perfil && typeof linha.perfil === 'object') ? linha.perfil : {};
    const papelAlvo = linha.admin === true ? (PAPEIS.indexOf(String(linha.papel || '')) >= 0 ? String(linha.papel) : 'admin') : null;

    const meu = (rows, col) => (rows || []).filter(r => norm(r[col]) === norm(nome));

    const [subsQ, palpQ, carRecQ, carDadosQ, visRecQ, visFeitasQ, repQ, notifQ, sessQ, reacQ] = await Promise.all([
      sb.from('submissions').select('row_id,sub_id,usuario,year,grid,ts').ilike('usuario', nome),
      sb.from('palpites').select('*').ilike('usuario', nome),
      /* `alvo IS NULL` = carimbo de perfil; com alvo é reação a post do feed,
         listada à parte logo abaixo */
      sb.from('carimbos').select('*').ilike('profile_user', nome).is('alvo', null),
      sb.from('carimbos').select('*').ilike('from_user', nome).is('alvo', null),
      sb.from('visitas').select('*').ilike('profile_user', nome),
      sb.from('visitas').select('*').ilike('visitor_user', nome),
      sb.from('reputacao').select('*').ilike('profile_user', nome),
      sb.from('notificacoes').select('*').ilike('usuario', nome).order('ts', { ascending: false }).limit(50),
      sb.from('sessoes').select('id,dispositivo,criado_em,ultimo_uso').ilike('usuario', nome),
      sb.from('carimbos').select('*').ilike('from_user', nome).not('alvo', 'is', null)
    ]);

    const repRows = meu(repQ.data, 'profile_user');
    const repReal = repRows.filter(r => r.from_user !== ADMIN_REP).reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const repAjuste = Number((repRows.find(r => r.from_user === ADMIN_REP) || {}).valor || 0);

    const subs = meu(subsQ.data, 'usuario').map(r => ({
      row_id: r.row_id, sub_id: r.sub_id, year: Number(r.year),
      ts: Number(r.ts) || 0, grid: (r.grid && typeof r.grid === 'object') ? r.grid : {}
    })).sort((a, b) => b.ts - a.ts);

    return res.status(200).json({
      ok: true,
      usuario: nome,
      admin: linha.admin === true,
      papel: papelAlvo,
      euSou: eu.papel,          /* o modal usa isto pra esconder o que este papel não pode */
      criadoEm: linha.criado_em || 0,
      temSenha: !((p.oauth || {}).semSenha),
      perfil: p,
      moderacao: estadoConta(p),
      reputacao: { real: repReal, ajuste: repAjuste, total: repReal + repAjuste },
      carimbosRecebidos: meu(carRecQ.data, 'profile_user').map(r => ({ id: r.id, de: r.from_user, tipo: r.tipo, ts: Number(r.ts) || 0 })),
      carimbosDados: meu(carDadosQ.data, 'from_user').map(r => ({ id: r.id, para: r.profile_user, tipo: r.tipo, ts: Number(r.ts) || 0 })),
      /* reações que ele deu em posts do feed — mesma tabela, com `alvo` */
      reacoes: meu(reacQ.data, 'from_user').map(r => ({ id: r.id, post: r.alvo, autor: r.profile_user, tipo: r.tipo, ts: Number(r.ts) || 0 })),
      visitasRecebidas: meu(visRecQ.data, 'profile_user').map(r => ({ id: r.id, de: r.visitor_user, ts: Number(r.ts) || 0, count: Number(r.count) || 1 })),
      visitasFeitas: meu(visFeitasQ.data, 'visitor_user').length,
      votos: subs,
      palpites: meu(palpQ.data, 'usuario').map(r => ({ id: r.id, year: Number(r.year), palpites: r.palpites || {}, ts: Number(r.ts) || 0 })),
      notificacoes: meu(notifQ.data, 'usuario').map(r => ({ notif_id: r.notif_id, tipo: r.tipo, titulo: r.titulo, corpo: r.corpo, ts: Number(r.ts) || 0, lida: r.lida === true })),
      sessoes: (sessQ.data || []).map(r => ({ id: r.id, dispositivo: r.dispositivo || '', criadoEm: Number(r.criado_em) || 0, ultimoUso: Number(r.ultimo_uso) || 0 }))
    });
  }

  /* ---- 2) salvar campos do perfil (identidade, flags, showcase, favoritas, amigos…) ---- */
  if (action === 'salvarUsuarioAdmin') {
    const alvo = String(body.alvo || '');
    const linha = await acharLinhaUsuario(alvo);
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });

    const c = (body.campos && typeof body.campos === 'object') ? body.campos : {};
    const patch = {};
    /* lista explícita do que o modal pode gravar — evita que um campo digitado
       errado no front vire lixo permanente dentro do JSON do perfil */
    const TEXTO = ['email', 'pseudo', 'nota_admin'];
    const BOOL = ['anonimo', 'privado', 'twofa', 'email_verificado'];
    const OBJ = ['showcase', 'notif', 'admin_badges'];
    /* `edicoesFav` é o nome que o core.js lê (renderFavs) — não renomear */
    const LISTA = ['amigos', 'edicoesFav', 'destaques'];

    TEXTO.forEach(k => { if (c[k] !== undefined) patch[k] = String(c[k] || '').slice(0, 300).trim() || null; });
    BOOL.forEach(k => { if (c[k] !== undefined) patch[k] = !!c[k]; });
    OBJ.forEach(k => { if (c[k] !== undefined) patch[k] = (c[k] && typeof c[k] === 'object') ? c[k] : null; });
    LISTA.forEach(k => { if (c[k] !== undefined) patch[k] = Array.isArray(c[k]) ? c[k].slice(0, 500) : null; });

    if (patch.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.email)) {
      return res.status(400).json({ ok: false, error: 'e-mail inválido' });
    }
    /* ligar o anonimato pelo painel sem pseudônimo geraria "Anônimo ####"
       aleatório a cada leitura — fixa um aqui, igual faz o site */
    if (patch.anonimo === true) {
      const atual = String((linha.perfil || {}).pseudo || '').trim();
      if (!atual && !patch.pseudo) patch.pseudo = 'Anônimo ' + (1000 + Math.floor(Math.random() * 9000));
    }

    /* cargo NÃO se define por aqui: passa pelo `definirPapel`, que é a única
       rota com a checagem de "não rebaixe a si mesmo" e o registro do papel */
    const r = await patchPerfil(linha, patch);
    if (r.erro) return res.status(500).json({ ok: false, error: r.erro });
    return res.status(200).json({ ok: true, perfil: r.perfil });
  }

  /* ---- 3) esconder o nome e obrigar a pessoa a escolher outro ----
     Faz as duas coisas de uma vez: liga o anonimato (o nome some na hora de
     todo lugar público, porque lerPerfisMap passa a devolver o pseudônimo) e
     marca `nome_bloqueado`, que o site lê para abrir a tela obrigatória de
     escolher um nome novo no próximo carregamento. */
  if (action === 'forcarTrocaNome') {
    const alvo = String(body.alvo || '');
    const linha = await acharLinhaUsuario(alvo);
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const motivo = String(body.motivo || '').slice(0, 200).trim();
    const p = (linha.perfil && typeof linha.perfil === 'object') ? linha.perfil : {};
    const r = await patchPerfil(linha, {
      anonimo: true,
      anon_modo: 'sempre',
      pseudo: String(p.pseudo || '').trim() || ('Usuário ' + (1000 + Math.floor(Math.random() * 9000))),
      nome_bloqueado: { ts: Date.now(), motivo, nomeAntigo: linha.usuario, por: String(body.user || '') }
    });
    if (r.erro) return res.status(500).json({ ok: false, error: r.erro });
    await sb.from('notificacoes').insert({
      usuario: linha.usuario, notif_id: 'nome:' + Date.now(), tipo: 'admin',
      titulo: '✏️ Escolha um novo nome de usuário',
      corpo: motivo || 'Seu nome atual não está de acordo com as regras. Ele foi escondido até você escolher outro.',
      url: '/perfil.html', ts: Date.now(), lida: false
    });
    return res.status(200).json({ ok: true });
  }
  if (action === 'cancelarTrocaNome') {
    const linha = await acharLinhaUsuario(String(body.alvo || ''));
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const r = await patchPerfil(linha, { nome_bloqueado: null, anonimo: false, anon_modo: null, anon_ate: null });
    if (r.erro) return res.status(500).json({ ok: false, error: r.erro });
    return res.status(200).json({ ok: true });
  }

  /* ---- 4) renomear direto pelo painel (sem esperar o usuário) ---- */
  if (action === 'renomearUsuario') {
    const alvo = String(body.alvo || '');
    const novo = String(body.novoNome || '').trim();
    const erro = validarNome(novo);
    if (erro) return res.status(400).json({ ok: false, error: erro });
    const r = await migrarNomeUsuario(sb, alvo, novo, { limparAnonimato: !!body.limparAnonimato, motivo: 'renomeado pelo admin' });
    return res.status(r.ok ? 200 : 400).json(r);
  }

  /* ---- 5) suspender / silenciar ----
     dias = 0 (ou ausente) significa permanente no banimento e "sem efeito" no
     silêncio; `ativo:false` remove a punição. */
  if (action === 'definirBanimento') {
    const linha = await acharLinhaUsuario(String(body.alvo || ''));
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    if (linha.admin === true && body.ativo) {
      return res.status(400).json({ ok: false, error: 'remova o admin dessa conta antes de suspender' });
    }
    let valor = null;
    if (body.ativo) {
      let dias = Number(body.dias) || 0;
      /* suspensão sem prazo é decisão de admin. O moderador tem teto — assim
         o pior que ele consegue fazer é reversível sozinho pelo tempo. */
      if (eu.papel !== 'admin') {
        if (dias <= 0 || dias > MAX_DIAS_BAN_MODERADOR) {
          return res.status(403).json({ ok: false, error: 'como moderador, a suspensão precisa ter prazo de 1 a ' + MAX_DIAS_BAN_MODERADOR + ' dias' });
        }
      }
      valor = { ts: Date.now(), motivo: String(body.motivo || '').slice(0, 200).trim(), por: String(body.user || '') };
      if (dias > 0) valor.ate = Date.now() + dias * 24 * 60 * 60 * 1000;
    }
    const r = await patchPerfil(linha, { banido: valor });
    if (r.erro) return res.status(500).json({ ok: false, error: r.erro });
    /* Suspender sem derrubar as sessões abertas não adiantaria nada. E não
       basta limpar a tabela `sessoes`: o token legado mora em usuarios.token
       e continuaria valendo sozinho. */
    if (valor) {
      try { await apagarPorNome(sb, 'sessoes', 'usuario', linha.usuario); } catch (e) { /* segue */ }
      try { await sb.from('usuarios').update({ token: null }).eq('usuario', linha.usuario); } catch (e) { /* segue */ }
    }
    return res.status(200).json({ ok: true });
  }
  if (action === 'definirSilencio') {
    const linha = await acharLinhaUsuario(String(body.alvo || ''));
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const horas = Number(body.horas) || 0;
    const ate = (body.ativo && horas > 0) ? (Date.now() + horas * 60 * 60 * 1000) : null;
    const r = await patchPerfil(linha, { silenciado_ate: ate });
    if (r.erro) return res.status(500).json({ ok: false, error: r.erro });
    return res.status(200).json({ ok: true, ate });
  }

  /* ---- 6) derrubar todas as sessões (sem suspender) ---- */
  if (action === 'deslogarTudo') {
    const linha = await acharLinhaUsuario(String(body.alvo || ''));
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const { error } = await apagarPorNome(sb, 'sessoes', 'usuario', linha.usuario);
    /* o token legado mora em usuarios.token — zerar também, senão a sessão
       antiga de quem nunca relogou continua valendo */
    await sb.from('usuarios').update({ token: null }).eq('usuario', linha.usuario);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  /* ---- 7) badges: forçar ou bloquear ----
     As badges do perfil são CALCULADAS no navegador a partir dos votos, então
     não há o que "editar" no banco. O que guardamos é uma camada de exceção
     — { forcadas:[titulo], bloqueadas:[titulo] } — que o core.js aplica por
     cima do catálogo na hora de renderizar. */
  if (action === 'ajustarBadges') {
    const linha = await acharLinhaUsuario(String(body.alvo || ''));
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const lista = v => Array.isArray(v) ? [...new Set(v.map(x => String(x).slice(0, 80).trim()).filter(Boolean))].slice(0, 200) : [];
    const forcadas = lista(body.forcadas);
    const bloqueadas = lista(body.bloqueadas).filter(t => forcadas.indexOf(t) < 0);  // forçar ganha do bloquear
    const vazio = !forcadas.length && !bloqueadas.length;
    const r = await patchPerfil(linha, { admin_badges: vazio ? null : { forcadas, bloqueadas } });
    if (r.erro) return res.status(500).json({ ok: false, error: r.erro });
    return res.status(200).json({ ok: true, forcadas, bloqueadas });
  }

  /* ---- 8) atalho: mensagem direta pra UMA pessoa ---- */
  if (action === 'notificarUsuario') {
    const linha = await acharLinhaUsuario(String(body.alvo || ''));
    if (!linha) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const titulo = String(body.titulo || '').trim().slice(0, 120);
    const corpo = String(body.corpo || '').trim().slice(0, 500);
    if (!titulo && !corpo) return res.status(400).json({ ok: false, error: 'mensagem vazia' });
    const url = String(body.url || '/notificacoes.html').slice(0, 300);
    await sb.from('notificacoes').insert({
      usuario: linha.usuario, notif_id: 'admin:' + Date.now(), tipo: 'admin',
      titulo: titulo || '📣 CETECritic', corpo, url, ts: Date.now(), lida: false
    });
    let push = 0;
    if (body.push) push = await enviarPushPara([linha.usuario], { title: titulo || 'CETECritic', body: corpo, url });
    return res.status(200).json({ ok: true, push });
  }

  /* ---- 9) apagar conteúdo pontual do usuário ---- */
  if (action === 'apagarItemUsuario') {
    const tipo = String(body.tipo || '');
    const id = body.id;
    if (id === undefined || id === null || id === '') return res.status(400).json({ ok: false, error: 'id ausente' });
    const mapa = {
      voto: ['submissions', 'row_id'],
      carimbo: ['carimbos', 'id'],
      visita: ['visitas', 'id'],
      palpite: ['palpites', 'id'],
      notificacao: ['notificacoes', 'notif_id'],
      sessao: ['sessoes', 'id']
    };
    const par = mapa[tipo];
    if (!par) return res.status(400).json({ ok: false, error: 'tipo inválido: ' + tipo });
    /* voto e palpite mexem em dados de votação — só admin apaga */
    if (eu.papel !== 'admin' && ITENS_SO_ADMIN[tipo]) {
      return res.status(403).json({ ok: false, error: 'apagar ' + tipo + ' é restrito ao admin' });
    }

    let q = sb.from(par[0]).delete().eq(par[1], id);
    /* ATENÇÃO: notif_id NÃO é único. Um aviso enviado "para todos" grava a
       MESMA notif_id em uma linha por usuário — apagar só por notif_id
       removeria o aviso da caixa de todo mundo. Por isso, aqui, o alvo entra
       no filtro. As outras tabelas usam chave própria (id/row_id/endpoint) e
       não têm esse problema. */
    if (tipo === 'notificacao') {
      const alvo = String(body.alvo || '');
      if (!alvo) return res.status(400).json({ ok: false, error: 'alvo obrigatório para apagar notificação' });
      q = q.ilike('usuario', alvo);
    }
    const { error } = await q;
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  }

  /* ---- 10) editar as notas de UMA avaliação ---- */
  if (action === 'editarVoto') {
    const rowId = body.row_id;
    const grid = (body.grid && typeof body.grid === 'object') ? body.grid : null;
    if (!rowId || !grid) return res.status(400).json({ ok: false, error: 'dados inválidos' });
    const limpo = {};
    Object.keys(grid).forEach(k => {
      if (!/^s\d+e\d+$/.test(k)) return;                 // só chaves no formato sNeM
      const v = Number(grid[k]);
      if (Number.isFinite(v) && v >= 0 && v <= 10) limpo[k] = v;
    });
    const { error } = await sb.from('submissions').update({ grid: limpo }).eq('row_id', rowId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, grid: limpo });
  }

  // ----- item 4: testar/normalizar link do Spotify/YouTube (usado no import de CSV também) -----
  if (action === 'parseLink') {
    return res.status(200).json({ ok: true, resultado: parseLinkMusica(body.link) });
  }

  // ----- item 5: anonimizar usuário pelo admin (uma vez / por período / sempre) -----
  if (action === 'anonimizarUsuario') {
    const alvo = String(body.alvo || '');
    const modo = ['uma_vez', 'periodo', 'sempre'].includes(String(body.modo)) ? String(body.modo) : 'sempre';
    const { data } = await sb.from('usuarios').select('usuario,perfil').ilike('usuario', alvo);
    const real = (data || []).find(r => norm(r.usuario) === norm(alvo));
    if (!real) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const p = (real.perfil && typeof real.perfil === 'object') ? Object.assign({}, real.perfil) : {};
    p.anonimo = true;
    p.anon_modo = modo;
    if (modo === 'periodo') {
      const dias = Math.max(1, Number(body.dias) || 1);
      p.anon_ate = Date.now() + dias * 24 * 60 * 60 * 1000;
    } else {
      delete p.anon_ate;   // 'sempre' e 'uma_vez' não expiram por tempo
    }
    await sb.from('usuarios').update({ perfil: p }).eq('usuario', real.usuario);
    return res.status(200).json({ ok: true, anonAte: p.anon_ate || null });
  }
  // desfaz o anonimato manualmente (admin)
  if (action === 'removerAnonimato') {
    const alvo = String(body.alvo || '');
    const { data } = await sb.from('usuarios').select('usuario,perfil').ilike('usuario', alvo);
    const real = (data || []).find(r => norm(r.usuario) === norm(alvo));
    if (!real) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
    const p = (real.perfil && typeof real.perfil === 'object') ? Object.assign({}, real.perfil) : {};
    p.anonimo = false; delete p.anon_modo; delete p.anon_ate;
    await sb.from('usuarios').update({ perfil: p }).eq('usuario', real.usuario);
    return res.status(200).json({ ok: true });
  }

  /* Define o papel da pessoa na equipe. Só admin chega aqui (ver a tabela de
     permissões), o que impede um moderador de se promover.

       papel null/'' -> tira do painel (admin=false)
       'admin' | 'moderador' | 'historiador' -> entra com aquele papel

     `admin` (booleano) segue sendo a chave da porta e `papel` o que ela faz
     lá dentro — por isso os dois são gravados juntos, sempre. */
  if (action === 'definirPapel' || action === 'tornarAdmin') {
    const alvo = String(body.alvo || '');
    const { data } = await sb.from('usuarios').select('usuario').ilike('usuario', alvo);
    const real = (data || []).find(r => norm(r.usuario) === norm(alvo));
    if (!real) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });

    /* compatibilidade: a chamada antiga mandava só { valor: true/false } */
    let papel = body.papel !== undefined ? String(body.papel || '') : (body.valor ? 'admin' : '');
    if (papel && PAPEIS.indexOf(papel) < 0) return res.status(400).json({ ok: false, error: 'papel inválido: ' + papel });

    /* não dá pra tirar o próprio acesso e ficar sem ninguém com a chave */
    if (norm(real.usuario) === norm(eu.usuario) && papel !== 'admin') {
      return res.status(400).json({ ok: false, error: 'você não pode rebaixar a si mesmo — peça a outro admin' });
    }

    const { error } = await sb.from('usuarios').update({ admin: !!papel, papel: papel || null }).eq('usuario', real.usuario);
    if (error) {
      const dica = /papel/i.test(error.message || '') ? ' — rode o SQL sql/2026-07-papeis-admin.sql no Supabase primeiro' : '';
      return res.status(500).json({ ok: false, error: error.message + dica });
    }
    /* mudou de papel: derruba as sessões pra recarregar o painel com os
       poderes certos, e avisa a pessoa */
    if (papel) {
      await sb.from('notificacoes').insert({
        usuario: real.usuario, notif_id: 'papel:' + Date.now(), tipo: 'admin',
        titulo: '🛠️ Acesso à equipe',
        corpo: 'Seu papel no painel agora é: ' + papel + '.',
        url: '/admin.html', ts: Date.now(), lida: false
      });
    }
    return res.status(200).json({ ok: true, papel: papel || null });
  }
  // ----- item 6: reputação editável pelo admin -----
  // Guardamos o ajuste do admin como uma linha ESPECIAL em `reputacao`
  // (from_user = '__admin__'), com o valor sendo a diferença entre o
  // número desejado e a soma dos votos reais. Assim o total bate com o
  // que o admin definiu, sem apagar ou sobrescrever o voto de ninguém.
  const ADMIN_REP_FROM = '__admin__';

  if (action === 'lerReputacao') {
    const alvo = String(body.alvo || '');
    const { data } = await sb.from('reputacao').select('from_user,valor').ilike('profile_user', alvo);
    const rows = data || [];
    const votosReais = rows.filter(r => r.from_user !== ADMIN_REP_FROM).reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const ajuste = (rows.find(r => r.from_user === ADMIN_REP_FROM) || {}).valor || 0;
    return res.status(200).json({ ok: true, totalAtual: votosReais + Number(ajuste) });
  }

  if (action === 'ajustarReputacao') {
    const alvo = String(body.alvo || '');
    const desejado = Number(body.valor);
    if (!alvo || !Number.isFinite(desejado)) return res.status(400).json({ ok: false, error: 'parâmetros inválidos' });
    const { data } = await sb.from('reputacao').select('id,from_user,valor').ilike('profile_user', alvo);
    const rows = data || [];
    const votosReais = rows.filter(r => r.from_user !== ADMIN_REP_FROM).reduce((s, r) => s + (Number(r.valor) || 0), 0);
    const linhaAdmin = rows.find(r => r.from_user === ADMIN_REP_FROM);
    const ajuste = desejado - votosReais;
    if (ajuste === 0 && linhaAdmin) await sb.from('reputacao').delete().eq('id', linhaAdmin.id);
    else if (linhaAdmin) await sb.from('reputacao').update({ valor: ajuste, ts: Date.now() }).eq('id', linhaAdmin.id);
    else await sb.from('reputacao').insert({ profile_user: alvo, from_user: ADMIN_REP_FROM, valor: ajuste, ts: Date.now() });
    return res.status(200).json({ ok: true, totalAtual: votosReais + ajuste });
  }

  if (action === 'moderarPerfil') {
    const alvo = String(body.alvo || '');
    const nu = norm(alvo); const op = body.opcoes || {};
    /* o moderador limpa rastro social (carimbo, visita, reação, notificação),
       mas não toca em voto nem em conteúdo autoral do perfil */
    if (eu.papel !== 'admin') {
      const proibida = Object.keys(op).find(k => op[k] && LIMPEZAS_SO_ADMIN[k]);
      if (proibida) return res.status(403).json({ ok: false, error: 'limpar "' + proibida + '" é restrito ao admin' });
    }
    const avisos = [];
    /* filtro NO SERVIDOR (ilike) e não select('*') solto: o PostgREST corta em
       1000 linhas, e em tabelas grandes as linhas do usuário nem apareciam —
       mesma armadilha já documentada no apiDeletarConta do db.js. */
    /* Apagamos pela PRÓPRIA coluna, usando os valores exatos observados na
       leitura. Não usamos a chave primária de propósito: em `notificacoes` o
       notif_id se repete entre usuários (aviso enviado pra todos), então
       deletar por ele limparia a caixa de terceiros. E não dá pra usar ilike
       direto no delete porque `_` é curinga em LIKE e nomes aceitam `_`. */
    /* `ajustar` aplica o mesmo filtro extra na leitura e no delete — usado pra
       separar carimbo de perfil (alvo IS NULL) de reação a post (alvo NOT NULL),
       que dividem a tabela `carimbos`. */
    const limpar = async (table, col, ajustar) => {
      let sel = sb.from(table).select('*').ilike(col, alvo);
      if (ajustar) sel = ajustar(sel);
      const { data, error } = await sel;
      if (error) { avisos.push('ler ' + table + ': ' + error.message); return; }
      const exatos = [...new Set((data || []).filter(r => norm(r[col]) === nu).map(r => r[col]))];
      if (!exatos.length) return;
      let del = sb.from(table).delete().in(col, exatos);
      if (ajustar) del = ajustar(del);
      const { error: e2 } = await del;
      if (e2) avisos.push('apagar ' + table + ': ' + e2.message);
    };
    const soPerfil = q => q.is('alvo', null);
    const soReacao = q => q.not('alvo', 'is', null);
    if (op.carimbos)     await limpar('carimbos', 'profile_user', soPerfil);
    if (op.carimbosDados)await limpar('carimbos', 'from_user', soPerfil);
    if (op.reacoes)      await limpar('carimbos', 'from_user', soReacao);
    if (op.visitas)      await limpar('visitas', 'profile_user');
    if (op.reputacao)    await limpar('reputacao', 'profile_user');
    if (op.palpites)     await limpar('palpites', 'usuario');
    if (op.notificacoes) await limpar('notificacoes', 'usuario');
    if (op.push)         await limpar('push', 'usuario');
    /* votos: anonimizamos em vez de apagar, senão as médias das peças mudam
       retroativamente e o histórico do festival fica errado.

       `name` vai junto com `usuario`: quem vota logado grava o próprio nome
       nas DUAS colunas, e é o `name` que a lista pública de avaliações
       mostra. Zerando só o `usuario`, o voto saía do perfil mas o nome
       continuava aparecendo no site — a limpeza não limpava de fato. */
    if (op.votos) {
      const { data, error } = await sb.from('submissions').select('row_id,usuario').ilike('usuario', alvo);
      if (error) avisos.push('ler submissions: ' + error.message);
      const ids = (data || []).filter(r => norm(r.usuario) === nu).map(r => r.row_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { error: e2 } = await sb.from('submissions').update({ usuario: null, name: '' }).in('row_id', ids.slice(i, i + 200));
        if (e2) avisos.push('anonimizar votos: ' + e2.message);
      }
    }
    if (op.showcase || op.amigos) {
      const { data } = await sb.from('usuarios').select('usuario,perfil').ilike('usuario', alvo);
      const real = (data || []).find(r => norm(r.usuario) === nu);
      if (real) {
        const p = (real.perfil && typeof real.perfil === 'object') ? Object.assign({}, real.perfil) : {};
        if (op.showcase) { delete p.destaques; delete p.favoritas; delete p.showcase; }
        if (op.amigos) delete p.amigos;
        const { error } = await sb.from('usuarios').update({ perfil: p }).eq('usuario', real.usuario);
        if (error) avisos.push('perfil: ' + error.message);
      }
    }
    return res.status(200).json({ ok: avisos.length === 0, avisos });
  }
  /* mesmo tratamento do apiDeletarConta do db.js: filtro no servidor (o select('*')
     sem filtro só traz 1000 linhas e deixava rastro pra FK barrar) + checagem de erro */
  if (action === 'deletarUsuario') {
    const alvo = String(body.alvo || ''); const nu = norm(alvo);
    if (!nu) return res.status(400).json({ ok: false, error: 'usuário inválido' });

    const avisos = [];
    const anota = (etapa, error) => { if (error) avisos.push(etapa + ': ' + (error.message || String(error))); };

    {
      const { data, error } = await sb.from('submissions').select('row_id,usuario').ilike('usuario', alvo);
      anota('ler submissions', error);
      const ids = (data || []).filter(r => norm(r.usuario) === nu).map(r => r.row_id);
      if (ids.length) { const { error: e2 } = await sb.from('submissions').update({ usuario: null }).in('row_id', ids); anota('anonimizar votos', e2); }
    }

    const delWhere = async (table, cols) => {
      const ids = new Set();
      for (const c of cols) {
        const { data, error } = await sb.from(table).select('*').ilike(c, alvo);
        if (error) { anota('ler ' + table + '.' + c, error); continue; }
        (data || []).forEach(r => { if (norm(r[c]) === nu && r.id != null) ids.add(r.id); });
      }
      if (ids.size) { const { error } = await sb.from(table).delete().in('id', [...ids]); anota('apagar ' + table, error); }
    };
    await delWhere('carimbos',     ['profile_user', 'from_user']);
    await delWhere('visitas',      ['profile_user', 'visitor_user']);
    await delWhere('reputacao',    ['profile_user', 'from_user']);
    await delWhere('palpites',     ['usuario']);
    await delWhere('resets',       ['usuario']);
    await delWhere('notificacoes', ['usuario']);
    await delWhere('sessoes',      ['usuario']);

    { const { error } = await apagarPorNome(sb, 'login_codes', 'usuario', alvo); anota('apagar login_codes', error); }

    {
      const { data, error } = await sb.from('push').select('endpoint,usuario').ilike('usuario', alvo);
      anota('ler push', error);
      const eps = (data || []).filter(r => norm(r.usuario) === nu).map(r => r.endpoint);
      if (eps.length) { const { error: e2 } = await sb.from('push').delete().in('endpoint', eps); anota('apagar push', e2); }
    }

    const { data: us } = await sb.from('usuarios').select('usuario').ilike('usuario', alvo);
    const real = (us || []).find(r => norm(r.usuario) === nu);
    if (real) {
      const { error } = await sb.from('usuarios').delete().eq('usuario', real.usuario);
      if (error) return res.status(500).json({ ok: false, error: 'não deu pra apagar o usuário — ' + (error.message || error), detalhes: avisos });
    }
    return res.status(200).json({ ok: true, avisos });
  }

  if (action === 'salvarConfig') {
    const dados = (body.dados && typeof body.dados === 'object') ? body.dados : {};
    const r = await gravarConfig(dados, body.versao);
    if (!r.ok) return res.status(r.conflito ? 409 : 500).json({ ok: false, error: r.error });
    return res.status(200).json({ ok: true, versao: r.versao });
  }

  // ----- postar no FEED social (aparece na aba Social > Geral do perfil) -----
  if (action === 'postarFeed') {
    const item = {
      autor: String(body.autor || 'CETECritic').slice(0, 40),
      emoji: String(body.emoji || '📣').slice(0, 4),
      texto: String(body.texto || '').trim().slice(0, 300),
      url: String(body.url || '').trim().slice(0, 300),
      ts: Date.now()
    };
    if (!item.texto) return res.status(400).json({ ok: false, error: 'escreva o texto do post' });

    /* ler-alterar-regravar com retentativa: se outra gravação entrou no meio,
       relemos e tentamos de novo em vez de sobrescrever o trabalho dela */
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const cfg = await lerConfig();
      const feed = Array.isArray(cfg.feed) ? cfg.feed : [];
      feed.unshift(item);
      const novo = Object.assign({}, cfg, { feed: feed.slice(0, 40) });
      const r = await gravarConfig(novo, cfg._versao);
      if (r.ok) return res.status(200).json({ ok: true });
      if (!r.conflito) return res.status(500).json({ ok: false, error: r.error });
    }
    return res.status(409).json({ ok: false, error: 'o painel está sendo salvo por outra pessoa agora — tente de novo em alguns segundos' });
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

    /* ---- trava anti-exclusão do historiador --------------------------
       Esta rota substitui a edição inteira: apaga noites e peças do ano e
       reinsere o que veio no corpo. Para quem pode criar mas NÃO excluir,
       isso seria uma porta dos fundos — bastaria mandar a lista sem uma
       peça pra apagá-la. Então comparamos com o que já existe e recusamos
       qualquer payload que encolha o acervo. Adicionar e corrigir passa. */
    if (eu.papel !== 'admin') {
      const { data: noitesAtuais } = await sb.from('noites').select('noite').eq('ano', ano);
      const { data: pecasAtuais } = await sb.from('pecas').select('noite').eq('ano', ano);

      const noitesNovas = Array.isArray(body.noites) ? body.noites : [];
      const setNovas = new Set(noitesNovas.map(n => Number(n.noite)).filter(Boolean));

      const sumiu = (noitesAtuais || []).map(n => Number(n.noite)).find(n => !setNovas.has(n));
      if (sumiu) return res.status(403).json({ ok: false, error: 'a noite ' + sumiu + ' sumiu do envio. Como historiador você pode adicionar e corrigir, mas não excluir.' });

      const contaAtual = {};
      (pecasAtuais || []).forEach(p => { const n = Number(p.noite); contaAtual[n] = (contaAtual[n] || 0) + 1; });
      for (const n of Object.keys(contaAtual)) {
        const nd = noitesNovas.find(x => Number(x.noite) === Number(n));
        const qtd = (nd && Array.isArray(nd.pecas)) ? nd.pecas.length : 0;
        if (qtd < contaAtual[n]) {
          return res.status(403).json({ ok: false, error: 'a noite ' + n + ' tem ' + contaAtual[n] + ' peça(s) e o envio traz ' + qtd + '. Como historiador você pode adicionar e corrigir, mas não excluir.' });
        }
      }
      /* campos da edição que mudam o estado do site, não o acervo */
      if (e.em_breve !== undefined && !!e.em_breve !== false) {
        /* deixar marcar "em breve" é inofensivo; o que não pode é esconder
           uma edição já publicada — checamos abaixo */
        const { data: edAtual } = await sb.from('edicoes').select('em_breve').eq('ano', ano).limit(1);
        if (edAtual && edAtual[0] && edAtual[0].em_breve === false) {
          return res.status(403).json({ ok: false, error: 'só o admin pode voltar uma edição publicada para "em breve"' });
        }
      }
    }

    /* ---- trava de remanejamento: vale pra TODO MUNDO, inclusive admin ----
       A peça não tem id próprio — ela É a posição dela na grade (`sNeM`), e
       essa string é a chave dos votos em `submissions.grid` e dos palpites.

       Como esta rota reinsere as peças renumerando (`ordem: i + 1`), tirar
       uma peça do meio faz todas as seguintes subirem uma posição, e cada
       nota já dada passa a apontar para a peça errada. Em silêncio: sem
       erro, sem log, sem nada. Alguém só estranha meses depois, quando o
       campeão daquele ano "mudou".

       A trava do historiador logo acima já cobria isso pra ele. Aqui a
       mesma regra passa a valer pro admin — mas só quando há histórico em
       jogo, isto é, quando aquele ano já tem votos. Editar uma edição que
       ninguém votou continua livre.

       Escape consciente: `body.confirmarRemanejamento === true` libera, pra
       quando a remoção for mesmo o que se quer e as chaves já tiverem sido
       remanejadas em SQL na mão. */
    if (!body.confirmarRemanejamento && Array.isArray(body.noites)) {
      const { data: votos } = await sb.from('submissions').select('row_id').eq('year', ano).limit(1);
      if (votos && votos.length) {
        const { data: pecasAtuais } = await sb.from('pecas').select('noite').eq('ano', ano).limit(LIMITE_ALTO);
        const contaAtual = {};
        (pecasAtuais || []).forEach(p => { const n = Number(p.noite); contaAtual[n] = (contaAtual[n] || 0) + 1; });
        for (const n of Object.keys(contaAtual)) {
          const nd = body.noites.find(x => Number(x.noite) === Number(n));
          const qtd = (nd && Array.isArray(nd.pecas)) ? nd.pecas.length : 0;
          if (qtd < contaAtual[n]) {
            return res.status(409).json({
              ok: false,
              error: 'a noite ' + n + ' tem ' + contaAtual[n] + ' peça(s) e o envio traz ' + qtd +
                     '. Esta edição JÁ TEM VOTOS: remover uma peça renumera as seguintes e faz as notas '
                     + 'apontarem para a peça errada. Para corrigir o texto de uma peça que não aconteceu, '
                     + 'esvazie o título em vez de tirá-la da lista.'
            });
          }
        }
      }
    }

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

    /* ---- noites + peças: substitui tudo do ano pelo que veio ----

       O PostgREST não expõe transação, então DELETE seguido de INSERT tem
       uma janela em que o ano fica sem conteúdo. ANTES essa janela era maior
       do que precisava: as linhas eram montadas dentro do laço, DEPOIS do
       delete, e nenhum erro de insert era conferido — se a função caísse no
       meio (timeout da Vercel, hiccup do banco), a edição ficava sem noites
       e sem peças, com os votos apontando pro vazio, e a resposta ainda era
       `ok: true`.

       Agora: monta e valida TUDO em memória primeiro, e só então apaga e
       grava, em duas escritas em lote. A janela vira alguns milissegundos, e
       qualquer erro é devolvido em vez de engolido. */
    if (Array.isArray(body.noites)) {
      const linhasNoites = [];
      const linhasPecas = [];
      for (const nd of body.noites) {
        const noite = Number(nd.noite);
        if (!noite) continue;
        linhasNoites.push({ ano, noite, data: nd.data || null, subtitulo: nd.subtitulo || null });
        (Array.isArray(nd.pecas) ? nd.pecas : []).forEach((p, i) => {
          linhasPecas.push({
            ano, noite, ordem: i + 1,
            titulo: p.titulo || '', turma: p.turma || '', sinopse: p.sinopse || '',
            youtube: p.youtube || '', youtube_inicio: Number(p.youtubeInicio ?? p.youtube_inicio) || 0
          });
        });
      }

      const del1 = await sb.from('pecas').delete().eq('ano', ano);
      if (del1.error) return res.status(500).json({ ok: false, error: 'não deu pra limpar as peças: ' + del1.error.message });
      const del2 = await sb.from('noites').delete().eq('ano', ano);
      if (del2.error) return res.status(500).json({ ok: false, error: 'não deu pra limpar as noites: ' + del2.error.message });

      if (linhasNoites.length) {
        const ins1 = await sb.from('noites').insert(linhasNoites);
        if (ins1.error) return res.status(500).json({
          ok: false,
          error: 'AS NOITES NÃO FORAM GRAVADAS e as antigas já tinham sido apagadas: ' + ins1.error.message +
                 ' — reenvie o formulário antes de sair da página.'
        });
      }
      if (linhasPecas.length) {
        const ins2 = await sb.from('pecas').insert(linhasPecas);
        if (ins2.error) return res.status(500).json({
          ok: false,
          error: 'AS PEÇAS NÃO FORAM GRAVADAS e as antigas já tinham sido apagadas: ' + ins2.error.message +
                 ' — reenvie o formulário antes de sair da página.'
        });
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
      const ids = Array.isArray(body.row_ids) ? body.row_ids.filter(Boolean) : [];
      if (!ids.length) return res.status(400).json({ ok: false, error: 'selecione ao menos um voto pra apagar' });
      const { error } = await sb.from('submissions').delete().in('row_id', ids);
      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, apagados: ids.length });
    }
    // listarVotos com filtros
    const ano = body.ano ? Number(body.ano) : null;
    const usuarioF = norm(body.usuario || '');
    const noite = body.noite ? Number(body.noite) : null;
    const ep = body.episodio ? Number(body.episodio) : null;
    const notaF = (body.nota !== '' && body.nota != null) ? Number(body.nota) : null;
    const chave = (noite && ep) ? ('s' + noite + 'e' + ep) : null;

    /* `name` é o nome DIGITADO no formulário (quem votou sem conta) e
       `usuario` é o vínculo com a conta logada. O painel só lia `usuario`,
       por isso TODO voto sem conta aparecia como "(anônimo)" mesmo tendo
       nome preenchido. Agora os dois vêm, e o painel decide o que mostrar.

       As colunas *_antigo guardam o nome removido pela moderação. Se ainda
       não existirem no banco, o select falha inteiro — daí o fallback. */
    const COLS_COM_HIST = 'row_id,sub_id,usuario,name,year,grid,ts,usuario_antigo,name_antigo';
    const COLS_BASE     = 'row_id,sub_id,usuario,name,year,grid,ts';
    let temHistorico = true;
    let data = null;

    {
      let q = sb.from('submissions').select(COLS_COM_HIST);
      if (ano) q = q.eq('year', ano);
      const r1 = await q.limit(3000);
      if (r1.error) {
        temHistorico = false;
        let q2 = sb.from('submissions').select(COLS_BASE);
        if (ano) q2 = q2.eq('year', ano);
        const r2 = await q2.limit(3000);
        if (r2.error) return res.status(500).json({ ok: false, error: r2.error.message });
        data = r2.data;
      } else {
        data = r1.data;
      }
    }

    let rows = (data || []);
    /* o filtro por usuário agora também acha por nome digitado — antes, procurar
       "Maria" não trazia nada se a Maria tivesse votado sem conta */
    if (usuarioF) rows = rows.filter(r => norm(r.usuario) === usuarioF || norm(r.name) === usuarioF);
    rows = rows.filter(r => {
      const g = (r.grid && typeof r.grid === 'object') ? r.grid : {};
      if (chave) { if (!(chave in g)) return false; if (notaF != null && Number(g[chave]) !== notaF) return false; return true; }
      if (notaF != null) return Object.values(g).some(v => Number(v) === notaF);
      return true;
    });
    /* mais recentes primeiro: é assim que se investiga um voto */
    rows.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));

    const votos = rows.slice(0, 400).map(r => {
      const g = (r.grid && typeof r.grid === 'object') ? r.grid : {};
      const nomeGuardado = temHistorico ? (r.usuario_antigo || r.name_antigo || '') : '';
      return {
        row_id: r.row_id, sub_id: r.sub_id, year: r.year, ts: r.ts,
        usuario: r.usuario || '',            // vínculo com a conta (vazio = votou sem login)
        name: r.name || '',                  // nome digitado no formulário
        grid: g,                             // grade completa, pro painel expandir
        nota: chave ? g[chave] : null,
        notas: Object.keys(g).length,
        anonimizado: !!nomeGuardado,         // já teve o nome removido pela moderação
        nomeGuardado                         // o que volta se restaurar
      };
    });
    return res.status(200).json({ ok: true, votos, total: rows.length, historicoDisponivel: temHistorico });
  }

  /* ---- tirar o nome de UM voto (deixa anônimo) / devolver o nome ----
     O nome sai do voto mas fica guardado em usuario_antigo/name_antigo, então
     a ação é reversível — mesma lógica do anonimizarUsuario/removerAnonimato
     que já existe para perfis. Zerar `usuario` também desliga o voto do perfil
     da pessoa, que é justamente o efeito esperado. */
  if (action === 'anonimizarVoto' || action === 'restaurarNomeVoto') {
    const rowId = body.row_id;
    if (!rowId) return res.status(400).json({ ok: false, error: 'informe o voto' });

    const { data: linhas, error: erroLer } = await sb.from('submissions')
      .select('row_id,usuario,name,usuario_antigo,name_antigo').eq('row_id', rowId).limit(1);
    if (erroLer) {
      /* erro de coluna inexistente = migração não rodou */
      return res.status(500).json({
        ok: false,
        error: 'o banco ainda não tem as colunas usuario_antigo/name_antigo — rode a migração no Supabase'
      });
    }
    const linha = (linhas || [])[0];
    if (!linha) return res.status(404).json({ ok: false, error: 'voto não encontrado' });

    if (action === 'anonimizarVoto') {
      const temNome = !!(String(linha.usuario || '').trim() || String(linha.name || '').trim());
      if (!temNome) return res.status(400).json({ ok: false, error: 'este voto já está anônimo' });
      /* não sobrescreve um histórico anterior: se já foi anonimizado antes, o
         primeiro nome guardado é o que vale */
      const patch = {
        usuario: null,
        name: '',
        usuario_antigo: linha.usuario_antigo || linha.usuario || null,
        name_antigo: linha.name_antigo || linha.name || null
      };
      const { error } = await sb.from('submissions').update(patch).eq('row_id', rowId);
      if (error) return res.status(500).json({ ok: false, error: error.message });
      return res.status(200).json({ ok: true, nomeGuardado: patch.usuario_antigo || patch.name_antigo || '' });
    }

    // restaurarNomeVoto
    const temHist = !!(String(linha.usuario_antigo || '').trim() || String(linha.name_antigo || '').trim());
    if (!temHist) return res.status(400).json({ ok: false, error: 'não há nome guardado para este voto' });
    const patch = {
      usuario: linha.usuario_antigo || null,
      name: linha.name_antigo || '',
      usuario_antigo: null,
      name_antigo: null
    };
    const { error } = await sb.from('submissions').update(patch).eq('row_id', rowId);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true, usuario: patch.usuario || '', name: patch.name || '' });
  }

  // ----- upload de imagem (poster / banner) pro Supabase Storage -----
  if (action === 'uploadImagem') {
    /* Só formatos de imagem. Sem isto, um data: URL com qualquer content-type
       (text/html, image/svg+xml) subia pro bucket público e era servido de
       volta com esse tipo — SVG aceita <script> dentro, então virava XSS
       hospedado no nosso próprio domínio. */
    const TIPOS_OK = { 'image/webp': '.webp', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' };
    /* 3 MB de imagem = ~4 MB depois do base64, que é o teto de corpo de
       requisição do Vercel. Barrar aqui devolve um erro legível em vez do
       413 cru da plataforma. O painel manda bem menos que isso. */
    const LIMITE_BYTES = 3 * 1024 * 1024;

    const b64 = String(body.data || '');
    const m = b64.match(/^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]*)$/);
    if (!m) return res.status(400).json({ ok: false, error: 'imagem em formato inesperado' });

    const contentType = m[1].toLowerCase();
    if (!TIPOS_OK[contentType]) return res.status(400).json({ ok: false, error: 'tipo de imagem não aceito: ' + contentType });

    const raw = m[2].replace(/\s/g, '');
    if (!raw) return res.status(400).json({ ok: false, error: 'sem imagem' });

    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) return res.status(400).json({ ok: false, error: 'sem imagem' });
    if (buffer.length > LIMITE_BYTES) return res.status(413).json({ ok: false, error: 'imagem grande demais (máx. 8 MB)' });

    /* nome do arquivo: colapsa pontos seguidos (senão "..%2F" viraria ".." e
       daria pra escapar da pasta) e garante a extensão certa pro tipo */
    let nomeLimpo = String(body.nome || 'img')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '')
      .slice(0, 80) || 'img';
    const extEsperada = TIPOS_OK[contentType];
    if (!nomeLimpo.toLowerCase().endsWith(extEsperada)) nomeLimpo = nomeLimpo.replace(/\.[a-z0-9]+$/i, '') + extEsperada;

    const pasta = String(body.pasta || 'geral').replace(/[^a-zA-Z0-9_-]/g, '') || 'geral';
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
  /* Avisos automáticos (hoje só os do bolão) usam o próprio broadcast como
     memória de "já enviei este aviso" — ver avisarUmaVez em /api/db.js. Eles
     não podem ser excluídos de verdade, então são ARQUIVADOS: `fim` no
     passado tira o banner do ar e da lista, e a linha continua servindo de
     comprovante. */
  const ehAvisoAutomatico = id => /^bolao-(abre|fecha):/.test(String(id || ''));
  const estaArquivado = b => ehAvisoAutomatico(b.bc_id) && b.fim && Number(b.fim) < Date.now();

  if (action === 'listarBanners') {
    const { data } = await sb.from('broadcasts').select('*').order('ts', { ascending: false }).limit(50);
    /* arquivado, pro painel, é o mesmo que apagado: não volta pra lista */
    return res.status(200).json({ ok: true, banners: (data || []).filter(b => !estaArquivado(b)) });
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
    const bcId = String(body.bc_id || '');
    /* ANTES este DELETE era o bug: ele apagava a memória do aviso automático
       junto com o banner. Na visita seguinte de qualquer pessoa, o servidor
       conferia, não achava a linha, concluía que nunca tinha avisado — e
       recriava o banner E disparava o push de novo pra base inteira. Do lado
       do painel a impressão era de que o "Apagar" não funcionava; do lado de
       quem usa o site, o aviso voltava sozinho. */
    if (ehAvisoAutomatico(bcId)) {
      await sb.from('broadcasts').update({ fim: Date.now() - 1 }).eq('bc_id', bcId);
      return res.status(200).json({ ok: true, arquivado: true });
    }
    await sb.from('broadcasts').delete().eq('bc_id', bcId);
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
