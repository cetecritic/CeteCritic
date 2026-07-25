/* =====================================================================
   MIGRAÇÃO DE CONTEÚDO: arquivos .js  ->  Supabase
   =====================================================================
   Lê o config.js, e para cada ano lê ANO/edicao.js + ANO/noites/noite-N.js,
   e insere tudo nas tabelas de conteúdo (config_site, edicoes, noites, pecas).

   Rode UMA vez, localmente, na raiz do projeto:
     1) npm install @supabase/supabase-js
     2) defina as variáveis e rode:
        SUPABASE_URL=... SUPABASE_SECRET_KEY=... node migrar-conteudo.js
     (no Windows PowerShell:
        $env:SUPABASE_URL="..."; $env:SUPABASE_SECRET_KEY="..."; node migrar-conteudo.js )

   Pode rodar de novo sem medo: usa upsert (não duplica).
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY nas variáveis de ambiente.');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const raiz = __dirname;

/* roda um arquivo .js num sandbox e devolve as variáveis que ele definiu.
   ATENÇÃO: no `vm`, `const`/`let` do topo NÃO viram propriedade do contexto —
   por isso capturamos os nomes conhecidos numa linha extra no fim do script. */
function rodarJs(arquivo, contextoInicial) {
  const code = fs.readFileSync(arquivo, 'utf8');
  const ctx = Object.assign({ NOITES: {}, __CAP__: {} }, contextoInicial || {});
  vm.createContext(ctx);
  const nomes = ['EDICOES','EDICAO_EM_DESTAQUE','SLOGAN_HOME','RODAPE','EMAIL_CONTATO',
    'ANO_EDICAO_HISTORICA','ANO_VOTOS_ANTIGOS','COOLDOWN_MINUTOS','NOTA_MAXIMA','VAPID_PUBLIC_KEY','EDICAO'];
  const captura = '\n;try{__CAP__={' +
    nomes.map(n => `${n}:(typeof ${n}!=='undefined'?${n}:undefined)`).join(',') + '};}catch(e){}';
  vm.runInContext(code + captura, ctx, { filename: arquivo });
  return Object.assign({}, ctx.__CAP__, { NOITES: ctx.NOITES });
}

async function migrarConfig() {
  const ctx = rodarJs(path.join(raiz, 'config.js'));
  const dados = {
    EDICAO_EM_DESTAQUE: ctx.EDICAO_EM_DESTAQUE,
    SLOGAN_HOME: ctx.SLOGAN_HOME,
    RODAPE: ctx.RODAPE,
    EMAIL_CONTATO: ctx.EMAIL_CONTATO,
    ANO_EDICAO_HISTORICA: ctx.ANO_EDICAO_HISTORICA,
    ANO_VOTOS_ANTIGOS: ctx.ANO_VOTOS_ANTIGOS,
    COOLDOWN_MINUTOS: ctx.COOLDOWN_MINUTOS,
    NOTA_MAXIMA: ctx.NOTA_MAXIMA,
    API_URL: '/api/db',
    VAPID_PUBLIC_KEY: ctx.VAPID_PUBLIC_KEY
  };
  await sb.from('config_site').upsert({ id: 1, dados }, { onConflict: 'id' });
  console.log('config_site migrado.');
  return ctx.EDICOES || [];
}

async function migrarEdicao(cfgEd) {
  const ano = cfgEd.ano;
  const pastaAno = path.join(raiz, String(ano));
  let ed = null;
  const edPath = path.join(pastaAno, 'edicao.js');
  if (fs.existsSync(edPath)) {
    try { ed = rodarJs(edPath).EDICAO || null; } catch (e) { console.warn('  ! erro lendo edicao.js de', ano, e.message); }
  }
  // grava a linha da edição (mistura dados do config.js + do edicao.js)
  const row = {
    ano,
    ordem: cfgEd.ordem != null ? cfgEd.ordem : ano,
    noites: cfgEd.noites || (ed ? 5 : 5),
    em_breve: !!cfgEd.emBreve,
    abre_em: cfgEd.abreEm || null,
    monte_abre_em: cfgEd.monteAbreEm || null,
    titulo: ed ? ed.titulo : ('Cetec Festival ' + ano),
    descricao: ed ? ed.descricao : null,
    episodios_por_noite: ed ? (ed.episodiosPorNoite || 3) : 3,
    inicio: ed ? ed.inicio : null,
    fim_votacao: ed ? ed.fimVotacao : null,
    poster: ed ? ed.poster : null,
    mensagem_fim: ed ? ed.mensagemFim : null,
    sobre: ed ? (ed.sobre || {}) : {},
    abertura: ed ? (ed.abertura || {}) : {},
    extra: {}
  };
  await sb.from('edicoes').upsert(row, { onConflict: 'ano' });
  console.log('  edição', ano, 'migrada' + (cfgEd.emBreve ? ' (em breve)' : ''));

  // noites + peças (só se a edição tem pasta/arquivos)
  if (!cfgEd.emBreve && fs.existsSync(pastaAno)) {
    const nNoites = cfgEd.noites || 5;
    for (let n = 1; n <= nNoites; n++) {
      const nPath = path.join(pastaAno, 'noites', 'noite-' + n + '.js');
      if (!fs.existsSync(nPath)) continue;
      let NOITES = {};
      try { NOITES = rodarJs(nPath).NOITES || {}; } catch (e) { console.warn('    ! erro em noite', n, 'de', ano, e.message); continue; }
      const nd = NOITES[n];
      if (!nd) continue;
      await sb.from('noites').upsert({ ano, noite: n, data: nd.data || null, subtitulo: nd.subtitulo || null }, { onConflict: 'ano,noite' });
      // substitui as peças dessa noite
      await sb.from('pecas').delete().eq('ano', ano).eq('noite', n);
      const pecas = Array.isArray(nd.pecas) ? nd.pecas : [];
      if (pecas.length) {
        await sb.from('pecas').insert(pecas.map((p, i) => ({
          ano, noite: n, ordem: i + 1,
          titulo: p.titulo || '', turma: p.turma || '', sinopse: p.sinopse || '',
          youtube: p.youtube || '', youtube_inicio: Number(p.youtubeInicio) || 0
        })));
      }
      console.log('    noite', n, '—', pecas.length, 'peça(s)');
    }
  }
}

(async () => {
  console.log('Iniciando migração de conteúdo…');
  const edicoes = await migrarConfig();
  for (const cfgEd of edicoes) {
    await migrarEdicao(cfgEd);
  }
  console.log('\\nMigração concluída! Confira as tabelas edicoes / noites / pecas no Supabase.');
})().catch(e => { console.error('Falha na migração:', e); process.exit(1); });
