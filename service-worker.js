/* =====================================================================
   CETECRITIC — SERVICE WORKER
   =====================================================================
   Faz o site abrir quase instantâneo e funcionar offline (o que já foi
   visitado). Estratégia: Stale-While-Revalidate para os ESTÁTICOS do
   próprio site (HTML, CSS, JS, imagens): responde na hora com o que está
   no cache e, em paralelo, busca a versão nova na rede e regrava o cache.
 
   NÃO cacheia:
     - requisições que não são GET (nada de POST de voto/login);
     - a planilha (Apps Script) — os dados vêm sempre frescos da rede,
       e o cache "instantâneo" dos dados é feito no core.js (localStorage);
     - domínios de terceiros (YouTube, Vercel insights etc.).
 
   Ao publicar uma versão nova do site, troque o número em CACHE_VERSION
   para forçar a limpeza do cache antigo. */
 
const CACHE_VERSION = 'cetecritic-v32';

/* Cache SEPARADO para as imagens de outro domínio (os posters moram no
   Supabase Storage). Fica fora do CACHE_VERSION de propósito: um poster não
   muda quando o código do site muda, e refazer o download de todas as capas a
   cada deploy é justamente o que deixava a home dependente da rede. */
const CACHE_IMG = 'cetecritic-img-v1';

/* Lê o config.js para saber qual é o festival "em destaque" (EDICAO_EM_DESTAQUE)
   agora — assim, quando esse número mudar no config.js, o service worker passa
   a pré-cachear o festival novo sozinho, sem precisar editar nada aqui.
   Envolto em try/catch: se o config.js não carregar por algum motivo, o SW
   ainda funciona normalmente, só sem esse pedaço extra do PRECACHE. */
try { importScripts('/config.js'); } catch (e) { /* segue sem os dados do ano em destaque */ }
 
const CFG_ATUAL = (typeof EDICOES !== 'undefined' && typeof EDICAO_EM_DESTAQUE !== 'undefined')
  ? (EDICOES.find(e => e.ano === EDICAO_EM_DESTAQUE) || null)
  : null;
const ANO_ATUAL = (CFG_ATUAL && !CFG_ATUAL.emBreve) ? EDICAO_EM_DESTAQUE : null;
 
/* Endereços que valem a pena já deixar prontos na primeira visita.
   Se algum não existir, o addAll ignora silenciosamente (ver install). */
const PRECACHE = [
  '/index.html',
  '/busca.html',
  '/hall.html',
  '/perfil.html',
  '/em-breve.html',
  '/config.js',
  '/home-dados.js',
  '/hall-dados.js',
  '/perfil.js',
  '/termos.pdf',
  '/assets/core.js',
  '/assets/estilo.css',
  '/assets/logo.png',
  '/assets/logo-rodape.png',
  '/assets/favicon.png',
  '/manifest.webmanifest',
  /* páginas e dados do Cetec Festival ATUAL (o definido em EDICAO_EM_DESTAQUE) */
  ...(ANO_ATUAL ? [
    `/${ANO_ATUAL}/index.html`,
    `/${ANO_ATUAL}/sobre.html`,
    `/${ANO_ATUAL}/abertura.html`,
    `/${ANO_ATUAL}/monte.html`,
    `/${ANO_ATUAL}/edicao.js`,
    /* ANTES havia um `/${ANO_ATUAL}/poster.jpg` aqui. Esse caminho deixou de
       existir quando os posters foram para o Supabase Storage: o cache.add
       dava 404 e era engolido pelo .catch(), então a capa NUNCA era
       pré-cacheada. O endereço real vem do config.js (EDICOES[].poster) e
       está logo abaixo, em PRECACHE_IMG. */
    ...Array.from({ length: CFG_ATUAL.noites || 0 }, (_, i) => `/${ANO_ATUAL}/noite-${i + 1}.html`),
    ...Array.from({ length: CFG_ATUAL.noites || 0 }, (_, i) => `/${ANO_ATUAL}/noites/noite-${i + 1}.js`)
  ] : [])
];

