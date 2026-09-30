'use server';

/**
 * Actions du module Catalogue.
 *
 * Même discipline que le module Administrateurs de la phase 4C, dans le même
 * ordre, pour la même raison — un second patron finirait par diverger du
 * premier :
 *
 *   1. **permission** — `assertPermission()`, qui journalise le refus ;
 *   2. **validation** — les valeurs reçues du navigateur sont revalidées
 *      côté serveur, jamais crues ;
 *   3. **écriture sous RLS** — par le client de session, jamais par la clé à
 *      privilèges ;
 *   4. **audit** — assuré par les déclencheurs de la migration 0006, qui
 *      voient passer toute écriture quel qu'en soit le chemin.
 *
 * ## Le point le plus important de ce fichier
 *
 * Le cadrage de la phase l'écrit sans détour : « Les boutons masqués dans
 * l'interface ne constituent jamais une sécurité suffisante. Un ADMIN sans
 * permission ne doit pas pouvoir réaliser l'action en appelant directement le
 * serveur. »
 *
 * Trois barrières répondent à cela, et il en faut trois parce qu'elles ne
 * protègent pas des mêmes erreurs :
 *
 *   * `assertPermission()` refuse l'action et laisse une trace — c'est la
 *     barrière applicative, celle qui produit le message ;
 *   * RLS refuse l'écriture — c'est la barrière de la base, celle qui tient
 *     même si une action future oublie la première ;
 *   * le déclencheur `catalogue_publication_guard` refuse le changement de
 *     statut — c'est la seule qui sache distinguer « modifier » de
 *     « publier », puisqu'une politique RLS juge une ligne, pas une transition.
 *
 * ## Les champs que le navigateur ne décide pas
 *
 * `published_at`, `created_by`, `updated_by` et le statut lors d'une simple
 * modification ne sont jamais lus depuis le formulaire. Un champ caché forgé
 * n'a donc aucune prise : la valeur écrite est celle que le serveur calcule.
 *
 * Références : `05_TABLEAU_DE_BORD_ADMINISTRATEUR.md` § 129, § 193-196 ;
 * `09_ADMINISTRATION/00_GESTION_SERVICES.md` § 61-64, § 94-99.
 */

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from '@/lib/admin/actions';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { CatalogueStatus } from '@/lib/supabase/types';

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

/** Messages génériques : le § 129 interdit d'exposer une cause technique. */
const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  unknown: 'Cette offre est introuvable.',
  invalidSlug:
    'L’identifiant d’URL doit être en minuscules, sans accent ni espace : par exemple « site-vitrine ».',
  slugTaken: 'Cet identifiant d’URL est déjà utilisé par une autre offre.',
  required: 'Renseignez tous les champs obligatoires avant d’enregistrer.',
  incompletePublish:
    'Cette offre ne peut pas être publiée tant que le titre, les descriptions, le prix, le visuel et le bouton d’action ne sont pas renseignés.',
  invalidPrice: 'Le montant doit être un nombre supérieur à zéro, ou rester vide pour « sur devis ».',
  publishDenied: 'La mise en ligne et le retrait exigent la permission de publication.',
  deletePublished:
    'Cette offre a déjà été publiée : elle ne peut plus être supprimée. Archivez-la pour conserver l’historique.',
  categoryUnknown: 'La catégorie choisie n’existe pas ou n’appartient pas à l’univers des services.',
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Les quatre statuts de la migration 0006. Tout autre mot est écarté. */
const STATUSES: readonly CatalogueStatus[] = ['BROUILLON', 'PUBLIE', 'NON_PUBLIE', 'ARCHIVE'];

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on' || formData.get(name) === 'true';
}

/**
 * Les avantages sont saisis une ligne par avantage. Les lignes vides sont
 * écartées plutôt que stockées : une puce vide dans la carte publique serait
 * un défaut visible.
 */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Traduit un refus de la base en message lisible.
 *
 * Les codes proviennent des contraintes et déclencheurs de la migration 0006.
 * Les reconnaître permet de dire à l'administrateur *ce qui* bloque, sans
 * jamais lui montrer le texte brut de l'erreur Postgres (§ 129).
 */
