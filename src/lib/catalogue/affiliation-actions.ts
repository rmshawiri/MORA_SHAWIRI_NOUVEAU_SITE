'use server';

/**
 * Éligibilité d'une offre à l'affiliation — correctif de clôture 4H.
 *
 * L'éligibilité et le plafond de commission sont un levier financier : ils
 * exigent la permission d'édition de l'offre **et** `affiliate_rules.manage`.
 * Trois barrières, comme partout :
 *
 *   * `assertPermission()` ×2, qui journalise un refus ;
 *   * `set_offer_affiliation`, qui revérifie les deux permissions ;
 *   * le déclencheur `*_affiliation_guard`, qui refuse tout changement de ces
 *     deux colonnes sans `affiliate_rules.manage`, quel qu'en soit le chemin.
 *
 * La publication n'entre pas en jeu : une offre peut être affiliable sans être
 * publiée, et publiée sans être affiliable. Chaque changement rejoint
 * l'historique `offer_affiliation_history`, que le moteur lit à la date de
 * l'affaire : les commissions déjà nées ne bougent pas.
 */

import { revalidatePath } from 'next/cache';

import type { AdminActionState } from '@/lib/admin/actions';
import { formatRate, parseRate } from '@/lib/catalogue/affiliation';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ok = (message: string): AdminActionState => ({ status: 'ok', message });
const ko = (message: string): AdminActionState => ({ status: 'error', message });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function setOfferAffiliationAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const type = formData.get('type') === 'PRODUCT' ? 'PRODUCT' : formData.get('type') === 'SERVICE' ? 'SERVICE' : null;
  const id = String(formData.get('offre') ?? '');
  if (!type || !UUID.test(id)) return ko('Cette offre est introuvable.');

  try {
    await assertPermission(type === 'SERVICE' ? 'services.update' : 'products.update', 'catalogue.affiliation');
    await assertPermission('affiliate_rules.manage', 'catalogue.affiliation');
  } catch (error) {
    return error instanceof PermissionDenied
      ? ko('Rendre une offre affiliable exige la permission de modifier l’offre et celle de gérer les règles d’affiliation.')
      : ko('L’opération n’a pas abouti. Réessayez dans un instant.');
  }

  const eligible = formData.get('eligible') === '1';
  const rate = parseRate(String(formData.get('plafond') ?? ''));
  if (rate === 'invalide') return ko('Le plafond est un pourcentage supérieur à 0 et au plus égal à 100, deux décimales au plus.');
  if (eligible && rate === null) return ko('Une offre éligible à l’affiliation doit porter un plafond de commission.');

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('La base de données est momentanément indisponible.');

  const { data, error } = await supabase.rpc('set_offer_affiliation', {
    p_offer_type: type,
    p_offer_id: id,
    p_eligible: eligible,
    p_max_rate: rate,
  });
  if (error || !data) {
    if (error?.code === '42501') return ko('Vous n’avez pas le droit d’effectuer cette action.');
    if (error?.code === 'P0002') return ko('Cette offre est introuvable.');
    if (error?.code === '23514' && error.message.length < 240) return ko(error.message);
    return ko('L’opération n’a pas abouti. Réessayez dans un instant.');
  }

  const result = data as { title?: string; eligible?: boolean; maxRate?: number | string | null };
  revalidatePath('/administration/catalogue/', 'layout');
  revalidatePath('/administration/affiliation/', 'layout');
  revalidatePath('/espace-affilie/', 'layout');

  return ok(
    result.eligible
      ? `« ${result.title} » est éligible à l’affiliation, plafond ${formatRate(result.maxRate)}. Les ventes conclues à partir de maintenant en tiennent compte.`
      : `« ${result.title} » n’est plus éligible à l’affiliation. Les commissions déjà nées restent intactes.`,
  );
}