/* capas das edições — endereços absolutos do Storage, guardados no CACHE_IMG */
const PRECACHE_IMG = (typeof EDICOES !== 'undefined' && Array.isArray(EDICOES))
  ? EDICOES.map(e => e && e.poster).filter(p => /^https?:\/\//i.test(String(p || '')))
  : [];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    /* cacheia um a um: se um endereço faltar, não derruba os outros */
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    /* as capas vão pro cache de imagens, que sobrevive à troca de versão */
    const cacheImg = await caches.open(CACHE_IMG);
    await Promise.all(PRECACHE_IMG.map(url =>
      cacheImg.add(new Request(url, { mode: 'no-cors' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    const manter = [CACHE_VERSION, CACHE_IMG];
    await Promise.all(nomes.filter(n => manter.indexOf(n) < 0).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});
 
/* Estes caminhos são gerados na hora pelo /api/content (config.js, listas de
   edições, dados de cada noite etc.) — ou seja, mudam sempre que o admin
   edita algo no painel. Pra esses, NÃO faz sentido "stale-while-revalidate"
   (que mostra o cache velho e só atualiza pra próxima vez): a gente tenta a
   rede PRIMEIRO e só cai pro cache se estiver offline. Assim, um reload
   normal (sem precisar de Ctrl+Shift+R) já mostra a mudança na hora. */
function ehArquivoDeDados_(pathname) {
  if (['/config.js', '/hall-dados.js', '/perfil.js', '/home-dados.js'].includes(pathname)) return true;
  if (/^\/\d{4}\/edicao\.js$/.test(pathname)) return true;
  if (/^\/\d{4}\/noites\/noite-\d+\.js$/.test(pathname)) return true;
  return false;
}

self.addEventListener('fetch', event => {
  const req = event.request;
 
  /* só mexemos em GET; o resto passa direto */
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* ---- IMAGENS de outro domínio: cache-first ----
     As capas das edições moram no Supabase Storage. Antes o SW devolvia cedo
     pra tudo que não fosse do próprio site, então a capa saía pela rede em
     TODA visita nova — e um soluço qualquer virava "Sem capa" no card da home.
     Um poster não muda de conteúdo (uma capa nova ganha URL nova), então
     cache-first é seguro e a segunda visita nunca mais depende da rede.

     A resposta é `opaque` (vem de outra origem, sem CORS): não dá pra ler
     status nem corpo, mas dá pra guardar e devolver — que é tudo que o <img>
     precisa. Por isso o teste é "veio alguma coisa", não "resp.ok". */
  if (url.origin !== self.location.origin) {
    if (req.destination === 'image') {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE_IMG);
        const cacheado = await cache.match(req);
        if (cacheado) return cacheado;
        const resp = await fetch(req);
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      })());
    }
    return;
  }

  /* a API (dados frescos) e o script de insights nunca entram no cache */
  if (url.pathname.startsWith('/_vercel/')) return;
  if (url.pathname.startsWith('/api/')) return;

  /* arquivos de DADOS (gerados por /api/content): network-first */
  if (ehArquivoDeDados_(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const resp = await fetch(req, { cache: 'reload' });
        if (resp && resp.status === 200 && resp.type === 'basic') {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch (e) {
        const cacheado = await cache.match(req);
        if (cacheado) return cacheado;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }
 
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cacheado = await cache.match(req);
 
    /* busca a versão nova em paralelo e regrava (revalidate).
       cache:'reload' ignora a cache HTTP do navegador (que é separada do
       Cache Storage acima) — sem isso, uma resposta antiga (ex.: um 404
       de quando a página ainda não existia) podia ficar "grudada" e o
       navegador nem chegava a sair pela rede de novo. */
    const rede = fetch(req, { cache: 'reload' }).then(resp => {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        cache.put(req, resp.clone()).catch(() => {});
      }
      return resp;
    }).catch(() => null);
 
    /* stale: se tem cache, devolve na hora; senão espera a rede */
    if (cacheado) { event.waitUntil(rede); return cacheado; }
    const resp = await rede;
    if (resp) return resp;
 
    /* offline e sem cache: para navegação, cai no index já cacheado */
    if (req.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
 
/* =====================================================================
   PUSH (F2) — recebe a notificação e trata o clique
   =====================================================================
   O payload enviado pela função do Vercel é um JSON:
     { title, body, url, icon }  (todos opcionais menos title/body) */
self.addEventListener('push', event => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; }
  catch (e) { dados = { title: 'CETECritic', body: event.data ? event.data.text() : '' }; }
  const titulo = dados.title || 'CETECritic';
  /* o arquivo é icon.JPG (é o que existe em /assets e o que o manifest usa).
     Apontar pra icon.png dava 404 e a notificação saía com o ícone genérico
     do navegador em vez da marca. */
  const opcoes = {
    body: dados.body || '',
    icon: dados.icon || '/assets/icon.jpg',
    badge: '/assets/favicon.png',
    data: { url: dados.url || '/index.html' }
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});
 
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/index.html';
  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const alvo = new URL(destino, self.location.origin).href;
    /* se já existe uma aba NA PÁGINA certa, só foca. Antes o navigate()
       rodava sempre e recarregava a aba à toa — se a pessoa estivesse
       preenchendo uma avaliação, perdia o que tinha digitado. */
    for (const c of clientes) { if (c.url === alvo && 'focus' in c) return c.focus(); }
    for (const c of clientes) {
      if ('focus' in c) {
        try { if (c.navigate) await c.navigate(alvo); } catch (e) { /* aba de outra origem */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(alvo);
  })());
});

/* =====================================================================
   pushsubscriptionchange — o navegador trocou/expirou a inscrição
   =====================================================================
   Quando isso acontece (inscrição morta/rotacionada), a gente refaz a
   inscrição na hora com a MESMA chave pública (vem do config.js importado).
   O SW não tem o token do usuário pra salvar no servidor, então quem grava a
   nova inscrição é o site na próxima visita (verificarInscricaoPush no core.js),
   que faz o apiSalvarPush com o token. Aqui só garantimos que o navegador volte
   a ter uma inscrição VÁLIDA. */
function urlB64ParaUint8_(base64){
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      if (typeof VAPID_PUBLIC_KEY === 'undefined') return;
      await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ParaUint8_(VAPID_PUBLIC_KEY)
      });
    } catch (e) { /* na próxima visita o site tenta religar */ }
  })());
});
 