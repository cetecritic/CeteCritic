/* =====================================================================
   REORDENAR PEÇAS DE UMA EDIÇÃO JÁ VOTADA  (remanejar-pecas.js)
   =====================================================================
   O painel recusa reordenar uma edição que já tem votos, e faz certo: as
   notas são gravadas por posição (`s2e3`), então trocar a ordem sem
   reescrever os votos faria cada nota apontar para a peça errada. Isso não
   dá pra fazer com segurança dentro de uma função serverless, que não tem
   transação e pode ser cortada por timeout no meio.

   Este script faz o trabalho inteiro, em dois passos:

     node remanejar-pecas.js 2026
        mostra a ordem atual e escreve remanejar-2026.json

     (você edita o arquivo: mude a ordem das peças dentro de cada noite)

     node remanejar-pecas.js 2026 --aplicar
        reescreve os votos E a ordem das peças, conferindo no fim

   ANTES DE APLICAR, RODE `node backup.js`. O script cobra isso.

   ---------------------------------------------------------------------
   COMO ELE SOBREVIVE A UMA FALHA NO MEIO

   O PostgREST não expõe transação, então não há como reescrever 300 votos
   atomicamente. Em vez de fingir que há, o script grava o progresso num
   arquivo local (`remanejar-2026.progresso.json`) a cada voto reescrito. Se
   cair no meio — internet, Ctrl+C, o que for — rodar de novo continua de
   onde parou, sem reaplicar o remanejamento em quem já foi.

   Reaplicar seria a corrupção clássica desta operação: mover s1e1→s1e2 duas
   vezes leva a nota para s1e3, e não existe backup de meia hora atrás que
   diga quais linhas já tinham sido tocadas.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { chavePosicional, planoDeRemanejamento, aplicarRemanejamento } = require('./api/_pecas');

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SECRET_KEY;
const ANO = Number(process.argv[2]);
const APLICAR = process.argv.includes('--aplicar');

if (!URL_BASE || !CHAVE) { console.error('Faltam SUPABASE_URL e SUPABASE_SECRET_KEY.'); process.exit(1); }
if (!ANO) { console.error('Uso: node remanejar-pecas.js <ano> [--aplicar]'); process.exit(1); }

const cab = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' };
async function api(caminho, opcoes = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...opcoes, headers: { ...cab, ...(opcoes.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

const ARQUIVO = path.join(__dirname, `remanejar-${ANO}.json`);
const PROGRESSO = path.join(__dirname, `remanejar-${ANO}.progresso.json`);

(async () => {
  const pecas = await api(`pecas?select=id,ano,noite,ordem,chave,titulo,turma&ano=eq.${ANO}&limit=10000`);
  if (!pecas.length) { console.error(`Nenhuma peça em ${ANO}.`); process.exit(1); }

  const semChave = pecas.filter(p => !p.chave);
  if (semChave.length) {
    console.error(`\n${semChave.length} peça(s) de ${ANO} estão sem chave. Rode antes:`);
    console.error('  node migrar-peca-chave.js --aplicar\n');
    process.exit(1);
  }
  pecas.sort((a, b) => a.noite - b.noite || a.ordem - b.ordem);

  /* ---------------- passo 1: gerar o arquivo para editar ---------------- */
  if (!APLICAR) {
    const porNoite = {};
    pecas.forEach(p => {
      (porNoite[p.noite] = porNoite[p.noite] || []).push({
        chave: p.chave, titulo: p.titulo, turma: p.turma, posicaoAtual: chavePosicional(p.noite, p.ordem)
      });
    });
    fs.writeFileSync(ARQUIVO, JSON.stringify({
      ano: ANO,
      instrucoes: 'Mude a ORDEM das peças dentro de cada noite. Não edite as chaves, ' +
                  'não acrescente e não remova peças — isto aqui só reordena. ' +
                  'Depois: node remanejar-pecas.js ' + ANO + ' --aplicar',
      noites: porNoite
    }, null, 2), 'utf8');

    console.log(`\nOrdem atual de ${ANO}:\n`);
    Object.keys(porNoite).forEach(n => {
      console.log(`  Noite ${n}`);
      porNoite[n].forEach(p => console.log(`    ${p.posicaoAtual.padEnd(6)} ${(p.turma || '').padEnd(6)} ${p.titulo || '(sem título)'}`));
    });
    console.log(`\nEscrito em remanejar-${ANO}.json — edite a ordem e rode com --aplicar\n`);
    return;
  }

  /* ---------------- passo 2: aplicar ---------------- */
  if (!fs.existsSync(ARQUIVO)) { console.error(`Falta remanejar-${ANO}.json. Rode sem --aplicar primeiro.`); process.exit(1); }
  const desejado = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));

  const antes = pecas.map(p => ({ chave: p.chave, noite: p.noite, ordem: p.ordem }));
  const depois = [];
  for (const noite of Object.keys(desejado.noites)) {
    desejado.noites[noite].forEach((p, i) => depois.push({ chave: p.chave, noite: Number(noite), ordem: i + 1 }));
  }

  /* o arquivo editado tem que conter exatamente as mesmas peças */
  const setA = new Set(antes.map(p => p.chave)), setD = new Set(depois.map(p => p.chave));
  const faltando = [...setA].filter(c => !setD.has(c));
  const sobrando = [...setD].filter(c => !setA.has(c));
  if (faltando.length || sobrando.length) {
    console.error('\nO arquivo não bate com o banco. Este script só REORDENA.');
    if (faltando.length) console.error('  sumiram: ' + faltando.join(', '));
    if (sobrando.length) console.error('  apareceram: ' + sobrando.join(', '));
    process.exit(1);
  }

  const plano = planoDeRemanejamento(antes, depois);
  if (!plano.movidas) { console.log('\nNada mudou de posição. Nada a fazer.\n'); return; }

  console.log(`\n${plano.movidas} peça(s) mudam de posição:\n`);
  Object.entries(plano.mapa).forEach(([de, para]) => console.log(`  ${de} → ${para}`));

  /* backup recente é condição, não sugestão */
  const dirBackups = path.join(__dirname, 'backups');
  const recente = fs.existsSync(dirBackups) && fs.readdirSync(dirBackups)
    .map(d => fs.statSync(path.join(dirBackups, d)).mtimeMs)
    .some(t => Date.now() - t < 24 * 60 * 60 * 1000);
  if (!recente) { console.error('\nNão achei backup das últimas 24 h. Rode `node backup.js` antes.\n'); process.exit(1); }

  const jaFeitas = fs.existsSync(PROGRESSO) ? new Set(JSON.parse(fs.readFileSync(PROGRESSO, 'utf8'))) : new Set();
  if (jaFeitas.size) console.log(`\nRetomando: ${jaFeitas.size} linha(s) já reescritas numa execução anterior.`);

  /* ---- votos ---- */
  const subs = await api(`submissions?select=row_id,grid&year=eq.${ANO}&limit=10000`);
  console.log(`\nReescrevendo ${subs.length} avaliações...`);
  let n = 0;
  for (const s of subs) {
    if (jaFeitas.has(s.row_id)) continue;
    const { grid, conflitos } = aplicarRemanejamento(s.grid, plano.mapa);
    if (conflitos.length) {
      console.error(`\nERRO na avaliação ${s.row_id}: duas notas cairiam em ${conflitos.join(', ')}. Abortado.`);
      process.exit(1);
    }
    await api(`submissions?row_id=eq.${s.row_id}`, { method: 'PATCH', body: JSON.stringify({ grid }) });
    jaFeitas.add(s.row_id);
    fs.writeFileSync(PROGRESSO, JSON.stringify([...jaFeitas]), 'utf8');
    if (++n % 20 === 0) process.stdout.write(`\r  ${n}...`);
  }

  /* ---- palpites ---- */
  const palp = await api(`palpites?select=id,palpites&year=eq.${ANO}&limit=10000`);
  for (const p of palp) {
    const chaveProg = 'palpite:' + p.id;
    if (jaFeitas.has(chaveProg)) continue;
    const { grid } = aplicarRemanejamento(p.palpites, plano.mapa);
    await api(`palpites?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ palpites: grid }) });
    jaFeitas.add(chaveProg);
    fs.writeFileSync(PROGRESSO, JSON.stringify([...jaFeitas]), 'utf8');
  }

  /* ---- e só então a ordem das peças ---- */
  for (const p of depois) {
    const orig = pecas.find(x => x.chave === p.chave);
    if (orig.noite !== p.noite || orig.ordem !== p.ordem) {
      await api(`pecas?id=eq.${orig.id}`, { method: 'PATCH', body: JSON.stringify({ noite: p.noite, ordem: p.ordem }) });
    }
  }

  /* ---- conferência: a soma das notas não pode ter mudado ---- */
  const depoisSubs = await api(`submissions?select=grid&year=eq.${ANO}&limit=10000`);
  const soma = lista => lista.reduce((t, s) => t + Object.values(s.grid || {}).reduce((a, v) => a + (Number(v) || 0), 0), 0);
  const somaAntes = soma(subs), somaDepois = soma(depoisSubs);

  console.log(`\r  ${subs.length} avaliações e ${palp.length} palpites reescritos.        `);
  if (Math.abs(somaAntes - somaDepois) > 0.001) {
    console.error(`\n⚠️  A soma das notas mudou (${somaAntes} → ${somaDepois}). RESTAURE O BACKUP.`);
    process.exit(1);
  }
  fs.unlinkSync(PROGRESSO);
  console.log(`\n✓ Pronto. Soma das notas conferida: ${somaDepois}.`);
  console.log('  Confira /' + ANO + '/index.html — as médias por peça devem ter acompanhado a nova ordem.\n');
})().catch(e => { console.error('\nFalhou:', e.message); console.error('O progresso foi salvo; rodar de novo continua de onde parou.'); process.exit(1); });
