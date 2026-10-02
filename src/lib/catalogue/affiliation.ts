/**
 * Éligibilité d'une offre à l'affiliation — fonctions pures, partagées par le
 * formulaire et l'action serveur (correctif de clôture 4H).
 */

/** Plafond saisi : un pourcentage, deux décimales au plus, virgule acceptée. */
export function parseRate(raw: string): number | null | 'invalide' {
  const value = raw.trim().replace(/\s/g, '').replace(/%$/, '').replace(',', '.');
  if (!value) return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return 'invalide';
  const rate = Number(value);
  return rate > 0 && rate <= 100 ? rate : 'invalide';
}

/** « 12,5 % » — l'écriture française d'un plafond stocké. */
export function formatRate(rate: number | string | null | undefined): string {
  if (rate === null || rate === undefined || rate === '') return '—';
  return `${Number(rate).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

export type OfferAffiliationChange = 'ACTIVATION' | 'DESACTIVATION' | 'PLAFOND' | 'AUCUN';

/** Nature d'un changement : elle décide du texte de la confirmation. */
export function affiliationChange(
  before: { eligible: boolean; rate: number | null },
  after: { eligible: boolean; rate: number | null },
): OfferAffiliationChange {
  if (before.eligible !== after.eligible) return after.eligible ? 'ACTIVATION' : 'DESACTIVATION';
  if (after.eligible && before.rate !== after.rate) return 'PLAFOND';
  return 'AUCUN';
}

/** Conséquence d'un changement, dite en clair dans la fenêtre de confirmation. */
export function affiliationConsequence(
  change: OfferAffiliationChange,
  title: string,
  before: number | null,
  after: number | null,
  published: boolean,
): string {
  const visibility = published ? '' : ' Elle n’est pas publiée : l’éligibilité ne la rend pas visible sur le site.';
  switch (change) {
    case 'ACTIVATION':
      return `« ${title} » deviendra éligible à l’affiliation, avec un plafond de ${formatRate(after)}. Les ventes conclues à partir de maintenant pourront ouvrir une commission, selon les règles en vigueur ; les ventes antérieures ne sont pas concernées.${visibility}`;
    case 'DESACTIVATION':
      return `« ${title} » ne sera plus éligible à l’affiliation. Les ventes conclues à partir de maintenant ne produiront plus de commission. Les commissions déjà nées — prévisionnelles, acquises ou versées — et l’historique restent intacts : une vente conclue pendant que l’offre était éligible garde sa commission.`;
    case 'PLAFOND':
      return `Le plafond de « ${title} » passera de ${formatRate(before)} à ${formatRate(after)}. Il s’applique aux ventes conclues à partir de maintenant ; les commissions existantes gardent le plafond en vigueur à la date de leur vente. Une règle individuelle en dérogation contractuelle n’est pas plafonnée.`;
    default:
      return '';
  }
}