function explain(message: string): string {
  if (message.includes('services_publiable')) return MESSAGES.incompletePublish;
  if (message.includes('services_slug_format')) return MESSAGES.invalidSlug;
  if (message.includes('services_slug_unique') || message.includes('duplicate key')) {
    return MESSAGES.slugTaken;
  }
  if (message.includes('services_price_positive')) return MESSAGES.invalidPrice;
  if (message.includes('Publication refusée')) return MESSAGES.publishDenied;
  if (message.includes('a été publiée')) return MESSAGES.deletePublished;
  if (message.includes('Catégorie incompatible')) return MESSAGES.categoryUnknown;
  if (message.includes('services_affiliate_capped')) {
    return 'Une offre déclarée éligible à l’affiliation doit porter un plafond de commission.';
  }
  if (message.includes('services_featured_ordered')) {
    return 'Une offre mise en avant doit indiquer son rang d’affichage.';
  }
  return MESSAGES.unexpected;
}

/** Recharge les pages publiques que le catalogue alimente. */
function revalidatePublicPages() {
  revalidatePath('/');
  revalidatePath('/boutique/');
  revalidatePath('/contact/');
  revalidatePath('/administration/catalogue/');
}

/* ========================================================================== */
/*  Champs communs à la création et à la modification                         */
/* ========================================================================== */

type ServiceFields = {
  slug: string;
  category_id: string;
  title: string;
  tag: string;
  featured_tag: string | null;
  short_description: string;
  description: string;
  benefits: string[];
  price_label: string;
  price_note: string;
  price_amount: number | null;
  image_path: string;
  image_alt: string | null;
  cta_label: string;
  request_subject: string;
  internal_href: string | null;
  show_in_services: boolean;
  show_in_shop: boolean;
  is_featured: boolean;
  featured_order: number | null;
  sort_order: number;
};

function readServiceFields(formData: FormData): ServiceFields | AdminActionState {
  const slug = field(formData, 'slug').toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return ko(MESSAGES.invalidSlug);

  const title = field(formData, 'titre');
  const shortDescription = field(formData, 'description_courte');
  const description = field(formData, 'description');
  const priceLabel = field(formData, 'prix');
  const imagePath = field(formData, 'image');
  const ctaLabel = field(formData, 'cta');
  const requestSubject = field(formData, 'sujet');
  const categoryId = field(formData, 'categorie');
  const tag = field(formData, 'etiquette');

  if (
    !title ||
    !shortDescription ||
    !description ||
    !priceLabel ||
    !imagePath ||
    !ctaLabel ||
    !requestSubject ||
    !categoryId ||
    !tag
  ) {
    return ko(MESSAGES.required);
  }

  // Le montant est facultatif — « Sur devis » n'en a pas. Mais s'il est saisi,
  // il doit être un nombre : une chaîne « quinze mille » deviendrait NaN, et
  // NaN passerait silencieusement en NULL si on ne le rattrapait pas ici.
  const rawAmount = field(formData, 'montant');
  let priceAmount: number | null = null;
  if (rawAmount) {
    const parsed = Number(rawAmount.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) return ko(MESSAGES.invalidPrice);
    priceAmount = parsed;
  }

  const rawFeaturedOrder = field(formData, 'rang_avant');
  const isFeatured = checkbox(formData, 'mise_en_avant');
  const featuredOrder = rawFeaturedOrder ? Number(rawFeaturedOrder) : null;
  if (isFeatured && (featuredOrder === null || !Number.isFinite(featuredOrder))) {
    return ko('Une offre mise en avant doit indiquer son rang d’affichage.');
  }

  const rawSortOrder = field(formData, 'rang');
  const sortOrder = rawSortOrder ? Number(rawSortOrder) : 0;
  if (!Number.isFinite(sortOrder)) return ko(MESSAGES.unexpected);

  return {
    slug,
    category_id: categoryId,
    title,
    tag,
    featured_tag: field(formData, 'etiquette_courte') || null,
    short_description: shortDescription,
    description,
    benefits: lines(field(formData, 'avantages')),
    price_label: priceLabel,
    price_note: field(formData, 'note_prix'),
    price_amount: priceAmount,
    image_path: imagePath,
    image_alt: field(formData, 'texte_alternatif') || null,
    cta_label: ctaLabel,
    request_subject: requestSubject,
    internal_href: field(formData, 'lien_interne') || null,
    show_in_services: checkbox(formData, 'afficher_services'),
    show_in_shop: checkbox(formData, 'afficher_boutique'),
    is_featured: isFeatured,
    featured_order: isFeatured ? featuredOrder : null,
    sort_order: sortOrder,
  };
}

