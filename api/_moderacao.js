/* =====================================================================
   CETECRITIC — MODERAÇÃO: helpers compartilhados
   Caminho: /api/_moderacao.js
   =====================================================================
   Arquivos com "_" no começo NÃO viram rota na Vercel — este módulo existe
   só para ser `require`ado por /api/db.js (ações do próprio usuário) e por
   /api/content.js (ações do painel admin), sem duplicar regra.

   O que mora aqui:
     - normalização e validação de nome de usuário
     - migrarNomeUsuario(): renomeia a conta em TODAS as tabelas
     - estadoConta(): traduz perfil.banido / silenciado_ate / nome_bloqueado
   ===================================================================== */

const norm = u => String(u || '').trim().toLowerCase();

function asObj(v){ if(!v) return {}; if(typeof v === 'object') return v; try{ return JSON.parse(v); }catch(e){ return {}; } }

/* mesmas regras do cadastro (apiRegistrar) — mantidas em UM lugar só para
   não divergirem com o tempo */
const NOME_RE = /^[A-Za-z0-9_.\- ]+$/;
function validarNome(nome){
  const n = String(nome || '').trim();
  if(n.length < 2 || n.length > 20) return 'o nome deve ter de 2 a 20 caracteres';
  if(!NOME_RE.test(n)) return 'use só letras, números, espaço, ponto, hífen ou _';
  return null;
}

/* ---------------------------------------------------------------------
   TABELAS que guardam nome de usuário. Toda renomeação precisa passar por
   todas elas — se você criar uma tabela nova com nome de usuário, ADICIONE
   AQUI, senão a conta renomeada deixa rastro órfão.
   --------------------------------------------------------------------- */
const REFERENCIAS = [
  { tabela: 'submissions',  colunas: ['usuario'] },
  { tabela: 'palpites',     colunas: ['usuario'] },
  { tabela: 'notificacoes', colunas: ['usuario'] },
  { tabela: 'sessoes',      colunas: ['usuario'] },
  { tabela: 'push',         colunas: ['usuario'] },
  { tabela: 'resets',       colunas: ['usuario'] },
  { tabela: 'carimbos',     colunas: ['profile_user', 'from_user'] },
  { tabela: 'visitas',      colunas: ['profile_user', 'visitor_user'] },
  { tabela: 'reputacao',    colunas: ['profile_user', 'from_user'] }
];

/* ---------------------------------------------------------------------
   migrarNomeUsuario — renomeia a conta de verdade.

   ATENÇÃO (isto foi decidido conscientemente): o PostgREST não expõe
   transação, então a migração NÃO é atômica. A ordem abaixo foi escolhida
   para que, se cair no meio, o estado que sobra seja RECUPERÁVEL e nunca
   destrutivo:

     1. cria a linha NOVA em `usuarios` (as duas coexistem por um instante)
     2. repõe as referências das outras tabelas para o nome novo
     3. só então apaga a linha ANTIGA
     4. conserta a lista de amigos de terceiros

   Se o processo morrer entre 1 e 3, as duas contas existem e nenhum dado
   sumiu — dá pra rodar de novo. Por isso o passo 3 só acontece se os
   anteriores não acumularem erro, e a função devolve `avisos` com o que
   falhou (mesmo padrão do apiDeletarConta já existente neste projeto).
   --------------------------------------------------------------------- */
