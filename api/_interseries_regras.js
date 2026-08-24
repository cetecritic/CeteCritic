/* =====================================================================
   CETEC INTERSÉRIES — REGRAS PURAS (api/_interseries_regras.js)
   =====================================================================
   Tudo aqui é função pura: sem banco, sem rede, sem `document`. É o que dá
   para testar sem infraestrutura, e é justamente a parte cujo erro custa
   caro em silêncio (o rateio, as refs de idempotência, o desempate).

   O prefixo `_` NÃO é estilo: arquivo que começa com `_` não vira rota na
   Vercel. É como o projeto já mantém `api/_moderacao.js` importável sem
   ficar exposto na web.

   ⚠️ DUPLICAÇÃO DECLARADA
   `CRITERIOS_IS` e `ordenarClassificacao` existem TAMBÉM em
   `assets/interseries.js`, porque o navegador não faz `require` e as duas
   pontas precisam da mesma ordem: o servidor para semear o chaveamento, o
   cliente para desenhar a tabela. O que impede as cópias de divergirem não
   é a linguagem, é o teste "as duas cópias têm o MESMO desempate" em
   testes/interseries.test.js. É o mesmo arranjo de `BOLAO_FAIXAS`.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Básico
   --------------------------------------------------------------------- */
const norm = u => String(u || '').trim().toLowerCase();

/* O PostgREST corta em 1000 linhas EM SILÊNCIO. Todo select leva .limit()
   explícito; este é o teto de segurança, não a solução. */
const LIMITE_ALTO = 10000;

/* A conta do sistema. Guarda a sobra de arredondamento para a soma do razão
   continuar fechando. Não é usuário: nunca aparece no placar. */
const CONTA_SISTEMA = '__sistema__';

/* Fuso do evento, fixo. O Brasil não tem horário de verão desde 2019, então
   -03:00 é constante — e um fuso fixo é o que faz "a mesada do dia" ser a
   mesma coisa para todo mundo, venha a requisição de onde vier. */
const FUSO_EVENTO = '-03:00';
const OFFSET_EVENTO_MS = 3 * 60 * 60 * 1000;

/* 'AAAA-MM-DD' do instante `ms` no fuso do evento.
   Subtrair 3h do UTC e ler a data em UTC dá exatamente a data em -03:00. */
function dataEvento(ms){
  const t = Number(ms);
  if(!isFinite(t)) return null;
  return new Date(t - OFFSET_EVENTO_MS).toISOString().slice(0, 10);
}
/* o instante em que o dia `AAAA-MM-DD` começa, em epoch ms */
function inicioDoDiaEvento(dataStr){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataStr || ''));
  if(!m) return null;
  return Date.parse(dataStr + 'T00:00:00' + FUSO_EVENTO);
}

/* ---------------------------------------------------------------------
   CONFIG — os valores padrão

   Existem para o site não quebrar se uma chave sumir do jsonb. Quem manda é
   sempre o banco; isto é o chão.
   --------------------------------------------------------------------- */
const CONFIG_PADRAO = {
  ativo: true,
  temporada_atual: null,
  saldo_inicial: 1000,
  mesada_diaria: 250,
  teto_percentual: 25,
  aposta_minima: 10,
  refresh_ms: { padrao: 20000, ao_vivo: 10000, ocioso: 60000 }
};

function configComPadrao(dados){
  const d = (dados && typeof dados === 'object') ? dados : {};
  const r = Object.assign({}, CONFIG_PADRAO, d);
  r.refresh_ms = Object.assign({}, CONFIG_PADRAO.refresh_ms, d.refresh_ms || {});
  /* números vindos de formulário chegam como string com frequência */
  ['saldo_inicial','mesada_diaria','teto_percentual','aposta_minima'].forEach(k => {
    const n = Number(r[k]);
    r[k] = isFinite(n) ? n : CONFIG_PADRAO[k];
  });
  r.ativo = r.ativo !== false;   // ausente = ligado
  return r;
}

