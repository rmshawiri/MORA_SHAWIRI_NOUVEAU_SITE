'use server';

/**
 * Actions du module Contenus.
 *
 * Même discipline que les modules Administrateurs (4C) et Catalogue (4E-1),
 * dans le même ordre, pour la même raison — un second patron finirait par
 * diverger du premier :
 *
 *   1. **permission** — `assertPermission()`, qui journalise le refus ;
 *   2. **validation** — les valeurs reçues du navigateur sont revalidées côté
 *      serveur, jamais crues ;
 *   3. **écriture sous RLS** — par le client de session, jamais par la clé à
 *      privilèges ;
 *   4. **audit** — assuré par les déclencheurs de la migration 0007, qui voient
 *      passer toute écriture quel qu'en soit le chemin.
 *
 * ## Trois barrières, et pourquoi il en faut trois
 *
 * Le point 14 du cadrage est explicite : « Ne repose pas uniquement sur le
 * masquage d'un bouton dans l'administration. » Les trois barrières ne
 * protègent pas des mêmes erreurs :
 *
 *   * `assertPermission()` refuse l'action et laisse une trace — barrière
 *     applicative, celle qui produit le message ;
 *   * RLS refuse l'écriture — barrière de la base, celle qui tient même si une
 *     action future oublie la première ;
 *   * `contenus_publication_guard` refuse la **transition** — la seule qui sache
 *     distinguer « modifier » de « publier », puisqu'une politique RLS juge une
 *     ligne, pas un changement.
 *
 * ## Publier n'est pas modifier — concrètement
 *
 * Pour un bloc, `enregistrerBrouillon` n'écrit que `draft_fields` : rien ne
 * devient public, et `content.update` suffit. `publierBloc` recopie le brouillon
 * dans `published_fields`, ce que seul `content.publish` autorise — refusé par
 * le déclencheur, pas seulement par cette fonction.
 *
 * ## Les champs que le navigateur ne décide pas
 *
 * `published_at`, `published_fields` lors d'un simple enregistrement, et le
 * statut lors d'une simple modification ne sont jamais lus depuis le
 * formulaire. Un champ caché forgé n'a donc aucune prise.
 */

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from '@/lib/admin/actions';
import { LIST_BLOCKS, TEXT_BLOCKS } from '@/content/blocks';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import { validateListItems, validateTextFields } from '@/lib/contenus/validation';
import type { ContentStatusValue } from '@/lib/supabase/types';

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

/** Messages génériques : le § 129 interdit d'exposer une cause technique. */
const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  unknownBlock: 'Ce contenu est introuvable.',
  unknownItem: 'Cette question est introuvable.',
  unknownPost: 'Cet article est introuvable.',
  invalidFields:
    'Les valeurs saisies sont incomplètes ou mal formées. Vérifiez chaque champ obligatoire.',
  invalidList:
    'La liste comporte un élément incomplet, une icône inconnue ou un lien non autorisé. Aucun élément n’a été enregistré.',
  publishDenied: 'La mise en ligne et le retrait exigent la permission de publication.',
  nothingToPublish: 'Il n’y a aucune modification en attente à publier.',
  deletePublished:
    'Ce contenu a déjà été publié : il ne peut plus être supprimé. Dépubliez-le ou archivez-le pour conserver l’historique.',
  categoryBusy:
    'Cette catégorie porte encore des questions publiées. Dépubliez-les avant de la désactiver.',
  invalidSlug:
    'L’identifiant d’URL doit être en minuscules, sans accent ni espace : par exemple « mon-article ».',
  slugTaken: 'Cet identifiant d’URL est déjà utilisé par un autre article.',
  incompletePublish:
    'Cet article ne peut pas être publié tant que le titre, l’accroche, le résumé, la date, le visuel et le corps ne sont pas renseignés.',
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const STATUSES: readonly ContentStatusValue[] = [
  'BROUILLON',
  'PUBLIE',
  'NON_PUBLIE',
  'ARCHIVE',
];

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on' || formData.get(name) === 'true';
}