async function migrarNomeUsuario(sb, nomeAntigo, nomeNovo, opcoes){
  const opts = opcoes || {};
  const antigo = String(nomeAntigo || '').trim();
  const novo = String(nomeNovo || '').trim();
  const avisos = [];
  const anota = (etapa, error) => { if(error){ avisos.push(etapa + ': ' + (error.message || String(error))); return true; } return false; };

  const erroNome = validarNome(novo);
  if(erroNome) return { ok: false, error: erroNome };
  if(norm(antigo) === norm(novo)) return { ok: false, error: 'o nome novo é igual ao atual' };

  /* a conta de origem precisa existir */
  const { data: origemRows } = await sb.from('usuarios').select('*').ilike('usuario', antigo).limit(10);
  const origem = (origemRows || []).find(r => norm(r.usuario) === norm(antigo));
  if(!origem) return { ok: false, error: 'usuário não encontrado' };

  /* o nome novo não pode estar ocupado por OUTRA conta (comparação
     case-insensitive: "Joao" e "joao" são a mesma pessoa aqui) */
  const { data: ocupadoRows } = await sb.from('usuarios').select('usuario').ilike('usuario', novo).limit(10);
  const ocupado = (ocupadoRows || []).find(r => norm(r.usuario) === norm(novo));
  if(ocupado) return { ok: false, error: 'esse nome já está em uso — escolha outro' };

  /* perfil da conta nova: limpa a marca de "precisa trocar de nome" e guarda
     o histórico, que só o admin lê */
  const perfil = asObj(origem.perfil);
  const historico = Array.isArray(perfil.nomes_antigos) ? perfil.nomes_antigos.slice(-9) : [];
  historico.push({ nome: origem.usuario, ts: Date.now(), motivo: opts.motivo || null });
  perfil.nomes_antigos = historico;
  delete perfil.nome_bloqueado;
  /* o anonimato aplicado só para esconder o nome ofensivo perde a razão de
     existir junto com o nome antigo */
  if(opts.limparAnonimato){
    delete perfil.anonimo; delete perfil.anon_modo; delete perfil.anon_ate; delete perfil.pseudo;
  }

  /* 1) linha nova ------------------------------------------------------ */
  {
    const { error } = await sb.from('usuarios').insert({
      usuario: novo,
      senha_hash: origem.senha_hash,
      salt: origem.salt,
      token: origem.token || null,
      criado_em: origem.criado_em || Date.now(),
      tentativas: 0,
      lock_until: 0,
      admin: origem.admin === true,
      perfil
    });
    if(error) return { ok: false, error: 'não deu pra criar a conta com o nome novo — ' + (error.message || error) };
  }

  /* 2) referências ----------------------------------------------------- */
  let falhouAlguma = false;
  for(const ref of REFERENCIAS){
    for(const col of ref.colunas){
      const { data, error } = await sb.from(ref.tabela).select('*').ilike(col, antigo);
      if(anota('ler ' + ref.tabela + '.' + col, error)){ falhouAlguma = true; continue; }
      const linhas = (data || []).filter(r => norm(r[col]) === norm(antigo));
      if(!linhas.length) continue;

      /* Atualizamos filtrando pela PRÓPRIA coluna, com os valores exatos que
         acabamos de observar. Duas razões para não usar chave primária aqui:

         1. as tabelas não compartilham uma chave só (id / row_id / endpoint),
            e `notificacoes` pode nem ter `id` — o notif_id se repete entre
            usuários, então filtrar por ele atingiria a caixa de terceiros;
         2. não dá pra usar `ilike` direto no update: `_` é curinga em LIKE e
            nomes de usuário aceitam `_`, então "joao_silva" casaria também
            com "joaoXsilva".

         Ler com ilike + conferir com norm() e só então escrever nos valores
         exatos resolve os dois. */
      const exatos = [...new Set(linhas.map(r => r[col]))];
      const { error: e2 } = await sb.from(ref.tabela).update({ [col]: novo }).in(col, exatos);
      if(anota('atualizar ' + ref.tabela + '.' + col, e2)) falhouAlguma = true;
    }
  }

  /* login_codes tem o usuário como chave primária: em vez de migrar, apaga —
     é só um código de 2FA de 5 minutos, pedir outro é trivial */
  { const { error } = await sb.from('login_codes').delete().ilike('usuario', antigo); anota('apagar login_codes', error); }

  /* 3) apaga a linha antiga — só se as referências foram todas movidas,
     senão a FK barra e/ou sobram rastros apontando pro nome que sumiu */
  if(falhouAlguma){
    return { ok: false, error: 'a migração falhou no meio; a conta antiga foi PRESERVADA e a nova também existe — resolva os avisos e rode de novo', avisos, parcial: true, novo };
  }
  {
    const { error } = await sb.from('usuarios').delete().eq('usuario', origem.usuario);
    if(error) return { ok: false, error: 'as referências migraram, mas não deu pra apagar a conta antiga — ' + (error.message || error), avisos, parcial: true, novo };
  }

  /* 4) lista de amigos de terceiros ------------------------------------ */
  try{
    const { data: todos } = await sb.from('usuarios').select('usuario,perfil');
    for(const r of (todos || [])){
      const p = asObj(r.perfil);
      if(!Array.isArray(p.amigos)) continue;
      if(!p.amigos.some(a => norm(a) === norm(antigo))) continue;
      p.amigos = p.amigos.map(a => (norm(a) === norm(antigo) ? novo : a));
      const { error } = await sb.from('usuarios').update({ perfil: p }).eq('usuario', r.usuario);
      anota('amigos de ' + r.usuario, error);
    }
  }catch(e){ anota('lista de amigos', e); }

  return { ok: true, de: origem.usuario, para: novo, avisos };
}

/* ---------------------------------------------------------------------
   estadoConta — lê os campos de moderação do perfil e devolve o que o
   servidor precisa decidir. Um só lugar para a regra de expiração, senão
   cada rota interpreta `banido.ate` do seu jeito.
   --------------------------------------------------------------------- */
