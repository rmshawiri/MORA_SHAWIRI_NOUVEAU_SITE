'use server';

/**
 * Administration Clients — actes (phase 4I-4).
 *
 * Trois barrières pour chacun : l'interface ne montre le bouton qu'à qui
 * détient la permission ; l'action serveur la revérifie (`assertPermission`,
 * refus journalisé) ; la fonction en base la vérifie une troisième fois et
 * journalise l'acte (qui, quand, quoi, pourquoi).
 *
 *   * bloquer / débloquer un client — `users.disable`, motif obligatoire au
 *     blocage ;
 *   * ajouter une note interne — `users.update`, ajout seul ;
 *   * rattacher un élément historique — `users.update` + `quotes.manage`
 *     (demande) ou `appointments.update` (rendez-vous), par le mécanisme
 *     existant `attach_historical_request`.
 *
 * Après un acte, la page est rechargée avec `?resultat=<code>` (liste
 * fermée) : la carte qui portait le formulaire peut avoir disparu.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getServerSupabaseClient } from '@/lib/supabase/server';

const ko = (message: string): AdminActionState => ({ status: 'error', message });

function field(formData: FormData, name: string, max = 4000): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const REFERENCE = /^MORA-CLI-[A-Z]+\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function describe(error: { code?: string | null; message?: string }): string {
  if (error.code === '23514' && error.message && error.message.length < 220) return error.message;
  if (error.code === '42501') return 'Permission insuffisante pour cet acte.';
  if (error.code === 'P0002') return 'Élément introuvable.';
  return 'L’opération n’a pas pu aboutir. Réessayez dans un instant.';
}

async function target(formData: FormData): Promise<{ userId: string; reference: string } | null> {
  const userId = field(formData, 'client', 64);
  const reference = field(formData, 'reference', 32);
  return UUID.test(userId) && REFERENCE.test(reference) ? { userId, reference } : null;
}

function done(reference: string, result: string): never {
  revalidatePath('/administration/clients/', 'layout');
  redirect(`/administration/clients/${reference}/?resultat=${result}`);
}

export async function blockClientAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  try {
    await assertPermission('users.disable', 'clients.blocage');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko('La permission users.disable est nécessaire.');
    throw error;
  }
  const client = await target(formData);
  const reason = field(formData, 'motif', 500);
  if (!client) return ko('Client introuvable.');
  if (reason.length < 3) return ko('Indiquez le motif du blocage.');
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const { error } = await supabase.rpc('block_client', { p_user_id: client.userId, p_reason: reason });
  if (error) return ko(describe(error));
  done(client.reference, 'bloque');
}

export async function unblockClientAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  try {
    await assertPermission('users.disable', 'clients.deblocage');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko('La permission users.disable est nécessaire.');
    throw error;
  }
  const client = await target(formData);
  const reason = field(formData, 'motif', 500);
  if (!client) return ko('Client introuvable.');
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const { error } = await supabase.rpc('unblock_client', { p_user_id: client.userId, p_reason: reason.length >= 3 ? reason : null });
  if (error) return ko(describe(error));
  done(client.reference, 'debloque');
}

export async function addClientNoteAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  try {
    await assertPermission('users.update', 'clients.note');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko('La permission users.update est nécessaire.');
    throw error;
  }
  const client = await target(formData);
  const body = field(formData, 'note', 4000);
  const corrects = field(formData, 'corrige', 64);
  if (!client) return ko('Client introuvable.');
  if (body.length === 0) return ko('La note est vide.');
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  const { error } = await supabase.rpc('add_client_note', {
    p_user_id: client.userId,
    p_body: body,
    p_corrects: UUID.test(corrects) ? corrects : null,
  });
  if (error) return ko(describe(error));
  done(client.reference, 'note');
}

export async function attachHistoricalAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const kind = field(formData, 'type', 16);
  if (kind !== 'DEMANDE' && kind !== 'RENDEZ_VOUS') return ko('Type d’élément inconnu.');
  try {
    await assertPermission('users.update', 'clients.rattachement_historique');
    await assertPermission(kind === 'DEMANDE' ? 'quotes.manage' : 'appointments.update', 'clients.rattachement_historique');
  } catch (error) {
    if (error instanceof PermissionDenied) {
      return ko(kind === 'DEMANDE' ? 'Permissions users.update et quotes.manage nécessaires.' : 'Permissions users.update et appointments.update nécessaires.');
    }
    throw error;
  }
  const client = await target(formData);
  const itemId = field(formData, 'element', 64);
  const reason = field(formData, 'motif', 500);
  if (!client || !UUID.test(itemId)) return ko('Élément introuvable.');
  if (reason.length < 3) return ko('Indiquez le motif du rattachement.');
  const supabase = await getServerSupabaseClient();
  if (!supabase) return ko('Le service est momentanément indisponible.');
  // Avant tout : l'élément doit être détecté comme rattachable à CE client
  // (adresse confirmée identique, aucun titulaire, aucun conflit). La base
  // revérifie ensuite tout, sous verrou.
  const { data: eligible, error: detectError } = await supabase.rpc('historical_claimable_requests');
  if (detectError) return ko(describe(detectError));
  if (!(eligible ?? []).some((item) => item.item_id === itemId && item.item_kind === kind && item.client_user_id === client.userId)) {
    return ko('Cet élément n’est pas rattachable à ce client.');
  }
  const { error } = await supabase.rpc('attach_historical_request', { p_kind: kind, p_item_id: itemId, p_reason: reason });
  if (error) return ko(describe(error));
  done(client.reference, 'rattache');
}
