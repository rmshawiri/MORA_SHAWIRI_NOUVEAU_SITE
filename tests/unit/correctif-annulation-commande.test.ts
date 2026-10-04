/**
 * Micro-correctif 4G — annulation d'une commande et paiements (rapport 22).
 *
 * Ce que ces tests épinglent, sans base :
 *   * la règle « encaissé > remboursé → pas d'ANNULEE » vit dans la garde des
 *     commandes, hors du bloc des permissions : aucun chemin ne la contourne ;
 *   * une commande annulée clôt ses seules déclarations en attente, jamais un
 *     paiement confirmé ou remboursé, et ne supprime rien ;
 *   * une commande annulée ne reçoit plus d'argent, mais une clôture reste
 *     possible ;
 *   * le client ne reçoit qu'une notification quand la déclaration est close
 *     par l'annulation de sa commande ; « Paiement annulé » reste branché ;
 *   * aucune garde n'est désactivée, aucune permission ni statut créé ;
 *   * l'administration affiche un message métier et informe dans la
 *     confirmation existante.
 *
 * Le comportement réel (sept cas, chemins directs) est contrôlé contre la
 * base par `verify-commerce.mjs` et `verify-notifications-branchements.mjs`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const SQL = readFileSync(resolve(ROOT, 'supabase', 'migrations', '20261004130000_correctif_annulation_commande.sql'), 'utf8');
const CODE = SQL.replace(/^\s*--.*$/gm, '');
const fn = (name: string) => CODE.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$(fn|)\\$;`))![0];

test('la règle financière vit dans la garde des commandes, hors du bloc des permissions', () => {
  const guard = fn('tg_orders_transition_guard');
  const privilegedBlock = guard.match(/if not public\.is_privileged_db_role\(\) then[\s\S]*?\n  end if;/)![0];
  assert.ok(!/paid_amount/.test(privilegedBlock), 'la règle ne doit pas dépendre du rôle');
  assert.match(guard, /if new\.status = 'ANNULEE' and old\.paid_amount > old\.refunded_amount then\s+raise exception/);
  assert.match(guard, /traitez le remboursement avant d''annuler/);
  assert.match(guard, /security invoker/, 'une garde qui interroge le rôle courant reste SECURITY INVOKER');
});

test('la garde des commandes garde intactes ses transitions et ses dates', () => {
  const guard = fn('tg_orders_transition_guard');
  for (const line of [
    "when 'NOUVELLE'        then array['CONFIRMEE', 'ANNULEE']",
    "when 'CONFIRMEE'       then array['EN_TRAITEMENT', 'EN_ATTENTE_INFO', 'PRETE', 'ANNULEE']",
    "when 'EN_TRAITEMENT'   then array['EN_ATTENTE_INFO', 'PRETE', 'TERMINEE', 'ANNULEE']",
    "when 'EN_ATTENTE_INFO' then array['EN_TRAITEMENT', 'PRETE', 'ANNULEE']",
    "when 'PRETE'           then array['TERMINEE', 'ANNULEE']",
    "new.cancelled_at := coalesce(new.cancelled_at, now());",
    "new.closed_at := coalesce(new.closed_at, now());",
    "permission orders.cancel requise",
    "permission orders.update requise",
  ]) {
    assert.ok(guard.includes(line), line);
  }
});

test('une annulation clôt seulement les déclarations en attente, sans rien supprimer', () => {
  const close = fn('tg_orders_close_pending_payments');
  assert.match(close, /if new\.status = 'ANNULEE' and old\.status is distinct from 'ANNULEE' then/);
  assert.match(close, /set status = 'ANNULE'\s+where order_id = new\.id\s+and status in \('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION'\);/);
  assert.ok(!/PAYE|REMBOURSE/.test(close.replace(/--.*$/gm, '')), 'jamais un paiement confirmé ou remboursé');
  assert.ok(!/\bdelete\b/i.test(close));
  assert.match(SQL, /create trigger orders_close_pending_payments\s+after update of status on public\.orders/);
});

test('une commande annulée ne reçoit plus d’argent, mais une déclaration peut être close', () => {
  const guard = fn('tg_payments_amount_guard');
  assert.match(guard, /if tg_op = 'INSERT'\s+or \(new\.status is distinct from old\.status\s+and new\.status not in \('ANNULE', 'ECHEC', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE'\)\)/);
  assert.match(guard, /Une commande annulée ne reçoit pas de paiement/);
  assert.match(guard, /dépasseraient le total de la commande/, 'le plafond du cumul confirmé est conservé');
});

test('l’historique distingue la clôture « avec la commande » par l’événement enregistré', () => {
  const history = fn('tg_payments_history');
  assert.match(history, /'Déclaration annulée avec la commande'/);
  assert.match(history, /else 'Déclaration annulée' end/);
  assert.match(fn('tg_orders_close_pending_payments'), /set_config\('mora\.paiement_cloture_commande', new\.id::text, true\)[\s\S]*set_config\('mora\.paiement_cloture_commande', '', true\)/);
});

test('une seule notification client ; « Paiement annulé » reste branché', () => {
  const router = fn('notifications_route_order_event');
  assert.match(router, /perform public\.notifications_resolve\(array\['admin\.paiement\.a_verifier'\], 'payment', e\.payment_id\);\s+if e\.event_type = 'PAIEMENT_ANNULE' and e\.summary = 'Déclaration annulée avec la commande' then\s+return;/);
  assert.match(router, /else 'client\.paiement\.annule'/);
  assert.match(SQL, /revoke execute on function public\.notifications_route_order_event\(public\.order_events\) from public, anon, authenticated;/);
});

test('aucune garde désactivée, aucune permission ni statut nouveau, rien d’autre touché', () => {
  assert.ok(!/disable trigger|session_replication_role/.test(CODE));
  assert.ok(!/insert into public\.permissions|insert into public\.roles|alter table [a-z_.]+ (add|drop) constraint/i.test(CODE));
  assert.ok(!/cancel_order|record_refund|complete_refund|issue_order_invoice|issue_document/.test(CODE), 'ni remboursement, ni facture, ni document');
  assert.ok(!/orders\.refund/.test(CODE));
});

test('l’administration : message métier exact et information dans la confirmation existante', () => {
  const actions = readFileSync(resolve(ROOT, 'src', 'lib', 'commerce', 'actions.ts'), 'utf8');
  assert.match(actions, /if \(text\.includes\('traitez le remboursement'\)\) return MESSAGES\.cancelWithPayment;/);
  assert.match(actions, /if \(text\.includes\('ne reçoit pas de paiement'\)\) return MESSAGES\.orderCancelled;/);
  const page = readFileSync(resolve(ROOT, 'src', 'app', '(pilotage)', 'administration', 'commandes', '[reference]', 'page.tsx'), 'utf8');
  assert.match(page, /Cette commande possède une déclaration de paiement en attente de vérification\. Elle sera annulée avec la commande\./);
  assert.match(page, /consequence=\{cancelConsequence\}/);
  assert.match(page, /\['EN_ATTENTE', 'INITIE', 'EN_VERIFICATION'\]\.includes\(payment\.status\)/);
});