/* ---------------------------------------------------------------------
   PAPÉIS — quem faz o quê no painel do interséries
   =====================================================================
   Território, não hierarquia. A separação entre `is_esportes` e
   `is_apostas` é de propósito e é a única trava técnica que existe contra
   o conflito de interesse do apurador: QUEM DIGITA O PLACAR DECIDE QUEM
   GANHA FICHAS. Quem cadastra resultado não precisa poder mexer em ficha,
   e vice-versa.

   Um `admin = true` do CETECritic NÃO ganha estes papéis automaticamente.
   Conceder é ato explícito — ver `papelIS` logo abaixo e a § 2 do
   LEIA-ME-INTERSERIES.md.
   --------------------------------------------------------------------- */
const PAPEIS_IS = ['is_admin', 'is_esportes', 'is_apostas'];

/* Só para o `ping` conseguir dizer o que este build sabe fazer. Não roteia
   nada — o roteamento é a sequência de `if` do api/interseries.js.

   AO ACRESCENTAR UMA AÇÃO: registre aqui, decida o papel em
   ACOES_POR_PAPEL_IS (omitir = só is_admin, que é o padrão seguro) e SUBA
   a VERSAO_IS. É o que permite descobrir em dois segundos se o build no ar
   é o atual, em vez de adivinhar por que uma ação nova responde "ação
   desconhecida". */
const ACOES_CONHECIDAS_IS = {
  ping: 1,
  /* temporada e estrutura */
  salvarTemporada: 1, definirTemporadaAtual: 1,
  salvarCategoria: 1, arquivarCategoria: 1,
  salvarEquipe: 1, vincularEquipeCategoria: 1, salvarAtleta: 1,
  salvarFase: 1, salvarGrupo: 1, sortearGrupos: 1, gerarTurnoGrupos: 1,
  gerarChaveamento: 1,
  /* dia de jogo */
  salvarPartida: 1, salvarResultado: 1, cancelarPartida: 1,
  salvarEventoPartida: 1, removerEventoPartida: 1,
  importarCsv: 1,
  /* apostas */
  salvarMercado: 1, criarMercadosEmLote: 1, fecharMercado: 1, cancelarMercado: 1,
  previaLiquidacao: 1, liquidarMercado: 1, reliquidarMercado: 1,
  extratoUsuario: 1, ajustarFichas: 1,
  /* config */
  salvarConfigIS: 1
};

/* Suba a cada ação nova. O `ping` devolve este número. */
const VERSAO_IS = 1;

const ACOES_POR_PAPEL_IS = {
  is_esportes: {
    ping: 1,
    salvarTemporada: 1, definirTemporadaAtual: 1,
    salvarCategoria: 1, arquivarCategoria: 1,
    salvarEquipe: 1, vincularEquipeCategoria: 1, salvarAtleta: 1,
    salvarFase: 1, salvarGrupo: 1, sortearGrupos: 1, gerarTurnoGrupos: 1,
    gerarChaveamento: 1,
    salvarPartida: 1, salvarResultado: 1, cancelarPartida: 1,
    salvarEventoPartida: 1, removerEventoPartida: 1,
    importarCsv: 1
    /* `salvarConfigIS` fica FORA de propósito: lá moram a mesada, os tetos,
       o interruptor de morte e a lista da equipe. Território de is_admin. */
  },
  is_apostas: {
    ping: 1,
    salvarMercado: 1, criarMercadosEmLote: 1, fecharMercado: 1, cancelarMercado: 1,
    previaLiquidacao: 1, liquidarMercado: 1, reliquidarMercado: 1,
    extratoUsuario: 1, ajustarFichas: 1
    /* nenhuma ação de competição: quem apura o mercado não digita o placar */
  }
};

function podeExecutarIS(papel, acao){
  if(papel === 'is_admin') return true;
  const permitidas = ACOES_POR_PAPEL_IS[papel];
  return !!(permitidas && permitidas[acao]);
}