/** Une ligne par entrée ; les lignes vides sont écartées plutôt que stockées. */
function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Traduit un refus de la base en message lisible.
 *
 * Reconnaître les contraintes de la migration 0007 permet de dire *ce qui*
 * bloque, sans jamais montrer le texte brut de l'erreur Postgres (§ 129).
 */
function explain(message: string): string {
  if (message.includes('Publication refusée')) return MESSAGES.publishDenied;
  if (message.includes('Retrait refusé')) return MESSAGES.publishDenied;
  if (message.includes('déjà été publié')) return MESSAGES.deletePublished;
  if (message.includes('Désactivation refusée')) return MESSAGES.categoryBusy;
  if (message.includes('content_posts_publiable')) return MESSAGES.incompletePublish;
  if (message.includes('content_posts_slug_format')) return MESSAGES.invalidSlug;
  if (message.includes('content_posts_slug_unique') || message.includes('duplicate key')) {
    return MESSAGES.slugTaken;
  }
  if (message.includes('faq_items_publiable')) {
    return 'Une question ne peut pas être publiée sans réponse.';
  }
  if (message.includes('content_posts_related_excludes_self')) {
    return 'Un article ne peut pas se suggérer lui-même.';
  }
  if (message.includes('media_assets_decorative_has_no_alt')) {
    return 'Une image décorative ne porte pas de description : son texte alternatif doit rester vide.';
  }
  if (message.includes('media_assets_mime_allowed')) {
    return 'Ce type de fichier n’est pas accepté. Formats autorisés : WebP, AVIF, PNG, JPEG, PDF.';
  }
  if (message.includes('media_assets_size_sane')) {
    return 'Ce fichier dépasse la taille maximale de 10 Mio.';
  }
  return MESSAGES.unexpected;
}

/**
 * Régénère les pages publiques touchées par une écriture.
 *
 * Les pages sont pré-rendues et revalidées toutes les cinq minutes ; forcer la
 * régénération évite d'attendre le cycle suivant pour constater son propre
 * changement. `revalidatePath('/', 'layout')` couvre l'arbre entier — un bloc
 * transversal comme les témoignages apparaît sur deux pages, et énumérer les
 * chemins un par un aurait fini par en oublier un.
 */
function revalidatePublic() {
  revalidatePath('/', 'layout');
}

/* ========================================================== BLOCS DE TEXTE === */

/**
 * Reconstruit l'objet de champs attendu par la nature du bloc, à partir du
 * formulaire.
 *
 * Seuls les champs **connus** sont lus. Une clé supplémentaire postée par un
 * client forgé n'atteint donc jamais la base : elle n'est pas ignorée par
 * indulgence, elle n'est pas lue du tout.
 */
function readTextFields(kind: string, formData: FormData): Record<string, unknown> | null {
  const eyebrow = field(formData, 'eyebrow');
  const title = field(formData, 'title');
  const lead = field(formData, 'lead');

  if (kind === 'CTA') {
    return {
      title,
      text: field(formData, 'text'),
      primaryLabel: field(formData, 'primaryLabel'),
      whatsappMessage: field(formData, 'whatsappMessage'),
    };
  }

  if (kind === 'HERO') {
    return { eyebrow, title, lead, proof: lines(field(formData, 'proof')) };
  }

  if (kind === 'PAGE_HERO') {
    return { eyebrow, title, lead };
  }

  // SECTION : le chapô est facultatif, et son absence doit pouvoir être
  // exprimée. Envoyer une chaîne vide reviendrait à publier un chapô vide.
  return lead === '' ? { eyebrow, title } : { eyebrow, title, lead };
}

/**
 * Enregistre un brouillon de bloc.
 *
 * `content.update` suffit, et c'est le cœur du point 13 du cadrage : cette
 * action ne peut **rien** rendre public, puisqu'elle n'écrit que
 * `draft_fields`. Le déclencheur de publication n'est même pas sollicité.
 */
