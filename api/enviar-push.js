/* =====================================================================
   CETECRITIC — ENVIO DE PUSH (Vercel Serverless Function)
   Caminho no projeto: /api/enviar-push.js
   =====================================================================
   Envia uma notificação para TODAS as inscrições guardadas na planilha.
   - Chamada MANUAL: POST com { secret, title, body, url } (a página
     enviar-push.html faz isso).
   - Reusada pelo cron em /api/cron-push.js (envio automático).

   Variáveis de ambiente necessárias no Vercel:
     VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SEND_SECRET
     SUPABASE_URL, SUPABASE_SECRET_KEY  (lê/limpa inscrições e grava broadcast) */

const webpush = require('web-push');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }
});

/* aceita "mailto: <x@y>" (com espaço/colchetes) e devolve "mailto:x@y" */
function limparSubject(s) {
  s = String(s || '').trim();
  const m = s.match(/([^\s<>]+@[^\s<>]+)/);
  if (m) return 'mailto:' + m[1];
  if (/^https?:\/\//.test(s)) return s;
  return 'mailto:cetecritic@gmail.com';
}

/* `semBroadcast: true` manda só o push. Serve pra quem já gravou o próprio
   broadcast com um bc_id determinístico (é assim que os avisos automáticos do
   bolão garantem que só saem uma vez) — sem isso sairiam dois banners. */
async function enviarParaTodos({ title, body, url, dur, semBroadcast }) {
  webpush.setVapidDetails(
    limparSubject(process.env.VAPID_SUBJECT),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  // lê as inscrições direto do Supabase
  const { data: rows } = await sb.from('push').select('endpoint,p256dh,auth');
  const subs = (rows || []).filter(r => r.endpoint).map(r => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }));

  const payload = JSON.stringify({ title: title || 'CETECritic', body: body || '', url: url || '/index.html' });
  let ok = 0, fail = 0;
  const erros = [];    // guarda o motivo de cada falha (status HTTP do serviço de push)
  const mortos = [];   // endpoints que responderam 410/404 (inscrição expirada) -> remover
  await Promise.all(subs.map(async (sub) => {
    try { await webpush.sendNotification(sub, payload); ok++; }
    catch (e) {
      fail++;
      const code = (e && e.statusCode) ? e.statusCode : (e && e.message) ? e.message : String(e);
      erros.push(code);
      if (e && (e.statusCode === 410 || e.statusCode === 404) && sub && sub.endpoint) mortos.push(sub.endpoint);
    }
  }));
  /* resume os motivos: ex. { "410": 2 } = 2 inscrições expiradas */
  const resumoErros = erros.reduce((acc, c) => { const k = String(c); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  /* limpa as inscrições mortas do Supabase automaticamente */
  if (mortos.length) {
    try { await sb.from('push').delete().in('endpoint', mortos); }
    catch (e) { /* se falhar, elas serão limpas no próximo envio */ }
  }

  /* registra o aviso como BROADCAST, pra aparecer no site pra todo mundo
     (inclusive quem não tem login/push) de forma transitória */
  if (!semBroadcast) try {
    let d = Number(dur) || 0; if (d < 0) d = 0; if (d > 120) d = 120;
    await sb.from('broadcasts').insert({
      bc_id: 'bc:' + Date.now(), titulo: title || 'CETECritic', corpo: body || '',
      url: url || '/index.html', ts: Date.now(), dur: d
    });
  } catch (e) { /* aviso ainda vai por push mesmo se o broadcast falhar */ }

  return { enviados: ok, falhas: fail, total: subs.length, erros: resumoErros, limpos: mortos.length };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'use POST' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  /* comparação em tempo constante (o `!==` vaza o prefixo correto byte a byte
     pra quem cronometrar as respostas) */
  const secret = String(req.headers['x-secret'] || body.secret || '');
  const esperado = String(process.env.PUSH_SEND_SECRET || '');
  const bs = Buffer.from(secret, 'utf8'), be = Buffer.from(esperado, 'utf8');
  const autorizado = !!esperado && bs.length === be.length && crypto.timingSafeEqual(bs, be);
  if (!autorizado) { res.status(401).json({ ok: false, error: 'não autorizado' }); return; }
  try {
    const r = await enviarParaTodos({ title: body.title, body: body.body, url: body.url, dur: body.dur });
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};

module.exports.enviarParaTodos = enviarParaTodos;
