/* =====================================================================
   PREENCHE pecas.chave — roda UMA VEZ  (migrar-peca-chave.js)
   =====================================================================
   Pré-requisito: `migracao-peca-chave.sql` já rodado no SQL Editor.

     $env:SUPABASE_URL="https://xxxx.supabase.co"
     $env:SUPABASE_SECRET_KEY="sb_secret_..."
     node migrar-peca-chave.js            # mostra o que faria
     node migrar-peca-chave.js --aplicar  # grava

   Não instala nada (fetch do Node 18+). Só preenche peça SEM chave — rodar
   de novo não mexe no que já foi atribuído, que é o ponto inteiro da coisa:
   chave atribuída é chave congelada.

   A ordem de atribuição é (ano, noite, ordem), para que o sufixo de colisão
   (`S1.2023`, `S1.2023-2`) caia sempre na mesma peça se você rodar duas
   vezes em bancos diferentes — produção e um restore de teste, por exemplo.
   ===================================================================== */
const { gerarChave } = require('./api/_pecas');

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SECRET_KEY;
const APLICAR = process.argv.includes('--aplicar');

if (!URL_BASE || !CHAVE) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SECRET_KEY. Veja o cabeçalho deste arquivo.');
  process.exit(1);
}
const cab = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' };

async function api(caminho, opcoes = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...opcoes, headers: { ...cab, ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

(async () => {
  const pecas = await api('pecas?select=id,ano,noite,ordem,titulo,turma,chave&limit=10000');
  pecas.sort((a, b) => a.ano - b.ano || a.noite - b.noite || a.ordem - b.ordem);

  /* chaves já atribuídas continuam reservadas, por ano */
  const usadasPorAno = new Map();
  const doAno = ano => {
    if (!usadasPorAno.has(ano)) usadasPorAno.set(ano, new Set());
    return usadasPorAno.get(ano);
  };
  pecas.forEach(p => { if (p.chave) doAno(p.ano).add(p.chave); });

  const aGravar = [];
  for (const p of pecas) {
    if (p.chave) continue;
    const chave = gerarChave(p.turma, p.ano, doAno(p.ano));
    aGravar.push({ id: p.id, ano: p.ano, chave, rotulo: `${p.ano} n${p.noite}e${p.ordem} ${p.turma || '(sem turma)'} — ${p.titulo || '(sem título)'}` });
  }

  console.log(`\n${pecas.length} peças, ${pecas.length - aGravar.length} já com chave, ${aGravar.length} a preencher.\n`);
  aGravar.slice(0, 12).forEach(x => console.log(`  ${x.chave.padEnd(18)} ${x.rotulo}`));
  if (aGravar.length > 12) console.log(`  ... e mais ${aGravar.length - 12}`);

  const repetidas = aGravar.length - new Set(aGravar.map(x => x.ano + '|' + x.chave)).size;
  if (repetidas) { console.error(`\nERRO: ${repetidas} chave(s) repetida(s) no mesmo ano. Nada foi gravado.`); process.exit(1); }

  if (!aGravar.length) { console.log('\nNada a fazer.'); return; }
  if (!APLICAR) { console.log('\nEnsaio. Para gravar: node migrar-peca-chave.js --aplicar\n'); return; }

  let feitas = 0;
  for (const x of aGravar) {
    await api(`pecas?id=eq.${x.id}`, { method: 'PATCH', body: JSON.stringify({ chave: x.chave }) });
    feitas++;
    if (feitas % 20 === 0) process.stdout.write(`\r  gravadas ${feitas}/${aGravar.length}...`);
  }

  /* confere no banco em vez de confiar no laço */
  const depois = await api('pecas?select=id,chave&limit=10000');
  const semChave = depois.filter(p => !p.chave).length;
  console.log(`\r  gravadas ${feitas}/${aGravar.length}.                    `);
  console.log(semChave ? `\n⚠️  ainda restam ${semChave} peças sem chave — rode de novo.`
                       : `\n✓ todas as ${depois.length} peças têm chave.`);
})().catch(e => { console.error('\nFalhou:', e.message); process.exit(1); });
