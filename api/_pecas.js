/* =====================================================================
   IDENTIDADE DA PEÇA (api/_pecas.js)
   =====================================================================
   Módulo compartilhado. O `_` no nome não é estilo: arquivos que começam
   com `_` não viram rota na Vercel, então isto é importável sem ficar
   exposto na web — mesmo padrão do `_moderacao.js`.

   ---------------------------------------------------------------------
   O PROBLEMA QUE ISTO RESOLVE

   Até aqui a peça não tinha identificador: ela ERA a posição dela na
   grade. `s2e3` quer dizer "terceira peça da segunda noite", e essa string
   é a chave dos votos (`submissions.grid`) e dos palpites.

   Como `salvarEdicaoCompleta` reinsere as peças renumerando (`ordem: i+1`),
   REORDENAR as peças de uma noite faz cada nota já dada apontar para a peça
   errada. Em silêncio: sem erro, sem log. Alguém estranha meses depois,
   quando o campeão daquele ano "mudou".

   ---------------------------------------------------------------------
   A CHAVE ESTÁVEL

   A coluna `pecas.chave` é atribuída UMA VEZ, na criação, e nunca mais é
   recalculada. O formato é legível de propósito — `A3.2025`, `O1.2026` —
   mas o formato não é o que dá a garantia. A garantia é o congelamento.

   ISTO É O PONTO MAIS IMPORTANTE DO ARQUIVO: se a chave fosse DERIVADA do
   campo `turma`, teríamos trocado "a peça é a posição dela" por "a peça é o
   texto da turma dela" — e `turma` é campo editável, digitado à mão, que a
   fase de acervo existe justamente para corrigir. Alguém escreveria "3A"
   onde estava "A3" em outubro e reescreveria o histórico do mesmo jeito.

   Por isso `gerarChave` só é chamada para peça NOVA. Peça que já tem chave
   carrega a dela para sempre, mesmo que a turma mude, mesmo que o título
   mude, mesmo que ela troque de noite.

   A chave não substitui o `sNeM`: os votos continuam gravados por posição.
   O que a chave permite é DETECTAR que uma posição mudou de dono — que é o
   que `planoDeRemanejamento` faz.
   ===================================================================== */

/* a chave posicional de sempre: s<noite>e<ordem> */
function chavePosicional(noite, ordem) {
  return 's' + Number(noite) + 'e' + Number(ordem);
}

/* turma -> pedaço legível e estável da chave.
   "S1 Santa Fé" -> "S1SANTAFE" ; "G33 (CETEC Santa Fé)" -> "G33CETECSANT" */
function slugTurma(turma) {
  const limpo = String(turma == null ? '' : turma)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acento
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return limpo.slice(0, 14) || 'PECA';
}

/* Gera uma chave nova, única dentro do conjunto `usadas` (um Set).
   Colisão ganha sufixo: duas peças da mesma turma no mesmo ano acontecem de
   verdade — em 2023 aconteceu quatro vezes. */
function gerarChave(turma, ano, usadas) {
  const base = slugTurma(turma) + '.' + Number(ano);
  if (!usadas || !usadas.has(base)) { if (usadas) usadas.add(base); return base; }
  for (let i = 2; ; i++) {
    const tentativa = base + '-' + i;
    if (!usadas.has(tentativa)) { usadas.add(tentativa); return tentativa; }
  }
}

/* ---------------------------------------------------------------------
   planoDeRemanejamento — o que mudou de lugar

   Recebe duas listas de { chave, noite, ordem } (antes e depois) e devolve:

     mapa      { 's1e2': 's1e3', ... }  posição antiga -> posição nova,
                                        só das peças que MUDARAM de lugar
     movidas   quantas peças mudaram de posição
     sumiram   chaves que existiam e não vieram no envio
     novas     chaves que não existiam antes

   Quem chama decide o que fazer com isso. O `salvarEdicaoCompleta` usa
   `movidas > 0` para recusar o envio quando o ano já tem votos; o script
   `remanejar-pecas.js` usa o `mapa` para reescrever os grids de verdade.
   --------------------------------------------------------------------- */
function planoDeRemanejamento(antes, depois) {
  const posAntes = new Map();
  (antes || []).forEach(p => { if (p.chave) posAntes.set(p.chave, chavePosicional(p.noite, p.ordem)); });

  const posDepois = new Map();
  (depois || []).forEach(p => { if (p.chave) posDepois.set(p.chave, chavePosicional(p.noite, p.ordem)); });

  const mapa = {};
  let movidas = 0;
  for (const [chave, de] of posAntes) {
    const para = posDepois.get(chave);
    if (para === undefined) continue;          // sumiu: tratado à parte
    if (para !== de) { mapa[de] = para; movidas++; }
  }

  const sumiram = [...posAntes.keys()].filter(c => !posDepois.has(c));
  const novas = [...posDepois.keys()].filter(c => !posAntes.has(c));

  return { mapa, movidas, sumiram, novas };
}

/* ---------------------------------------------------------------------
   aplicarRemanejamento — reescreve um grid segundo o mapa

   Renomear chaves de um objeto tem uma armadilha: aplicar o mapa entrada
   por entrada, no mesmo objeto, faz uma nota já movida ser movida de novo
   (s1e1 -> s1e2 e depois s1e2 -> s1e3 leva a nota original para s1e3). Por
   isso o resultado é montado num objeto NOVO, lendo sempre do original.

   Chave que não está no mapa é copiada como está — inclusive chave órfã de
   peça que não existe mais. Perder nota silenciosamente é exatamente o que
   este módulo existe para impedir.
   --------------------------------------------------------------------- */
function aplicarRemanejamento(grid, mapa) {
  const origem = (grid && typeof grid === 'object') ? grid : {};
  const saida = {};
  const conflitos = [];
  for (const chaveAntiga of Object.keys(origem)) {
    const destino = Object.prototype.hasOwnProperty.call(mapa, chaveAntiga) ? mapa[chaveAntiga] : chaveAntiga;
    if (Object.prototype.hasOwnProperty.call(saida, destino)) conflitos.push(destino);
    saida[destino] = origem[chaveAntiga];
  }
  return { grid: saida, conflitos };
}

module.exports = {
  chavePosicional, slugTurma, gerarChave,
  planoDeRemanejamento, aplicarRemanejamento
};