/* O papel de alguém sai da lista guardada em `is_config.dados.equipe`,
   um mapa { "usuario": "is_papel" }. Mora ali, e não em `usuarios.papel`,
   por duas razões: a coluna `papel` é dos três papéis do FESTIVAL e mexer
   nela seria mexer no `_moderacao.js` (proibido), e a equipe do interséries
   provavelmente não é a mesma do festival.

   Devolve null para quem não está na lista — inclusive para admin do
   CETECritic. É a regra: conceder é ato explícito. */
function papelIS(config, usuario){
  const equipe = (config && config.equipe && typeof config.equipe === 'object') ? config.equipe : {};
  const alvo = norm(usuario);
  for(const k in equipe){
    if(norm(k) === alvo){
      const p = String(equipe[k] || '');
      return PAPEIS_IS.indexOf(p) >= 0 ? p : null;
    }
  }
  return null;
}

/* ---------------------------------------------------------------------
   LIMITE DE TAXA — as chaves e os tetos (§ 9.5 do brief)

   Reusa a tabela `rate_limite` de migracao-seguranca.sql. Se a tabela não
   existir, LIBERA TUDO e avisa no log: migração pendente não pode derrubar
   o site no meio do evento.
   --------------------------------------------------------------------- */
const LIMITES_IS = {
  aposta_usuario: { prefixo: 'is:aposta:u:',  maximo: 20, janelaMs:  5 * 60 * 1000 },
  aposta_ip:      { prefixo: 'is:aposta:ip:', maximo: 40, janelaMs:  5 * 60 * 1000 },
  csv_usuario:    { prefixo: 'is:csv:u:',     maximo: 10, janelaMs: 10 * 60 * 1000 }
};

/* ---------------------------------------------------------------------
   REFS — as chaves determinísticas de idempotência
   =====================================================================
   A LINHA É A MEMÓRIA DE "JÁ FIZ ISSO". Combinadas com o índice único
   `is_lanc_ref_unico (usuario, tipo, ref)`, estas strings são o que faz
   crédito de mesada, liquidação e reliquidação poderem rodar duas vezes
   sem pagar duas vezes.

   A garantia é o ÍNDICE, nunca "eu verifiquei antes de escrever" — duas
   abas abertas quebram qualquer checagem em memória.
   --------------------------------------------------------------------- */
const REF = {
  inicial:        usuario => 'inicial:' + norm(usuario),
  mesada:         (usuario, dia) => 'mesada:' + norm(usuario) + ':' + dia,
  apostaDebito:   (apostaId, versao) => 'aposta:' + apostaId + ':v' + versao,
  apostaEstorno:  (apostaId, versao) => 'aposta:' + apostaId + ':v' + versao + ':cancel',
  mercado:        (mercadoId, versao) => 'mercado:' + mercadoId + ':v' + versao,
  mercadoEstorno: (mercadoId, versao) => 'mercado:' + mercadoId + ':v' + versao + ':estorno',
  sobra:          (mercadoId, versao) => 'sobra:mercado:' + mercadoId + ':v' + versao,
  /* cancelar é devolver a APOSTA; estornar uma liquidação é desfazer o
     PRÊMIO. Valores diferentes, refs diferentes — se dividissem a mesma
     chave, cancelar depois de liquidar não escreveria nada e ninguém
     receberia de volta. */
  mercadoCancelado: mercadoId => 'cancel:mercado:' + mercadoId
};

/* uma linha do razão para cada usuário: as refs acima são únicas por
   (usuario, tipo, ref) — o mesmo `ref` em contas diferentes não colide, que
   é exatamente o que a liquidação em lote precisa. */

