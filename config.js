/* =====================================================================
   CETECRITIC — CONFIGURAÇÃO GERAL (config.js)
   =====================================================================
   Tudo que muda com frequência fica AQUI ou nos arquivos do ano:
     - ANO/edicao.js .............. título, descrição, datas e textos do ano
     - ANO/noites/noite-N.js ...... DATA e PEÇAS de cada noite
   ===================================================================== */

/* Edição mostrada quando alguém abre cetecritic.xyz.
   Troque este número e pronto — a votação "em destaque" muda de ano. */
const EDICAO_EM_DESTAQUE = 2026;

/* Edições que aparecem no menu lateral (a ordem aqui = ordem do menu).
   Para um ano novo: copie a pasta de um ano, ajuste os arquivos dela
   e adicione uma linha aqui.
     ano ........... pasta do ano (ex: 2027 -> pasta /2027)
     noites ........ quantas noites aparecem no menu e na grade
     abreEm ........ (opcional) data da 1ª noite — usada no countdown
                     "faltam X para o próximo festival" do banner final
     monteAbreEm ... (opcional) quando o "Monte o Seu" desse ano libera
     emBreve ....... (opcional) true = a edição vira só um aviso "Em breve"
                     (SEM countdown). NÃO precisa criar pasta do ano: o menu
                     manda para uma página compartilhada (em-breve.html).
                     Ideal para anos retrô/futuros que ainda não têm conteúdo.

   O menu lateral agrupa as edições por década automaticamente — não precisa
   fazer nada, basta a linha do ano estar aqui. */
const EDICOES = [
  { ano: 2027, noites: 5,
    abreEm: '2027-07-12T19:00:00-03:00',
    monteAbreEm: '2027-07-01T00:00:00-03:00' },
  { ano: 2026, noites: 5 },
  { ano: 2025, noites: 5 },
  { ano: 2024, noites: 5 },
  { ano: 2023, noites: 5 },
  { ano: 2022, noites: 5 },
  { ano: 2021, noites: 5 },
  { ano: 2020, noites: 3 },
  { ano: 2019, noites: 4 },
  { ano: 2018, noites: 4, emBreve: true },
  { ano: 2017, noites: 4, emBreve: true  },
  { ano: 2016, noites: 4, emBreve: true  },
  { ano: 2015, noites: 4, emBreve: true  },
  { ano: 2014, noites: 4, emBreve: true  },
  { ano: 2013, noites: 4, emBreve: true  },
  { ano: 2012, noites: 4, emBreve: true  },
  { ano: 2011, noites: 4, emBreve: true  },
  { ano: 2010, noites: 4, emBreve: true  },
  { ano: 2009, noites: 4, emBreve: true  },
  { ano: 2008, noites: 4, emBreve: true  },
  { ano: 2007, noites: 4, emBreve: true  },
  { ano: 2006, noites: 4, emBreve: true  },
  { ano: 2005, noites: 4, emBreve: true  },
  { ano: 2004, noites: 4, emBreve: true  },
  { ano: 2003, noites: 4, emBreve: true  },
  { ano: 2002, noites: 4, emBreve: true  },
  { ano: 2001, noites: 4, emBreve: true  },
  { ano: 2000, noites: 4, emBreve: true  },
  { ano: 1999, noites: 4, emBreve: true  },
  { ano: 1998, noites: 4, emBreve: true  },
  { ano: 1997, noites: 4, emBreve: true  }

  /* Exemplo de ano futuro sem data ainda: aparece como "Em breve", sem contador.
     Copie a pasta de um ano, ajuste os arquivos e descomente a linha abaixo. */
  //{ ano: 2028, noites: 5, emBreve: true },

  //{ ano: 2028, noites: 5,
  //  abreEm: '2028-07-10T19:00:00-03:00',
  //  monteAbreEm: '2028-07-01T00:00:00-03:00' },
];

/* Planilha (Google Apps Script) que guarda os votos — vale para todos os anos */
const API_URL = 'https://script.google.com/macros/s/AKfycbwuwKpZ8XUWKHKlw3ZiPS-1HiWvt6hqwHAFtsLS10Rf_ToI3h_eIaDdXIY-ZlQcUuJLQg/exec';

/* Chave PÚBLICA VAPID das notificações push (NÃO é segredo — pode ficar aqui).
   Precisa ser a MESMA da variável VAPID_PUBLIC_KEY na Vercel; a chave privada
   correspondente vive só no Vercel (VAPID_PRIVATE_KEY). Se trocar o par de
   chaves, todos os aparelhos precisam se reinscrever no push. */
const VAPID_PUBLIC_KEY = 'BHHyvYlbob5Jvt8h_7g8H96uT8eqFH1QlPo-jUNfY_R9fCVOnKh0VKQvvwarizc5EgpyfPbUOPff46DAchJkZBQ';

/* Nota máxima aceita nos formulários (mantenha igual ao MAX_RATING do Apps Script) */
const NOTA_MAXIMA = 10;

/* Votos antigos SEM a coluna "ano" preenchida na planilha pertencem a esta
   edição (os primeiros votos de 2026 foram salvos antes da coluna existir).
   Sem isso, eles apareceriam em todas as edições. */
const ANO_VOTOS_ANTIGOS = 2026;

/* E-mail de contato (rodapé + aviso das edições históricas) */
const EMAIL_CONTATO = 'cetecritic@gmail.com';

/* Edições deste ano PARA TRÁS são "históricas": ao entrar nelas aparece um
   aviso de que há poucos dados e um convite para contribuir por e-mail */
const ANO_EDICAO_HISTORICA = 2009;

/* Frase de apoio da página inicial (cetecritic.xyz) */
const SLOGAN_HOME = 'O Cetec Festival na palma da sua mão: vote nas peças, acompanhe as médias ao vivo, compare edições e explore a história do maior festival estudantil do sul do pais.';

/* Tempo mínimo entre envios de avaliação (anti-spam), em minutos */
const COOLDOWN_MINUTOS = 5;

/* Texto do rodapé de todas as páginas */
const RODAPE = 'Esse site não é filiado, ou mantém qualquer relação de forma oficial com nenhuma mantida da FUCS';