export async function enregistrerBlocBrouillon(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');

  try {
    await assertPermission('content.update', 'contenus.bloc.brouillon');

    const isText = key in TEXT_BLOCKS;
    const isList = key in LIST_BLOCKS;
    if (!isText && !isList) return ko(MESSAGES.unknownBlock);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    let draft: unknown;
    let kind: string;
    let page: string;

    if (isText) {
      const definition = TEXT_BLOCKS[key as keyof typeof TEXT_BLOCKS];
      kind = definition.kind;
      page = definition.page;

      const candidate = readTextFields(kind, formData);
      const validated = candidate === null ? null : validateTextFields(kind, candidate);
      if (validated === null) return ko(MESSAGES.invalidFields);
      draft = validated;
    } else {
      const definition = LIST_BLOCKS[key as keyof typeof LIST_BLOCKS];
      kind = definition.kind;
      page = definition.page;

      // Une liste est saisie en JSON. C'est un choix assumé pour cette
      // livraison : construire un éditeur de tableau par forme (icône,
      // lien, ordre) demandait un travail d'interface disproportionné, et le
      // § 101 met en garde contre une administration inutilement complexe.
      // La validation, elle, est complète — une forme invalide est refusée
      // avec un message, jamais enregistrée.
      let parsed: unknown;
      try {
        parsed = JSON.parse(field(formData, 'items'));
      } catch {
        return ko(MESSAGES.invalidList);
      }

      const validated = validateListItems(definition.shape, parsed);
      if (validated === null) return ko(MESSAGES.invalidList);
      draft = validated;
    }

    const { error } = await supabase
      .from('content_blocks')
      .upsert(
        { key, kind: kind as never, page_slug: page, draft_fields: draft as never },
        { onConflict: 'key' },
      );

    if (error) return ko(explain(error.message));

    return ok('Brouillon enregistré. Il n’est pas encore visible sur le site.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Publie le brouillon d'un bloc.
 *
 * Exige `content.publish`. Le brouillon est **effacé** au passage : le laisser
 * en place afficherait indéfiniment « modification en attente » alors qu'elle
 * est en ligne.
 */
export async function publierBloc(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');

  try {
    await assertPermission('content.publish', 'contenus.bloc.publication');

    if (!(key in TEXT_BLOCKS) && !(key in LIST_BLOCKS)) return ko(MESSAGES.unknownBlock);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const { data: row, error: readError } = await supabase
      .from('content_blocks')
      .select('id, draft_fields')
      .eq('key', key)
      .maybeSingle();

    if (readError) return ko(explain(readError.message));
    if (!row) return ko(MESSAGES.unknownBlock);
    if (row.draft_fields === null) return ko(MESSAGES.nothingToPublish);

    const { error } = await supabase
      .from('content_blocks')
      .update({ published_fields: row.draft_fields, draft_fields: null })
      .eq('id', row.id);

    if (error) return ko(explain(error.message));

    revalidatePublic();
    return ok('Contenu publié. Il est désormais visible sur le site.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/**
 * Retire la surcharge d'un bloc : le site revient à la valeur du code.
 *
 * C'est un retrait de contenu public, donc `content.publish` — la même
 * permission que la mise en ligne, puisque l'effet visible est du même ordre.
 * La ligne est supprimée plutôt que vidée : une ligne sans surcharge ni
 * brouillon décrit exactement l'état « le code fait foi », qui est l'absence
 * de ligne (contrainte `content_blocks_not_empty`).
 */
export async function retablirBloc(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');

  try {
    await assertPermission('content.publish', 'contenus.bloc.retablissement');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    // La ligne est **supprimée**, et non vidée : la contrainte
    // `content_blocks_not_empty` refuse une ligne sans surcharge ni brouillon,
    // parce qu'un tel état décrit exactement « le code fait foi » — c'est-à-dire
    // l'absence de ligne. Le déclencheur `content_blocks_delete_guard` exige
    // `content.publish` pour supprimer une ligne en ligne, de sorte que ce
    // retrait reste refusé à un compte qui ne pourrait pas le publier.
    const { error } = await supabase.from('content_blocks').delete().eq('key', key);

    if (error) return ko(explain(error.message));

    revalidatePublic();
    return ok('Contenu rétabli : le site affiche de nouveau le texte d’origine.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ==================================================================== FAQ === */

export async function creerQuestion(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.create', 'contenus.faq.creation');

    const categoryId = field(formData, 'category_id');
    const question = field(formData, 'question');
    const answer = field(formData, 'answer');

    if (!categoryId || !question || !answer) return ko(MESSAGES.invalidFields);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const sortOrder = Number.parseInt(field(formData, 'sort_order'), 10);

    // Toujours créée en brouillon. Créer directement en ligne ferait de la
    // création une publication déguisée, que `content.create` suffirait à
    // obtenir — contournant `content.publish`. Même raisonnement qu'en 4E-1.
    const { error } = await supabase.from('faq_items').insert({
      category_id: categoryId,
      question,
      answer,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      status: 'BROUILLON',
    });

    if (error) return ko(explain(error.message));

    return ok('Question créée en brouillon. Publiez-la pour la rendre visible.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

export async function modifierQuestion(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.update', 'contenus.faq.modification');

    const id = field(formData, 'id');
    const question = field(formData, 'question');
    const answer = field(formData, 'answer');

    if (!id || !question || !answer) return ko(MESSAGES.invalidFields);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const sortOrder = Number.parseInt(field(formData, 'sort_order'), 10);

    // `status` n'est pas lu : une modification ne change pas l'état de
    // publication, sans quoi `content.update` vaudrait `content.publish`.
    const { error } = await supabase
      .from('faq_items')
      .update({
        question,
        answer,
        ...(Number.isFinite(sortOrder) ? { sort_order: sortOrder } : {}),
      })
      .eq('id', id);

    if (error) return ko(explain(error.message));

    return ok('Question enregistrée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/** Change le statut d'une question. Exige `content.publish`. */
export async function changerStatutQuestion(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.publish', 'contenus.faq.statut');

    const id = field(formData, 'id');
    const status = field(formData, 'status') as ContentStatusValue;

    if (!id || !STATUSES.includes(status)) return ko(MESSAGES.invalidFields);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const { error } = await supabase.from('faq_items').update({ status }).eq('id', id);
    if (error) return ko(explain(error.message));

    revalidatePublic();

    return ok(
      status === 'PUBLIE'
        ? 'Question publiée. Elle est désormais visible sur le site.'
        : 'Question retirée du site.',
    );
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

export async function supprimerQuestion(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.delete', 'contenus.faq.suppression');

    const id = field(formData, 'id');
    if (!id) return ko(MESSAGES.unknownItem);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const { error } = await supabase.from('faq_items').delete().eq('id', id);
    if (error) return ko(explain(error.message));

    return ok('Question supprimée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* =============================================================== ARTICLES === */

export async function modifierArticle(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.update', 'contenus.article.modification');

    const id = field(formData, 'id');
    if (!id) return ko(MESSAGES.unknownPost);

    const slug = field(formData, 'slug');
    if (!SLUG_PATTERN.test(slug)) return ko(MESSAGES.invalidSlug);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const width = Number.parseInt(field(formData, 'cover_width'), 10);
    const height = Number.parseInt(field(formData, 'cover_height'), 10);
    const sortOrder = Number.parseInt(field(formData, 'sort_order'), 10);

    // `body` et `status` ne sont pas modifiables ici : le corps d'un article se
    // travaille dans un éditeur de blocs, et le statut relève de
    // `content.publish`. Les omettre est plus sûr que les accepter et les
    // ignorer — un champ accepté puis ignoré finit par être branché par erreur.
    const { error } = await supabase
      .from('content_posts')
      .update({
        slug,
        category: field(formData, 'category'),
        title: field(formData, 'title'),
        lead: field(formData, 'lead'),
        excerpt: field(formData, 'excerpt'),
        author: field(formData, 'author') || null,
        published_on: field(formData, 'published_on') || null,
        date_label: field(formData, 'date_label') || null,
        reading_time: field(formData, 'reading_time') || null,
        cover_path: field(formData, 'cover_path') || null,
        cover_width: Number.isFinite(width) ? width : null,
        cover_height: Number.isFinite(height) ? height : null,
        cta_title: field(formData, 'cta_title') || null,
        cta_text: field(formData, 'cta_text') || null,
        cta_label: field(formData, 'cta_label') || null,
        cta_href: field(formData, 'cta_href') || null,
        seo_title: field(formData, 'seo_title') || null,
        seo_description: field(formData, 'seo_description') || null,
        ...(Number.isFinite(sortOrder) ? { sort_order: sortOrder } : {}),
      })
      .eq('id', id);

    if (error) return ko(explain(error.message));

    revalidatePublic();
    return ok('Article enregistré.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

export async function changerStatutArticle(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.publish', 'contenus.article.statut');

    const id = field(formData, 'id');
    const status = field(formData, 'status') as ContentStatusValue;

    if (!id || !STATUSES.includes(status)) return ko(MESSAGES.invalidFields);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const { error } = await supabase.from('content_posts').update({ status }).eq('id', id);
    if (error) return ko(explain(error.message));

    revalidatePublic();

    const messages: Record<ContentStatusValue, string> = {
      PUBLIE: 'Article publié. Il est désormais visible sur le site et dans le plan de site.',
      NON_PUBLIE: 'Article retiré du site. Son adresse répond désormais 404.',
      BROUILLON: 'Article repassé en brouillon.',
      ARCHIVE: 'Article archivé. Il n’est plus visible mais son historique est conservé.',
    };

    return ok(messages[status]);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

export async function supprimerArticle(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('content.delete', 'contenus.article.suppression');

    const id = field(formData, 'id');
    if (!id) return ko(MESSAGES.unknownPost);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    // Le déclencheur refuse la suppression d'un article déjà publié : il
    // s'archive. Le message le dit en clair plutôt que de laisser croire à une
    // panne (§ 129).
    const { error } = await supabase.from('content_posts').delete().eq('id', id);
    if (error) return ko(explain(error.message));

    return ok('Article supprimé.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

/* ============================================================ MÉDIATHÈQUE === */

/**
 * Décrit un média : titre, texte alternatif, classement.
 *
 * Le fichier lui-même n'est pas touché. Le § 25 demande une description, le
 * § 26 un texte alternatif, le § 27 admet l'image décorative — et la contrainte
 * `media_assets_decorative_has_no_alt` interdit qu'une image décorative porte
 * une description, ce qui ferait annoncer un ornement par un lecteur d'écran.
 */
export async function decrireMedia(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    await assertPermission('media.update', 'contenus.media.description');

    const id = field(formData, 'id');
    const title = field(formData, 'title');
    if (!id || !title) return ko(MESSAGES.invalidFields);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.unexpected);

    const decorative = checkbox(formData, 'is_decorative');

    const { error } = await supabase
      .from('media_assets')
      .update({
        title,
        // Une image décorative ne porte aucun texte alternatif : la contrainte
        // le refuserait, et le forcer ici évite un message d'erreur pour une
        // incohérence que l'interface peut résoudre seule.
        alt_text: decorative ? null : field(formData, 'alt_text') || null,
        description: field(formData, 'description') || null,
        category: field(formData, 'category') || null,
        is_decorative: decorative,
      })
      .eq('id', id);

    if (error) return ko(explain(error.message));

    return ok('Média enregistré.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}
