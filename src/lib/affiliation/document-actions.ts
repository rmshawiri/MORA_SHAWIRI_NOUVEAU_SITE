'use server';

/**
 * Fiche officielle de l'affilié — phase 4H-7.
 *
 * L'émission passe par la base (`issue_affiliate_sheet`) : permission
 * `affiliate_documents.issue`, numéro FIAF alloué par le moteur de documents
 * de 4D, instantané figé dans la même transaction, fiche précédente
 * remplacée. Le serveur rend alors le PDF depuis cet instantané et l'archive
 * avec son empreinte.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { archiveIssuedAffiliateDocument } from '@/lib/documents/affiliate-documents';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DENIED = 'Vous n’avez pas le droit d’effectuer cette action.';
const UNEXPECTED = 'L’émission n’a pas abouti. Réessayez dans un instant.';

export async function issueAffiliateSheet(_p: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_documents.issue', 'affiliation.fiche.emission');
    const value = formData.get('id');
    const id = typeof value === 'string' ? value.trim() : '';
    if (!UUID.test(id)) return ko('Affilié introuvable.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(UNEXPECTED);
    const { data, error } = await supabase.rpc('issue_affiliate_sheet', { p_affiliate_id: id });
    if (error || !data) {
      if (error?.code === '42501') return ko(error.message.length < 200 ? error.message : DENIED);
      if (error?.code === '23514' && error.message.length < 240) return ko(error.message);
      return ko(UNEXPECTED);
    }
    const archived = await archiveIssuedAffiliateDocument(data.reference);
    revalidatePath('/administration/affiliation/', 'layout');
    revalidatePath('/espace-affilie/');
    destination = `/administration/affiliation/affilies/${id}/?resultat=${archived ? 'FICHE_EMISE' : 'FICHE_EMISE_SANS_ARCHIVE'}#documents`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(DENIED);
    return ko(UNEXPECTED);
  }
  redirect(destination);
}