/* ---------------------------------------------------------------------
   RATEIO DA APOSTA MÚTUA
   =====================================================================
   Todas as apostas de um mercado entram num bolo; saído o resultado, o bolo
   se divide entre quem acertou, proporcional ao valor apostado.

       bolo      = soma de todas as apostas
       acertos   = soma das apostas na opção vencedora
       prêmio(x) = floor( bolo × aposta(x) ÷ acertos )

   A casa NUNCA tem exposição: não se paga mais do que entrou. É por isso
   que não existe cotação fixa aqui — cotação fixa cria passivo, e um erro
   de linha esvazia o placar da temporada inteira.

   INVARIANTE QUE TEM QUE VALER SEMPRE:  pago + sobra === bolo.
   O `floor` de cada prêmio deixa resto; o resto vira um lançamento `sobra`
   na conta do sistema. NUNCA some.
   --------------------------------------------------------------------- */
function ratear(apostas, opcaoVencedoraId){
  const lista = Array.isArray(apostas) ? apostas : [];
  const bolo    = lista.reduce((s, a) => s + Number(a.valor || 0), 0);
  const ganhos  = lista.filter(a => String(a.opcao_id) === String(opcaoVencedoraId));
  const acertos = ganhos.reduce((s, a) => s + Number(a.valor || 0), 0);

  /* mercado sem nenhuma aposta liquida do mesmo jeito, sem escrever nada */
  if(lista.length === 0) return { premios: [], sobra: 0, bolo: 0, acertos: 0 };

  /* ninguém acertou → devolve tudo. Não é caridade: o bolo não tem dono, e
     ficar com ele seria a casa lucrando com o próprio evento. */
  if(acertos === 0){
    return {
      premios: lista.map(a => ({ usuario: a.usuario, aposta_id: a.id,
                                 valor: Number(a.valor || 0), tipo: 'estorno' })),
      sobra: 0, bolo, acertos: 0
    };
  }

  const premios = ganhos.map(a => ({
    usuario:   a.usuario,
    aposta_id: a.id,
    valor:     Math.floor(bolo * Number(a.valor || 0) / acertos),
    tipo:      'premio'
  }));
  const pago = premios.reduce((s, p) => s + p.valor, 0);
  return { premios, sobra: bolo - pago, bolo, acertos };
}

/* ---------------------------------------------------------------------
   VALIDAÇÃO DA APOSTA — a ordem importa, e cada passo tem mensagem própria

   Tudo aqui é conferido NO SERVIDOR. A validação do cliente é conforto:
   quem chama a API na mão passa por cima dela sem esforço nenhum.
   --------------------------------------------------------------------- */
function tetoDaAposta(saldo, tetoPercentual){
  return Math.floor(Number(saldo || 0) * Number(tetoPercentual || 0) / 100);
}
/* devolve null se está tudo certo, ou a mensagem de erro (em português) */
function validarValorAposta(valor, saldo, config){
  const cfg = configComPadrao(config);
  const v = Number(valor);
  if(!isFinite(v) || Math.floor(v) !== v) return 'o valor da aposta precisa ser um número inteiro de fichas';
  if(v <= 0) return 'o valor da aposta precisa ser positivo';
  if(v < cfg.aposta_minima) return 'a aposta mínima é de ' + cfg.aposta_minima + ' fichas';
  const teto = tetoDaAposta(saldo, cfg.teto_percentual);
  if(v > teto) return 'você pode apostar no máximo ' + cfg.teto_percentual + '% do seu saldo neste mercado — ' + teto + ' fichas';
  if(v > Number(saldo || 0)) return 'você não tem fichas suficientes (saldo: ' + Number(saldo || 0) + ')';
  return null;
}

/* ---------------------------------------------------------------------
   VENCEDOR DA PARTIDA

   `vencedor_id` é derivado do placar quando há diferença, e preenchido à
   mão quando não há (pênaltis, set extra, critério de regulamento).

   ⚠️ Mata-mata empatado sem `vencedor_id` devolve `indefinido`. Quem chama
   NÃO propaga e devolve erro claro. Adivinhar aqui é pior do que falhar.
   --------------------------------------------------------------------- */
