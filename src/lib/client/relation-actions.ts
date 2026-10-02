'use server';

/**
 * Actions de l'espace client — demandes, devis, rendez-vous (phase 4I-3).
 *
 * Trois actes, chacun confié à une fonction de la base qui identifie le
 * compte par `auth.uid()`, exige un compte actif et revérifie propriété, état
 * et transition sous verrou :
 *
 *   * accepter ou refuser un devis — `respond_to_my_quote` (aucune commande
 *     n'est créée : elle reste un acte de l'administration) ;
 *   * annuler un rendez-vous non commencé — `cancel_my_appointment` (motif
 *     obligatoire, aucun délai minimal, aucune reprogrammation) ;
 *   * rattacher ses demandes déposées hors connexion — `claim_my_requests`
 *     (adresse confirmée, égalité exacte).
 *
 * Aucun identifiant de compte ne vient du navigateur ; l'identifiant du devis
 * ou du rendez-vous, lui, n'ouvre rien à qui n'en est pas le titulaire.
 * Aucun e-mail n'est envoyé (décision 10).
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const ok = (message: string): AdminActionState => ({ status: 'ok', message });

function field(formData: FormData, name: string, max = 1000): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Messages de la base rédigés pour le client (23514) ; tout le reste reste générique. */
function describe(error: { code?: string | null; message?: string }, notFound: string): string {
  if (error.code === 'P0002' || error.code === '02000') return notFound;
  if (error.code === '23514' && error.message && error.message.length < 200) return error.message;
  if (error.code === '42501') return 'Cette action n’est pas possible depuis votre compte. Contactez MORA Shawiri.';
  return 'L’opération n’a pas pu aboutir. Réessayez dans un instant.';
}

export async function respondToMyQuote(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const quoteId = field(formData, 'devis', 64);
  const decision = field(formData, 'decision', 16);
  const reason = field(formData, 'motif', 1000);
  if (!quoteId || (decision !== 'ACCEPTE' && decision !== 'REFUSE')) return ko('Décision inconnue.');

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');

  const { data, error } = await supabase.rpc('respond_to_my_quote', {
    p_quote_id: quoteId,
    p_decision: decision,
    p_reason: decision === 'REFUSE' && reason !== '' ? reason : null,
  });
  if (error) return ko(describe(error, 'Ce devis est introuvable.'));

  revalidatePath('/espace-client/', 'layout');
  // La carte de réponse disparaît : le message est porté par l'adresse.
  const reference = (data as { reference?: string } | null)?.reference;
  redirect(`/espace-client/devis/${reference ?? ''}/?resultat=${decision === 'ACCEPTE' ? 'accepte' : 'refuse'}`);
}

export async function cancelMyAppointment(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const appointmentId = field(formData, 'rendez_vous', 64);
  const reason = field(formData, 'motif', 500);
  if (!appointmentId) return ko('Ce rendez-vous est introuvable.');
  if (reason.length < 3) return ko('Indiquez le motif de l’annulation.');

  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');

  const { error } = await supabase.rpc('cancel_my_appointment', { p_appointment_id: appointmentId, p_reason: reason });
  if (error) return ko(describe(error, 'Ce rendez-vous est introuvable.'));

  revalidatePath('/espace-client/', 'layout');
  redirect(`/espace-client/rendez-vous/${appointmentId}/?resultat=annule`);
}

export async function claimMyRequests(): Promise<AdminActionState> {
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');

  const { data, error } = await supabase.rpc('claim_my_requests');
  if (error) return ko(describe(error, 'Aucune demande à rattacher.'));

  revalidatePath('/espace-client/', 'layout');
  const total = (data?.demandes ?? 0) + (data?.rendez_vous ?? 0);
  if (total === 0) return ok('Il n’y avait plus rien à rattacher : votre espace est à jour.');
  redirect('/espace-client/demandes/?resultat=rattachement');
}
