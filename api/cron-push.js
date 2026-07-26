/* =====================================================================
   CETECRITIC — CRON (Vercel) — processa banners/push AGENDADOS
   Caminho: /api/cron-push.js  (agendado no vercel.json)
   =====================================================================
   A cada execução, busca na tabela `agendados` tudo que já passou da hora
   (quando <= agora) e ainda não foi enviado, e dispara:
     - push=true  -> enviarParaTodos (push nos aparelhos + banner no site)
     - push=false -> só o banner no site (broadcasts)
   Depois marca como enviado.

   OBS de plano: no Vercel Hobby o cron roda ~1x/dia, então o agendamento sai
   na próxima execução do cron após a data marcada (granularidade ~diária).
   No Pro dá pra rodar de hora em hora (ajuste o schedule no vercel.json). */

const { enviarParaTodos } = require('./enviar-push');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

module.exports = async (req, res) => {
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    res.status(401).json({ ok: false, error: 'não autorizado' }); return;
  }

  const agora = Date.now();
  let processados = 0, falhas = 0;
  try {
    const { data } = await sb.from('agendados').select('*').eq('enviado', false).lte('quando', agora).limit(50);
    for (const a of (data || [])) {
      try {
        if (a.push) {
          await enviarParaTodos({ title: a.titulo, body: a.corpo, url: a.url, dur: a.dur });
        } else {
          let d = Number(a.dur) || 0; if (d < 0) d = 0; if (d > 120) d = 120;
          await sb.from('broadcasts').insert({
            bc_id: 'bc:' + Date.now() + ':' + a.id, titulo: a.titulo || 'CETECritic',
            corpo: a.corpo || '', url: a.url || '/index.html', ts: Date.now(), dur: d
          });
        }
        await sb.from('agendados').update({ enviado: true }).eq('id', a.id);
        processados++;
      } catch (e) { falhas++; }
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String((e && e.message) || e) }); return;
  }
  res.status(200).json({ ok: true, processados, falhas });
};