function vencedorEPerdedor(p){
  if(!p) return { indefinido: true };
  const a = p.equipe_a, b = p.equipe_b;
  const pa = p.placar_a, pb = p.placar_b;
  if(p.vencedor_id){
    const venc = p.vencedor_id;
    const perd = (String(venc) === String(a)) ? b : a;
    return { vencedor: venc, perdedor: perd, indefinido: false };
  }
  if(pa == null || pb == null) return { indefinido: true };
  if(Number(pa) === Number(pb)) return { indefinido: true, empate: true };
  return Number(pa) > Number(pb)
    ? { vencedor: a, perdedor: b, indefinido: false }
    : { vencedor: b, perdedor: a, indefinido: false };
}

/* ---------------------------------------------------------------------
   MODELOS DE OPÇÃO DE MERCADO

   O painel oferece estes modelos por `placar_tipo`, mas quem cadastra pode
   escrever o que quiser: as opções são LINHAS em is_opcoes, não um enum no
   código. É o que permite um mercado esquisito e divertido ("sai gol no
   primeiro minuto?") sem tocar em código.

   `permite_empate = false` (vôlei) simplesmente não gera a opção "Empate".
   --------------------------------------------------------------------- */
function modelosDeOpcoes(tipo, categoria, nomeA, nomeB){
  const cat = categoria || {};
  const A = nomeA || 'Equipe A', B = nomeB || 'Equipe B';
  const empate = cat.permite_empate !== false;

  if(tipo === 'vencedor'){
    const r = [{ rotulo: A, lado: 'a' }];
    if(empate) r.push({ rotulo: 'Empate', lado: null });
    r.push({ rotulo: B, lado: 'b' });
    return r;
  }
  if(tipo === 'margem'){
    if(cat.placar_tipo === 'sets'){
      return [ { rotulo: '2–0 ' + A, lado:'a' }, { rotulo: '2–1 ' + A, lado:'a' },
               { rotulo: '2–1 ' + B, lado:'b' }, { rotulo: '2–0 ' + B, lado:'b' } ];
    }
    if(cat.placar_tipo === 'pontos'){
      return [ { rotulo: A + ' por 1–5', lado:'a' }, { rotulo: A + ' por 6+', lado:'a' },
               { rotulo: B + ' por 1–5', lado:'b' }, { rotulo: B + ' por 6+', lado:'b' } ];
    }
    const r = [{ rotulo: A + ' por 1–2', lado:'a' }, { rotulo: A + ' por 3+', lado:'a' }];
    if(empate) r.push({ rotulo: 'Empate', lado: null });
    r.push({ rotulo: B + ' por 1–2', lado:'b' }, { rotulo: B + ' por 3+', lado:'b' });
    return r;
  }
  return [];
}

/* ---------------------------------------------------------------------
   DESEMPATE DA CLASSIFICAÇÃO
   =====================================================================
   ⚠️ CÓPIA DECLARADA — o gêmeo mora em assets/interseries.js.
   Um teste confere que as duas dão a mesma ordem. Se alterar aqui, altere
   lá; se não der para alterar lá, não altere aqui.

   A view devolve números BRUTOS. A ordenação acontece em JavaScript porque
   o critério de confronto direto é recursivo e não cabe em SQL — e, de
   quebra, vira função pura testável, que é o que este projeto mais precisa.

   DUAS ARMADILHAS:

   1. `confronto` só é aplicável ENTRE DUAS EQUIPES. Com três empatadas, o
      critério não define ordem (pode até ciclar: A ganha de B, B de C, C de
      A). Aqui isso não é resolvido no chute: o grupo é marcado com
      `confrontoInconclusivo` e o critério seguinte decide. A tela mostra um
      asterisco. Não invente uma regra.

   2. `sorteio` é `equipe_id`, DETERMINÍSTICO. Nunca Math.random() em algo
      cujo resultado precisa ser igual para todo mundo.
   --------------------------------------------------------------------- */
