/* =====================================================================
   CETECRITIC — CRON DE PUSH (Vercel Serverless Function)
   Caminho no projeto: /api/cron-push.js
   =====================================================================
   Chamada automaticamente pelo Vercel Cron (agendado no vercel.json).
   Reusa a mesma função de envio da rota manual. Por padrão NÃO manda nada —
   você define a regra automática aqui (ex.: "uma noite abre hoje → avisa").

   No plano Hobby o cron roda no máximo 1x/dia. O envio MANUAL continua sendo
   o caminho principal; este cron é o "na pior das hipóteses eu automatizo". */

const { enviarParaTodos } = require('./enviar-push');

module.exports = async (req, res) => {
  /* Se você definir a env var CRON_SECRET, o Vercel manda o header
     Authorization: Bearer <CRON_SECRET> — validamos aqui. Sem CRON_SECRET,
     a rota fica aberta (mas não envia nada por padrão). */
  const auth = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    res.status(401).json({ ok: false, error: 'não autorizado' }); return;
  }

  /* ---- SUA REGRA AUTOMÁTICA VAI AQUI ----
     Exemplos:
       - mandar um aviso fixo todo dia;
       - buscar os dados do site e só enviar se uma noite abrir hoje.
     Descomente e ajuste quando quiser ligar o automático: */
  //
  // const r = await enviarParaTodos({
  //   title: 'CETEC Festival',
  //   body: 'Tem novidade no festival — dá uma olhada!',
  //   url: '/index.html'
  // });
  // res.status(200).json({ ok: true, ...r }); return;

  res.status(200).json({ ok: true, msg: 'cron ativo — nenhuma regra automática definida ainda' });
};
