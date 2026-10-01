/**
 * Partage du vrai fichier PDF — chaque situation simulée.
 *
 * Le bouton « Envoyer par WhatsApp / partager » repose sur trois fonctions
 * pures de `src/lib/documents/share.ts`. On les éprouve ici avec un `fetch`
 * et un `navigator` de substitution : appareil compatible, appareil qui ne
 * sait pas partager de fichier, partage annulé, réseau coupé, réponse qui
 * n'est pas un PDF.
 *
 * Et l'on vérifie, dans le code du bouton, ce qu'il ne doit jamais faire :
 * prétendre joindre un fichier par un lien `wa.me`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { canShareFile, fetchDocumentFile, shareFile, type ShareCapableNavigator } from '../../src/lib/documents/share';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // %PDF-1.4
const NAME = 'MORA-FACL-A0001.pdf';

function fakeFetch(body: BodyInit | null, init: ResponseInit & { type?: string } = {}): typeof fetch {
  return (async () =>
    new Response(body, {
      status: init.status ?? 200,
      headers: { 'content-type': init.type ?? 'application/pdf' },
    })) as unknown as typeof fetch;
}

test('le vrai PDF est récupéré et devient un fichier nommé par la référence', async () => {
  let asked: RequestInit | undefined;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    asked = init;
    return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
  }) as unknown as typeof fetch;

  const result = await fetchDocumentFile('/api/documents/MORA-FACL-A0001/', NAME, fetchImpl);
  assert.ok(result.ok);
  if (!result.ok) return;

  assert.equal(result.file.name, NAME);
  assert.equal(result.file.type, 'application/pdf');
  const bytes = new Uint8Array(await result.file.arrayBuffer());
  assert.deepEqual(bytes, PDF, 'le fichier partagé est exactement le PDF reçu');
  assert.equal(asked?.credentials, 'same-origin', 'la session du navigateur fait foi');
  assert.equal(asked?.cache, 'no-store');
});

test('une erreur réseau n’est pas déguisée en fichier', async () => {
  const failing = (async () => {
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;
  assert.deepEqual(await fetchDocumentFile('/x', NAME, failing), { ok: false });
});

test('un refus (404) ou une page HTML ne deviennent jamais « MORA-FACL-….pdf »', async () => {
  assert.deepEqual(await fetchDocumentFile('/x', NAME, fakeFetch('Document introuvable.', { status: 404, type: 'text/plain' })), { ok: false });
  assert.deepEqual(await fetchDocumentFile('/x', NAME, fakeFetch('<html></html>', { type: 'text/html' })), { ok: false });
  assert.deepEqual(await fetchDocumentFile('/x', NAME, fakeFetch(new Uint8Array(0))), { ok: false });
});

test('appareil compatible : le partage de fichier est proposé', () => {
  const file = new File([PDF], NAME, { type: 'application/pdf' });
  const seen: unknown[] = [];
  const nav: ShareCapableNavigator = {
    share: async () => {},
    canShare: (data) => {
      seen.push(data);
      return Array.isArray(data.files) && data.files[0]?.type === 'application/pdf';
    },
  };
  assert.equal(canShareFile(nav, file), true);
  assert.deepEqual(seen, [{ files: [file] }], 'canShare est interrogé avec le fichier lui-même');
});

test('appareil incompatible : pas de partage prétendu, repli par téléchargement', () => {
  const file = new File([PDF], NAME, { type: 'application/pdf' });
  assert.equal(canShareFile(undefined, file), false);
  assert.equal(canShareFile({}, file), false, 'navigateur sans Web Share');
  assert.equal(canShareFile({ share: async () => {} }, file), false, 'share sans canShare');
  assert.equal(canShareFile({ share: async () => {}, canShare: () => false }, file), false, 'fichiers refusés');
  assert.equal(
    canShareFile({ share: async () => {}, canShare: () => { throw new TypeError('x'); } }, file),
    false,
  );
});

test('le partage transmet le fichier réel, avec un titre', async () => {
  const file = new File([PDF], NAME, { type: 'application/pdf' });
  let shared: { files?: File[]; title?: string } | undefined;
  const outcome = await shareFile({ share: async (data) => { shared = data; } }, file, 'Facture MORA-FACL-A0001');
  assert.equal(outcome, 'shared');
  assert.equal(shared?.files?.[0], file);
  assert.equal(shared?.title, 'Facture MORA-FACL-A0001');
});

test('fermer la feuille de partage est une annulation, pas une panne', async () => {
  const file = new File([PDF], NAME, { type: 'application/pdf' });
  const abort = new DOMException('Share canceled', 'AbortError');
  assert.equal(await shareFile({ share: async () => { throw abort; } }, file, 't'), 'cancelled');
  const denied = new DOMException('Must be handling a user gesture', 'NotAllowedError');
  assert.equal(await shareFile({ share: async () => { throw denied; } }, file, 't'), 'failed');
});

test('le bouton ne prétend jamais joindre un fichier par wa.me', () => {
  const source = readFileSync(resolve(process.cwd(), 'src', 'components', 'documents', 'DocumentShareButton.tsx'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/wa\.me|api\.whatsapp|whatsapp:\/\//i.test(code), 'aucun lien WhatsApp textuel');
  assert.ok(!/envoyé sur WhatsApp|envoyé par WhatsApp/i.test(code), 'aucune promesse d’envoi automatique');
  assert.match(code, /canShareFile\(navigator, fetched\.file\)/, 'la compatibilité est vérifiée sur le fichier');
  assert.match(code, /saveFile\(/, 'le repli télécharge le vrai fichier');
});

test('aucune clé secrète dans les composants et modules du navigateur', () => {
  for (const path of [
    ['src', 'components', 'documents', 'DocumentShareButton.tsx'],
    ['src', 'lib', 'documents', 'share.ts'],
  ]) {
    const source = readFileSync(resolve(process.cwd(), ...path), 'utf8');
    assert.ok(!/SUPABASE_SECRET|service_role|getAdminSupabaseClient|supabase\/admin/.test(source), path.join('/'));
  }
});
