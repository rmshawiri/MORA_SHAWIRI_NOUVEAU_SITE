import 'server-only';

/**
 * Lecture publique des contenus administrables — base de données, surchargeant
 * les valeurs du code.
 *
 * ## Une différence importante avec le catalogue de 4E-1
 *
 * Le catalogue avait un vrai problème de repli : avant 4E-1, `offers.ts` était
 * la seule source ; après, la base pouvait être injoignable **ou légitimement
 * vide**, et il fallait distinguer les deux — sans quoi retirer une offre du
 * site devenait impossible.
 *
 * Ici, la question ne se pose pas dans les mêmes termes, et c'est voulu. Le
 * registre `src/content/blocks.ts` porte la valeur réellement publiée ; la base
 * ne contient que des **surcharges**. Donc :
 *
 *   * une base vide n'est pas une anomalie, c'est **l'état normal** au sortir
 *     de la migration : rien n'a encore été modifié en administration ;
 *   * une panne rend le même HTML qu'une base vide ;
 *   * il n'existe aucun état où un texte manque.
 *
 * On ne peut donc pas « oublier » de replier : le repli est le chemin par
 * défaut, exercé à chaque build. C'est l'inverse du catalogue, où le repli
 * était un chemin rare — donc mal testé par nature.
 *
 * ## Ce qui reste à distinguer malgré tout
 *
 * Une panne ne doit pas être silencieuse : personne ne remarquerait que les
 * modifications de l'administration ont cessé d'apparaître, puisque le site
 * resterait parfaitement correct. Les situations sont donc journalisées côté
 * serveur, comme en 4E-1 — sans que le visiteur en voie la moindre trace.
 *
 * ## Pourquoi un client sans cookie
 *
 * `getPublicSupabaseClient()` n'ouvre pas `cookies()`. Le client de session
 * l'aurait fait, et Next.js en aurait déduit — à juste titre — que la page
 * dépend de la requête : toutes les pages du site seraient passées de statiques
 * à recalculées à chaque visite. Le point 19 du cadrage l'interdit.
 */

import {
  LIST_BLOCKS,
  TEXT_BLOCKS,
  type ListBlockKey,
  type TextBlockKey,
} from '@/content/blocks';
import { getPublicSupabaseClient } from '@/lib/supabase/public';
import { validateListItems, validateTextFields } from '@/lib/contenus/validation';

export { CONTENUS_REVALIDATE_SECONDS } from '@/lib/contenus/revalidation';


/** D'où viennent les contenus effectivement rendus. */
export type ContenusSource = 'base' | 'statique';

/** Pourquoi le code a gardé la main, lorsqu'il l'a gardée entièrement. */
export type ContenusFallbackReason = 'configuration' | 'panne';

type TextDefaults<K extends TextBlockKey> = (typeof TEXT_BLOCKS)[K]['defaults'];
type ListDefaults<K extends ListBlockKey> = (typeof LIST_BLOCKS)[K]['defaults'];

export type Contenus = {
  source: ContenusSource;
  reason?: ContenusFallbackReason;
  /** Nombre de surcharges réellement appliquées — sert aux contrôles. */
  overrides: number;
  /** Textes d'un bloc : la surcharge publiée, sinon la valeur du code. */
  texte: <K extends TextBlockKey>(key: K) => TextDefaults<K>;
  /** Éléments d'une liste : la surcharge publiée, sinon la valeur du code. */
  liste: <K extends ListBlockKey>(key: K) => ListDefaults<K>;
};

/* -------------------------------------------------------------- journal --- */

function reportFallback(reason: ContenusFallbackReason, detail?: string) {
  // Une configuration absente n'est pas une panne : c'est un build sans
  // secrets, cas normal en intégration. Le signaler ferait du bruit que
  // personne ne lirait, et un journal qu'on n'écoute plus ne sert à rien.
  if (reason === 'configuration') return;

  console.error(
    `[contenus] Les valeurs du code font foi — ${reason}${detail ? ` : ${detail}` : ''}`,
  );
}

/**
 * Surcharge écartée par la validation.
 *
 * Signalé distinctement d'une panne, parce que la cause est distincte et la
 * correction aussi : ici la base répond, mais une ligne est mal formée. Sans
 * cette trace, un administrateur verrait sa modification « ne pas prendre »
 * sans que rien ne l'explique.
 */
function reportRejected(key: string) {
  console.error(
    `[contenus] Surcharge écartée pour « ${key} » : forme invalide. La valeur du code est rendue.`,
  );
}

/* ----------------------------------------------------- contenus résolus --- */

function makeContenus(
  source: ContenusSource,
  overridesByKey: Map<string, unknown>,
  reason?: ContenusFallbackReason,
): Contenus {
  return {
    source,
    ...(reason ? { reason } : {}),
    overrides: overridesByKey.size,

    texte: <K extends TextBlockKey>(key: K): TextDefaults<K> => {
      const definition = TEXT_BLOCKS[key];
      const override = overridesByKey.get(key);
      if (override === undefined) return definition.defaults as TextDefaults<K>;

      // Une surcharge est traitée comme un jeu de champs **complet** : le
      // formulaire d'administration les soumet tous. Fusionner par-dessus les
      // valeurs du code rendrait impossible de retirer un chapô, puisque son
      // absence serait comblée par la valeur d'origine.
      const validated = validateTextFields(definition.kind, override);
      if (validated === null) {
        reportRejected(key);
        return definition.defaults as TextDefaults<K>;
      }

      return validated as TextDefaults<K>;
    },

    liste: <K extends ListBlockKey>(key: K): ListDefaults<K> => {
      const definition = LIST_BLOCKS[key];
      const override = overridesByKey.get(key);
      if (override === undefined) return definition.defaults as ListDefaults<K>;

      const validated = validateListItems(definition.shape, override);
      if (validated === null) {
        reportRejected(key);
        return definition.defaults as ListDefaults<K>;
      }

      return validated as unknown as ListDefaults<K>;
    },
  };
}

/* ------------------------------------------------------------- lecture --- */

/**
 * Contenus publics : les surcharges publiées, indexées par clé.
 *
 * Une seule requête, sans filtre par page : la table compte quelques dizaines
 * de lignes au plus, et une requête par page aurait multiplié les allers-retours
 * pour économiser des octets. Le § 116 (performances) va dans ce sens.
 */
export async function getContenus(): Promise<Contenus> {
  const supabase = getPublicSupabaseClient();

  if (!supabase) {
    reportFallback('configuration');
    return makeContenus('statique', new Map(), 'configuration');
  }

  try {
    const { data, error } = await supabase
      .from('content_blocks')
      .select('key, published_fields')
      // RLS ne renvoie déjà que les lignes surchargées au rôle anonyme. Le
      // filtre est répété parce qu'une lecture publique ne doit pas dépendre
      // d'une seule barrière : si une politique venait à être élargie, la
      // requête resterait juste.
      .not('published_fields', 'is', null);

    if (error) throw new Error(error.message);

    const overrides = new Map<string, unknown>();

    for (const row of data ?? []) {
      // Une clé absente du registre est ignorée : elle désignerait un bloc que
      // le code ne rend pas. Cela arrive légitimement après un remaniement de
      // page, et ce n'est pas une erreur — c'est une ligne devenue orpheline.
      if (row.key in TEXT_BLOCKS || row.key in LIST_BLOCKS) {
        overrides.set(row.key, row.published_fields);
      }
    }

    return makeContenus('base', overrides);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'cause inconnue';
    reportFallback('panne', detail);
    return makeContenus('statique', new Map(), 'panne');
  }
}
