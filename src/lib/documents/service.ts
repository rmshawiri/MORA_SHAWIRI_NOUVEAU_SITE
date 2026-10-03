import 'server-only';

/**
 * Moteur de Documents — service transverse.
 *
 * Ce module est le seul point d'entrée applicatif vers la numérotation
 * officielle. Devis, commandes, factures et relevés de commission l'appelleront
 * en phases 4F à 4H ; aucun d'eux n'aura à connaître le format d'une référence,
 * ni à savoir qu'un compteur existe.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne calcule aucun numéro. `issueDocument()` délègue intégralement à
 * `public.issue_document()`, qui alloue sous verrou de ligne et enregistre dans
 * la même transaction. Le § 36 du prompt maître l'exige, et la base le rend
 * opposable : le rôle `authenticated` n'a aucun privilège d'écriture sur
 * `public.documents`, et la fonction d'allocation ne lui est pas exécutable.
 *
 * Il n'administre rien non plus. Le Moteur de Documents n'est pas un des 13
 * modules officiels : il n'a ni écran, ni entrée de menu. La décision a été
 * confirmée par le propriétaire au démarrage de cette phase, et le registre
 * `src/lib/rbac/modules.ts` l'explique de son côté.
 *
 * ## Qui lit quoi
 *
 * La lecture passe par le client de session, donc par RLS. Les deux règles du
 * § 184-185 du stockage s'appliquent sans que ce fichier ait à les redire :
 * le destinataire lit ses documents parce qu'il en est le propriétaire, un
 * administrateur lit ceux d'un domaine parce qu'il en détient la permission.
 * La clé à privilèges n'apparaît nulle part ici.
 *
 * Références : prompt maître § 35-43 ; `05_STOCKAGE.md` § 128-131, § 184-185 ;
 * plan § 4.8 et phase 4D.
 */

import { site } from '@/lib/site';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { DocumentRow, DocumentTypeRow } from '@/lib/supabase/types';

import {
  documentFileName,
  documentTypeLabel,
  parseReference,
  type DocumentType,
} from '@/lib/domain/documents';
import { renderDocumentPdf, type DocumentField } from '@/lib/domain/pdf';

export type IssueDocumentInput = {
  type: DocumentType;
  /** Domaine de l'entité liée. Par défaut, celui déclaré par le type. */
  entityType?: string;
  entityId?: string | null;
  /** Destinataire : c'est lui qui lira le document sans permission. */
  ownerId?: string | null;
  /** Nom tel qu'il doit figurer sur la pièce, figé à l'émission. */
  subjectName?: string | null;
  metadata?: Record<string, unknown>;
  /** Document remplacé, le cas échéant (§ 152 : versionnage). */
  replaces?: string | null;
};

export type IssueDocumentResult =
  | { ok: true; document: DocumentRow }
  | { ok: false; reason: 'indisponible' | 'refuse' | 'echec' };

/**
 * Émet un document officiel.
 *
 * Trois issues, et une seule d'entre elles est un succès. Le refus est
 * distingué de l'échec : un refus signale une permission manquante ou un second
 * facteur absent — donc une décision de sécurité —, un échec signale que la
 * base n'a pas pu écrire. Les confondre reviendrait à traiter une tentative
 * comme un incident.
 */
export async function issueDocument(input: IssueDocumentInput): Promise<IssueDocumentResult> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return { ok: false, reason: 'indisponible' };

  const { data, error } = await supabase.rpc('issue_document', {
    p_type: input.type,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_owner_id: input.ownerId ?? null,
    p_subject_name: input.subjectName ?? null,
    p_metadata: (input.metadata ?? {}) as never,
    p_replaces: input.replaces ?? null,
  });

  if (error) {
    // `42501` est le code Postgres des privilèges insuffisants : c'est celui
    // que lève la fonction quand la permission ou le second facteur manque.
    return { ok: false, reason: error.code === '42501' ? 'refuse' : 'echec' };
  }

  return { ok: true, document: data as unknown as DocumentRow };
}

/**
 * Charge un document par sa référence officielle.
 *
 * Renvoie `null` aussi bien pour un document inexistant que pour un document
 * que la session n'a pas le droit de lire — RLS ne fait pas la différence, et
 * c'est voulu : le § 102 du tableau de bord demande de ne pas révéler ce qui
 * existe. La référence est vérifiée avant la requête, pour ne pas envoyer une
 * chaîne quelconque à la base.
 */
export async function getDocumentByReference(reference: string): Promise<DocumentRow | null> {
  if (!parseReference(reference)) return null;

  const supabase = await getServerSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('reference', reference.trim().toUpperCase())
    .maybeSingle();

  if (error) return null;
  return (data as DocumentRow | null) ?? null;
}

/** Documents du compte connecté, du plus récent au plus ancien. */
export async function listOwnDocuments(limit = 50): Promise<DocumentRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('owner_id', userData.user.id)
    .order('issued_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data ?? []) as DocumentRow[];
}

/** Types documentaires actifs, tels que la base les déclare. */
export async function listDocumentTypes(): Promise<DocumentTypeRow[]> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('document_types')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) return [];
  return (data ?? []) as DocumentTypeRow[];
}

/* -------------------------------------------------------------------------- */
/* Rendu                                                                       */
/* -------------------------------------------------------------------------- */

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Indian/Comoro',
});

const STATUS_NOTICES: Record<string, string | null> = {
  EMIS: null,
  ANNULE: 'Document annulé — sans valeur.',
  REMPLACE: 'Document remplacé par une version ultérieure.',
};

/**
 * Compose le PDF d'un document.
 *
 * `subjectName` est passé séparément parce que l'appelant peut disposer du nom
 * **actuel** du client, alors que la pièce porte le nom **figé à l'émission**.
 * Les deux sont légitimes et ne servent pas à la même chose : le § 39 réserve
 * le nom au confort de lecture, le § 40 garantit que le changer ne touche pas
 * l'identifiant. La pièce conserve donc son instantané, et c'est le nom de
 * fichier qui suit le nom courant.
 */
export function renderDocument(
  document: DocumentRow,
  options: { currentSubjectName?: string | null } = {},
): { bytes: Uint8Array; fileName: string } {
  const label = documentTypeLabel(document.doc_type) ?? 'Document officiel';

  const fields: DocumentField[] = [
    { label: 'Référence officielle', value: document.reference },
    { label: 'Type de document', value: `${label} (${document.doc_type})` },
    { label: 'Série', value: `${document.series}${String(document.number).padStart(4, '0')}` },
    { label: 'Version', value: String(document.version) },
    { label: 'Statut', value: document.status },
  ];

  if (document.entity_id) {
    fields.push({ label: 'Entité associée', value: `${document.entity_type} · ${document.entity_id}` });
  }

  const bytes = renderDocumentPdf({
    title: label,
    reference: document.reference,
    issuedAt: DATE_FORMAT.format(new Date(document.issued_at)),
    subjectName: document.subject_name,
    statusNotice: STATUS_NOTICES[document.status] ?? null,
    fields,
    footer:
      `${site.name} — ${site.addressLabel}. Document émis par le Moteur de Documents. ` +
      'La référence officielle portée en haut de page est l’identifiant unique et stable de cette pièce.',
  });

  const fileName = documentFileName(
    document.reference,
    options.currentSubjectName ?? document.subject_name,
  );

  return { bytes, fileName };
}
