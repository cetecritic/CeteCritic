/* Gera um par de chaves VAPID (P-256) válido, usando só o Node embutido.
   Rode com:  node gerar-vapid.js
   - Public Key  -> config.js (VAPID_PUBLIC_KEY) e Vercel (VAPID_PUBLIC_KEY)
   - Private Key -> só na Vercel (VAPID_PRIVATE_KEY)
   Depois pode apagar este arquivo. */
const crypto = require('crypto');

const ec = crypto.createECDH('prime256v1');
ec.generateKeys();

const b64url = b => Buffer.from(b).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// pública = ponto não comprimido (65 bytes, começa com 0x04)
const pub = ec.getPublicKey();
// privada = escalar de 32 bytes (garante o padding à esquerda se vier menor)
let priv = ec.getPrivateKey();
if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);

console.log('');
console.log('Public Key: ', b64url(pub));
console.log('Private Key:', b64url(priv));
console.log('');
console.log('(pública tem', pub.length, 'bytes = 65 esperado; privada', priv.length, 'bytes = 32 esperado)');
