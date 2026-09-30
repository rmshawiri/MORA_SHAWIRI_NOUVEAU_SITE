import { NextResponse } from 'next/server';

import { signProofUrl } from '@/lib/commerce/proofs';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Accès contrôlé à un justificatif de paiement.
 *
 * Le bucket est privé et n'expose aucune adresse permanente. Cette route est
 * la seule porte : elle lit la ligne `payment_proofs` **sous RLS**, et ne
 * signe une URL que si la base a laissé passer la lecture.
 *
 * ## Pourquoi la RLS décide, et pas ce fichier
 *
 * On pourrait comparer ici l'identifiant du demandeur à celui du titulaire de
 * la commande. Ce serait une quatrième copie d'une règle déjà écrite trois
 * fois — dans `payment_proofs_select_own`, dans `payments_select_own` et dans
 * la politique Storage. Les copies divergent ; la politique, elle, s'applique
 * à toute lecture, y compris celles qu'on n'a pas prévues.
 *
 * Un justificatif qui ne vous appartient pas est donc **introuvable**, pas
 * interdit : le § 102 demande de ne pas révéler ce qui existe, et distinguer
 * les deux cas apprendrait à un curieux qu'il a deviné juste.
 *
 * ## L'URL signée expire
 *
 * Cinq minutes, le temps d'ouvrir le fichier. § 80 : « les URLs signées
 * doivent avoir une durée d'expiration adaptée ». La réponse porte
 * `Cache-Control: no-store` — § 74 du même document interdit qu'un cache
 * public contienne accidentellement une donnée privée.
 *
 * Références : `07_ARCHITECTURE_TECHNIQUE/05_STOCKAGE.md` § 22-25, § 74,
 * § 79-81, § 184.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const refused = NextResponse.json({ erreur: 'Introuvable.' }, { status: 404 });
  refused.headers.set('Cache-Control', 'no-store');

  // Un identifiant qui n'a pas la forme d'un UUID ne peut désigner aucune
  // ligne : inutile d'interroger la base pour l'apprendre.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return refused;
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) return refused;

  const { data: proof, error } = await supabase
    .from('payment_proofs')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  if (error || !proof) return refused;

  const url = await signProofUrl(proof.storage_path);
  if (!url) return refused;

  const response = NextResponse.redirect(url, 307);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}
