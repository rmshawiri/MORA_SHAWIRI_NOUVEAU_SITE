/**
 * Prépare le logo officiel pour les documents PDF.
 *
 *   node scripts/build-pdf-logo.mjs
 *
 * Lit `public/logo-rect.png` (RGBA 8 bits), le réduit de moitié, sépare les
 * couleurs de la transparence, comprime chaque plan, et écrit
 * `src/lib/documents/logo-asset.ts`.
 *
 * ## Pourquoi un fichier généré et versionné
 *
 * Une fonction Vercel ne garantit pas l'accès au dossier `public/` : ses
 * fichiers sont servis par le CDN, pas embarqués dans le paquet serveur. Le
 * logo voyage donc dans le code, sous une forme que le PDF accepte telle
 * quelle (`/FlateDecode`), sans décodage PNG à chaque facture. Le résultat est
 * déterministe : même PNG, mêmes octets.
 *
 * À relancer uniquement si le logo officiel change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';

import { PROJECT_ROOT } from './lib/config.mjs';

const SOURCE = resolve(PROJECT_ROOT, 'public', 'logo-rect.png');
const TARGET = resolve(PROJECT_ROOT, 'src', 'lib', 'documents', 'logo-asset.ts');
const FACTOR = 2;

function readPng(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) throw new Error('PNG attendu');

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!header || header.depth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error('Seul le PNG RGBA 8 bits non entrelacé est pris en charge');
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = header.width * bpp;
  const pixels = Buffer.alloc(stride * header.height);

  // Défiltrage PNG (types 0 à 4), ligne par ligne.
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { ...header, pixels };
}

const png = readPng(readFileSync(SOURCE));
const width = Math.floor(png.width / FACTOR);
const height = Math.floor(png.height / FACTOR);
const rgb = Buffer.alloc(width * height * 3);
const alpha = Buffer.alloc(width * height);

// Réduction par moyenne pondérée par l'opacité : un pixel transparent ne
// noircit pas le bord de son voisin.
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let dy = 0; dy < FACTOR; dy += 1) {
      for (let dx = 0; dx < FACTOR; dx += 1) {
        const index = ((y * FACTOR + dy) * png.width + (x * FACTOR + dx)) * 4;
        const opacity = png.pixels[index + 3];
        r += png.pixels[index] * opacity;
        g += png.pixels[index + 1] * opacity;
        b += png.pixels[index + 2] * opacity;
        a += opacity;
      }
    }
    const target = y * width + x;
    rgb[target * 3] = a > 0 ? Math.round(r / a) : 255;
    rgb[target * 3 + 1] = a > 0 ? Math.round(g / a) : 255;
    rgb[target * 3 + 2] = a > 0 ? Math.round(b / a) : 255;
    alpha[target] = Math.round(a / (FACTOR * FACTOR));
  }
}

const rgbDeflated = deflateSync(rgb, { level: 9 }).toString('base64');
const alphaDeflated = deflateSync(alpha, { level: 9 }).toString('base64');

const source = `/**
 * Logo officiel MORA Shawiri, préparé pour les documents PDF.
 *
 * FICHIER GÉNÉRÉ par \`scripts/build-pdf-logo.mjs\` à partir de
 * \`public/logo-rect.png\`. Ne pas modifier à la main : relancer le script si le
 * logo officiel change.
 *
 * Deux plans comprimés en zlib (\`/FlateDecode\`) : les couleurs RVB, et la
 * transparence en masque doux (\`/SMask\`). Le PDF les accepte tels quels.
 */

export const LOGO_ASSET = {
  width: ${width},
  height: ${height},
  rgb: '${rgbDeflated}',
  alpha: '${alphaDeflated}',
} as const;
`;

writeFileSync(TARGET, source, 'utf8');
console.log(`logo-asset.ts écrit — ${width}×${height}, ${Math.round((rgbDeflated.length + alphaDeflated.length) / 1024)} Kio en base64`);