const CRITERIOS_IS = {
  pontos:    (a, b) => (b.pontos     || 0) - (a.pontos     || 0),
  vitorias:  (a, b) => (b.vitorias   || 0) - (a.vitorias   || 0),
  saldo:     (a, b) => (b.saldo      || 0) - (a.saldo      || 0),
  pro:       (a, b) => (b.pontos_pro || 0) - (a.pontos_pro || 0),
  contra:    (a, b) => (a.pontos_contra || 0) - (b.pontos_contra || 0),
  jogos:     (a, b) => (a.jogos      || 0) - (b.jogos      || 0),
  sorteio:   (a, b) => Number(a.equipe_id) - Number(b.equipe_id)
};

/* confronto direto entre DUAS equipes: pontos no(s) jogo(s) entre elas,
   depois saldo desses jogos. Sem jogo entre as duas, devolve 0 (indeciso). */
function confrontoDireto(a, b, ctx){
  const partidas = (ctx && ctx.partidas) || [];
  const pv = Number((ctx && ctx.pontos_vitoria) != null ? ctx.pontos_vitoria : 3);
  const pe = Number((ctx && ctx.pontos_empate)  != null ? ctx.pontos_empate  : 1);
  const pd = Number((ctx && ctx.pontos_derrota) != null ? ctx.pontos_derrota : 0);
  let ptsA = 0, ptsB = 0, golsA = 0, golsB = 0, jogos = 0;

  for(const p of partidas){
    if(p.status !== 'encerrada') continue;
    if(p.placar_a == null || p.placar_b == null) continue;
    let ma, mb;
    if(String(p.equipe_a) === String(a.equipe_id) && String(p.equipe_b) === String(b.equipe_id)){
      ma = Number(p.placar_a); mb = Number(p.placar_b);
    } else if(String(p.equipe_a) === String(b.equipe_id) && String(p.equipe_b) === String(a.equipe_id)){
      ma = Number(p.placar_b); mb = Number(p.placar_a);
    } else continue;
    jogos++; golsA += ma; golsB += mb;
    if(ma > mb){ ptsA += pv; ptsB += pd; }
    else if(ma < mb){ ptsA += pd; ptsB += pv; }
    else { ptsA += pe; ptsB += pe; }
  }
  if(!jogos) return 0;
  if(ptsA !== ptsB) return ptsB - ptsA;   // negativo = `a` na frente
  return golsB - golsA;                   // empate em pontos: saldo do confronto
}

/* Ordena por refinamento: aplica um critério, agrupa os que continuam
   empatados, e recorre com o critério seguinte. É o que permite tratar o
   confronto direto só dentro do grupo empatado, que é onde ele faz sentido. */
function ordenarClassificacao(linhas, criterios, ctx){
  const lista = (Array.isArray(linhas) ? linhas : []).map(l => Object.assign({}, l));
  const crits = (Array.isArray(criterios) && criterios.length)
    ? criterios.slice()
    : ['pontos','vitorias','saldo','pro','confronto'];

  function refinar(grupo, i){
    if(grupo.length <= 1 || i >= crits.length){
      /* fim da lista de critérios: desempate determinístico e explícito */
      return grupo.slice().sort(CRITERIOS_IS.sorteio);
    }
    const nome = crits[i];

    if(nome === 'confronto'){
      if(grupo.length === 2){
        const r = confrontoDireto(grupo[0], grupo[1], ctx);
        if(r !== 0) return r < 0 ? [grupo[0], grupo[1]] : [grupo[1], grupo[0]];
        return refinar(grupo, i + 1);
      }
      /* 3+ empatadas: o critério NÃO define ordem. Marca e segue. */
      grupo.forEach(l => { l.confrontoInconclusivo = true; });
      return refinar(grupo, i + 1);
    }

    const cmp = CRITERIOS_IS[nome];
    if(!cmp) return refinar(grupo, i + 1);          // critério desconhecido: ignora

    const ordenado = grupo.slice().sort(cmp);
    const saida = [];
    let bloco = [ordenado[0]];
    for(let k = 1; k < ordenado.length; k++){
      if(cmp(bloco[0], ordenado[k]) === 0) bloco.push(ordenado[k]);
      else { saida.push(...refinar(bloco, i + 1)); bloco = [ordenado[k]]; }
    }
    saida.push(...refinar(bloco, i + 1));
    return saida;
  }

  return refinar(lista, 0).map((l, idx) => Object.assign(l, { posicao: idx + 1 }));
}

