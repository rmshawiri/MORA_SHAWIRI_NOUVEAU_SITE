/**
 * Partage d'une pièce officielle — logique, sans interface.
 *
 * Séparée du bouton pour être éprouvée sans navigateur : chaque situation
 * (appareil compatible, incompatible, partage annulé, réseau coupé, réponse
 * qui n'est pas un PDF) se simule en passant un `fetch` et un `navigator` de
 * substitution.
 *
 * Rien ici ne parle de WhatsApp, et c'est voulu : la feuille de partage de
 * l'appareil propose WhatsApp quand il est installé ; un site web ne peut pas
 * l'imposer, et ne prétend pas le faire.
 */

export type ShareCapableNavigator = {
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

export type FetchResult = { ok: true; file: File } | { ok: false };

/**
 * Récupère le vrai PDF par la route authentifiée et en fait un fichier.
 *
 * Refuse tout ce qui n'est pas un PDF non vide : une page d'erreur HTML
 * transmise sous le nom `MORA-FACL-A0001.pdf` serait pire qu'un échec.
 */
export async function fetchDocumentFile(
  href: string,
  fileName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchResult> {
  try {
    const response = await fetchImpl(href, { credentials: 'same-origin', cache: 'no-store' });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('application/pdf')) return { ok: false };

    const blob = await response.blob();
    if (blob.size === 0) return { ok: false };

    return { ok: true, file: new File([blob], fileName, { type: 'application/pdf' }) };
  } catch {
    return { ok: false };
  }
}

/** Vrai seulement si l'appareil sait partager **ce fichier-là**. */
export function canShareFile(nav: ShareCapableNavigator | undefined, file: File): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

/**
 * Ouvre la feuille de partage avec le fichier joint.
 *
 * Fermer la feuille sans choisir (`AbortError`) est un choix de la personne,
 * pas une panne : il est rendu comme tel.
 */
export async function shareFile(nav: ShareCapableNavigator, file: File, title: string): Promise<ShareOutcome> {
  try {
    await nav.share!({ files: [file], title });
    return 'shared';
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
