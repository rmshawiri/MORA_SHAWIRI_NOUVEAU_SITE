/**
 * Téléchargement d'un document officiel.
 *
 * Applique littéralement les deux règles du § 184-185 du stockage :
 *
 *   document client        → authentification → propriété  → téléchargement
 *   document administratif → authentification → permission → accès
 *
 * Elles ne sont pourtant écrites nulle part dans ce fichier. C'est le point
 * important : la décision appartient aux politiques RLS de `public.documents`,
 * et cette route se contente de demander la pièce avec la session de la
 * personne. Un document qu'elle n'a pas le droit de lire ne remonte pas, et la
 * route répond alors exactement comme pour une référence inexistante.
 *
 * ## Pourquoi 404 partout
 *
 * Trois situations différentes — référence mal formée, document inexistant,
 * document interdit — donnent la même réponse. Le § 102 du tableau de bord
 * demande de ne pas révéler inutilement ce qui existe : un 403 confirmerait à
 * qui essaie des références au hasard que `MORA-FACL-A0007` en est une. La
 * vraie protection reste RLS ; l'uniformité des réponses évite d'en donner la
 * carte.
 *
 * ## Pourquoi aucune redirection
 *
 * Le proxy ne couvre pas `/api/` : une route d'API qui renverrait la page de
 * connexion en HTML casserait tout appel programmatique, et un navigateur qui
 * télécharge un fichier n'a pas de quoi suivre un formulaire de connexion. Un
 * visiteur non connecté reçoit donc un refus, pas un aiguillage.
 *
 * Références : `05_STOCKAGE.md` § 124, § 128-131, § 184-185 ;
 * `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 102 ; prompt maître § 39-42.
 */

import { NextResponse } from 'next/server';

import { getInvoicePdf } from '@/lib/documents/invoices';
import { getDocumentByReference, renderDocument } from '@/lib/documents/service';
import { documentFileName, parseReference } from '@/lib/domain/documents';
import { recordAuditEvent } from '@/lib/rbac';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { ProfileRow } from '@/lib/supabase/types';

export const runtime = 'nodejs';
/** Une pièce dépend de la session qui la demande : rien n'est pré-rendu. */
export const dynamic = 'force-dynamic';

/**
 * Réponse unique à tout ce qui n'aboutit pas. Volontairement dépourvue de
 * détail : le corps ne dit pas laquelle des trois situations s'est produite.
 */
function refuse(): NextResponse {
  return new NextResponse('Document introuvable.', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * En-têtes communs à toute pièce servie.
 *
 * `?affichage=1` demande l'ouverture dans le navigateur plutôt que le
 * téléchargement — c'est la consultation depuis la fiche. Le fichier est le
 * même ; seule la disposition change.
 */
function pdfResponse(bytes: Uint8Array, asciiName: string, fileName: string, inline: boolean): NextResponse {
  const disposition =
    `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; ` +
    `filename*=UTF-8''${encodeURIComponent(fileName)}`;

  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      'Content-Length': String(bytes.byteLength),
      // § 124 : un document privé ne doit jamais être mis en cache partagé.
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ reference: string }> },
): Promise<NextResponse> {
  const { reference: raw } = await context.params;

  const reference = decodeURIComponent(raw ?? '').trim().toUpperCase();
  if (!parseReference(reference)) return refuse();

  const supabase = await getServerSupabaseClient();
  if (!supabase) return refuse();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return refuse();

  const inline = new URL(request.url).searchParams.get('affichage') === '1';

  /*
   * Facture : rendue depuis son instantané figé à l'émission, ou servie depuis
   * son archive. Jamais recomposée à partir de la commande ou du catalogue
   * courants. Nom de fichier : la référence officielle, et elle seule.
   */
  if (parseReference(reference)?.type === 'FACL') {
    const invoice = await getInvoicePdf(reference);
    if (!invoice) return refuse();

    await recordAuditEvent({
      action: 'documents.telechargement',
      resourceType: 'document',
      resourceId: reference,
      result: 'SUCCES',
      metadata: { type: 'FACL', source: invoice.source },
    });

    return pdfResponse(invoice.bytes, invoice.fileName, invoice.fileName, inline);
  }

  const document = await getDocumentByReference(reference);
  if (!document) return refuse();

  // Le nom du fichier suit le nom **courant** du destinataire lorsque c'est lui
  // qui télécharge ; la pièce, elle, garde le nom figé à l'émission. Le § 40
  // n'interdit que de toucher à l'identifiant, et c'est bien ce qui se passe :
  // la référence est la même dans les deux cas.
  let currentSubjectName: string | null = document.subject_name;

  if (document.owner_id && document.owner_id === userData.user.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, username')
      .eq('id', userData.user.id)
      .maybeSingle();

    const row = profile as Pick<ProfileRow, 'full_name' | 'username'> | null;
    currentSubjectName = row?.full_name ?? row?.username ?? document.subject_name;
  }

  const { bytes, fileName } = renderDocument(document, { currentSubjectName });

  await recordAuditEvent({
    action: 'documents.telechargement',
    resourceType: 'document',
    resourceId: document.reference,
    result: 'SUCCES',
    metadata: { type: document.doc_type, proprietaire: document.owner_id === userData.user.id },
  });

  // `filename` en ASCII pour les clients anciens, `filename*` pour les autres.
  // Le nom normalisé par le § 42 est déjà dépourvu d'accents et de caractères
  // interdits ; les deux formes coïncident donc presque toujours.
  return pdfResponse(bytes, documentFileName(document.reference, null), fileName, inline);
}
