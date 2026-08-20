/* =====================================================================
   BACKUP — despeja o banco inteiro em JSON  (backup.js)
   =====================================================================
   Rode LOCALMENTE, na raiz do projeto, antes de qualquer operação grande:
   migração, limpeza em massa, edição de acervo antigo, e ao fim de cada
   festival.

     Windows (PowerShell):
       $env:SUPABASE_URL="https://xxxx.supabase.co"
       $env:SUPABASE_SECRET_KEY="sb_secret_..."
       node backup.js

     Linux / Mac:
       SUPABASE_URL=... SUPABASE_SECRET_KEY=... node backup.js

   Não instala nada: usa o `fetch` que já vem no Node 18+ e fala direto com
   o PostgREST. Escreve em backups/AAAA-MM-DD-HHMM/, um .json por tabela,
   mais um resumo.json com a contagem de linhas de cada uma.

   POR QUE JSON E NÃO O CSV DO PAINEL: `submissions.grid`, `palpites.palpites`
   e `usuarios.perfil` são jsonb. No CSV eles viram texto com aspas escapadas,
   e na hora de restaurar você descobre — no pior momento possível — que
   precisa desescapar tudo na mão. O JSON volta como saiu.

   ATENÇÃO: o arquivo gerado contém hash de senha e e-mail de todo mundo.
   Guarde fora do repositório (a pasta backups/ já está no .gitignore) e não
   mande por WhatsApp.
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SECRET_KEY;

if (!URL_BASE || !CHAVE) {
  console.error('\nFaltam as variáveis. No PowerShell:\n');
  console.error('  $env:SUPABASE_URL="https://xxxx.supabase.co"');
  console.error('  $env:SUPABASE_SECRET_KEY="sb_secret_..."');
  console.error('  node backup.js\n');
  process.exit(1);
}

/* As duas primeiras são INSUBSTITUÍVEIS: são a memória do festival e não
   existem em nenhum outro lugar. O resto se reconstrói com trabalho. */
const TABELAS = [
  'submissions', 'palpites',
  'usuarios', 'edicoes', 'noites', 'pecas', 'config_site',
  'carimbos', 'reputacao', 'visitas', 'notificacoes',
  'broadcasts', 'agendados', 'push', 'sessoes', 'resets'
];

const PAGINA = 1000;   // o teto do PostgREST — por isso a paginação abaixo

async function lerTabela(tabela) {
  const linhas = [];
  for (let offset = 0; ; offset += PAGINA) {
    const url = `${URL_BASE}/rest/v1/${tabela}?select=*&limit=${PAGINA}&offset=${offset}`;
    const r = await fetch(url, {
      headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}` }
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const lote = await r.json();
    linhas.push(...lote);
    /* o corte de 1000 do PostgREST é SILENCIOSO: um lote cheio nunca prova
       que acabou, só que talvez tenha mais. Por isso o laço só para num
       lote incompleto. */
    if (lote.length < PAGINA) break;
    process.stdout.write(`\r  ${tabela}: ${linhas.length} linhas...`);
  }
  return linhas;
}

(async () => {
  const agora = new Date();
  const carimbo = agora.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const destino = path.join(__dirname, 'backups', carimbo);
  fs.mkdirSync(destino, { recursive: true });

  console.log(`\nBackup em backups/${carimbo}/\n`);
  const resumo = { quando: agora.toISOString(), tabelas: {}, falhas: {} };

  for (const tabela of TABELAS) {
    try {
      const linhas = await lerTabela(tabela);
      fs.writeFileSync(
        path.join(destino, `${tabela}.json`),
        JSON.stringify(linhas, null, 2), 'utf8'
      );
      resumo.tabelas[tabela] = linhas.length;
      console.log(`\r  ✓ ${tabela.padEnd(15)} ${String(linhas.length).padStart(6)} linhas`);
    } catch (e) {
      /* uma tabela que não existe nesta instalação não pode abortar o resto —
         o que importa é submissions e palpites saírem */
      resumo.falhas[tabela] = String(e.message || e);
      console.log(`\r  ✗ ${tabela.padEnd(15)} ${e.message || e}`);
    }
  }

  fs.writeFileSync(path.join(destino, 'resumo.json'), JSON.stringify(resumo, null, 2), 'utf8');

  /* a conferência que transforma "rodei o backup" em "tenho backup" */
  const votos = resumo.tabelas.submissions;
  const palpites = resumo.tabelas.palpites;
  console.log('\n----------------------------------------');
  if (!votos) {
    console.log('⚠️  ATENÇÃO: submissions veio com 0 linhas ou falhou.');
    console.log('   ISTO NÃO É UM BACKUP VÁLIDO. Confira a URL e a chave (tem que ser a SECRET, não a anon).');
    process.exitCode = 1;
  } else {
    console.log(`✓ ${votos} avaliações e ${palpites || 0} palpites salvos.`);
    console.log(`  Pasta: ${destino}`);
    console.log('  Copie para fora do computador (Drive, pendrive) antes de mexer no banco.');
  }
})();