function isActionState(value: unknown): value is AdminActionState {
  return typeof value === 'object' && value !== null && 'status' in value;
}

/* ========================================================================== */
/*  Création                                                                  */
/* ========================================================================== */

/**
 * Crée un service. Toujours en brouillon, jamais publié d'emblée.
 *
 * Le § 96 distingue « Enregistrer le brouillon » de « Publier ». Créer
 * directement en ligne ferait de la création une publication déguisée, que
 * `services.create` suffirait alors à obtenir — contournant `services.publish`.
 */
export async function createServiceAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let context;
  try {
    context = await assertPermission('services.create', 'catalogue.service.create');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const fields = readServiceFields(formData);
  if (isActionState(fields)) return fields;

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  const { error } = await supabase.from('services').insert({
    ...fields,
    status: 'BROUILLON',
    created_by: context.access.userId,
    updated_by: context.access.userId,
  });

  if (error) return ko(explain(error.message));

  revalidatePublicPages();
  return ok(`L’offre « ${fields.title} » a été créée en brouillon.`);
}

/* ========================================================================== */
/*  Modification                                                              */
/* ========================================================================== */

/**
 * Modifie un service sans toucher à son statut.
 *
 * Le statut est volontairement absent de la mise à jour : le changer relève
 * de `publishServiceAction`, sous une autre permission. Un champ `status`
 * ajouté au formulaire par un navigateur bricolé serait ici purement ignoré.
 */
export async function updateServiceAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let context;
  try {
    context = await assertPermission('services.update', 'catalogue.service.update');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const identifier = field(formData, 'offre');
  if (!identifier) return ko(MESSAGES.unknown);

  const fields = readServiceFields(formData);
  if (isActionState(fields)) return fields;

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  const { data, error } = await supabase
    .from('services')
    .update({ ...fields, updated_by: context.access.userId })
    .eq('id', identifier)
    .select('slug')
    .maybeSingle();

  if (error) return ko(explain(error.message));
  // RLS a filtré la ligne : l'offre existe peut-être, mais pas pour ce compte.
  if (!data) return ko(MESSAGES.unknown);

  revalidatePublicPages();
  revalidatePath(`/administration/catalogue/${data.slug}/`);
  return ok('L’offre a été mise à jour avec succès.');
}

/* ========================================================================== */
/*  Publication, dépublication, archivage                                     */
/* ========================================================================== */

/**
 * Change le statut d'une offre.
 *
 * Une seule action pour les quatre transitions : elles partagent la même
 * permission, le même contrôle et le même effet sur les pages publiques. En
 * écrire quatre inviterait à ce que l'une d'elles oublie une vérification.
 */
export async function setServiceStatusAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const requested = field(formData, 'statut');
  if (!STATUSES.includes(requested as CatalogueStatus)) return ko(MESSAGES.unexpected);
  const status = requested as CatalogueStatus;

  let context;
  try {
    context = await assertPermission('services.publish', `catalogue.service.${status.toLowerCase()}`);
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const identifier = field(formData, 'offre');
  if (!identifier) return ko(MESSAGES.unknown);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  const { data, error } = await supabase
    .from('services')
    .update({ status, updated_by: context.access.userId })
    .eq('id', identifier)
    .select('slug, title')
    .maybeSingle();

  if (error) return ko(explain(error.message));
  if (!data) return ko(MESSAGES.unknown);

  revalidatePublicPages();
  revalidatePath(`/administration/catalogue/${data.slug}/`);

  const wording: Record<CatalogueStatus, string> = {
    PUBLIE: `« ${data.title} » est désormais visible sur le site.`,
    NON_PUBLIE: `« ${data.title} » a été retirée du site. Ses données sont conservées.`,
    BROUILLON: `« ${data.title} » est repassée en brouillon.`,
    ARCHIVE: `« ${data.title} » a été archivée. Elle reste consultable en administration.`,
  };

  return ok(wording[status]);
}