function estadoConta(perfil){
  const p = asObj(perfil);
  const agora = Date.now();

  const b = (p.banido && typeof p.banido === 'object') ? p.banido : null;
  /* ate = null/ausente => banimento permanente */
  const banidoAtivo = !!b && (!b.ate || agora < Number(b.ate));

  const silAte = Number(p.silenciado_ate || 0);
  const silenciadoAtivo = silAte > agora;

  const nb = (p.nome_bloqueado && typeof p.nome_bloqueado === 'object') ? p.nome_bloqueado : null;

  return {
    banido: banidoAtivo,
    banidoAte: banidoAtivo ? (b.ate || null) : null,
    banidoMotivo: banidoAtivo ? String(b.motivo || '') : '',
    silenciado: silenciadoAtivo,
    silenciadoAte: silenciadoAtivo ? silAte : 0,
    precisaTrocarNome: !!nb,
    nomeBloqueadoMotivo: nb ? String(nb.motivo || '') : ''
  };
}

/* mensagem pronta pro usuário — usada no login e nas ações bloqueadas */
function mensagemBloqueio(est){
  if(est.banido){
    const quando = est.banidoAte ? (' até ' + new Date(Number(est.banidoAte)).toLocaleString('pt-BR')) : ' permanentemente';
    return 'esta conta está suspensa' + quando + (est.banidoMotivo ? ' — ' + est.banidoMotivo : '');
  }
  if(est.silenciado){
    return 'sua conta está temporariamente sem permissão de interagir (até ' +
      new Date(Number(est.silenciadoAte)).toLocaleString('pt-BR') + ')';
  }
  return null;
}

/* =====================================================================
   PAPÉIS DA EQUIPE — quem pode executar o quê no painel
   =====================================================================
   Esta tabela é a autoridade. A interface esconde botões pelo papel, mas
   esconder botão não é segurança: TODA ação passa por `podeExecutar` no
   servidor antes de rodar.

   Princípio de cada papel:

     admin        pode tudo.

     moderador    lida com PESSOAS e nada mais. Tudo o que ele faz é
                  reversível: silenciar, suspender por prazo, esconder nome,
                  derrubar sessão, limpar carimbo/visita. Não apaga conta,
                  não renomeia (migração irreversível), não mexe em nota de
                  votação, não dá cargo, não toca no acervo nem no config.

     historiador  lida com o ACERVO e nada mais. Pode criar edição, noite e
                  peça, corrigir texto e subir imagem — mas não excluir. A
                  proibição de excluir é verificada de verdade no
                  salvarEdicaoCompleta, não só escondendo o botão.
   ===================================================================== */
const PAPEIS = ['admin', 'moderador', 'historiador'];

/* suspensão por tempo indeterminado é decisão de admin. O moderador tem teto. */
const MAX_DIAS_BAN_MODERADOR = 30;

const ACOES_POR_PAPEL = {
  moderador: {
    ping: 1,
    /* ver e agir sobre pessoas */
    listarUsuarios: 1, usuarioDetalhe: 1,
    notificarUsuario: 1,
    definirSilencio: 1,
    definirBanimento: 1,          // limitado a MAX_DIAS_BAN_MODERADOR, sem permanente
    forcarTrocaNome: 1, cancelarTrocaNome: 1,
    anonimizarUsuario: 1, removerAnonimato: 1,
    deslogarTudo: 1,
    moderarPerfil: 1,             // opções destrutivas filtradas abaixo
    apagarItemUsuario: 1,         // tipos destrutivos filtrados abaixo
    lerReputacao: 1,
    listarVotos: 1                // pode investigar, não pode alterar
    /* anonimizarVoto / restaurarNomeVoto ficam FORA de propósito: apesar de
       serem reversíveis, mexem na linha de `submissions`, e votos são
       território de admin aqui (ver ITENS_SO_ADMIN.voto logo abaixo). Para
       liberar pro moderador, basta adicionar as duas nesta lista. */
  },
  historiador: {
    ping: 1,
    /* acervo */
    salvarEdicaoCompleta: 1,      // com trava anti-exclusão
    uploadImagem: 1,
    parseLink: 1
  }
};

/* opções de limpeza que o moderador NÃO pode disparar: mexem em dados de
   votação ou apagam conteúdo autoral que não se recupera */
const LIMPEZAS_SO_ADMIN = { votos: 1, showcase: 1, amigos: 1 };
/* itens que o moderador não pode apagar um a um, pela mesma razão */
const ITENS_SO_ADMIN = { voto: 1, palpite: 1 };

function podeExecutar(papel, acao){
  if(papel === 'admin') return true;
  const permitidas = ACOES_POR_PAPEL[papel];
  return !!(permitidas && permitidas[acao]);
}

module.exports = {
  norm, asObj, validarNome, migrarNomeUsuario, estadoConta, mensagemBloqueio, REFERENCIAS,
  PAPEIS, MAX_DIAS_BAN_MODERADOR, LIMPEZAS_SO_ADMIN, ITENS_SO_ADMIN, podeExecutar
};
