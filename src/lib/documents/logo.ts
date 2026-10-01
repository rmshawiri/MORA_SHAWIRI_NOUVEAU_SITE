/**
 * Logo officiel prêt pour le moteur PDF.
 *
 * Décodé une fois par processus : la chaîne base64 de `logo-asset.ts` devient
 * deux tableaux d'octets que le PDF embarque tels quels. Pas de `server-only` :
 * les scripts de contrôle et les tests rendent les mêmes factures que la
 * production, avec le même logo.
 */

import { decodeBase64, type PdfImage } from '@/lib/domain/pdf-engine';

import { LOGO_ASSET } from './logo-asset';

let cached: PdfImage | null = null;

export function invoiceLogo(): PdfImage {
  cached ??= {
    name: 'Logo',
    width: LOGO_ASSET.width,
    height: LOGO_ASSET.height,
    rgb: decodeBase64(LOGO_ASSET.rgb),
    alpha: decodeBase64(LOGO_ASSET.alpha),
  };
  return cached;
}