/* ========================================================================== */
/*  Suppression                                                               */
/* ========================================================================== */

/**
 * Supprime une offre — uniquement si elle n'a jamais été publiée.
 *
 * La règle est posée en base (§ 78) ; l'action ne la réimplémente pas, elle
 * traduit le refus. Réécrire la condition ici créerait deux vérités, dont une
 * seule s'applique aux écritures venues d'ailleurs.
 */
export async function deleteServiceAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('services.delete', 'catalogue.service.delete');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const identifier = field(formData, 'offre');
  if (!identifier) return ko(MESSAGES.unknown);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  const { data, error } = await supabase
    .from('services')
    .delete()
    .eq('id', identifier)
    .select('title')
    .maybeSingle();

  if (error) return ko(explain(error.message));
  if (!data) return ko(MESSAGES.unknown);

  revalidatePublicPages();
  return ok(`L’offre « ${data.title} » a été supprimée.`);
}

/* ========================================================================== */
/*  Catégories                                                                */
/* ========================================================================== */

export async function createCategoryAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('services.create', 'catalogue.category.create');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const slug = field(formData, 'slug').toLowerCase();
  const name = field(formData, 'nom');

  if (!SLUG_PATTERN.test(slug)) return ko(MESSAGES.invalidSlug);
  if (!name) return ko(MESSAGES.required);

  const rawOrder = field(formData, 'rang');
  const sortOrder = rawOrder ? Number(rawOrder) : 0;
  if (!Number.isFinite(sortOrder)) return ko(MESSAGES.unexpected);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  // `kind` n'est pas lu du formulaire : ce module administre l'univers des
  // services. L'univers des produits aura son propre écran, avec sa propre
  // permission — les mélanger permettrait de créer une catégorie de produits
  // avec `services.create`.
  const { error } = await supabase
    .from('categories')
    .insert({ slug, name, kind: 'SERVICE', sort_order: sortOrder, is_active: true });

  if (error) {
    if (error.message.includes('categories_slug_unique') || error.message.includes('duplicate')) {
      return ko('Cette catégorie existe déjà.');
    }
    return ko(explain(error.message));
  }

  revalidatePublicPages();
  return ok(`La catégorie « ${name} » a été créée.`);
}

/**
 * Active ou désactive une catégorie.
 *
 * La base refuse de désactiver une catégorie portant des offres publiées
 * (§ 12). Le refus remonte tel quel, traduit : c'est plus honnête que de
 * masquer le bouton, qui laisserait croire que l'action est impossible alors
 * qu'elle le redeviendra dès la dernière offre dépubliée.
 */
export async function toggleCategoryAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('services.update', 'catalogue.category.update');
  } catch (error) {
    return error instanceof PermissionDenied ? ko(MESSAGES.denied) : ko(MESSAGES.unexpected);
  }

  const identifier = field(formData, 'categorie');
  const active = field(formData, 'actif') === 'true';
  if (!identifier) return ko(MESSAGES.unexpected);

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko(MESSAGES.unexpected);

  const { data, error } = await supabase
    .from('categories')
    .update({ is_active: active })
    .eq('id', identifier)
    .select('name')
    .maybeSingle();

  if (error) {
    if (error.message.includes('Désactivation refusée')) {
      return ko(
        'Cette catégorie porte encore des offres publiées. Dépubliez-les avant de la désactiver.',
      );
    }
    return ko(explain(error.message));
  }

  if (!data) return ko('Cette catégorie est introuvable.');

  revalidatePublicPages();
  return ok(
    active
      ? `La catégorie « ${data.name} » est de nouveau active.`
      : `La catégorie « ${data.name} » a été désactivée.`,
  );
}
