/* =====================================================================
   CETEC INTERSÉRIES — API (api/interseries.js)
   =====================================================================
   Função serverless da Vercel, Node. Rota única: /api/interseries.
   GET  = leitura pública (+ ?meu=1, autenticada pela querystring)
   POST = ações do público (apostar) e do painel (tudo o mais)

   NÃO ENCOSTA em api/db.js nem em api/content.js. A única coisa
   compartilhada com o festival é a SESSÃO do usuário (tabelas `usuarios` e
   `sessoes`) e a moderação (`_moderacao.js`): quem está banido ou
   silenciado no CETECritic não aposta aqui.

   Variáveis de ambiente (as mesmas que o resto do projeto já usa):
     SUPABASE_URL          = https://xxxx.supabase.co
     SUPABASE_SECRET_KEY   = sb_secret_...   (chave secreta — só no servidor!)
     RATE_SALT             = (opcional) tempero do hash de IP

   AS QUATRO REGRAS QUE GOVERNAM ESTE ARQUIVO

   1. Todo `select` leva `.limit()` explícito. O PostgREST corta em 1000
      linhas EM SILÊNCIO, sem erro. Já causou bug de produção aqui.
   2. Nunca `ilike` direto em `update`/`delete`. `_` é curinga em LIKE e
      nome de usuário aceita `_`. Padrão: ler com `ilike`, conferir com
      `norm`, escrever nos valores exatos observados.
   3. `is_lancamentos` é APPEND-ONLY. Se aparecer um UPDATE ou DELETE nela
      neste arquivo, é bug. Corrigir é escrever estorno e reliquidar.
   4. Toda decisão de tempo usa o relógio DO SERVIDOR. O cliente recebe
      `serverNow` e obedece; nenhuma trava dele é autoridade.
   ===================================================================== */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const R = require('./_interseries_regras');
const { estadoConta, mensagemBloqueio } = require('./_moderacao');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }
});

const norm = R.norm;
const LIMITE_ALTO = R.LIMITE_ALTO;

/* Grita no log quando um resultado volta exatamente cheio — o sinal de que
   há dado sendo ignorado e a hora de paginar chegou. */
function avisarSeTruncou(nome, data, limite){
  const n = (data || []).length;
  if(n >= (limite || LIMITE_ALTO)){
    console.warn('[interseries] ATENÇÃO: "' + nome + '" voltou com ' + n +
      ' linhas (no limite). Há dados sendo ignorados — hora de paginar.');
  }
  return data || [];
}

const erro = (res, msg, codigo) => res.status(codigo || 400).json({ ok: false, error: msg });

/* =====================================================================
   CONFIG
   ===================================================================== */
let _cfgCache = null, _cfgCacheAt = 0;
const CFG_TTL_MS = 15000;

async function lerConfigIS(){
  if(_cfgCache && (Date.now() - _cfgCacheAt) < CFG_TTL_MS) return _cfgCache;
  try{
    const { data } = await sb.from('is_config').select('dados').eq('id', 1).limit(1);
    const d = (data && data[0] && data[0].dados) ? data[0].dados : {};
    _cfgCache = d; _cfgCacheAt = Date.now();
    return d;
  }catch(e){ return _cfgCache || {}; }
}
/* O interruptor de morte demora até 15s para pegar nas outras instâncias da
   Vercel. É o preço do cache, e é aceitável: desligar o interséries é uma
   decisão de minutos, não de milissegundos. */
function invalidarCacheConfig(){ _cfgCache = null; _cfgCacheAt = 0; }

/* Concorrência otimista no jsonb, mesmo padrão do `config_site` do festival:
   o UPDATE filtra por `dados->>_versao` e devolve 409 se alguém salvou no
   meio. Sem isso, dois admins salvando ao mesmo tempo perdem alteração em
   silêncio. */
async function gravarConfigIS(dados, versaoEsperada){
  const proxima = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  const novo = Object.assign({}, dados, { _versao: proxima });

  const atualQ = await sb.from('is_config').select('dados').eq('id', 1).limit(1);
  const atual = atualQ.data && atualQ.data[0];
  if(!atual){
    const { error } = await sb.from('is_config').insert({ id: 1, dados: novo });
    invalidarCacheConfig();
    return { ok: !error, error: error ? error.message : null, versao: proxima };
  }
  const versaoAtual = (atual.dados && atual.dados._versao) ? String(atual.dados._versao) : null;

  let q = sb.from('is_config').update({ dados: novo }).eq('id', 1);
  if(versaoEsperada && versaoAtual) q = q.eq('dados->>_versao', String(versaoEsperada));

  const { data, error } = await q.select('id');
  if(error) return { ok: false, error: error.message };
  if(versaoEsperada && versaoAtual && (!data || !data.length)){
    return { ok: false, conflito: true, error: 'alguém salvou a configuração enquanto você editava. Recarregue o painel e refaça a alteração — o que você digitou NÃO foi gravado.' };
  }
  invalidarCacheConfig();
  return { ok: true, versao: proxima };
}

/* O que o navegador pode ver. `equipe` e `turmas` NÃO saem daqui: um é a
   lista de quem manda no painel, o outro é o vínculo pessoa→turma. */
function configPublica(cfg){
  const c = R.configComPadrao(cfg);
  return {
    ativo: c.ativo,
    saldo_inicial: c.saldo_inicial,
    mesada_diaria: c.mesada_diaria,
    teto_percentual: c.teto_percentual,
    aposta_minima: c.aposta_minima,
    refresh_ms: c.refresh_ms
  };
}

/* =====================================================================
   SESSÃO E PERMISSÃO
   =====================================================================
   `verificarTokenIS` e `barreiraModeracaoIS` são o MESMO comportamento do
   api/db.js, reescritos aqui porque o db.js não exporta nada (é uma função
   serverless, não um módulo). Se a regra mudar lá, mude aqui: são duas
   cópias declaradas da mesma decisão.
   ===================================================================== */
async function acharUsuario(usuario){
  const alvo = norm(usuario);
  if(!alvo) return null;
  /* ilike + conferência com norm: `_` é curinga em LIKE e nome de usuário
     aceita `_`. Nunca escreva usando o ilike — só leia. */
  const { data } = await sb.from('usuarios').select('usuario,token,admin,perfil').ilike('usuario', usuario).limit(10);
  return (data || []).find(r => norm(r.usuario) === alvo) || null;
}

async function verificarTokenIS(usuario, token){
  if(!usuario || !token) return false;
  const nu = norm(usuario);
  let tokenOk = false;
  try{
    const { data } = await sb.from('sessoes').select('usuario').eq('token', String(token)).limit(5);
    if((data || []).some(r => norm(r.usuario) === nu)) tokenOk = true;
  }catch(e){ /* sem tabela sessoes: cai no legado */ }
  const u = await acharUsuario(usuario);
  if(!u) return false;
  if(!tokenOk && u.token && u.token === String(token)) tokenOk = true;   // legado
  if(!tokenOk) return false;
  if(estadoConta(u.perfil).banido) return false;   // conta suspensa não tem sessão válida
  return true;
}

/* 'interagir' bloqueia suspensa E silenciada. Apostar afeta o bolo dos
   outros, então entra nesse nível. */
async function barreiraModeracaoIS(usuario, nivel){
  const u = await acharUsuario(usuario);
  if(!u) return null;
  const est = estadoConta(u.perfil);
  if(est.banido) return mensagemBloqueio(est);
  if(nivel === 'interagir' && est.silenciado) return mensagemBloqueio(est);
  return null;
}

/* Quem está chamando o PAINEL e qual o papel dele.
   Devolve null para quem não tem papel — inclusive para admin do CETECritic.
   Conceder é ato explícito (ver papelIS em _interseries_regras.js). */
async function identificarEquipeIS(usuario, token){
  if(!usuario || !token) return null;
  if(!(await verificarTokenIS(usuario, token))) return null;
  const cfg = await lerConfigIS();
  const papel = R.papelIS(cfg, usuario);
  if(!papel) return null;
  const u = await acharUsuario(usuario);
  return u ? { usuario: u.usuario, papel } : null;
}

/* =====================================================================
   LIMITE DE TAXA — reusa a tabela `rate_limite` de migracao-seguranca.sql
   Se a tabela não existir, LIBERA TUDO e avisa no log: migração pendente
   não pode derrubar o site no meio do evento.
   ===================================================================== */
let _rateIndisponivel = false;
function hashCurto(s){
  return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 32);
}
/* só o HASH do IP entra na tabela — serve pra contar sem virar cadastro de
   endereços de quem apostou */
function ipDe(req){
  const xf = String((req && req.headers && req.headers['x-forwarded-for']) || '');
  const ip = xf.split(',')[0].trim() || String((req && req.headers && req.headers['x-real-ip']) || '') || 'sem-ip';
  return hashCurto(ip + '|' + (process.env.RATE_SALT || 'cetecritic'));
}
async function limiteTaxa(chave, maximo, janelaMs){
  if(_rateIndisponivel) return { ok: true };
  const agora = Date.now();
  try{
    const { data, error } = await sb.from('rate_limite').select('chave,contagem,janela_ate').eq('chave', chave).limit(1);
    if(error){ _rateIndisponivel = true; console.warn('[interseries] rate_limite indisponível — rode migracao-seguranca.sql'); return { ok: true }; }
    const linha = (data || [])[0];
    if(!linha || Number(linha.janela_ate) <= agora){
      await sb.from('rate_limite').upsert({ chave, contagem: 1, janela_ate: agora + janelaMs }, { onConflict: 'chave' });
      return { ok: true };
    }
    if(Number(linha.contagem) >= maximo){
      return { ok: false, esperar: Math.ceil((Number(linha.janela_ate) - agora) / 1000) };
    }
    await sb.from('rate_limite').update({ contagem: Number(linha.contagem) + 1 }).eq('chave', chave);
    return { ok: true };
  }catch(e){ return { ok: true }; }   // limite nunca derruba a ação
}
function textoEspera(seg){
  if(seg >= 60) return Math.ceil(seg / 60) + ' minuto(s)';
  return seg + ' segundo(s)';
}

/* =====================================================================
   LEITURAS DE APOIO
   ===================================================================== */
async function temporadaAtual(cfg){
  const c = R.configComPadrao(cfg);
  if(c.temporada_atual){
    const { data } = await sb.from('is_temporadas').select('*').eq('id', c.temporada_atual).limit(1);
    if(data && data[0]) return data[0];
  }
  /* sem temporada definida na config: cai na ativa mais recente. Melhor um
     palpite bom do que uma tela vazia. */
  const { data } = await sb.from('is_temporadas').select('*').eq('status', 'ativa')
    .order('id', { ascending: false }).limit(1);
  return (data && data[0]) || null;
}

async function equipesDaTemporada(temporadaId){
  if(!temporadaId) return [];
  const { data } = await sb.from('is_equipes').select('*').eq('temporada_id', temporadaId).limit(LIMITE_ALTO);
  return avisarSeTruncou('is_equipes', data);
}

async function categoriasDaTemporada(temporadaId){
  if(!temporadaId) return [];
  const { data } = await sb.from('is_categorias').select('*').eq('temporada_id', temporadaId)
    .order('ordem', { ascending: true }).limit(LIMITE_ALTO);
  return avisarSeTruncou('is_categorias', data);
}

/* Junta as equipes na partida em JavaScript, e NÃO com embedding do
   PostgREST, de propósito: `is_partidas` tem TRÊS chaves estrangeiras para
   `is_equipes` (equipe_a, equipe_b, vencedor_id), então o embed fica
   ambíguo e só resolve citando o NOME da constraint
   (`is_equipes!is_partidas_equipe_a_fkey`). Isso amarra a API ao nome que o
   Postgres gerou sozinho — e quebra em silêncio no dia em que alguém
   recriar a tabela. As equipes de uma temporada são ~30 linhas: uma leitura
   e um mapa resolvem sem acoplar nada. */
function embutirEquipes(partidas, equipes){
  const porId = {};
  (equipes || []).forEach(e => { porId[String(e.id)] = e; });
  const enxuta = e => e ? { id: e.id, nome: e.nome, sigla: e.sigla, cor: e.cor, escudo: e.escudo } : null;
  return (partidas || []).map(p => Object.assign({}, p, {
    equipe_a_obj: enxuta(porId[String(p.equipe_a)]),
    equipe_b_obj: enxuta(porId[String(p.equipe_b)])
  }));
}

/* Quanto o cliente deve esperar até a próxima atualização. Vem do servidor
   para dar pra afrouxar em produção sem deploy. */
let _cadCache = null, _cadCacheAt = 0;
async function proximaAtualizacao(cfg){
  const c = R.configComPadrao(cfg);
  if(_cadCache && (Date.now() - _cadCacheAt) < 10000) return _cadCache;
  let ms = c.refresh_ms.ocioso;
  try{
    const hoje = R.dataEvento(Date.now());
    const de = new Date(R.inicioDoDiaEvento(hoje)).toISOString();
    const ate = new Date(R.inicioDoDiaEvento(hoje) + 24 * 3600 * 1000).toISOString();
    const { data } = await sb.from('is_partidas').select('status')
      .gte('comeca_em', de).lt('comeca_em', ate).limit(500);
    const lista = data || [];
    if(lista.some(p => p.status === 'ao_vivo')) ms = c.refresh_ms.ao_vivo;
    else if(lista.length) ms = c.refresh_ms.padrao;
  }catch(e){ /* na dúvida, o intervalo ocioso */ }
  _cadCache = ms; _cadCacheAt = Date.now();
  return ms;
}

/* Toda resposta de leitura carrega `serverNow`. É o relógio oficial: o
   cliente guarda o desvio e usa `agora()` para TODA comparação de tempo. */
