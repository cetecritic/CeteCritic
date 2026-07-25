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
   (PUSH_SEND_SECRET precisa ser IGUAL ao PUSH_SECRET colado no .gs.) */

const webpush = require('web-push');

/* mesma URL do API_URL do config.js (não é segredo) */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwuwKpZ8XUWKHKlw3ZiPS-1HiWvt6hqwHAFtsLS10Rf_ToI3h_eIaDdXIY-ZlQcUuJLQg/exec';

/* aceita "mailto: <x@y>" (com espaço/colchetes) e devolve "mailto:x@y" */
function limparSubject(s) {
  s = String(s || '').trim();
  const m = s.match(/([^\s<>]+@[^\s<>]+)/);
  if (m) return 'mailto:' + m[1];
  if (/^https?:\/\//.test(s)) return s;
  return 'mailto:cetecritic@gmail.com';
}

async function enviarParaTodos({ title, body, url }) {
  webpush.setVapidDetails(
    limparSubject(process.env.VAPID_SUBJECT),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const secret = process.env.PUSH_SEND_SECRET || '';
  const resp = await fetch(APPS_SCRIPT_URL + '?listaPush=' + encodeURIComponent(secret) + '&_=' + Date.now());
  const data = await resp.json();
  const subs = (data && Array.isArray(data.subs)) ? data.subs : [];

  const payload = JSON.stringify({ title: title || 'CETECritic', body: body || '', url: url || '/index.html' });
  let ok = 0, fail = 0;
  const erros = [];   // guarda o motivo de cada falha (status HTTP do serviço de push)
  await Promise.all(subs.map(async (sub) => {
    try { await webpush.sendNotification(sub, payload); ok++; }
    catch (e) {
      fail++;
      const code = (e && e.statusCode) ? e.statusCode : (e && e.message) ? e.message : String(e);
      erros.push(code);
    }
  }));
  /* resume os motivos: ex. { "410": 2 } = 2 inscrições expiradas */
  const resumoErros = erros.reduce((acc, c) => { const k = String(c); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  return { enviados: ok, falhas: fail, total: subs.length, erros: resumoErros };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'use POST' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const secret = req.headers['x-secret'] || body.secret;
  if (!process.env.PUSH_SEND_SECRET || secret !== process.env.PUSH_SEND_SECRET) {
    res.status(401).json({ ok: false, error: 'não autorizado' }); return;
  }
  try {
    const r = await enviarParaTodos({ title: body.title, body: body.body, url: body.url });
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};

module.exports.enviarParaTodos = enviarParaTodos;