/* ---------------------------------------------------------------------
   MONTAGEM DE TABELA E DE CHAVE

   As duas funções abaixo são a matemática do "gerar turno" e do "gerar
   chaveamento". Moram aqui, e não no api/interseries.js, porque são puras
   e porque errar nelas é caro: uma chave mal semeada põe as duas melhores
   equipes na primeira rodada, e ninguém percebe até a tabela sair.
   --------------------------------------------------------------------- */

/* Ordem clássica de sementes: 1×8, 4×5, 2×7, 3×6. As duas primeiras
   cabeças só se encontram na final, a 1ª e a 3ª só na semi, e assim por
   diante. `n` tem que ser potência de 2. */
function ordemDeSementes(n){
  let arr = [1, 2];
  while(arr.length < n){
    const m = arr.length * 2 + 1;
    const prox = [];
    arr.forEach(s => { prox.push(s, m - s); });
    arr = prox;
  }
  return arr;
}

/* Turno de todos-contra-todos pelo método do círculo (Berger): um time
   fica parado e os outros giram. Com número ímpar de equipes entra uma
   folga — quem cai com ela naquela rodada, folga.
   O mando alterna a cada rodada para ninguém jogar sempre do mesmo lado. */
function rodadasDoCirculo(ids){
  const lista = (ids || []).slice();
  if(lista.length < 2) return [];
  if(lista.length % 2) lista.push(null);
  const n = lista.length;
  const rodadas = [];
  for(let r = 0; r < n - 1; r++){
    const jogos = [];
    for(let i = 0; i < n / 2; i++){
      const a = lista[i], b = lista[n - 1 - i];
      if(a && b) jogos.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rodadas.push(jogos);
    lista.splice(1, 0, lista.pop());
  }
  return rodadas;
}

/* ---------------------------------------------------------------------
   MERGE DA TABELA — a correção da segunda armadilha da view

   `is_classificacao` é um GROUP BY, e GROUP BY não inventa linhas: equipe
   que ainda não jogou NÃO APARECE. No começo da competição a tabela
   nasceria vazia, o que parece bug e não é.

   Quem corrige é quem lê: parta da lista de equipes do grupo (ou da
   categoria, em chave única) e zere quem não tiver linha.
   --------------------------------------------------------------------- */
const LINHA_ZERO = {
  jogos: 0, vitorias: 0, empates: 0, derrotas: 0,
  pontos_pro: 0, pontos_contra: 0, saldo: 0, pontos: 0
};
function mesclarClassificacao(equipeIds, linhas){
  const porEquipe = {};
  (linhas || []).forEach(l => { porEquipe[String(l.equipe_id)] = l; });
  return (equipeIds || []).map(id =>
    Object.assign({ equipe_id: id }, LINHA_ZERO, porEquipe[String(id)] || {})
  );
}

module.exports = {
  norm, LIMITE_ALTO, CONTA_SISTEMA,
  FUSO_EVENTO, OFFSET_EVENTO_MS, dataEvento, inicioDoDiaEvento,
  CONFIG_PADRAO, configComPadrao,
  PAPEIS_IS, ACOES_CONHECIDAS_IS, ACOES_POR_PAPEL_IS, podeExecutarIS, papelIS, VERSAO_IS,
  LIMITES_IS, REF,
  ratear, tetoDaAposta, validarValorAposta,
  vencedorEPerdedor, modelosDeOpcoes,
  ordemDeSementes, rodadasDoCirculo,
  CRITERIOS_IS, confrontoDireto, ordenarClassificacao, mesclarClassificacao, LINHA_ZERO
};