async function respLeitura(res, obj, cfg){
  return res.status(200).json(Object.assign({ ok: true }, obj, {
    serverNow: Date.now(),
    proximaAtualizacao: await proximaAtualizacao(cfg)
  }));
}

/* =====================================================================
   RAZÃO — saldo, mesada preguiçosa
   ===================================================================== */
async function lancamentosDe(usuario){
  const { data } = await sb.from('is_lancamentos').select('*').eq('usuario', usuario)
    .order('id', { ascending: false }).limit(500);
  return data || [];
}
async function saldoDe(usuario){
  const { data } = await sb.from('is_saldos').select('saldo').eq('usuario', usuario).limit(1);
  return (data && data[0]) ? Number(data[0].saldo) : 0;
}

/* ---------------------------------------------------------------------
   MESADA PREGUIÇOSA — cron feito de tráfego

   Não usa cron: o cron da Vercel no plano Hobby roda uma vez por dia e é
   grosso demais. Na primeira vez que a pessoa abre o site no dia, o
   servidor tenta inserir o lançamento; o ÍNDICE ÚNICO é a garantia de "uma
   vez só", nunca uma verificação prévia — duas abas abertas quebrariam
   qualquer checagem em memória.

   ⚠️ A ORDEM IMPORTA e é fácil errar: o saldo inicial é decidido por
   "a pessoa não tem NENHUM lançamento". Se a mesada entrasse primeiro,
   ninguém nunca receberia o saldo inicial. Por isso a contagem vem antes
   das duas escritas.
   --------------------------------------------------------------------- */
