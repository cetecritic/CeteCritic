/* =====================================================================
   COMPRIME E SOBE as imagens atuais (poster.jpg / sobre-banner.jpg) de cada
   ano pro Supabase Storage, e atualiza as edições com as URLs.
   =====================================================================
   Converte pra WebP de alta qualidade (comprime bem mais que JPG, sem perda
   visível) e reduz pra no máx. 1400px de largura. Roda uma vez, na raiz:

     1) npm.cmd install sharp            (dependência de compressão)
     2) $env:SUPABASE_URL="..."; $env:SUPABASE_SECRET_KEY="..."; node subir-imagens.js

   Precisa do bucket "conteudo" (público) já criado no Supabase Storage.
   Pode rodar de novo sem problema (upsert).
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY.'); process.exit(1);
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const raiz = __dirname;
const BUCKET = 'conteudo';
const ehUrl = v => /^https?:\/\//.test(String(v || ''));

async function comprimir(arquivo) {
  /* rotate() respeita a orientação EXIF.
     1600px @ q88 (era 1400 @ q80) pra bater com o que o painel admin passou
     a gerar — o pôster é exportado no card de compartilhamento perto de
     1080px de largura, então 1400 já entregava a imagem no limite.
     `kernel: lanczos3` é o reamostrador mais nítido do sharp. */
  return await sharp(arquivo)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true, kernel: 'lanczos3' })
    .webp({ quality: 88, effort: 6 })
    .toBuffer();
}
async function subir(buffer, dest) {
  const { error } = await sb.storage.from(BUCKET).upload(dest, buffer, { contentType: 'image/webp', upsert: true });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(dest).data.publicUrl;
}

(async () => {
  const { data: eds } = await sb.from('edicoes').select('ano,poster,sobre');
  for (const e of (eds || [])) {
    const ano = e.ano;
    const pasta = path.join(raiz, String(ano));

    // POSTER
    if (!ehUrl(e.poster)) {
      const nome = e.poster && String(e.poster).trim() ? e.poster : 'poster.jpg';
      const p = path.join(pasta, nome);
      if (fs.existsSync(p)) {
        try {
          const buf = await comprimir(p);
          const url = await subir(buf, 'edicoes/poster_' + ano + '.webp');
          await sb.from('edicoes').update({ poster: url }).eq('ano', ano);
          console.log(ano, 'poster ->', Math.round(buf.length / 1024) + 'KB');
        } catch (err) { console.warn('  ! poster', ano, err.message); }
      }
    }

    // SOBRE-BANNER
    const bannerNome = (e.sobre && e.sobre.banner && !ehUrl(e.sobre.banner)) ? e.sobre.banner : 'sobre-banner.jpg';
    if (!(e.sobre && ehUrl(e.sobre.banner))) {
      const p = path.join(pasta, bannerNome);
      if (fs.existsSync(p)) {
        try {
          const buf = await comprimir(p);
          const url = await subir(buf, 'edicoes/sobre_' + ano + '.webp');
          const sobre = Object.assign({}, e.sobre || {}, { banner: url });
          await sb.from('edicoes').update({ sobre }).eq('ano', ano);
          console.log(ano, 'sobre-banner ->', Math.round(buf.length / 1024) + 'KB');
        } catch (err) { console.warn('  ! sobre-banner', ano, err.message); }
      }
    }
  }
  // era '\\n' (barra + n literal, não quebra de linha)
  console.log('\nPronto! Imagens comprimidas, subidas e edições atualizadas.');
})().catch(e => { console.error(e); process.exit(1); });
