'use server';

/**
 * Actions de la fiche affilié et des catégories — phase 4H-3.
 *
 * Même discipline que les autres modules : permission (journalisée en cas de
 * refus) → validation → écriture en base sous la session, par des fonctions
 * qui revérifient la permission → e-mail journalisé ensuite, seulement si
 * « Notifier » est coché.
 *
 * Une seule action emploie la clé à privilèges : l'activation, qui doit
 * retrouver ou créer le compte de l'affilié dans `auth.users`. Elle ne décide
 * de rien : c'est `activate_affiliate`, appelée sous la session de
 * l'administrateur, qui contrôle la permission, la configuration, l'adresse du
 * compte, et alloue la référence.
 *
 * Après un acte, la page est rechargée avec un code de résultat fermé — le
 * bouton qui a déclenché l'acte disparaît souvent avec le nouvel état.
 */

import { randomBytes } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/lib/admin/actions';
import { affiliateLink } from '@/lib/affiliation/affiliates';
import { moroniLocalToIso, resolveEffectiveStart } from '@/lib/affiliation/time';
import { validateRule, type Rule, type Tier } from '@/lib/domain/affiliation';
import {
  renderAffiliateActivated,
  renderAffiliateStatus,
  renderPayoutAccountReviewed,
  type AffiliateStatusEmail,
} from '@/lib/emails/affiliation';
import { sendLoggedEmail } from '@/lib/emails/send';
import { getSiteUrl } from '@/lib/env';
import { assertPermission, PermissionDenied } from '@/lib/rbac/guards';
import { getAdminSupabaseClient } from '@/lib/supabase/admin';
import { getServerSupabaseClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/types';

const ko = (message: string): AdminActionState => ({ status: 'error', message });
const ok = (message: string): AdminActionState => ({ status: 'ok', message });

const MESSAGES = {
  denied: 'Vous n’avez pas le droit d’effectuer cette action.',
  unexpected: 'L’opération n’a pas abouti. Réessayez dans un instant.',
  noSupabase: 'La base de données est momentanément indisponible.',
  unknown: 'Cet affilié est introuvable.',
  reason: 'Un motif est requis : il rejoint l’historique.',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL = /^\d+(?:[.,]\d{1,2})?$/;

function field(formData: FormData, name: string, max = 2000): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function money(raw: string): number | null {
  const value = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!value) return null;
  return DECIMAL.test(value) ? Number(value) : Number.NaN;
}

function integer(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function describe(error: { code?: string; message?: string }): string {
  if (error.code === '42501') return error.message && error.message.length < 200 ? error.message : MESSAGES.denied;
  if (error.code === 'P0002') return MESSAGES.unknown;
  if (error.code === '23514' || error.code === '23505' || error.code === '23P01') {
    if (error.code === '23505') return 'Cette valeur existe déjà (un code ou une campagne porte déjà ce nom).';
    if (error.code === '23P01') return 'Une version de cette règle est déjà en vigueur sur la même période.';
    const message = error.message ?? '';
    return message.length > 0 && message.length < 240 ? message : 'Cette opération n’est pas possible dans l’état actuel.';
  }
  return MESSAGES.unexpected;
}

function affiliatePath(id: string) {
  return `/administration/affiliation/affilies/${id}/`;
}

function refresh(id?: string) {
  revalidatePath('/administration/affiliation/');
  revalidatePath('/administration/affiliation/affilies/');
  revalidatePath('/administration/affiliation/categories/');
  if (id) revalidatePath(affiliatePath(id));
  revalidatePath('/espace-affilie/', 'layout');
}

const back = (id: string, result: string, mail: 'sent' | 'failed' | 'skipped' = 'skipped') =>
  `${affiliatePath(id)}?resultat=${result}&mail=${mail}`;

async function mailAffiliate(
  affiliateId: string,
  template: string,
  email: { subject: string; rendered: { html: string; text: string } },
  to: string,
  actorId: string,
): Promise<'sent' | 'failed'> {
  const outcome = await sendLoggedEmail({
    template,
    to,
    subject: email.subject,
    rendered: email.rendered,
    entityType: 'affiliate',
    entityId: affiliateId,
    createdBy: actorId,
  });
  return outcome.state === 'sent' ? 'sent' : 'failed';
}

const firstName = (displayName: string) => displayName.split(/\s+/)[0] || displayName;

// -----------------------------------------------------------------------------
// Activation
// -----------------------------------------------------------------------------

export async function activateAffiliate(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('affiliates.create', 'affiliation.affilie.activation');
    const id = field(formData, 'id', 40);
    const notify = formData.get('notify') === '1';
    if (!UUID.test(id)) return ko(MESSAGES.unknown);

    const supabase = await getServerSupabaseClient();
    const admin = getAdminSupabaseClient();
    if (!supabase || !admin) return ko(MESSAGES.noSupabase);

    const { data: affiliate } = await supabase.from('affiliates').select('*').eq('id', id).maybeSingle();
    if (!affiliate) return ko(MESSAGES.unknown);

    if (affiliate.status === 'PREPARATION') {
      const { data: blockers } = await supabase.rpc('affiliate_activation_blockers', { p_affiliate_id: id });
      if (blockers && blockers.length > 0) return ko(`Activation impossible : ${blockers.join(' ')}`);
    }

    // Compte : retrouvé par l'adresse, créé seulement s'il n'existe pas.
    let newAccount = false;
    let userId = affiliate.user_id;
    if (!userId) {
      const { data: found } = await admin.rpc('find_auth_user_by_email', { p_email: affiliate.contact_email });
      userId = found ?? null;
    }
    if (!userId) {
      const created = await admin.auth.admin.createUser({
        email: affiliate.contact_email,
        email_confirm: true,
        // Mot de passe aléatoire jamais communiqué : la personne choisit le
        // sien par le parcours « mot de passe oublié », qui prouve qu'elle
        // détient l'adresse.
        password: `${randomBytes(24).toString('base64url')}Aa1!`,
        user_metadata: { full_name: affiliate.display_name },
      });
      if (created.error || !created.data.user) {
        // Une coupure peut survenir après la création : on relit avant d'abandonner.
        const { data: again } = await admin.rpc('find_auth_user_by_email', { p_email: affiliate.contact_email });
        if (!again) return ko('Le compte de l’affilié n’a pas pu être créé. Réessayez dans un instant.');
        userId = again;
      } else {
        userId = created.data.user.id;
        newAccount = true;
      }
    }

    const { data: activated, error } = await supabase.rpc('activate_affiliate', {
      p_affiliate_id: id,
      p_user_id: userId,
      p_started_on: field(formData, 'started_on', 10) || null,
    });
    if (error || !activated) return ko(describe(error ?? {}));

    let mail: 'sent' | 'failed' | 'skipped' = 'skipped';
    if (notify && affiliate.status === 'PREPARATION') {
      const site = getSiteUrl();
      const email = renderAffiliateActivated({
        firstName: firstName(activated.display_name),
        reference: activated.reference ?? '',
        link: affiliateLink(site, activated.slug),
        spaceUrl: `${site}/espace-affilie/`,
        newAccount,
        passwordUrl: `${site}/mot-de-passe-oublie/`,
        email: activated.contact_email,
      });
      mail = await mailAffiliate(id, 'affiliation.affilie.activation', email, activated.contact_email, context.access.userId);
    }
    refresh(id);
    destination = back(id, 'ACTIVE', mail);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    console.error('[affiliation] activation impossible');
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

// -----------------------------------------------------------------------------
// Statut
// -----------------------------------------------------------------------------

export async function changeAffiliateStatus(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('affiliates.disable', 'affiliation.affilie.statut');
    const id = field(formData, 'id', 40);
    const status = field(formData, 'status', 20);
    const reason = field(formData, 'reason', 1000);
    const message = field(formData, 'message') || null;
    const notify = formData.get('notify') === '1';
    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    if (!['SUSPENDU', 'ACTIF', 'TERMINE'].includes(status)) return ko('Statut inconnu.');
    if (!reason) return ko(MESSAGES.reason);

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { data: before } = await supabase.from('affiliates').select('status').eq('id', id).maybeSingle();
    const { data: after, error } = await supabase.rpc('change_affiliate_status', {
      p_affiliate_id: id,
      p_status: status,
      p_reason: reason,
      p_ended_on: field(formData, 'ended_on', 10) || null,
    });
    if (error || !after) return ko(describe(error ?? {}));

    let mail: 'sent' | 'failed' | 'skipped' = 'skipped';
    // Un affilié jamais activé n'a jamais été prévenu de rien : on ne lui écrit pas.
    if (notify && before?.status !== 'PREPARATION') {
      const kind: AffiliateStatusEmail = status === 'ACTIF' ? 'REACTIVE' : (status as 'SUSPENDU' | 'TERMINE');
      const email = renderAffiliateStatus(kind, {
        firstName: firstName(after.display_name),
        message,
        spaceUrl: `${getSiteUrl()}/espace-affilie/`,
      });
      mail = await mailAffiliate(id, `affiliation.affilie.${kind.toLowerCase()}`, email, after.contact_email, context.access.userId);
    }
    refresh(id);
    destination = back(id, status === 'ACTIF' ? 'REACTIVE' : status, mail);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

// -----------------------------------------------------------------------------
// Catégorie et paramètres individuels
// -----------------------------------------------------------------------------

export async function updateAffiliateTerms(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_rules.manage', 'affiliation.affilie.parametres');
    const id = field(formData, 'id', 40);
    const reason = field(formData, 'reason', 1000);
    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    if (!reason) return ko(MESSAGES.reason);

    const opt = (name: string) => field(formData, name, 40) || null;
    const windowDays = integer(field(formData, 'attribution_window_days', 6));
    const protectionMonths = integer(field(formData, 'prospect_protection_months', 4));
    const survivalMonths = integer(field(formData, 'post_end_survival_months', 4));
    const payoutMin = money(field(formData, 'payout_min_amount', 20));
    if ([windowDays, protectionMonths, survivalMonths, payoutMin].some((value) => Number.isNaN(value))) {
      return ko('Les durées sont des nombres entiers, le seuil un montant positif ; laissez vide pour hériter de la catégorie.');
    }
    const selfReferral = formData.get('self_referral_allowed') === '1';
    const selfReason = field(formData, 'self_referral_reason', 1000);
    if (selfReferral && !selfReason) return ko('Lever l’interdiction d’auto-affiliation exige un motif.');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { error } = await supabase.rpc('update_affiliate_terms', {
      p_affiliate_id: id,
      p_category_id: field(formData, 'category_id', 40),
      p_attribution_window_days: windowDays,
      p_prospect_protection_mode: opt('prospect_protection_mode'),
      p_prospect_protection_months: protectionMonths,
      p_post_end_survival_months: survivalMonths,
      p_payout_frequency: opt('payout_frequency'),
      p_payout_min_amount: payoutMin,
      p_acquisition_trigger: opt('acquisition_trigger'),
      p_self_referral_allowed: selfReferral,
      p_self_referral_reason: selfReferral ? selfReason : null,
      p_reason: reason,
    });
    if (error) return ko(describe(error));
    refresh(id);
    destination = back(id, 'PARAMETRES');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

// -----------------------------------------------------------------------------
// Règles
// -----------------------------------------------------------------------------

function readTiers(raw: string): Tier[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((entry) => {
      const tier = entry as Record<string, unknown>;
      const num = (value: unknown) => (value === '' || value === null || value === undefined ? null : Number(value));
      return {
        from: Number(tier.from),
        to: num(tier.to),
        rate: num(tier.rate),
        fixedAmount: num(tier.fixedAmount),
        minCommission: num(tier.minCommission),
        maxCommission: num(tier.maxCommission),
        label: typeof tier.label === 'string' && tier.label.trim() ? tier.label.trim().slice(0, 60) : null,
      };
    });
  } catch {
    return null;
  }
}

export async function publishRule(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_rules.manage', 'affiliation.regle.publication');
    const ownerType = field(formData, 'owner_type', 10) as 'CATEGORY' | 'AFFILIATE';
    const ownerId = field(formData, 'owner_id', 40);
    const target = field(formData, 'target', 60);
    const kind = field(formData, 'kind', 10) as Rule['kind'];
    const reason = field(formData, 'reason', 1000);
    const derogation = formData.get('derogation') === '1';
    const derogationReason = field(formData, 'derogation_reason', 1000);
    if (!['CATEGORY', 'AFFILIATE'].includes(ownerType) || !UUID.test(ownerId)) return ko('Propriétaire de règle invalide.');
    if (!['PERCENT', 'FIXED', 'TIERED', 'EXCLUDED'].includes(kind)) return ko('Type de règle invalide.');
    if (!reason) return ko(MESSAGES.reason);
    if (derogation) {
      await assertPermission('affiliate_rules.derogate', 'affiliation.regle.derogation');
      if (ownerType !== 'AFFILIATE') return ko('Une dérogation contractuelle ne se pose que sur un affilié.');
      if (!derogationReason) return ko('Le motif de la dérogation est obligatoire.');
    }

    const [targetType, targetId] = target === 'ALL' ? ['ALL', null] : (target.split(':') as [string, string]);
    if (!['ALL', 'SERVICE', 'PRODUCT'].includes(targetType) || (targetType !== 'ALL' && !UUID.test(targetId ?? ''))) {
      return ko('Cible de règle invalide.');
    }

    const rate = kind === 'PERCENT' ? money(field(formData, 'rate', 10)) : null;
    const fixed = kind === 'FIXED' ? money(field(formData, 'fixed_amount', 20)) : null;
    const tiers = kind === 'TIERED' ? readTiers(field(formData, 'tiers', 8000)) : null;
    const minCommission = kind === 'EXCLUDED' ? null : money(field(formData, 'min_commission', 20));
    const maxCommission = kind === 'EXCLUDED' ? null : money(field(formData, 'max_commission', 20));
    const minBase = money(field(formData, 'min_base', 20));
    if ([rate, fixed, minCommission, maxCommission, minBase].some((value) => Number.isNaN(value))) {
      return ko('Montants et taux : nombres positifs, deux décimales au plus.');
    }
    if (kind === 'TIERED' && !tiers) return ko('La grille de paliers est illisible.');

    // Immédiatement (la base prend son `now()`) ou une date ET une heure de
    // Moroni strictement à venir — jamais un minuit implicite.
    const start = resolveEffectiveStart(
      field(formData, 'effective_mode', 10),
      field(formData, 'effective_date', 10),
      field(formData, 'effective_time', 5),
    );
    if (!start.ok) return ko(start.message);
    const effectiveAt = start.iso;

    // Le moteur dit, avant la base, ce qui cloche dans la configuration.
    const draft: Rule = {
      id: 'brouillon',
      version: 1,
      owner: ownerType === 'AFFILIATE' ? { type: 'AFFILIATE', id: ownerId } : { type: 'CATEGORY', id: ownerId },
      target: targetType === 'ALL' ? { type: 'ALL' } : { type: targetType as 'SERVICE' | 'PRODUCT', id: targetId! },
      kind,
      rate,
      fixedAmount: fixed,
      tiers,
      minCommission,
      maxCommission,
      minBase,
      validFrom: effectiveAt ?? new Date().toISOString(),
    };
    const problems = validateRule(draft);
    if (problems.length > 0) return ko(problems.join(' '));

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { error } = await supabase.rpc('publish_affiliate_rule', {
      p_owner_type: ownerType,
      p_owner_id: ownerId,
      p_target_type: targetType as 'ALL' | 'SERVICE' | 'PRODUCT',
      p_target_id: targetId,
      p_kind: kind,
      p_rate: rate,
      p_fixed_amount: fixed,
      p_tiers: (tiers as unknown as Json) ?? null,
      p_min_commission: minCommission,
      p_max_commission: maxCommission,
      p_min_base: minBase,
      p_effective_at: effectiveAt,
      p_label: field(formData, 'label', 120) || null,
      p_reason: reason,
      p_derogation: derogation,
      p_derogation_reason: derogation ? derogationReason : null,
    });
    if (error) return ko(describe(error));
    refresh(ownerType === 'AFFILIATE' ? ownerId : undefined);
    destination =
      ownerType === 'AFFILIATE'
        ? back(ownerId, derogation ? 'DEROGATION' : 'REGLE')
        : `/administration/affiliation/categories/${ownerId}/?resultat=REGLE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    console.error('[affiliation] publication de règle impossible');
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

async function ruleOwnerPath(supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabaseClient>>>, ruleId: string) {
  const { data } = await supabase.from('affiliate_rules').select('affiliate_id, category_id').eq('id', ruleId).maybeSingle();
  if (!data) return null;
  return data.affiliate_id
    ? { path: affiliatePath(data.affiliate_id), affiliateId: data.affiliate_id }
    : { path: `/administration/affiliation/categories/${data.category_id}/`, affiliateId: undefined };
}

export async function endRule(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_rules.manage', 'affiliation.regle.cloture');
    const id = field(formData, 'rule', 40);
    const reason = field(formData, 'reason', 1000);
    if (!UUID.test(id)) return ko('Règle introuvable.');
    if (!reason) return ko(MESSAGES.reason);
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const owner = await ruleOwnerPath(supabase, id);
    const { error } = await supabase.rpc('end_affiliate_rule', { p_rule_id: id, p_end_at: null, p_reason: reason });
    if (error) return ko(describe(error));
    refresh(owner?.affiliateId);
    destination = `${owner?.path ?? '/administration/affiliation/'}?resultat=REGLE_CLOSE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

export async function withdrawRule(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_rules.manage', 'affiliation.regle.retrait');
    const id = field(formData, 'rule', 40);
    const reason = field(formData, 'reason', 1000);
    if (!UUID.test(id)) return ko('Règle introuvable.');
    if (!reason) return ko(MESSAGES.reason);
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const owner = await ruleOwnerPath(supabase, id);
    const { error } = await supabase.rpc('withdraw_affiliate_rule', { p_rule_id: id, p_reason: reason });
    if (error) return ko(describe(error));
    refresh(owner?.affiliateId);
    destination = `${owner?.path ?? '/administration/affiliation/'}?resultat=REGLE_RETIREE`;
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

// -----------------------------------------------------------------------------
// Codes de réduction
// -----------------------------------------------------------------------------

export async function saveCode(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_codes.manage', 'affiliation.code.enregistrement');
    const affiliateId = field(formData, 'affiliate_id', 40);
    const codeId = field(formData, 'code_id', 40);
    if (!UUID.test(affiliateId)) return ko(MESSAGES.unknown);

    const kind = field(formData, 'discount_kind', 10) as 'PERCENT' | 'FIXED';
    const value = money(field(formData, 'discount_value', 20));
    const minOrder = money(field(formData, 'min_order_amount', 20));
    const maxDiscount = money(field(formData, 'max_discount_amount', 20));
    const maxUses = integer(field(formData, 'max_uses', 8));
    const maxPerCustomer = integer(field(formData, 'max_uses_per_customer', 8));
    if (!['PERCENT', 'FIXED'].includes(kind) || value === null || Number.isNaN(value)) {
      return ko('Indiquez le type et la valeur de la réduction.');
    }
    if ([minOrder, maxDiscount, maxUses, maxPerCustomer].some((entry) => Number.isNaN(entry))) {
      return ko('Montants et nombres positifs, ou rien.');
    }
    const fromRaw = field(formData, 'valid_from', 20);
    const toRaw = field(formData, 'valid_to', 20);
    const validFrom = fromRaw ? moroniLocalToIso(fromRaw) : null;
    const validTo = toRaw ? moroniLocalToIso(toRaw) : null;
    if ((fromRaw && !validFrom) || (toRaw && !validTo)) return ko('Dates de validité invalides.');

    const readIds = (name: string) =>
      formData.getAll(name).filter((entry): entry is string => typeof entry === 'string' && UUID.test(entry));

    const values = {
      label: field(formData, 'label', 120) || null,
      is_active: formData.get('is_active') === '1',
      discount_kind: kind,
      discount_value: value,
      ...(validFrom ? { valid_from: validFrom } : {}),
      valid_to: validTo,
      min_order_amount: minOrder,
      max_discount_amount: maxDiscount,
      max_uses: maxUses,
      max_uses_per_customer: maxPerCustomer,
      service_ids: readIds('service_ids'),
      excluded_service_ids: readIds('excluded_service_ids'),
      product_ids: readIds('product_ids'),
      excluded_product_ids: readIds('excluded_product_ids'),
    };

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    if (codeId) {
      if (!UUID.test(codeId)) return ko('Code introuvable.');
      const { data, error } = await supabase.from('affiliate_codes').update(values).eq('id', codeId).eq('affiliate_id', affiliateId).select('id');
      if (error) return ko(describe(error));
      if (!data || data.length === 0) return ko(MESSAGES.denied);
    } else {
      const code = field(formData, 'code', 24).toUpperCase();
      if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code) || code.length < 3) return ko('Code : lettres, chiffres et tirets, 3 à 24 caractères.');
      const { error } = await supabase.from('affiliate_codes').insert({ ...values, affiliate_id: affiliateId, code });
      if (error) return ko(describe(error));
    }
    refresh(affiliateId);
    destination = back(affiliateId, codeId ? 'CODE_MODIFIE' : 'CODE_CREE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

// -----------------------------------------------------------------------------
// Campagnes
// -----------------------------------------------------------------------------

export async function createCampaign(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliates.update', 'affiliation.campagne.creation');
    const affiliateId = field(formData, 'affiliate_id', 40);
    const label = field(formData, 'label', 80);
    const code = field(formData, 'code', 32).toLowerCase();
    if (!UUID.test(affiliateId)) return ko(MESSAGES.unknown);
    if (!label || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code) || code.length < 2) {
      return ko('Un libellé, et un code en minuscules, chiffres et tirets.');
    }
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { error } = await supabase.rpc('create_affiliate_campaign', { p_affiliate_id: affiliateId, p_code: code, p_label: label });
    if (error) return ko(describe(error));
    refresh(affiliateId);
    destination = back(affiliateId, 'CAMPAGNE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

export async function toggleCampaign(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  try {
    await assertPermission('affiliates.update', 'affiliation.campagne.etat');
    const id = field(formData, 'campaign', 40);
    if (!UUID.test(id)) return ko('Campagne introuvable.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { data, error } = await supabase.rpc('set_affiliate_campaign_active', {
      p_campaign_id: id,
      p_active: formData.get('active') === '1',
    });
    if (error) return ko(describe(error));
    refresh(data?.affiliate_id);
    return ok(data?.is_active ? 'La campagne est activée.' : 'La campagne est désactivée.');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
}

// -----------------------------------------------------------------------------
// Coordonnées de versement (décision J)
// -----------------------------------------------------------------------------

export async function proposePayoutAccount(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('payouts.manage', 'affiliation.versement.coordonnees');
    const affiliateId = field(formData, 'affiliate_id', 40);
    const method = field(formData, 'method', 24);
    if (!UUID.test(affiliateId)) return ko(MESSAGES.unknown);
    const details: Record<string, string> = {};
    for (const key of ['numero', 'titulaire', 'banque', 'compte', 'email', 'ordre']) {
      const value = field(formData, `detail_${key}`, 120);
      if (value) details[key] = value;
    }
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { error } = await supabase.rpc('propose_payout_account', {
      p_affiliate_id: affiliateId,
      p_method: method,
      p_details: details,
    });
    if (error) return ko(describe(error));
    refresh(affiliateId);
    destination = back(affiliateId, 'COORDONNEES_SAISIES');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

export async function reviewPayoutAccount(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    const context = await assertPermission('payouts.manage', 'affiliation.versement.validation');
    const accountId = field(formData, 'account', 40);
    const approve = field(formData, 'decision', 10) === 'VALIDER';
    const note = field(formData, 'note', 1000) || null;
    const notify = formData.get('notify') === '1';
    if (!UUID.test(accountId)) return ko('Demande introuvable.');
    if (!approve && !note) return ko('Un refus se motive : la note est adressée à l’affilié si vous le notifiez.');

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { data: account, error } = await supabase.rpc('review_payout_account', {
      p_account_id: accountId,
      p_approve: approve,
      p_note: note,
    });
    if (error || !account) return ko(describe(error ?? {}));

    let mail: 'sent' | 'failed' | 'skipped' = 'skipped';
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('display_name, contact_email, status')
      .eq('id', account.affiliate_id)
      .maybeSingle();
    if (notify && affiliate && affiliate.status !== 'PREPARATION') {
      const { data: methods } = await supabase.rpc('affiliate_payout_methods');
      const label = (methods ?? []).find((row) => row.code === account.method_code)?.label ?? account.method_code;
      const email = renderPayoutAccountReviewed(approve, { firstName: firstName(affiliate.display_name), methodLabel: label, note });
      mail = await mailAffiliate(account.affiliate_id, 'affiliation.affilie.coordonnees', email, affiliate.contact_email, context.access.userId);
    }
    refresh(account.affiliate_id);
    destination = back(account.affiliate_id, approve ? 'COORDONNEES_VALIDEES' : 'COORDONNEES_REFUSEES', mail);
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

// -----------------------------------------------------------------------------
// Notes et catégories
// -----------------------------------------------------------------------------

export async function addAffiliateNote(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliates.update', 'affiliation.affilie.note');
    const id = field(formData, 'id', 40);
    const body = field(formData, 'note', 4000);
    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    if (!body) return ko('Une note vide n’apporte rien.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { error } = await supabase.from('affiliate_notes').insert({ affiliate_id: id, body });
    if (error) return ko(describe(error));
    refresh(id);
    destination = back(id, 'NOTE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

export async function updateAffiliateIdentity(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliates.update', 'affiliation.affilie.identite');
    const id = field(formData, 'id', 40);
    if (!UUID.test(id)) return ko(MESSAGES.unknown);
    const displayName = field(formData, 'display_name', 120);
    const email = field(formData, 'contact_email', 254).toLowerCase();
    if (!displayName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ko('Nom et adresse e-mail valides requis.');
    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    const { data: current } = await supabase.from('affiliates').select('user_id, contact_email').eq('id', id).maybeSingle();
    if (!current) return ko(MESSAGES.unknown);
    // L'adresse est celle du compte rattaché : elle ne change plus après l'activation.
    if (current.user_id && current.contact_email.toLowerCase() !== email) {
      return ko('L’adresse d’un affilié activé est celle de son compte : elle ne se modifie pas ici.');
    }
    const { data, error } = await supabase
      .from('affiliates')
      .update({
        display_name: displayName,
        legal_name: field(formData, 'legal_name', 160) || null,
        party_type: field(formData, 'party_type', 20) === 'ORGANISATION' ? 'ORGANISATION' : 'PERSONNE',
        contact_email: email,
        contact_phone: field(formData, 'contact_phone', 40) || null,
        country: field(formData, 'country', 80) || null,
        city: field(formData, 'city', 80) || null,
        contract_reference: field(formData, 'contract_reference', 120) || null,
        contract_signed_on: field(formData, 'contract_signed_on', 10) || null,
      })
      .eq('id', id)
      .select('id');
    if (error) return ko(describe(error));
    if (!data || data.length === 0) return ko(MESSAGES.denied);
    refresh(id);
    destination = back(id, 'IDENTITE');
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}

export async function saveCategory(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  let destination: string;
  try {
    await assertPermission('affiliate_rules.manage', 'affiliation.categorie.enregistrement');
    const id = field(formData, 'id', 40);
    const label = field(formData, 'label', 80);
    if (!label) return ko('Le libellé est requis.');
    const windowDays = integer(field(formData, 'attribution_window_days', 6));
    const protectionMonths = integer(field(formData, 'prospect_protection_months', 4));
    const survivalMonths = integer(field(formData, 'post_end_survival_months', 4));
    const payoutMin = money(field(formData, 'payout_min_amount', 20));
    const sortOrder = integer(field(formData, 'sort_order', 6));
    if ([windowDays, protectionMonths, survivalMonths, payoutMin, sortOrder].some((value) => Number.isNaN(value))) {
      return ko('Durées et ordre : nombres entiers ; seuil : montant positif ou vide.');
    }
    const values = {
      label,
      description: field(formData, 'description', 2000) || null,
      is_active: formData.get('is_active') === '1',
      is_internal: formData.get('is_internal') === '1',
      sort_order: sortOrder ?? 0,
      attribution_window_days: windowDays ?? 90,
      prospect_protection_mode: field(formData, 'prospect_protection_mode', 20) === 'PARTENARIAT' ? 'PARTENARIAT' : 'DUREE',
      prospect_protection_months: protectionMonths,
      post_end_survival_months: survivalMonths,
      payout_frequency: (field(formData, 'payout_frequency', 20) || 'FIN_DE_MOIS') as 'FIN_DE_MOIS',
      payout_min_amount: payoutMin,
      acquisition_trigger: (field(formData, 'acquisition_trigger', 30) || 'PAIEMENT_INTEGRAL') as 'PAIEMENT_INTEGRAL',
    } as const;

    const supabase = await getServerSupabaseClient();
    if (!supabase) return ko(MESSAGES.noSupabase);
    if (id) {
      if (!UUID.test(id)) return ko('Catégorie introuvable.');
      const { data, error } = await supabase.from('affiliate_categories').update(values).eq('id', id).select('id');
      if (error) return ko(describe(error));
      if (!data || data.length === 0) return ko(MESSAGES.denied);
      destination = `/administration/affiliation/categories/${id}/?resultat=CATEGORIE`;
    } else {
      const code = field(formData, 'code', 40).toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) return ko('Code : majuscules, chiffres et soulignés, commençant par une lettre.');
      const { data, error } = await supabase.from('affiliate_categories').insert({ ...values, code }).select('id').single();
      if (error) return ko(describe(error));
      destination = `/administration/affiliation/categories/${data.id}/?resultat=CATEGORIE`;
    }
    refresh();
  } catch (error) {
    if (error instanceof PermissionDenied) return ko(MESSAGES.denied);
    return ko(MESSAGES.unexpected);
  }
  redirect(destination);
}