async function garantirCreditos(usuario, cfg, temporada){
  const c = R.configComPadrao(cfg);
  const conta = String(usuario);
  const resultado = { inicialCreditado: false, mesadaCreditada: false, mesadaDia: null };

  const { data: existentes } = await sb.from('is_lancamentos').select('id').eq('usuario', conta).limit(1);
  const contaNova = !(existentes && existentes.length);

  if(contaNova && c.saldo_inicial > 0){
    const { error } = await sb.from('is_lancamentos').upsert({
      usuario: conta, tipo: 'mesada', valor: c.saldo_inicial,
      ref: R.REF.inicial(conta), motivo: 'saldo inicial'
    }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
    if(!error) resultado.inicialCreditado = true;
  }

  /* mesada só durante a temporada ativa, e só dentro da janela dela.
     Quem entra no dia 3 recebe o inicial + as mesadas dos dias restantes,
     sem retroativo: o jogo premia quem apareceu. */
  if(temporada && temporada.status === 'ativa' && c.mesada_diaria > 0){
    const agora = Date.now();
    const comecou = !temporada.comeca_em || agora >= Date.parse(temporada.comeca_em);
    const naoAcabou = !temporada.termina_em || agora <= Date.parse(temporada.termina_em);
    if(comecou && naoAcabou){
      const dia = R.dataEvento(agora);
      resultado.mesadaDia = dia;
      const { error } = await sb.from('is_lancamentos').upsert({
        usuario: conta, tipo: 'mesada', valor: c.mesada_diaria,
        ref: R.REF.mesada(conta, dia), motivo: 'mesada de ' + dia
      }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
      /* `ignoreDuplicates: true` é obrigatório: sem ele o upsert ATUALIZA a
         linha existente em vez de ignorá-la. Daria no mesmo hoje, por acaso,
         e deixaria de dar no dia em que o valor da mesada mudasse. */
      if(!error) resultado.mesadaCreditada = true;
    }
  }
  return resultado;
}

/* =====================================================================
   LIQUIDAÇÃO
   ===================================================================== */
async function lerMercado(id){
  const { data } = await sb.from('is_mercados').select('*').eq('id', id).limit(1);
  return (data && data[0]) || null;
}
async function opcoesDe(mercadoId){
  const { data } = await sb.from('is_opcoes').select('*').eq('mercado_id', mercadoId)
    .order('ordem', { ascending: true }).limit(200);
  return data || [];
}
async function apostasDe(mercadoId){
  const { data } = await sb.from('is_apostas').select('*').eq('mercado_id', mercadoId).limit(LIMITE_ALTO);
  return avisarSeTruncou('is_apostas do mercado ' + mercadoId, data);
}

/* O extrato do bolo é PÚBLICO de propósito: quem apura decide quem ganha
   fichas, e a defesa contra isso não é confiança, é poder conferir. */
function resumoDoBolo(apostas, opcoes){
  const total = apostas.reduce((s, a) => s + Number(a.valor || 0), 0);
  const porOpcao = opcoes.map(o => {
    const doLado = apostas.filter(a => String(a.opcao_id) === String(o.id));
    const soma = doLado.reduce((s, a) => s + Number(a.valor || 0), 0);
    return {
      opcao_id: o.id, rotulo: o.rotulo, equipe_id: o.equipe_id, ordem: o.ordem,
      fichas: soma, apostadores: doLado.length,
      percentual: total ? Math.round(soma * 1000 / total) / 10 : 0
    };
  });
  return { bolo: total, apostadores: apostas.length, opcoes: porOpcao };
}

/* ---------------------------------------------------------------------
   liquidarMercado — idempotente e RETOMÁVEL

   Se morrer no meio, rodar de novo insere só o que faltava: o índice único
   em (usuario, tipo, ref) é que cuida de quem já recebeu. É por isso que a
   tela do dia de jogo pode oferecer "tentar de novo" sem medo.
   --------------------------------------------------------------------- */
async function liquidarMercado(mercadoId, quem){
  const m = await lerMercado(mercadoId);
  if(!m) return { ok: false, error: 'mercado não encontrado' };
  if(m.status === 'cancelado') return { ok: false, error: 'este mercado foi cancelado — não há o que liquidar' };
  if(!m.opcao_vencedora) return { ok: false, error: 'defina a opção vencedora antes de liquidar' };

  const versao = Number(m.versao_liquidacao || 0);
  const opcoes = await opcoesDe(mercadoId);
  if(!opcoes.some(o => String(o.id) === String(m.opcao_vencedora))){
    return { ok: false, error: 'a opção vencedora não pertence a este mercado' };
  }

  const apostas = await apostasDe(mercadoId);
  const rateio = R.ratear(apostas, m.opcao_vencedora);

  const linhas = rateio.premios.map(p => ({
    usuario: p.usuario, tipo: p.tipo, valor: p.valor,
    ref: R.REF.mercado(mercadoId, versao),
    motivo: (p.tipo === 'premio' ? 'prêmio' : 'estorno (ninguém acertou)') + ' — ' + m.titulo
  })).filter(l => l.valor > 0);

  if(rateio.sobra > 0){
    linhas.push({
      usuario: R.CONTA_SISTEMA, tipo: 'sobra', valor: rateio.sobra,
      ref: R.REF.sobra(mercadoId, versao),
      motivo: 'resto de arredondamento — ' + m.titulo
    });
  }

  if(linhas.length){
    const { error } = await sb.from('is_lancamentos')
      .upsert(linhas, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
    if(error) return { ok: false, error: 'falha ao gravar os prêmios: ' + error.message };
  }

  const { error: e2 } = await sb.from('is_mercados')
    .update({ status: 'liquidado', liquidado_em: new Date().toISOString() })
    .eq('id', mercadoId);
  if(e2) return { ok: false, error: 'prêmios gravados, mas o mercado não foi marcado como liquidado: ' + e2.message };

  return {
    ok: true, mercado_id: mercadoId, versao,
    bolo: rateio.bolo, acertos: rateio.acertos, sobra: rateio.sobra,
    pagos: rateio.premios.length,
    /* a invariante do rateio, conferida a cada liquidação. Se um dia
       falhar, é aqui que aparece — não três dias depois no placar. */
    fecha: (rateio.premios.reduce((s, p) => s + p.valor, 0) + rateio.sobra) === rateio.bolo
  };
}

/* ---------------------------------------------------------------------
   reliquidarMercado — o placar foi corrigido

   NADA É APAGADO. Estorna a versão inteira, sobe a versão e liquida de
   novo. O extrato do usuário mostra prêmio → estorno → novo prêmio, e ele
   entende sozinho, sem abrir chamado.

   ⚠️ O sinal do estorno é o INVERSO do que se desfaz: para cancelar um
   prêmio de +400 escreve-se -400. A tabela de tipos da arquitetura mostra
   `estorno` com sinal `+` porque descreve o caso comum (mercado cancelado,
   devolução da aposta). O tipo é rótulo; o sinal é o que conta.
   --------------------------------------------------------------------- */
async function reliquidarMercado(mercadoId, novaOpcao, quem){
  const m = await lerMercado(mercadoId);
  if(!m) return { ok: false, error: 'mercado não encontrado' };
  const v = Number(m.versao_liquidacao || 0);

  const { data: antigos } = await sb.from('is_lancamentos').select('*')
    .eq('ref', R.REF.mercado(mercadoId, v)).limit(LIMITE_ALTO);
  const paraEstornar = (antigos || []).filter(l => Number(l.valor) !== 0);

  if(paraEstornar.length){
    const linhas = paraEstornar.map(l => ({
      usuario: l.usuario, tipo: 'estorno', valor: -Number(l.valor),
      ref: R.REF.mercadoEstorno(mercadoId, v),
      motivo: 'resultado corrigido — desfaz o pagamento de "' + m.titulo + '"'
    }));
    const { error } = await sb.from('is_lancamentos')
      .upsert(linhas, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
    if(error) return { ok: false, error: 'falha ao estornar a liquidação anterior: ' + error.message };
  }

  /* a sobra da versão antiga também volta, senão a conta do sistema fica
     com ficha de um pagamento que não existe mais */
  const { data: sobras } = await sb.from('is_lancamentos').select('*')
    .eq('ref', R.REF.sobra(mercadoId, v)).limit(50);
  if(sobras && sobras.length){
    const linhas = sobras.map(l => ({
      usuario: l.usuario, tipo: 'estorno', valor: -Number(l.valor),
      ref: R.REF.sobra(mercadoId, v) + ':estorno',
      motivo: 'resultado corrigido — desfaz a sobra de "' + m.titulo + '"'
    }));
    await sb.from('is_lancamentos').upsert(linhas, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
  }

  const patch = { versao_liquidacao: v + 1, status: 'fechado', liquidado_em: null };
  if(novaOpcao) patch.opcao_vencedora = novaOpcao;
  const { error: e2 } = await sb.from('is_mercados').update(patch).eq('id', mercadoId);
  if(e2) return { ok: false, error: 'estornos gravados, mas a versão não subiu: ' + e2.message };

  const nova = await liquidarMercado(mercadoId, quem);
  return Object.assign({ estornados: paraEstornar.length, versao_anterior: v }, nova);
}

/* Mercado cancelado: estorno INTEGRAL das apostas. Nunca apaga aposta. */
async function cancelarMercado(mercadoId, motivo){
  const m = await lerMercado(mercadoId);
  if(!m) return { ok: false, error: 'mercado não encontrado' };
  if(m.status === 'liquidado'){
    return { ok: false, error: 'este mercado já foi liquidado. Para desfazer, use "reliquidar" — cancelar não desfaz pagamento.' };
  }
  const apostas = await apostasDe(mercadoId);
  if(apostas.length){
    const linhas = apostas.map(a => ({
      usuario: a.usuario, tipo: 'estorno', valor: Number(a.valor),
      ref: R.REF.mercadoCancelado(mercadoId),
      motivo: 'mercado cancelado' + (motivo ? ' — ' + motivo : '') + ' — ' + m.titulo
    }));
    const { error } = await sb.from('is_lancamentos')
      .upsert(linhas, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
    if(error) return { ok: false, error: 'falha ao estornar as apostas: ' + error.message };
  }
  const { error: e2 } = await sb.from('is_mercados')
    .update({ status: 'cancelado', liquidado_em: new Date().toISOString() }).eq('id', mercadoId);
  if(e2) return { ok: false, error: e2.message };
  return { ok: true, estornadas: apostas.length };
}

/* ---------------------------------------------------------------------
   PROPAGAÇÃO DO CHAVEAMENTO

   Idempotente por construção: escrever o mesmo valor duas vezes não faz
   nada. Roda depois de cada resultado.
   --------------------------------------------------------------------- */
async function propagarChaveamento(partidaId){
  const { data: pd } = await sb.from('is_partidas').select('*').eq('id', partidaId).limit(1);
  const p = pd && pd[0];
  if(!p) return { ok: false, error: 'partida não encontrada' };
  if(p.status !== 'encerrada') return { ok: true, partidas_preenchidas: [], motivo: 'partida não encerrada' };

  const vp = R.vencedorEPerdedor(p);
  if(vp.indefinido){
    /* Adivinhar aqui é pior do que falhar. */
    return { ok: false, error: vp.empate
      ? 'esta partida terminou empatada — informe quem avançou (campo "vencedor") antes de propagar o chaveamento'
      : 'não dá para saber quem venceu esta partida' };
  }

  const { data: destinos } = await sb.from('is_partidas').select('*')
    .or('origem_a_partida.eq.' + partidaId + ',origem_b_partida.eq.' + partidaId).limit(200);

  const preenchidas = [];
  for(const d of (destinos || [])){
    const patch = {};
    if(String(d.origem_a_partida) === String(partidaId)){
      const alvo = d.origem_a_tipo === 'perdedor' ? vp.perdedor : vp.vencedor;
      if(alvo && String(d.equipe_a) !== String(alvo)) patch.equipe_a = alvo;
    }
    if(String(d.origem_b_partida) === String(partidaId)){
      const alvo = d.origem_b_tipo === 'perdedor' ? vp.perdedor : vp.vencedor;
      if(alvo && String(d.equipe_b) !== String(alvo)) patch.equipe_b = alvo;
    }
    if(Object.keys(patch).length){
      const { error } = await sb.from('is_partidas').update(patch).eq('id', d.id);
      if(!error) preenchidas.push(d.id);
    }
  }
  return { ok: true, partidas_preenchidas: preenchidas };
}

/* ---------------------------------------------------------------------
   LIQUIDAÇÃO AUTOMÁTICA DOS MERCADOS DA PARTIDA

   Só o mercado de `vencedor` liquida sozinho: o conjunto de opções dele é
   exatamente {Equipe A, Empate?, Equipe B}, e `is_opcoes.equipe_id` diz sem
   ambiguidade qual é qual.

   `margem` e `livre` NÃO liquidam sozinhos, e isso é decisão, não
   preguiça: a faixa ("A por 1–2", "2–1 A") mora no RÓTULO, que é texto
   livre editável pelo painel. Um resolvedor que lê rótulo erra calado no
   dia em que alguém escrever "A por 1-2" com hífen simples — e errar calado
   numa liquidação é exatamente o que não pode acontecer. Eles vão para a
   fila de liquidação do painel, com prévia do rateio.

   ⚠️ O mercado de VENCEDOR liquida por quem AVANÇOU (pênaltis contam,
   porque lê `vencedor_id`) e o de MARGEM liquida pelo placar do tempo
   normal (então numa final 2×2 decidida nos pênaltis sai "Empate"). Isso
   TEM que estar na página de regras antes da primeira aposta.
   --------------------------------------------------------------------- */
async function liquidarMercadosDaPartida(partidaId, quem){
  const { data: pd } = await sb.from('is_partidas').select('*').eq('id', partidaId).limit(1);
  const p = pd && pd[0];
  if(!p) return { ok: false, error: 'partida não encontrada' };

  const { data: mercados } = await sb.from('is_mercados').select('*')
    .eq('partida_id', partidaId).in('status', ['aberto', 'fechado']).limit(200);

  const liquidados = [], pendentes = [], falhas = [];
  const empate = p.placar_a != null && p.placar_b != null && Number(p.placar_a) === Number(p.placar_b);
  const vp = R.vencedorEPerdedor(p);

  for(const m of (mercados || [])){
    if(m.tipo !== 'vencedor'){ pendentes.push({ id: m.id, titulo: m.titulo, motivo: 'precisa de apuração manual' }); continue; }
    const opcoes = await opcoesDe(m.id);
    let vencedora = null;
    if(empate && !p.vencedor_id){
      vencedora = opcoes.find(o => !o.equipe_id);            // a opção "Empate"
    } else if(!vp.indefinido){
      vencedora = opcoes.find(o => String(o.equipe_id) === String(vp.vencedor));
    }
    if(!vencedora){
      pendentes.push({ id: m.id, titulo: m.titulo, motivo: 'nenhuma opção corresponde ao resultado' });
      continue;
    }
    const up = await sb.from('is_mercados').update({ opcao_vencedora: vencedora.id }).eq('id', m.id);
    if(up.error){ falhas.push({ id: m.id, error: up.error.message }); continue; }
    const r = await liquidarMercado(m.id, quem);
    if(r.ok) liquidados.push(m.id); else falhas.push({ id: m.id, error: r.error });
  }
  return {
    ok: falhas.length === 0,
    error: falhas.length ? ('falha em ' + falhas.length + ' mercado(s)') : undefined,
    mercados_liquidados: liquidados, mercados_pendentes: pendentes, falhas
  };
}

/* =====================================================================
   GET — leitura pública
   ===================================================================== */
async function handleGet(req, res){
  const q = req.query || {};
  const cfg = await lerConfigIS();
  const c = R.configComPadrao(cfg);

  /* INTERRUPTOR DE MORTE. Existe para o caso de o interséries dar problema
     durante a semana do festival de teatro, que tem prioridade absoluta.
     Sair do ar é uma flag, nunca um deploy às pressas. */
  if(!c.ativo){
    return res.status(200).json({ ok: true, ativo: false, serverNow: Date.now(), proximaAtualizacao: 60000 });
  }

  const temporada = await temporadaAtual(cfg);

  /* ---- ?estado=1 ---- */
  if(q.estado){
    const categorias = await categoriasDaTemporada(temporada && temporada.id);
    return respLeitura(res, {
      config: configPublica(cfg),
      temporada,
      categorias,
      equipes: await equipesDaTemporada(temporada && temporada.id)
    }, cfg);
  }

  /* ---- ?partidas=1 ---- */
  if(q.partidas){
    if(!temporada) return respLeitura(res, { partidas: [], temporada: null }, cfg);
    const categorias = await categoriasDaTemporada(temporada.id);
    let ids = categorias.map(x => x.id);
    if(q.categoria){
      const alvo = categorias.find(x => String(x.slug) === String(q.categoria) || String(x.id) === String(q.categoria));
      if(!alvo) return erro(res, 'categoria não encontrada');
      ids = [alvo.id];
    }
    if(!ids.length) return respLeitura(res, { partidas: [] }, cfg);

    /* o .limit() desta consulta é aplicado no fim da cadeia (linha do
       `await sel...`), porque os filtros opcionais entram no meio. Se você
       está auditando "todo select tem limit", este é o único que não mostra
       na mesma linha — e ele tem. */
    let sel = sb.from('is_partidas').select('*').in('categoria_id', ids);
    if(q.de)  sel = sel.gte('comeca_em', new Date(q.de).toISOString());
    if(q.ate) sel = sel.lte('comeca_em', new Date(q.ate).toISOString());
    if(q.status) sel = sel.in('status', String(q.status).split(',').map(s => s.trim()).filter(Boolean));
    const limite = Math.min(Math.max(Number(q.limite) || 300, 1), 2000);
    const { data } = await sel.order('comeca_em', { ascending: true }).limit(limite);
    const equipes = await equipesDaTemporada(temporada.id);
    return respLeitura(res, {
      partidas: embutirEquipes(avisarSeTruncou('is_partidas', data, limite), equipes),
      categorias
    }, cfg);
  }

  /* ---- ?partida=<id> ---- */
  if(q.partida){
    const { data: pd } = await sb.from('is_partidas').select('*').eq('id', q.partida).limit(1);
    const p = pd && pd[0];
    if(!p) return erro(res, 'partida não encontrada', 404);

    const { data: catd } = await sb.from('is_categorias').select('*').eq('id', p.categoria_id).limit(1);
    const categoria = (catd && catd[0]) || null;
    const equipes = await equipesDaTemporada(categoria && categoria.temporada_id);
    const [partidaCompleta] = embutirEquipes([p], equipes);

    const { data: fased } = p.fase_id
      ? await sb.from('is_fases').select('*').eq('id', p.fase_id).limit(1) : { data: [] };

    const idsEquipes = [p.equipe_a, p.equipe_b].filter(Boolean);
    const { data: elenco } = idsEquipes.length
      ? await sb.from('is_atletas').select('*').in('equipe_id', idsEquipes).order('numero', { ascending: true }).limit(500)
      : { data: [] };

    const { data: eventos } = await sb.from('is_eventos_partida').select('*')
      .eq('partida_id', p.id).order('minuto', { ascending: true }).limit(500);

    const { data: mercados } = await sb.from('is_mercados').select('*')
      .eq('partida_id', p.id).order('id', { ascending: true }).limit(50);

    const comBolo = [];
    for(const m of (mercados || [])){
      const opcoes = await opcoesDe(m.id);
      const apostas = await apostasDe(m.id);
      comBolo.push(Object.assign({}, m, resumoDoBolo(apostas, opcoes)));
    }
    return respLeitura(res, {
      partida: partidaCompleta, categoria, fase: (fased && fased[0]) || null,
      escalacoes: elenco || [], eventos: eventos || [], mercados: comBolo
    }, cfg);
  }

  /* ---- ?categoria=<slug> ---- */
  if(q.categoria){
    if(!temporada) return erro(res, 'nenhuma temporada ativa', 404);
    const categorias = await categoriasDaTemporada(temporada.id);
    const cat = categorias.find(x => String(x.slug) === String(q.categoria) || String(x.id) === String(q.categoria));
    if(!cat) return erro(res, 'categoria não encontrada', 404);

    const { data: fases } = await sb.from('is_fases').select('*').eq('categoria_id', cat.id)
      .order('ordem', { ascending: true }).limit(100);
    const idsFases = (fases || []).map(f => f.id);
    const { data: grupos } = idsFases.length
      ? await sb.from('is_grupos').select('*').in('fase_id', idsFases).order('ordem', { ascending: true }).limit(100)
      : { data: [] };
    const idsGrupos = (grupos || []).map(g => g.id);
    const { data: grupoEquipes } = idsGrupos.length
      ? await sb.from('is_grupo_equipes').select('*').in('grupo_id', idsGrupos).limit(LIMITE_ALTO)
      : { data: [] };
    const { data: catEquipes } = await sb.from('is_categoria_equipes').select('*')
      .eq('categoria_id', cat.id).limit(LIMITE_ALTO);

    const { data: partidas } = await sb.from('is_partidas').select('*').eq('categoria_id', cat.id)
      .order('comeca_em', { ascending: true }).limit(2000);
    const { data: classe } = await sb.from('is_classificacao').select('*').eq('categoria_id', cat.id).limit(LIMITE_ALTO);

    /* ⚠️ O MERGE COM ZEROS ACONTECE AQUI, e não é opcional.
       `is_classificacao` é um GROUP BY, e GROUP BY não inventa linha:
       equipe que ainda não jogou não aparece. Sem este merge a tabela
       nasce vazia no primeiro dia — o que parece bug e não é. */
    const equipes = await equipesDaTemporada(temporada.id);
    const idsDaCategoria = (catEquipes || []).map(x => x.equipe_id);
    const classificacao = [];
    if(idsGrupos.length){
      for(const g of grupos){
        const daqui = (grupoEquipes || []).filter(x => String(x.grupo_id) === String(g.id)).map(x => x.equipe_id);
        const linhas = (classe || []).filter(l => String(l.grupo_id) === String(g.id));
        R.mesclarClassificacao(daqui, linhas).forEach(l => classificacao.push(Object.assign({ grupo_id: g.id }, l)));
      }
    } else {
      const linhas = (classe || []).filter(l => l.grupo_id == null);
      R.mesclarClassificacao(idsDaCategoria, linhas).forEach(l => classificacao.push(Object.assign({ grupo_id: null }, l)));
    }

    const { data: artilharia } = await sb.from('is_artilharia').select('*').eq('categoria_id', cat.id)
      .order('gols', { ascending: false }).limit(200);
    const idsAtletas = (artilharia || []).map(a => a.atleta_id).filter(Boolean);
    const { data: atletas } = idsAtletas.length
      ? await sb.from('is_atletas').select('id,nome,equipe_id,numero').in('id', idsAtletas).limit(500)
      : { data: [] };

    return respLeitura(res, {
      categoria: cat, fases: fases || [], grupos: grupos || [],
      grupo_equipes: grupoEquipes || [], categoria_equipes: catEquipes || [],
      equipes, classificacao,
      partidas: embutirEquipes(partidas || [], equipes),
      artilharia: artilharia || [], atletas: atletas || []
    }, cfg);
  }

  /* ---- ?equipe=<id> ---- */
  if(q.equipe){
    const { data: ed } = await sb.from('is_equipes').select('*').eq('id', q.equipe).limit(1);
    const eq = ed && ed[0];
    if(!eq) return erro(res, 'equipe não encontrada', 404);

    const { data: elenco } = await sb.from('is_atletas').select('*').eq('equipe_id', eq.id)
      .order('numero', { ascending: true }).limit(200);
    const { data: partidas } = await sb.from('is_partidas').select('*')
      .or('equipe_a.eq.' + eq.id + ',equipe_b.eq.' + eq.id)
      .order('comeca_em', { ascending: true }).limit(500);

    const equipes = await equipesDaTemporada(eq.temporada_id);
    const jogadas = (partidas || []).filter(p => p.status === 'encerrada' && p.placar_a != null && p.placar_b != null);
    let v = 0, e = 0, d = 0, gp = 0, gc = 0;
    jogadas.forEach(p => {
      const souA = String(p.equipe_a) === String(eq.id);
      const meu = souA ? Number(p.placar_a) : Number(p.placar_b);
      const dele = souA ? Number(p.placar_b) : Number(p.placar_a);
      gp += meu; gc += dele;
      if(meu > dele) v++; else if(meu === dele) e++; else d++;
    });
    return respLeitura(res, {
      equipe: eq, elenco: elenco || [],
      partidas: embutirEquipes(partidas || [], equipes),
      aproveitamento: {
        jogos: jogadas.length, vitorias: v, empates: e, derrotas: d,
        gols_pro: gp, gols_contra: gc, saldo: gp - gc,
        /* pontos por vitória variam por categoria; aqui é o aproveitamento
           simples de 3-1-0, só para a página da equipe */
        percentual: jogadas.length ? Math.round((v * 3 + e) * 1000 / (jogadas.length * 3)) / 10 : 0
      }
    }, cfg);
  }

  /* ---- ?placar=1&por=individual|turma ---- */
  if(q.placar){
    const { data } = await sb.from('is_saldos').select('*')
      .order('saldo', { ascending: false }).limit(400);
    const linhas = (data || []).filter(l => l.usuario !== R.CONTA_SISTEMA);

    if(String(q.por) === 'turma'){
      /* O vínculo pessoa→turma mora em `is_config.dados.turmas`, um mapa
         { usuario: SIGLA } que o painel edita. Foi a saída de menor
         acoplamento: `usuarios.papel`/`perfil` são território do festival,
         e criar tabela nova para uma lista de 200 linhas não se paga.
         Quem não está no mapa aparece só no placar individual. */
      const mapa = (cfg && cfg.turmas && typeof cfg.turmas === 'object') ? cfg.turmas : {};
      const porNorm = {};
      for(const k in mapa) porNorm[norm(k)] = String(mapa[k] || '').trim().toUpperCase();
      const acc = {};
      let semTurma = 0;
      linhas.forEach(l => {
        const t = porNorm[norm(l.usuario)];
        if(!t){ semTurma++; return; }
        if(!acc[t]) acc[t] = { turma: t, saldo: 0, pessoas: 0 };
        acc[t].saldo += Number(l.saldo || 0);
        acc[t].pessoas++;
      });
      const turmas = Object.values(acc).sort((a, b) => b.saldo - a.saldo).slice(0, 200)
        .map((t, i) => Object.assign({ posicao: i + 1 }, t));
      return respLeitura(res, { por: 'turma', placar: turmas, sem_turma: semTurma }, cfg);
    }
    return respLeitura(res, {
      por: 'individual',
      placar: linhas.slice(0, 200).map((l, i) => ({
        posicao: i + 1, usuario: l.usuario, saldo: Number(l.saldo || 0), lancamentos: Number(l.lancamentos || 0)
      }))
    }, cfg);
  }

  /* ---- ?mercados=1 ---- */
  if(q.mercados){
    if(!temporada) return respLeitura(res, { mercados: [] }, cfg);
    const status = q.status ? String(q.status).split(',').map(s => s.trim()).filter(Boolean) : ['aberto'];
    const { data: mercados } = await sb.from('is_mercados').select('*')
      .eq('temporada_id', temporada.id).in('status', status)
      .order('fecha_em', { ascending: true }).limit(300);

    const idsPartidas = (mercados || []).map(m => m.partida_id).filter(Boolean);
    const { data: partidas } = idsPartidas.length
      ? await sb.from('is_partidas').select('*').in('id', idsPartidas).limit(500) : { data: [] };
    const equipes = await equipesDaTemporada(temporada.id);
    const partidasPorId = {};
    embutirEquipes(partidas || [], equipes).forEach(p => { partidasPorId[String(p.id)] = p; });

    const saida = [];
    for(const m of (mercados || [])){
      const opcoes = await opcoesDe(m.id);
      const apostas = await apostasDe(m.id);
      saida.push(Object.assign({}, m, resumoDoBolo(apostas, opcoes), {
        partida: m.partida_id ? (partidasPorId[String(m.partida_id)] || null) : null
      }));
    }
    return respLeitura(res, { mercados: saida }, cfg);
  }

  /* ---- ?meu=1&user=&token=  (autenticada; GET não tem corpo) ---- */
  if(q.meu){
    if(!(await verificarTokenIS(q.user, q.token))) return erro(res, 'sessão inválida — entre de novo', 403);
    const u = await acharUsuario(q.user);
    const conta = u.usuario;

    const creditos = await garantirCreditos(conta, cfg, temporada);
    const extrato = await lancamentosDe(conta);
    const saldo = extrato.reduce((s, l) => s + Number(l.valor || 0), 0);

    const { data: apostas } = await sb.from('is_apostas').select('*').eq('usuario', conta)
      .order('id', { ascending: false }).limit(300);
    const idsMercados = (apostas || []).map(a => a.mercado_id);
    const { data: mercados } = idsMercados.length
      ? await sb.from('is_mercados').select('*').in('id', idsMercados).limit(300) : { data: [] };
    const idsOpcoes = (apostas || []).map(a => a.opcao_id);
    const { data: opcoes } = idsOpcoes.length
      ? await sb.from('is_opcoes').select('*').in('id', idsOpcoes).limit(300) : { data: [] };

    return respLeitura(res, {
      usuario: conta, saldo,
      teto: R.tetoDaAposta(saldo, c.teto_percentual),
      apostas: apostas || [], mercados: mercados || [], opcoes: opcoes || [],
      extrato,
      mesadaCreditada: creditos.mesadaCreditada, mesadaDia: creditos.mesadaDia,
      inicialCreditado: creditos.inicialCreditado
    }, cfg);
  }

  return erro(res, 'parâmetro inválido — use ?estado=1, ?partidas=1, ?partida=<id>, ?categoria=<slug>, ?equipe=<id>, ?placar=1, ?mercados=1 ou ?meu=1');
}

/* =====================================================================
   POST — ações do público
   ===================================================================== */
async function acaoApostar(body, req, cfg){
  const c = R.configComPadrao(cfg);
  if(!c.ativo) return { ok: false, error: 'as apostas do interséries estão desligadas no momento' };
  if(!(await verificarTokenIS(body.user, body.token))) return { ok: false, error: 'sessão inválida — entre de novo' };

  const bloqueio = await barreiraModeracaoIS(body.user, 'interagir');
  if(bloqueio) return { ok: false, error: bloqueio };

  const u = await acharUsuario(body.user);
  const conta = u.usuario;

  /* limite de taxa antes de qualquer escrita */
  const lu = await limiteTaxa(R.LIMITES_IS.aposta_usuario.prefixo + norm(conta),
                              R.LIMITES_IS.aposta_usuario.maximo, R.LIMITES_IS.aposta_usuario.janelaMs);
  if(!lu.ok) return { ok: false, error: 'muitas apostas seguidas. Tente de novo em ' + textoEspera(lu.esperar) + '.' };
  const li = await limiteTaxa(R.LIMITES_IS.aposta_ip.prefixo + ipDe(req),
                              R.LIMITES_IS.aposta_ip.maximo, R.LIMITES_IS.aposta_ip.janelaMs);
  if(!li.ok) return { ok: false, error: 'muitas apostas desta origem. Tente de novo em ' + textoEspera(li.esperar) + '.' };

  const m = await lerMercado(body.mercado_id);
  if(!m) return { ok: false, error: 'mercado não encontrado' };
  if(m.status !== 'aberto') return { ok: false, error: 'este mercado não está mais aberto' };

  /* ---- O FECHAMENTO É AQUI, NO SERVIDOR, E A MAIS RESTRITIVA VENCE ----
     A contagem regressiva da tela é cortesia. Adiantar o relógio do
     computador não libera nada. */
  const agora = Date.now();
  if(agora >= Date.parse(m.fecha_em)) return { ok: false, error: 'este mercado já fechou' };
  if(m.partida_id){
    const { data: pd } = await sb.from('is_partidas').select('comeca_em,status').eq('id', m.partida_id).limit(1);
    const p = pd && pd[0];
    if(p && p.comeca_em && agora >= Date.parse(p.comeca_em)){
      return { ok: false, error: 'a partida já começou — as apostas fecharam' };
    }
    if(p && ['encerrada','cancelada','wo'].indexOf(p.status) >= 0){
      return { ok: false, error: 'esta partida não aceita mais apostas' };
    }
  }

  const opcoes = await opcoesDe(m.id);
  const opcao = opcoes.find(o => String(o.id) === String(body.opcao_id));
  if(!opcao) return { ok: false, error: 'esta opção não pertence a este mercado' };

  const saldoAtual = await saldoDe(conta);
  const valor = Number(body.valor);

  /* Reajuste: já existe aposta desta pessoa neste mercado.
     O teto e o saldo são conferidos contra o saldo COM a aposta anterior
     devolvida — senão reajustar de 100 para 120 seria recusado por "saldo
     insuficiente" com 100 fichas travadas na própria aposta que se está
     trocando. */
  const { data: jad } = await sb.from('is_apostas').select('*')
    .eq('usuario', conta).eq('mercado_id', m.id).limit(1);
  const ja = jad && jad[0];
  const saldoBase = ja ? saldoAtual + Number(ja.valor) : saldoAtual;

  const problema = R.validarValorAposta(valor, saldoBase, cfg);
  if(problema) return { ok: false, error: problema };

  if(ja){
    /* NUNCA dois débitos vivos: estorna o anterior, atualiza a linha,
       debita o novo. A versão sobe para a ref não colidir. */
    const versaoAnterior = Number(ja.versao || 0);
    const est = await sb.from('is_lancamentos').upsert({
      usuario: conta, tipo: 'estorno', valor: Number(ja.valor),
      ref: R.REF.apostaEstorno(ja.id, versaoAnterior),
      motivo: 'reajuste de aposta — ' + m.titulo
    }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
    if(est.error) return { ok: false, error: 'não consegui estornar a aposta anterior: ' + est.error.message };

    const novaVersao = versaoAnterior + 1;
    const up = await sb.from('is_apostas').update({
      opcao_id: opcao.id, valor, versao: novaVersao, ts: new Date().toISOString()
    }).eq('id', ja.id);
    if(up.error) return { ok: false, error: up.error.message };

    const deb = await sb.from('is_lancamentos').upsert({
      usuario: conta, tipo: 'aposta', valor: -valor,
      ref: R.REF.apostaDebito(ja.id, novaVersao),
      motivo: 'aposta em "' + opcao.rotulo + '" — ' + m.titulo
    }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
    if(deb.error) return { ok: false, error: deb.error.message };

    return { ok: true, saldo: await saldoDe(conta), aposta: { id: ja.id, valor, opcao_id: opcao.id }, reajuste: true };
  }

  /* aposta nova: primeiro a linha (para ter o id), depois o débito com a
     ref derivada dele. Se morrer entre as duas, a próxima chamada de
     `apostar` cai no caminho de reajuste e conserta sozinha. */
  const ins = await sb.from('is_apostas').insert({
    usuario: conta, mercado_id: m.id, opcao_id: opcao.id, valor
  }).select('*');
  if(ins.error){
    if(String(ins.error.message || '').indexOf('is_aposta_unica') >= 0){
      return { ok: false, error: 'você já tem uma aposta neste mercado — recarregue a página' };
    }
    return { ok: false, error: ins.error.message };
  }
  const nova = ins.data[0];
  const deb = await sb.from('is_lancamentos').upsert({
    usuario: conta, tipo: 'aposta', valor: -valor,
    ref: R.REF.apostaDebito(nova.id, 0),
    motivo: 'aposta em "' + opcao.rotulo + '" — ' + m.titulo
  }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
  if(deb.error) return { ok: false, error: deb.error.message };

  return { ok: true, saldo: await saldoDe(conta), aposta: { id: nova.id, valor, opcao_id: opcao.id } };
}

async function acaoCancelarAposta(body, req, cfg){
  const c = R.configComPadrao(cfg);
  if(!c.ativo) return { ok: false, error: 'as apostas do interséries estão desligadas no momento' };
  if(!(await verificarTokenIS(body.user, body.token))) return { ok: false, error: 'sessão inválida — entre de novo' };
  const u = await acharUsuario(body.user);
  const conta = u.usuario;

  const { data: ad } = await sb.from('is_apostas').select('*')
    .eq('usuario', conta).eq('mercado_id', body.mercado_id).limit(1);
  const a = ad && ad[0];
  if(!a) return { ok: false, error: 'você não tem aposta neste mercado' };

  const m = await lerMercado(a.mercado_id);
  if(!m || m.status !== 'aberto') return { ok: false, error: 'só dá para cancelar enquanto o mercado está aberto' };
  if(Date.now() >= Date.parse(m.fecha_em)) return { ok: false, error: 'este mercado já fechou' };

  const est = await sb.from('is_lancamentos').upsert({
    usuario: conta, tipo: 'estorno', valor: Number(a.valor),
    ref: R.REF.apostaEstorno(a.id, Number(a.versao || 0)),
    motivo: 'aposta cancelada — ' + m.titulo
  }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
  if(est.error) return { ok: false, error: est.error.message };

  /* a linha de is_apostas sai; o razão fica. O histórico do dinheiro é o
     razão, e ele continua contando a história inteira. */
  const del = await sb.from('is_apostas').delete().eq('id', a.id);
  if(del.error) return { ok: false, error: del.error.message };

  return { ok: true, saldo: await saldoDe(conta) };
}

/* =====================================================================
   POST — ações do painel
   ===================================================================== */

/* Upsert por chave natural: lê com filtros exatos, confere, escreve pelo id
   observado. Nunca ilike em update. */
async function acharEquipePorSigla(temporadaId, sigla){
  const alvo = String(sigla || '').trim().toUpperCase();
  if(!alvo) return null;
  const { data } = await sb.from('is_equipes').select('*').eq('temporada_id', temporadaId).limit(LIMITE_ALTO);
  return (data || []).find(e => String(e.sigla || '').trim().toUpperCase() === alvo) || null;
}
async function acharCategoriaPorSlug(temporadaId, slug){
  const alvo = String(slug || '').trim().toLowerCase();
  if(!alvo) return null;
  const { data } = await sb.from('is_categorias').select('*').eq('temporada_id', temporadaId).limit(LIMITE_ALTO);
  return (data || []).find(x => String(x.slug || '').trim().toLowerCase() === alvo) || null;
}
async function acharOuCriarFase(categoriaId, nome, tipo){
  const alvo = String(nome || '').trim();
  const { data } = await sb.from('is_fases').select('*').eq('categoria_id', categoriaId).limit(200);
  const achada = (data || []).find(f => String(f.nome || '').trim().toLowerCase() === alvo.toLowerCase());
  if(achada) return achada;
  const ordem = (data || []).length;
  const ins = await sb.from('is_fases').insert({
    categoria_id: categoriaId, nome: alvo, tipo: tipo || 'classificatoria', ordem
  }).select('*');
  return ins.data ? ins.data[0] : null;
}
async function acharOuCriarGrupo(faseId, nome){
  const alvo = String(nome || '').trim();
  if(!alvo) return null;
  const { data } = await sb.from('is_grupos').select('*').eq('fase_id', faseId).limit(200);
  const achado = (data || []).find(g => String(g.nome || '').trim().toLowerCase() === alvo.toLowerCase());
  if(achado) return achado;
  const ins = await sb.from('is_grupos').insert({ fase_id: faseId, nome: alvo, ordem: (data || []).length }).select('*');
  return ins.data ? ins.data[0] : null;
}

/* Data + hora do CSV viram timestamptz no fuso do evento, fixo em -03:00. */
function instanteDoEvento(data, hora){
  const d = String(data || '').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const h = /^\d{1,2}:\d{2}$/.test(String(hora || '').trim()) ? String(hora).trim().padStart(5, '0') : '00:00';
  const t = Date.parse(d + 'T' + h + ':00' + R.FUSO_EVENTO);
  return isFinite(t) ? new Date(t).toISOString() : null;
}

/* ---------------------------------------------------------------------
   IMPORTAÇÃO DE CSV

   O parsing acontece NO CLIENTE; aqui chegam objetos já estruturados. Assim
   a validação de formato dá feedback instantâneo e o servidor cuida só das
   regras de negócio.

   AS REGRAS, e elas são o que separa uma ferramenta útil de uma armadilha:
     · pré-visualização é o PADRÃO (`gravar` só grava se vier true);
     · NUNCA apaga — linha que existe no banco e sumiu do CSV fica em paz.
       Importar não é sincronizar;
     · upsert por CHAVE NATURAL, nunca por posição no arquivo;
     · um erro não derruba o lote: a linha 14 vira erro da 14, as outras
       entram.
   --------------------------------------------------------------------- */
async function acaoImportarCsv(body, eu){
  const tipo = String(body.tipo || '');
  const linhas = Array.isArray(body.linhas) ? body.linhas : [];
  const gravar = body.gravar === true;
  const temporadaId = Number(body.temporada_id);
  if(!temporadaId) return { ok: false, error: 'informe a temporada' };
  if(!linhas.length) return { ok: false, error: 'o arquivo não tem nenhuma linha de dados' };
  if(linhas.length > 5000) return { ok: false, error: 'arquivo grande demais (máximo 5000 linhas por importação)' };

  const lim = await limiteTaxa(R.LIMITES_IS.csv_usuario.prefixo + norm(eu.usuario),
                               R.LIMITES_IS.csv_usuario.maximo, R.LIMITES_IS.csv_usuario.janelaMs);
  if(!lim.ok) return { ok: false, error: 'muitas importações seguidas. Tente de novo em ' + textoEspera(lim.esperar) + '.' };

  const relatorio = [];
  const resumo = { criar: 0, atualizar: 0, ignorar: 0, erro: 0 };
  const conta = (acao) => { resumo[acao] = (resumo[acao] || 0) + 1; };

  const campo = (l, nome) => {
    const v = l[nome];
    return (v === undefined || v === null) ? '' : String(v).trim();
  };

  for(let i = 0; i < linhas.length; i++){
    const n = i + 1;
    const l = linhas[i] || {};
    try{
      /* ---------------- equipes ---------------- */
      if(tipo === 'equipes'){
        const sigla = campo(l, 'sigla').toUpperCase();
        const nome = campo(l, 'nome');
        if(!sigla || !nome){ relatorio.push({ n, acao: 'erro', erro: 'sigla e nome são obrigatórios' }); conta('erro'); continue; }
        const atual = await acharEquipePorSigla(temporadaId, sigla);
        const dados = {
          temporada_id: temporadaId, sigla, nome,
          turma: campo(l, 'turma') || null, serie: campo(l, 'serie') || null,
          cor: campo(l, 'cor') || null, escudo: campo(l, 'escudo') || null
        };
        if(!atual){
          if(gravar) await sb.from('is_equipes').insert(dados);
          relatorio.push({ n, acao: 'criar', dados }); conta('criar');
        } else {
          const mudou = ['nome','turma','serie','cor','escudo'].some(k => (atual[k] || null) !== (dados[k] || null));
          if(!mudou){ relatorio.push({ n, acao: 'ignorar', dados }); conta('ignorar'); }
          else {
            if(gravar) await sb.from('is_equipes').update(dados).eq('id', atual.id);
            relatorio.push({ n, acao: 'atualizar', de: atual, para: dados }); conta('atualizar');
          }
        }
        continue;
      }

      /* ---------------- atletas ---------------- */
      if(tipo === 'atletas'){
        const sigla = campo(l, 'equipe').toUpperCase();
        const nome = campo(l, 'nome');
        if(!sigla || !nome){ relatorio.push({ n, acao: 'erro', erro: 'equipe e nome são obrigatórios' }); conta('erro'); continue; }
        const eq = await acharEquipePorSigla(temporadaId, sigla);
        if(!eq){ relatorio.push({ n, acao: 'erro', erro: "equipe '" + sigla + "' não existe nesta temporada" }); conta('erro'); continue; }
        const { data: existentes } = await sb.from('is_atletas').select('*').eq('equipe_id', eq.id).limit(500);
        const atual = (existentes || []).find(a => norm(a.nome) === norm(nome));
        const numero = campo(l, 'numero') ? Number(campo(l, 'numero')) : null;
        const dados = { temporada_id: temporadaId, equipe_id: eq.id, nome, numero, posicao: campo(l, 'posicao') || null };
        if(!atual){
          if(gravar) await sb.from('is_atletas').insert(dados);
          relatorio.push({ n, acao: 'criar', dados }); conta('criar');
        } else {
          const mudou = (atual.numero || null) !== numero || (atual.posicao || null) !== dados.posicao;
          if(!mudou){ relatorio.push({ n, acao: 'ignorar', dados }); conta('ignorar'); }
          else {
            if(gravar) await sb.from('is_atletas').update(dados).eq('id', atual.id);
            relatorio.push({ n, acao: 'atualizar', de: atual, para: dados }); conta('atualizar');
          }
        }
        continue;
      }

      /* ---------------- partidas ---------------- */
      if(tipo === 'partidas'){
        const slug = campo(l, 'categoria');
        const cat = await acharCategoriaPorSlug(temporadaId, slug);
        if(!cat){ relatorio.push({ n, acao: 'erro', erro: "categoria '" + slug + "' não existe (use o SLUG, não o nome)" }); conta('erro'); continue; }
        const sa = campo(l, 'equipe_a').toUpperCase(), sbg = campo(l, 'equipe_b').toUpperCase();
        const ea = await acharEquipePorSigla(temporadaId, sa);
        const eb = await acharEquipePorSigla(temporadaId, sbg);
        if(!ea){ relatorio.push({ n, acao: 'erro', erro: "equipe '" + sa + "' não existe nesta temporada" }); conta('erro'); continue; }
        if(!eb){ relatorio.push({ n, acao: 'erro', erro: "equipe '" + sbg + "' não existe nesta temporada" }); conta('erro'); continue; }
        if(String(ea.id) === String(eb.id)){ relatorio.push({ n, acao: 'erro', erro: 'uma equipe não joga contra ela mesma' }); conta('erro'); continue; }

        const dataStr = campo(l, 'data');
        if(!/^\d{4}-\d{2}-\d{2}$/.test(dataStr)){
          relatorio.push({ n, acao: 'erro', erro: "data '" + dataStr + "' fora do formato AAAA-MM-DD" }); conta('erro'); continue;
        }
        const comeca = instanteDoEvento(dataStr, campo(l, 'hora'));
        const fase = await acharOuCriarFase(cat.id, campo(l, 'fase') || 'Fase de grupos', 'classificatoria');
        if(!fase){ relatorio.push({ n, acao: 'erro', erro: "não consegui criar a fase '" + (campo(l, 'fase') || 'Fase de grupos') + "'" }); conta('erro'); continue; }
        const grupo = campo(l, 'grupo') ? await acharOuCriarGrupo(fase.id, campo(l, 'grupo')) : null;

        /* chave natural: categoria + data + equipe_a + equipe_b */
        const { data: doDia } = await sb.from('is_partidas').select('*')
          .eq('categoria_id', cat.id).eq('equipe_a', ea.id).eq('equipe_b', eb.id).limit(50);
        const atual = (doDia || []).find(p => p.comeca_em && R.dataEvento(Date.parse(p.comeca_em)) === dataStr);

        const dados = {
          categoria_id: cat.id, fase_id: fase ? fase.id : null, grupo_id: grupo ? grupo.id : null,
          rodada: campo(l, 'rodada') ? Number(campo(l, 'rodada')) : null,
          equipe_a: ea.id, equipe_b: eb.id,
          comeca_em: comeca, local: campo(l, 'local') || null
        };
        if(!atual){
          if(gravar) await sb.from('is_partidas').insert(dados);
          relatorio.push({ n, acao: 'criar', dados: Object.assign({}, dados, { _rotulo: ea.sigla + ' × ' + eb.sigla }) }); conta('criar');
        } else {
          const mudou = ['fase_id','grupo_id','rodada','comeca_em','local'].some(k => String(atual[k] || '') !== String(dados[k] || ''));
          if(!mudou){ relatorio.push({ n, acao: 'ignorar', dados }); conta('ignorar'); }
          else {
            if(gravar) await sb.from('is_partidas').update(dados).eq('id', atual.id);
            relatorio.push({ n, acao: 'atualizar', de: atual, para: dados }); conta('atualizar');
          }
        }
        continue;
      }

      /* ---------------- resultados ---------------- */
      if(tipo === 'resultados'){
        let alvo = null;
        if(campo(l, 'id')){
          const { data } = await sb.from('is_partidas').select('*').eq('id', Number(campo(l, 'id'))).limit(1);
          alvo = data && data[0];
          if(!alvo){ relatorio.push({ n, acao: 'erro', erro: 'partida id ' + campo(l, 'id') + ' não existe' }); conta('erro'); continue; }
        } else {
          const cat = await acharCategoriaPorSlug(temporadaId, campo(l, 'categoria'));
          if(!cat){ relatorio.push({ n, acao: 'erro', erro: "categoria '" + campo(l, 'categoria') + "' não existe" }); conta('erro'); continue; }
          const ea = await acharEquipePorSigla(temporadaId, campo(l, 'equipe_a').toUpperCase());
          const eb = await acharEquipePorSigla(temporadaId, campo(l, 'equipe_b').toUpperCase());
          if(!ea || !eb){ relatorio.push({ n, acao: 'erro', erro: 'equipe do confronto não existe nesta temporada' }); conta('erro'); continue; }
          const dataStr = campo(l, 'data');
          const { data: cands } = await sb.from('is_partidas').select('*')
            .eq('categoria_id', cat.id).eq('equipe_a', ea.id).eq('equipe_b', eb.id).limit(50);
          alvo = (cands || []).find(p => p.comeca_em && R.dataEvento(Date.parse(p.comeca_em)) === dataStr);
          if(!alvo){ relatorio.push({ n, acao: 'erro', erro: 'não achei a partida ' + campo(l, 'equipe_a') + ' × ' + campo(l, 'equipe_b') + ' em ' + dataStr }); conta('erro'); continue; }
        }

        const pa = campo(l, 'placar_a'), pb = campo(l, 'placar_b');
        if(pa === '' || pb === ''){ relatorio.push({ n, acao: 'erro', erro: 'placar_a e placar_b são obrigatórios' }); conta('erro'); continue; }
        if(!/^\d+$/.test(pa) || !/^\d+$/.test(pb)){ relatorio.push({ n, acao: 'erro', erro: 'placar precisa ser número inteiro' }); conta('erro'); continue; }

        let vencedorId = null;
        if(campo(l, 'vencedor')){
          const ev = await acharEquipePorSigla(temporadaId, campo(l, 'vencedor').toUpperCase());
          if(!ev){ relatorio.push({ n, acao: 'erro', erro: "vencedor '" + campo(l, 'vencedor') + "' não é uma equipe desta temporada" }); conta('erro'); continue; }
          if(String(ev.id) !== String(alvo.equipe_a) && String(ev.id) !== String(alvo.equipe_b)){
            relatorio.push({ n, acao: 'erro', erro: 'o vencedor informado não joga esta partida' }); conta('erro'); continue;
          }
          vencedorId = ev.id;
        } else if(Number(pa) !== Number(pb)){
          vencedorId = Number(pa) > Number(pb) ? alvo.equipe_a : alvo.equipe_b;
        }

        const dados = { placar_a: Number(pa), placar_b: Number(pb), vencedor_id: vencedorId, status: 'encerrada' };
        const igual = Number(alvo.placar_a) === dados.placar_a && Number(alvo.placar_b) === dados.placar_b
                   && String(alvo.vencedor_id || '') === String(dados.vencedor_id || '') && alvo.status === 'encerrada';
        if(igual){ relatorio.push({ n, acao: 'ignorar', dados }); conta('ignorar'); continue; }

        if(gravar){
          const jaLiquidado = alvo.status === 'encerrada';
          await sb.from('is_partidas').update(Object.assign({}, dados, jaLiquidado ? {
            corrigido_em: new Date().toISOString(), corrigido_por: eu.usuario
          } : {})).eq('id', alvo.id);
          await propagarChaveamento(alvo.id);
          /* de propósito NÃO liquida mercado por CSV: importar 60 resultados
             de uma vez e pagar 60 mercados sem ninguém olhar é como se perde
             a confiança de todo mundo de uma vez. A liquidação é um ato
             consciente, na fila do painel. */
        }
        relatorio.push({ n, acao: alvo.status === 'encerrada' ? 'atualizar' : 'criar', de: alvo, para: dados });
        conta(alvo.status === 'encerrada' ? 'atualizar' : 'criar');
        continue;
      }

      /* ---------------- eventos ---------------- */
      if(tipo === 'eventos'){
        const cat = await acharCategoriaPorSlug(temporadaId, campo(l, 'categoria'));
        if(!cat){ relatorio.push({ n, acao: 'erro', erro: "categoria '" + campo(l, 'categoria') + "' não existe" }); conta('erro'); continue; }
        const ea = await acharEquipePorSigla(temporadaId, campo(l, 'equipe_a').toUpperCase());
        const eb = await acharEquipePorSigla(temporadaId, campo(l, 'equipe_b').toUpperCase());
        if(!ea || !eb){ relatorio.push({ n, acao: 'erro', erro: 'equipe do confronto não existe' }); conta('erro'); continue; }
        const dataStr = campo(l, 'data');
        const { data: cands } = await sb.from('is_partidas').select('*')
          .eq('categoria_id', cat.id).eq('equipe_a', ea.id).eq('equipe_b', eb.id).limit(50);
        const alvo = (cands || []).find(p => p.comeca_em && R.dataEvento(Date.parse(p.comeca_em)) === dataStr);
        if(!alvo){ relatorio.push({ n, acao: 'erro', erro: 'não achei a partida em ' + dataStr }); conta('erro'); continue; }

        const nomeAtleta = campo(l, 'atleta');
        const { data: atletas } = await sb.from('is_atletas').select('*')
          .in('equipe_id', [ea.id, eb.id]).limit(500);
        const atleta = (atletas || []).find(a => norm(a.nome) === norm(nomeAtleta));
        if(nomeAtleta && !atleta){ relatorio.push({ n, acao: 'erro', erro: "atleta '" + nomeAtleta + "' não está no elenco das duas equipes" }); conta('erro'); continue; }

        const dados = {
          partida_id: alvo.id, atleta_id: atleta ? atleta.id : null,
          tipo: campo(l, 'tipo') || 'gol',
          minuto: campo(l, 'minuto') ? Number(campo(l, 'minuto')) : null,
          periodo: campo(l, 'periodo') || null
        };
        /* eventos só inserem: dois gols do mesmo atleta no mesmo minuto são
           possíveis, então não há chave natural para deduplicar */
        if(gravar) await sb.from('is_eventos_partida').insert(dados);
        relatorio.push({ n, acao: 'criar', dados }); conta('criar');
        continue;
      }

      relatorio.push({ n, acao: 'erro', erro: 'tipo de importação desconhecido: ' + tipo }); conta('erro');
    }catch(e){
      relatorio.push({ n, acao: 'erro', erro: String((e && e.message) || e) }); conta('erro');
    }
  }

  return { ok: true, gravou: gravar, resumo, linhas: relatorio };
}

/* ---------------------------------------------------------------------
   GERAR CHAVEAMENTO

   Dado o número de vagas e a ordem de classificação, cria as partidas de
   mata-mata já com as `origem_*` ligadas, incluindo a disputa de 3º lugar.
   É um botão que economiza uma hora e vinte erros de digitação.

   A ordem das sementes é a clássica (1×8, 4×5, 2×7, 3×6): as duas primeiras
   cabeças só se encontram na final.
   --------------------------------------------------------------------- */
const NOME_DA_RODADA = { 2: 'Final', 4: 'Semifinal', 8: 'Quartas de final', 16: 'Oitavas de final', 32: 'Fase de 32' };

async function acaoGerarChaveamento(body, eu){
  const categoriaId = Number(body.categoria_id);
  const vagas = Number(body.num_vagas);
  if(!categoriaId) return { ok: false, error: 'informe a categoria' };
  if([2,4,8,16,32].indexOf(vagas) < 0) return { ok: false, error: 'o número de vagas precisa ser 2, 4, 8, 16 ou 32' };

  const { data: catd } = await sb.from('is_categorias').select('*').eq('id', categoriaId).limit(1);
  const cat = catd && catd[0];
  if(!cat) return { ok: false, error: 'categoria não encontrada' };

  /* as sementes vêm do painel (o humano olha a classificação e arruma) ou,
     na falta, da classificação geral da categoria */
  let sementes = Array.isArray(body.equipes) ? body.equipes.map(Number).filter(Boolean) : null;
  if(!sementes || !sementes.length){
    const { data: classe } = await sb.from('is_classificacao').select('*').eq('categoria_id', categoriaId).limit(LIMITE_ALTO);
    const { data: catEq } = await sb.from('is_categoria_equipes').select('*').eq('categoria_id', categoriaId).limit(LIMITE_ALTO);
    const { data: partidas } = await sb.from('is_partidas').select('*').eq('categoria_id', categoriaId).limit(2000);
    const linhas = R.mesclarClassificacao((catEq || []).map(x => x.equipe_id), classe || []);
    const ord = R.ordenarClassificacao(linhas, cat.desempate, {
      partidas: partidas || [],
      pontos_vitoria: cat.pontos_vitoria, pontos_empate: cat.pontos_empate, pontos_derrota: cat.pontos_derrota
    });
    sementes = ord.map(l => l.equipe_id);
  }
  if(sementes.length < vagas){
    return { ok: false, error: 'só ' + sementes.length + ' equipe(s) classificada(s) para ' + vagas + ' vagas' };
  }
  sementes = sementes.slice(0, vagas);

  if(body.gravar !== true){
    return { ok: true, previa: true, vagas, sementes,
      aviso: 'nada foi gravado. Confira a ordem das sementes e mande de novo com gravar: true.' };
  }

  const criadas = [];
  let ordemFase = 100;   // as fases de mata-mata vêm depois das classificatórias
  let anterior = null;   // ids das partidas da rodada anterior, em ordem

  for(let n = vagas; n >= 2; n = n / 2){
    const fase = await acharOuCriarFase(categoriaId, NOME_DA_RODADA[n] || ('Fase de ' + n), 'mata_mata');
    if(!fase) return { ok: false, error: 'não consegui criar a fase "' + (NOME_DA_RODADA[n] || n) + '". Nada mais foi criado a partir daqui.' };
    await sb.from('is_fases').update({ tipo: 'mata_mata', num_vagas: n, ordem: ordemFase++ }).eq('id', fase.id);

    const nesta = [];
    if(n === vagas){
      const ordem = R.ordemDeSementes(vagas);
      for(let i = 0; i < ordem.length; i += 2){
        const a = sementes[ordem[i] - 1], b = sementes[ordem[i + 1] - 1];
        const ins = await sb.from('is_partidas').insert({
          categoria_id: categoriaId, fase_id: fase.id, chave_ordem: (i / 2) + 1,
          equipe_a: a, equipe_b: b, status: 'agendada'
        }).select('id');
        if(ins.data && ins.data[0]){ nesta.push(ins.data[0].id); criadas.push(ins.data[0].id); }
      }
    } else {
      for(let i = 0; i < anterior.length; i += 2){
        const ins = await sb.from('is_partidas').insert({
          categoria_id: categoriaId, fase_id: fase.id, chave_ordem: (i / 2) + 1,
          origem_a_partida: anterior[i],     origem_a_tipo: 'vencedor',
          origem_b_partida: anterior[i + 1], origem_b_tipo: 'vencedor',
          status: 'agendada'
        }).select('id');
        if(ins.data && ins.data[0]){ nesta.push(ins.data[0].id); criadas.push(ins.data[0].id); }
      }
    }
    /* a disputa de 3º sai dos PERDEDORES da semifinal — é para isso que
       `origem_*_tipo = 'perdedor'` existe */
    if(n === 4 && nesta.length === 2){
      const fase3 = await acharOuCriarFase(categoriaId, 'Disputa de 3º lugar', 'mata_mata');
      await sb.from('is_fases').update({ tipo: 'mata_mata', num_vagas: 2, ordem: 999 }).eq('id', fase3.id);
      const ins = await sb.from('is_partidas').insert({
        categoria_id: categoriaId, fase_id: fase3.id, chave_ordem: 1,
        origem_a_partida: nesta[0], origem_a_tipo: 'perdedor',
        origem_b_partida: nesta[1], origem_b_tipo: 'perdedor',
        status: 'agendada'
      }).select('id');
      if(ins.data && ins.data[0]) criadas.push(ins.data[0].id);
    }
    anterior = nesta;
  }
  return { ok: true, partidas_criadas: criadas, vagas, sementes };
}

async function acaoGerarTurnoGrupos(body, eu){
  const faseId = Number(body.fase_id);
  if(!faseId) return { ok: false, error: 'informe a fase' };
  const { data: fd } = await sb.from('is_fases').select('*').eq('id', faseId).limit(1);
  const fase = fd && fd[0];
  if(!fase) return { ok: false, error: 'fase não encontrada' };
  if(fase.tipo !== 'classificatoria') return { ok: false, error: 'só faz sentido gerar turno em fase classificatória' };

  const { data: grupos } = await sb.from('is_grupos').select('*').eq('fase_id', faseId).order('ordem').limit(100);
  const { data: existentes } = await sb.from('is_partidas').select('*').eq('fase_id', faseId).limit(2000);
  const jaTem = (a, b) => (existentes || []).some(p =>
    (String(p.equipe_a) === String(a) && String(p.equipe_b) === String(b)) ||
    (String(p.equipe_a) === String(b) && String(p.equipe_b) === String(a)));

  const blocos = [];
  if(grupos && grupos.length){
    for(const g of grupos){
      const { data: ge } = await sb.from('is_grupo_equipes').select('equipe_id').eq('grupo_id', g.id).limit(200);
      blocos.push({ grupo: g, ids: (ge || []).map(x => x.equipe_id) });
    }
  } else {
    /* pontos corridos: a fase classificatória SEM grupos */
    const { data: ce } = await sb.from('is_categoria_equipes').select('equipe_id').eq('categoria_id', fase.categoria_id).limit(500);
    blocos.push({ grupo: null, ids: (ce || []).map(x => x.equipe_id) });
  }

  const plano = [];
  for(const bloco of blocos){
    if(bloco.ids.length < 2) continue;
    R.rodadasDoCirculo(bloco.ids).forEach((jogos, r) => {
      jogos.forEach(([a, b]) => {
        if(jaTem(a, b)) return;
        plano.push({ categoria_id: fase.categoria_id, fase_id: faseId,
                     grupo_id: bloco.grupo ? bloco.grupo.id : null,
                     rodada: r + 1, equipe_a: a, equipe_b: b, status: 'agendada' });
      });
    });
  }
  if(body.gravar !== true){
    return { ok: true, previa: true, criaria: plano.length, plano,
      aviso: 'nada foi gravado. Mande de novo com gravar: true.' };
  }
  if(plano.length){
    const { error } = await sb.from('is_partidas').insert(plano);
    if(error) return { ok: false, error: error.message };
  }
  return { ok: true, criadas: plano.length };
}

/* Sorteio de grupos DETERMINÍSTICO: nunca Math.random() em algo cujo
   resultado precisa ser igual para todo mundo. A semente fica registrada em
   is_config.dados.sorteios, então dá para repetir o sorteio e provar que
   ele foi o que foi. */
function embaralharComSemente(lista, semente){
  let s = 0;
  String(semente).split('').forEach(ch => { s = (s * 31 + ch.charCodeAt(0)) >>> 0; });
  const rnd = () => {   // mulberry32
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = lista.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function acaoSortearGrupos(body, eu, cfg){
  const faseId = Number(body.fase_id);
  const numGrupos = Number(body.num_grupos);
  if(!faseId || !numGrupos) return { ok: false, error: 'informe a fase e o número de grupos' };
  const { data: fd } = await sb.from('is_fases').select('*').eq('id', faseId).limit(1);
  const fase = fd && fd[0];
  if(!fase) return { ok: false, error: 'fase não encontrada' };

  const { data: ce } = await sb.from('is_categoria_equipes').select('equipe_id').eq('categoria_id', fase.categoria_id).limit(500);
  const ids = (ce || []).map(x => x.equipe_id);
  if(ids.length < numGrupos) return { ok: false, error: 'menos equipes do que grupos' };

  const semente = String(body.semente || '').trim() || (eu.usuario + ':' + Date.now());
  const sorteadas = embaralharComSemente(ids, semente);

  const letras = 'ABCDEFGH'.split('');
  const distribuicao = {};
  sorteadas.forEach((id, i) => {
    const g = letras[i % numGrupos];
    (distribuicao[g] = distribuicao[g] || []).push(id);
  });

  if(body.gravar !== true){
    return { ok: true, previa: true, semente, distribuicao,
      aviso: 'nada foi gravado. Guarde a semente: com ela o sorteio se repete igual.' };
  }

  for(const letra of Object.keys(distribuicao)){
    const g = await acharOuCriarGrupo(faseId, letra);
    if(!g) continue;
    await sb.from('is_grupo_equipes').delete().eq('grupo_id', g.id);   // refaz o grupo
    const linhas = distribuicao[letra].map(equipe_id => ({ grupo_id: g.id, equipe_id }));
    if(linhas.length) await sb.from('is_grupo_equipes').insert(linhas);
  }

  /* registra a semente: um sorteio que não dá para repetir é um sorteio
     que ninguém pode conferir */
  const sorteios = Object.assign({}, cfg.sorteios || {});
  sorteios['fase:' + faseId] = { semente, quando: new Date().toISOString(), por: eu.usuario };
  await gravarConfigIS(Object.assign({}, cfg, { sorteios }), cfg._versao);

  return { ok: true, semente, distribuicao };
}

/* ---------------------------------------------------------------------
   salvarResultado — a ação mais importante do sistema

   Faz três coisas, em ordem, e CADA UMA INDEPENDENTE. Se um passo falhar,
   os anteriores permanecem: a tela mostra onde parou e oferece "tentar de
   novo". Como tudo é idempotente, repetir é sempre seguro.
   --------------------------------------------------------------------- */
async function acaoSalvarResultado(body, eu){
  const id = Number(body.partida_id);
  if(!id) return { ok: false, error: 'informe a partida' };
  const { data: pd } = await sb.from('is_partidas').select('*').eq('id', id).limit(1);
  const p = pd && pd[0];
  if(!p) return { ok: false, error: 'partida não encontrada' };

  const pa = Number(body.placar_a), pb = Number(body.placar_b);
  if(!isFinite(pa) || !isFinite(pb) || pa < 0 || pb < 0 || Math.floor(pa) !== pa || Math.floor(pb) !== pb){
    return { ok: false, error: 'os dois placares precisam ser números inteiros e não negativos' };
  }
  if(!p.equipe_a || !p.equipe_b) return { ok: false, error: 'esta partida ainda não tem as duas equipes definidas' };

  let vencedorId = body.vencedor_id ? Number(body.vencedor_id) : null;
  if(vencedorId && String(vencedorId) !== String(p.equipe_a) && String(vencedorId) !== String(p.equipe_b)){
    return { ok: false, error: 'o vencedor informado não joga esta partida' };
  }
  if(!vencedorId && pa !== pb) vencedorId = pa > pb ? p.equipe_a : p.equipe_b;

  /* mata-mata empatado sem vencedor: recusa com mensagem clara em vez de
     adivinhar. Um chaveamento propagado errado é caro de desfazer. */
  if(pa === pb && !vencedorId){
    const { data: fd } = p.fase_id ? await sb.from('is_fases').select('tipo').eq('id', p.fase_id).limit(1) : { data: [] };
    if(fd && fd[0] && fd[0].tipo === 'mata_mata'){
      return { ok: false, error: 'esta partida é de mata-mata e terminou empatada — informe quem avançou' };
    }
  }

  const jaEraEncerrada = p.status === 'encerrada';
  const passos = {};

  /* passo 1 — o resultado */
  const patch = { placar_a: pa, placar_b: pb, vencedor_id: vencedorId, status: 'encerrada' };
  if(jaEraEncerrada){ patch.corrigido_em = new Date().toISOString(); patch.corrigido_por = eu.usuario; }
  if(body.obs !== undefined) patch.obs = String(body.obs || '').slice(0, 500) || null;
  const up = await sb.from('is_partidas').update(patch).eq('id', id);
  if(up.error) return { ok: false, error: 'o placar NÃO foi gravado: ' + up.error.message };
  passos.resultado = jaEraEncerrada ? 'corrigido' : 'ok';

  /* passo 2 — o chaveamento */
  passos.chaveamento = await propagarChaveamento(id);

  /* passo 3 — os mercados */
  if(jaEraEncerrada){
    /* correção: os mercados de vencedor já liquidados precisam de
       RELIQUIDAÇÃO, não de liquidação. Nada é apagado — estorno e novo
       prêmio, visíveis no extrato de quem foi afetado. */
    const { data: liquidados } = await sb.from('is_mercados').select('*')
      .eq('partida_id', id).eq('status', 'liquidado').eq('tipo', 'vencedor').limit(50);
    const refeitos = [], falhas = [];
    const vp = R.vencedorEPerdedor(Object.assign({}, p, patch));
    for(const m of (liquidados || [])){
      const opcoes = await opcoesDe(m.id);
      const nova = (pa === pb && !vencedorId)
        ? opcoes.find(o => !o.equipe_id)
        : opcoes.find(o => String(o.equipe_id) === String(vp.vencedor));
      if(!nova){ falhas.push({ id: m.id, error: 'nenhuma opção corresponde ao novo resultado' }); continue; }
      const r = await reliquidarMercado(m.id, nova.id, eu.usuario);
      if(r.ok) refeitos.push(m.id); else falhas.push({ id: m.id, error: r.error });
    }
    const aindaAbertos = await liquidarMercadosDaPartida(id, eu.usuario);
    passos.liquidacao = {
      ok: falhas.length === 0 && aindaAbertos.ok,
      error: falhas.length ? 'falha ao reliquidar ' + falhas.length + ' mercado(s)' : aindaAbertos.error,
      mercados_reliquidados: refeitos,
      mercados_liquidados: aindaAbertos.mercados_liquidados,
      mercados_pendentes: aindaAbertos.mercados_pendentes,
      falhas: falhas.concat(aindaAbertos.falhas || [])
    };
  } else {
    passos.liquidacao = await liquidarMercadosDaPartida(id, eu.usuario);
  }

  return { ok: true, passos, corrigido: jaEraEncerrada };
}

/* =====================================================================
   ROTEAMENTO DO POST
   ===================================================================== */
async function handlePost(req, res){
  let body = req.body;
  if(typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  body = body || {};
  const action = String(body.action || '');
  const cfg = await lerConfigIS();

  /* ---- ações do público ---- */
  if(action === 'apostar')        return res.status(200).json(await acaoApostar(body, req, cfg));
  if(action === 'cancelarAposta') return res.status(200).json(await acaoCancelarAposta(body, req, cfg));

  /* ---- daqui para baixo é painel: dois portões, nesta ordem ---- */
  const eu = await identificarEquipeIS(body.user, body.token);
  if(!eu){
    /* mensagem que diz o que fazer, não só que não deu. O primeiro papel é
       concedido por SQL, de propósito: conceder é ato explícito. */
    return res.status(403).json({ ok: false, error:
      'sem permissão no interséries. Os papéis vivem em is_config.dados.equipe — ver LEIA-ME-INTERSERIES.md § 2.' });
  }
  /* A interface esconde o que o papel não usa, mas quem MANDA é isto aqui:
     esconder botão não impede ninguém de chamar a API na mão. */
  if(!R.podeExecutarIS(eu.papel, action)){
    return res.status(403).json({ ok: false, error: 'seu papel (' + eu.papel + ') não permite esta ação' });
  }

  const c = R.configComPadrao(cfg);
  const temporada = await temporadaAtual(cfg);

  try{
    /* ---- diagnóstico ---- */
    if(action === 'ping'){
      return res.status(200).json({
        ok: true, papel: eu.papel, usuario: eu.usuario, versao: R.VERSAO_IS,
        ativo: c.ativo, temporada_atual: temporada ? temporada.id : null,
        serverNow: Date.now(),
        saude: {
          rate_limite: !_rateIndisponivel,
          config: !!cfg && Object.keys(cfg).length > 0,
          equipe_definida: !!(cfg.equipe && Object.keys(cfg.equipe).length)
        },
        acoes: Object.keys(R.ACOES_CONHECIDAS_IS).filter(a => R.podeExecutarIS(eu.papel, a))
      });
    }

    /* ---- temporada ---- */
    if(action === 'salvarTemporada'){
      const dados = {
        nome: String(body.nome || '').trim(),
        slug: String(body.slug || '').trim().toLowerCase(),
        comeca_em: body.comeca_em || null, termina_em: body.termina_em || null,
        status: ['rascunho','ativa','encerrada'].indexOf(body.status) >= 0 ? body.status : 'rascunho'
      };
      if(!dados.nome || !dados.slug) return erro(res, 'nome e slug são obrigatórios');
      if(body.id){
        const { error } = await sb.from('is_temporadas').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_temporadas').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, temporada: data[0] });
    }

    if(action === 'definirTemporadaAtual'){
      const r = await gravarConfigIS(Object.assign({}, cfg, { temporada_atual: Number(body.temporada_id) || null }), cfg._versao);
      return res.status(r.ok ? 200 : (r.conflito ? 409 : 400)).json(r);
    }

    /* ---- categorias ---- */
    if(action === 'salvarCategoria'){
      const dados = {
        temporada_id: Number(body.temporada_id) || (temporada && temporada.id),
        modalidade: String(body.modalidade || '').trim(),
        naipe: String(body.naipe || 'livre').trim(),
        nome: String(body.nome || '').trim(),
        slug: String(body.slug || '').trim().toLowerCase(),
        formato: String(body.formato || 'grupos_mata_mata'),
        placar_tipo: String(body.placar_tipo || 'gols'),
        permite_empate: body.permite_empate !== false,
        pontos_vitoria: Number(body.pontos_vitoria != null ? body.pontos_vitoria : 3),
        pontos_empate: Number(body.pontos_empate != null ? body.pontos_empate : 1),
        pontos_derrota: Number(body.pontos_derrota != null ? body.pontos_derrota : 0),
        desempate: Array.isArray(body.desempate) && body.desempate.length ? body.desempate : ['pontos','vitorias','saldo','pro','confronto'],
        status: String(body.status || 'inscricoes'),
        ordem: Number(body.ordem || 0)
      };
      if(!dados.temporada_id) return erro(res, 'não há temporada definida');
      if(!dados.nome || !dados.slug || !dados.modalidade) return erro(res, 'modalidade, nome e slug são obrigatórios');
      if(body.id){
        const { error } = await sb.from('is_categorias').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_categorias').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, categoria: data[0] });
    }

    if(action === 'arquivarCategoria'){
      /* arquivar é mudar o status, nunca apagar: a categoria carrega
         partidas, apostas e história */
      const { error } = await sb.from('is_categorias').update({ status: 'encerrada' }).eq('id', Number(body.id));
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true });
    }

    /* ---- equipes e atletas ---- */
    if(action === 'salvarEquipe'){
      const dados = {
        temporada_id: Number(body.temporada_id) || (temporada && temporada.id),
        nome: String(body.nome || '').trim(),
        sigla: String(body.sigla || '').trim().toUpperCase(),
        turma: body.turma ? String(body.turma).trim() : null,
        serie: body.serie ? String(body.serie).trim() : null,
        cor: body.cor ? String(body.cor).trim() : null,
        escudo: body.escudo ? String(body.escudo).trim() : null
      };
      if(!dados.nome || !dados.sigla) return erro(res, 'nome e sigla são obrigatórios');
      if(body.id){
        const { error } = await sb.from('is_equipes').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_equipes').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, equipe: data[0] });
    }

    if(action === 'vincularEquipeCategoria'){
      const categoria_id = Number(body.categoria_id), equipe_id = Number(body.equipe_id);
      if(!categoria_id || !equipe_id) return erro(res, 'informe a categoria e a equipe');
      if(body.remover === true){
        const { error } = await sb.from('is_categoria_equipes').delete()
          .eq('categoria_id', categoria_id).eq('equipe_id', equipe_id);
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, removido: true });
      }
      const { error } = await sb.from('is_categoria_equipes')
        .upsert({ categoria_id, equipe_id }, { onConflict: 'categoria_id,equipe_id', ignoreDuplicates: true });
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true });
    }

    if(action === 'salvarAtleta'){
      const dados = {
        temporada_id: Number(body.temporada_id) || (temporada && temporada.id),
        equipe_id: Number(body.equipe_id),
        nome: String(body.nome || '').trim(),
        numero: body.numero != null && body.numero !== '' ? Number(body.numero) : null,
        posicao: body.posicao ? String(body.posicao).trim() : null
      };
      if(!dados.equipe_id || !dados.nome) return erro(res, 'equipe e nome são obrigatórios');
      if(body.id){
        const { error } = await sb.from('is_atletas').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_atletas').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, atleta: data[0] });
    }

    /* ---- estrutura ---- */
    if(action === 'salvarFase'){
      const dados = {
        categoria_id: Number(body.categoria_id),
        nome: String(body.nome || '').trim(),
        tipo: body.tipo === 'mata_mata' ? 'mata_mata' : 'classificatoria',
        ordem: Number(body.ordem || 0),
        num_vagas: body.num_vagas != null && body.num_vagas !== '' ? Number(body.num_vagas) : null
      };
      if(!dados.categoria_id || !dados.nome) return erro(res, 'categoria e nome são obrigatórios');
      if(body.id){
        const { error } = await sb.from('is_fases').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_fases').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, fase: data[0] });
    }

    if(action === 'salvarGrupo'){
      if(body.equipes && Array.isArray(body.equipes) && body.grupo_id){
        await sb.from('is_grupo_equipes').delete().eq('grupo_id', Number(body.grupo_id));
        const linhas = body.equipes.map(Number).filter(Boolean).map(equipe_id => ({ grupo_id: Number(body.grupo_id), equipe_id }));
        if(linhas.length){
          const { error } = await sb.from('is_grupo_equipes').insert(linhas);
          if(error) return erro(res, error.message);
        }
        return res.status(200).json({ ok: true, equipes: linhas.length });
      }
      const dados = { fase_id: Number(body.fase_id), nome: String(body.nome || '').trim(), ordem: Number(body.ordem || 0) };
      if(!dados.fase_id || !dados.nome) return erro(res, 'fase e nome são obrigatórios');
      if(body.id){
        const { error } = await sb.from('is_grupos').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_grupos').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, grupo: data[0] });
    }

    if(action === 'sortearGrupos')    return res.status(200).json(await acaoSortearGrupos(body, eu, cfg));
    if(action === 'gerarTurnoGrupos') return res.status(200).json(await acaoGerarTurnoGrupos(body, eu));
    if(action === 'gerarChaveamento') return res.status(200).json(await acaoGerarChaveamento(body, eu));

    /* ---- partidas ---- */
    if(action === 'salvarPartida'){
      const dados = {
        categoria_id: Number(body.categoria_id),
        fase_id: body.fase_id ? Number(body.fase_id) : null,
        grupo_id: body.grupo_id ? Number(body.grupo_id) : null,
        rodada: body.rodada != null && body.rodada !== '' ? Number(body.rodada) : null,
        chave_ordem: body.chave_ordem != null && body.chave_ordem !== '' ? Number(body.chave_ordem) : null,
        equipe_a: body.equipe_a ? Number(body.equipe_a) : null,
        equipe_b: body.equipe_b ? Number(body.equipe_b) : null,
        comeca_em: body.comeca_em || null,
        local: body.local ? String(body.local).trim() : null,
        status: ['agendada','ao_vivo','encerrada','cancelada','wo'].indexOf(body.status) >= 0 ? body.status : undefined
      };
      Object.keys(dados).forEach(k => { if(dados[k] === undefined) delete dados[k]; });
      if(!dados.categoria_id && !body.id) return erro(res, 'informe a categoria');
      if(dados.equipe_a && dados.equipe_b && String(dados.equipe_a) === String(dados.equipe_b)){
        return erro(res, 'uma equipe não joga contra ela mesma');
      }
      if(body.id){
        const { error } = await sb.from('is_partidas').update(dados).eq('id', Number(body.id));
        if(error) return erro(res, error.message);
        return res.status(200).json({ ok: true, id: Number(body.id) });
      }
      const { data, error } = await sb.from('is_partidas').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, partida: data[0] });
    }

    if(action === 'salvarResultado') return res.status(200).json(await acaoSalvarResultado(body, eu));

    if(action === 'cancelarPartida'){
      const id = Number(body.partida_id || body.id);
      const novoStatus = body.wo === true ? 'wo' : 'cancelada';
      const { error } = await sb.from('is_partidas').update({
        status: novoStatus, obs: body.motivo ? String(body.motivo).slice(0, 500) : undefined
      }).eq('id', id);
      if(error) return erro(res, error.message);
      /* partida cancelada ou WO: os mercados dela viram `cancelado` com
         estorno integral. Nunca apaga aposta. */
      const { data: mercados } = await sb.from('is_mercados').select('id')
        .eq('partida_id', id).in('status', ['aberto','fechado']).limit(50);
      const cancelados = [];
      for(const m of (mercados || [])){
        const r = await cancelarMercado(m.id, novoStatus === 'wo' ? 'W.O.' : 'partida cancelada');
        if(r.ok) cancelados.push(m.id);
      }
      return res.status(200).json({ ok: true, status: novoStatus, mercados_cancelados: cancelados });
    }

    /* ---- eventos de partida (Fase 3) ---- */
    if(action === 'salvarEventoPartida'){
      const dados = {
        partida_id: Number(body.partida_id),
        atleta_id: body.atleta_id ? Number(body.atleta_id) : null,
        tipo: String(body.tipo || '').trim(),
        minuto: body.minuto != null && body.minuto !== '' ? Number(body.minuto) : null,
        periodo: body.periodo ? String(body.periodo).trim() : null
      };
      if(!dados.partida_id || !dados.tipo) return erro(res, 'partida e tipo são obrigatórios');
      const { data, error } = await sb.from('is_eventos_partida').insert(dados).select('*');
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, evento: data[0] });
    }
    if(action === 'removerEventoPartida'){
      const { error } = await sb.from('is_eventos_partida').delete().eq('id', Number(body.id));
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true });
    }

    /* ---- importação ---- */
    if(action === 'importarCsv') return res.status(200).json(await acaoImportarCsv(body, eu));

    /* ---- mercados ---- */
    if(action === 'salvarMercado'){
      const dados = {
        temporada_id: Number(body.temporada_id) || (temporada && temporada.id),
        categoria_id: body.categoria_id ? Number(body.categoria_id) : null,
        partida_id: body.partida_id ? Number(body.partida_id) : null,
        escopo: ['partida','categoria','temporada'].indexOf(body.escopo) >= 0 ? body.escopo : 'partida',
        tipo: ['vencedor','margem','futuro','livre'].indexOf(body.tipo) >= 0 ? body.tipo : 'livre',
        titulo: String(body.titulo || '').trim(),
        fecha_em: body.fecha_em || null
      };
      if(!dados.titulo) return erro(res, 'o mercado precisa de um título');
      if(!dados.fecha_em) return erro(res, 'o mercado precisa de um horário de fechamento');
      if(!dados.temporada_id) return erro(res, 'não há temporada definida');

      /* mercado de futuro fecha ANTES da primeira partida do evento: num
         mercado mútuo, quem apostasse no último dia levaria a mesma fatia
         de quem apostou às cegas no primeiro, e ninguém apostaria cedo. */
      if(dados.escopo !== 'partida'){
        const { data: primeira } = await sb.from('is_partidas').select('comeca_em')
          .not('comeca_em', 'is', null).order('comeca_em', { ascending: true }).limit(1);
        const p1 = primeira && primeira[0];
        if(p1 && Date.parse(dados.fecha_em) > Date.parse(p1.comeca_em)){
          return erro(res, 'mercado de futuro tem que fechar antes da primeira partida do evento (' +
            new Date(p1.comeca_em).toLocaleString('pt-BR') + ')');
        }
      }

      let mercadoId = body.id ? Number(body.id) : null;
      if(mercadoId){
        const { error } = await sb.from('is_mercados').update(dados).eq('id', mercadoId);
        if(error) return erro(res, error.message);
      } else {
        const { data, error } = await sb.from('is_mercados').insert(dados).select('*');
        if(error) return erro(res, error.message);
        mercadoId = data[0].id;
      }

      if(Array.isArray(body.opcoes) && body.opcoes.length){
        const { data: apostasExistentes } = await sb.from('is_apostas').select('id').eq('mercado_id', mercadoId).limit(1);
        if(apostasExistentes && apostasExistentes.length){
          return erro(res, 'este mercado já tem aposta — não dá para trocar as opções. Cancele e crie outro.');
        }
        await sb.from('is_opcoes').delete().eq('mercado_id', mercadoId);
        const linhas = body.opcoes.map((o, i) => ({
          mercado_id: mercadoId, rotulo: String(o.rotulo || '').trim(),
          equipe_id: o.equipe_id ? Number(o.equipe_id) : null,
          atleta_id: o.atleta_id ? Number(o.atleta_id) : null,
          ordem: i
        })).filter(o => o.rotulo);
        if(linhas.length < 2) return erro(res, 'um mercado precisa de pelo menos duas opções');
        const { error } = await sb.from('is_opcoes').insert(linhas);
        if(error) return erro(res, error.message);
      }
      return res.status(200).json({ ok: true, mercado_id: mercadoId });
    }

    if(action === 'criarMercadosEmLote'){
      const ids = Array.isArray(body.partidas) ? body.partidas.map(Number).filter(Boolean) : [];
      const tipo = ['vencedor','margem'].indexOf(body.tipo) >= 0 ? body.tipo : 'vencedor';
      if(!ids.length) return erro(res, 'selecione ao menos uma partida');

      const { data: partidas } = await sb.from('is_partidas').select('*').in('id', ids).limit(500);
      const equipes = await equipesDaTemporada(temporada && temporada.id);
      const porId = {}; equipes.forEach(e => { porId[String(e.id)] = e; });
      const { data: cats } = await sb.from('is_categorias').select('*').eq('temporada_id', temporada && temporada.id).limit(200);
      const catPorId = {}; (cats || []).forEach(x => { catPorId[String(x.id)] = x; });

      const criados = [], pulados = [];
      for(const p of (partidas || [])){
        if(!p.equipe_a || !p.equipe_b){ pulados.push({ id: p.id, motivo: 'partida ainda sem as duas equipes' }); continue; }
        if(!p.comeca_em){ pulados.push({ id: p.id, motivo: 'partida sem horário' }); continue; }
        const { data: jaTem } = await sb.from('is_mercados').select('id')
          .eq('partida_id', p.id).eq('tipo', tipo).limit(1);
        if(jaTem && jaTem.length){ pulados.push({ id: p.id, motivo: 'já tem mercado deste tipo' }); continue; }

        const cat = catPorId[String(p.categoria_id)] || {};
        const A = porId[String(p.equipe_a)], B = porId[String(p.equipe_b)];
        const modelos = R.modelosDeOpcoes(tipo, cat, A && A.nome, B && B.nome);
        if(modelos.length < 2){ pulados.push({ id: p.id, motivo: 'não sei montar as opções deste tipo' }); continue; }

        const titulo = (tipo === 'vencedor' ? 'Vencedor: ' : 'Margem: ') +
          (A ? A.sigla : '?') + ' × ' + (B ? B.sigla : '?');
        const ins = await sb.from('is_mercados').insert({
          temporada_id: temporada.id, categoria_id: p.categoria_id, partida_id: p.id,
          escopo: 'partida', tipo, titulo, fecha_em: p.comeca_em, status: 'aberto'
        }).select('*');
        if(ins.error){ pulados.push({ id: p.id, motivo: ins.error.message }); continue; }

        const mid = ins.data[0].id;
        const linhas = modelos.map((o, i) => ({
          mercado_id: mid, rotulo: o.rotulo, ordem: i,
          equipe_id: o.lado === 'a' ? p.equipe_a : (o.lado === 'b' ? p.equipe_b : null)
        }));
        await sb.from('is_opcoes').insert(linhas);
        criados.push(mid);
      }
      return res.status(200).json({ ok: true, criados, pulados });
    }

    if(action === 'fecharMercado'){
      const { error } = await sb.from('is_mercados').update({ status: 'fechado' }).eq('id', Number(body.id));
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true });
    }

    if(action === 'cancelarMercado'){
      return res.status(200).json(await cancelarMercado(Number(body.id), body.motivo));
    }

    /* ---- liquidação ---- */
    if(action === 'previaLiquidacao'){
      const m = await lerMercado(Number(body.id));
      if(!m) return erro(res, 'mercado não encontrado', 404);
      const opcoes = await opcoesDe(m.id);
      const apostas = await apostasDe(m.id);
      const escolhida = body.opcao_id ? Number(body.opcao_id) : m.opcao_vencedora;
      const rateio = R.ratear(apostas, escolhida);
      return res.status(200).json({
        ok: true, mercado: m, opcoes, resumo: resumoDoBolo(apostas, opcoes),
        opcao_simulada: escolhida,
        previa: {
          bolo: rateio.bolo, acertos: rateio.acertos, sobra: rateio.sobra,
          premios: rateio.premios,
          /* a invariante, mostrada ANTES de gravar */
          fecha: (rateio.premios.reduce((s, p) => s + p.valor, 0) + rateio.sobra) === rateio.bolo
        }
      });
    }

    if(action === 'liquidarMercado'){
      if(body.opcao_id){
        const up = await sb.from('is_mercados').update({ opcao_vencedora: Number(body.opcao_id) }).eq('id', Number(body.id));
        if(up.error) return erro(res, up.error.message);
      }
      return res.status(200).json(await liquidarMercado(Number(body.id), eu.usuario));
    }

    if(action === 'reliquidarMercado'){
      return res.status(200).json(await reliquidarMercado(Number(body.id), body.opcao_id ? Number(body.opcao_id) : null, eu.usuario));
    }

    /* ---- fichas ---- */
    if(action === 'extratoUsuario'){
      const u = await acharUsuario(body.alvo);
      if(!u) return erro(res, 'usuário não encontrado', 404);
      const extrato = await lancamentosDe(u.usuario);
      const { data: apostas } = await sb.from('is_apostas').select('*').eq('usuario', u.usuario).limit(300);
      return res.status(200).json({
        ok: true, usuario: u.usuario,
        saldo: extrato.reduce((s, l) => s + Number(l.valor || 0), 0),
        extrato, apostas: apostas || []
      });
    }

    if(action === 'ajustarFichas'){
      const u = await acharUsuario(body.alvo);
      if(!u) return erro(res, 'usuário não encontrado', 404);
      const valor = Number(body.valor);
      const motivo = String(body.motivo || '').trim();
      if(!isFinite(valor) || valor === 0 || Math.floor(valor) !== valor) return erro(res, 'o valor precisa ser um inteiro diferente de zero');
      if(!motivo) return erro(res, 'ajuste manual exige motivo — é ele que explica a linha no extrato de quem recebeu');
      /* `idempotencia` vem do painel, gerado uma vez por formulário aberto:
         é o que faz o clique duplo não creditar duas vezes */
      const chave = String(body.idempotencia || '').trim() || crypto.randomUUID();
      const { error } = await sb.from('is_lancamentos').upsert({
        usuario: u.usuario, tipo: 'ajuste', valor,
        ref: 'ajuste:' + chave, motivo: motivo + ' (por ' + eu.usuario + ')'
      }, { onConflict: 'usuario,tipo,ref', ignoreDuplicates: true });
      if(error) return erro(res, error.message);
      return res.status(200).json({ ok: true, saldo: await saldoDe(u.usuario), idempotencia: chave });
    }

    /* ---- config ---- */
    if(action === 'salvarConfigIS'){
      /* merge sobre o que já existe: chave que o painel não conhece
         (`equipe`, `turmas`, `sorteios`) NÃO some por descuido */
      const novo = Object.assign({}, cfg);
      ['ativo','saldo_inicial','mesada_diaria','teto_percentual','aposta_minima','temporada_atual','refresh_ms','equipe','turmas']
        .forEach(k => { if(body[k] !== undefined) novo[k] = body[k]; });

      if(novo.equipe && typeof novo.equipe === 'object'){
        const limpo = {};
        for(const k in novo.equipe){
          const p = String(novo.equipe[k] || '');
          if(R.PAPEIS_IS.indexOf(p) >= 0) limpo[String(k).trim()] = p;
        }
        novo.equipe = limpo;
        if(!Object.keys(limpo).length){
          return erro(res, 'a lista da equipe ficaria vazia — isso trancaria todo mundo fora do painel');
        }
      }
      const r = await gravarConfigIS(novo, cfg._versao);
      return res.status(r.ok ? 200 : (r.conflito ? 409 : 400)).json(r);
    }

    return erro(res, 'ação desconhecida: ' + action);
  }catch(e){
    console.error('[interseries] falha na ação', action, e);
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
}

module.exports = async (req, res) => {
  try{
    if(req.method === 'GET') return await handleGet(req, res);
    if(req.method === 'POST') return await handlePost(req, res);
    res.status(405).json({ ok: false, error: 'método não suportado' });
  }catch(e){
    console.error('[interseries] erro não tratado', e);
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
};
