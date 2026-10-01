import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';

import {
  CONSENT_VERSION,
  EMPTY_DRAFT,
  isPayoutKind,
  isRequestedProfile,
  LIMITS,
  payoutDetailsFor,
  PROFILE_LABELS,
  PROFILE_QUESTIONS,
  profileAnswersFor,
  validateDraft,
  type ApplicationDraft,
  type PayoutMethodOption,
} from '@/lib/affiliation/applications';
import { renderApplicationReceived, renderApplicationTeam, type ApplicationSummary } from '@/lib/emails/affiliation';
import { sendLoggedEmail, teamAddress } from '@/lib/emails/send';
import { getSiteUrl } from '@/lib/env';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Dépôt d'une candidature au programme d'affiliation — phase 4H.
 *
 * Même ordre que `/api/contact` depuis 4F, pour la même raison :
 *
 *   1. limite de fréquence et pot de miel ;
 *   2. revalidation complète — le navigateur a guidé, le serveur décide ;
 *   3. **la base d'abord** — `submit_affiliate_application`, seule porte ;
 *   4. **les e-mails ensuite**, journalisés : un échec SMTP ne retire rien à
 *      une candidature enregistrée, et l'administration peut renvoyer.
 *
 * La réponse ne dit jamais si une adresse avait déjà candidaté : un doublon
 * reçoit la même réponse qu'un premier dépôt, sans second accusé.
 */

export const runtime = 'nodejs';

const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function clean(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return '';
  const stripped = multiline
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : value.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return stripped.trim().slice(0, max);
}

function readRecord(value: unknown, max: number, multiline = false): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (!/^[a-z][a-z_]{1,30}$/.test(key)) continue;
    const text = clean(raw, max, multiline);
    if (text) out[key] = text;
  }
  return out;
}

function readDraft(raw: Record<string, unknown>): ApplicationDraft {
  const profile = isRequestedProfile(raw.profile) ? raw.profile : '';
  return {
    ...EMPTY_DRAFT,
    firstName: clean(raw.firstName, LIMITS.name),
    lastName: clean(raw.lastName, LIMITS.name),
    email: clean(raw.email, LIMITS.email).toLowerCase(),
    phone: clean(raw.phone, LIMITS.phone),
    country: clean(raw.country, LIMITS.place),
    city: clean(raw.city, LIMITS.place),
    profile,
    answers: readRecord(raw.answers, LIMITS.answer, true),
    motivation: clean(raw.motivation, LIMITS.motivation, true),
    idea: clean(raw.idea, LIMITS.idea, true),
    payoutMethod: clean(raw.payoutMethod, 24),
    payoutDetails: readRecord(raw.payoutDetails, LIMITS.payout),
    consent: raw.consent === true,
  };
}

export async function POST(request: Request) {
  const key = clientKey(request);
  const limit = rateLimit(`affiliation:${key}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }
  if (typeof payload !== 'object' || payload === null) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }
  const raw = payload as Record<string, unknown>;

  // Pot de miel : réponse indistinguable d'un succès, rien n'est écrit.
  if (typeof raw.website === 'string' && raw.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const { data: methodRows, error: methodsError } = await supabase.rpc('affiliate_payout_methods');
  if (methodsError) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
  const methods: PayoutMethodOption[] = (methodRows ?? [])
    .filter((row) => isPayoutKind(row.kind))
    .map((row) => ({ code: row.code, label: row.label, kind: row.kind as PayoutMethodOption['kind'] }));

  const draft = readDraft(raw);
  const invalid = validateDraft(draft, methods);
  if (invalid) {
    return NextResponse.json(
      { ok: false, error: 'invalid_fields', step: invalid.step, fields: Object.keys(invalid.errors) },
      { status: 400 },
    );
  }

  const method = methods.find((entry) => entry.code === draft.payoutMethod)!;
  const answers = profileAnswersFor(draft);
  const details = payoutDetailsFor(method.kind, draft.payoutDetails);
  const hash = createHash('sha256').update(`affiliation:${key}`).digest('hex');

  const { data, error } = await supabase.rpc('submit_affiliate_application', {
    p_first_name: draft.firstName,
    p_last_name: draft.lastName,
    p_email: draft.email,
    p_phone: draft.phone,
    p_country: draft.country,
    p_city: draft.city,
    p_profile: draft.profile,
    p_answers: answers,
    p_motivation: draft.motivation,
    p_idea: draft.idea || null,
    p_payout_method: method.code,
    p_payout_details: details,
    p_consent: true,
    p_consent_version: CONSENT_VERSION,
    p_client_hash: hash,
  });

  if (error) {
    if (error.code === '54000') {
      return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '3600' } });
    }
    if (error.code === '23514' || error.code === '23502' || error.code === '22001') {
      return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
    }
    console.error('[affiliation] dépôt impossible', error.code);
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  const row = data?.[0];
  if (!row) {
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }

  // Doublon : la candidature ouverte existe déjà, rien n'est renvoyé.
  if (row.duplicate) {
    return NextResponse.json({ ok: true, stored: true });
  }

  const profile = draft.profile as keyof typeof PROFILE_LABELS;
  const summary: ApplicationSummary = {
    firstName: draft.firstName,
    lastName: draft.lastName,
    email: draft.email,
    phone: draft.phone,
    country: draft.country,
    city: draft.city,
    profileLabel: PROFILE_LABELS[profile],
    payoutLabel: method.label,
    answers: PROFILE_QUESTIONS[profile]
      .filter((question) => answers[question.key])
      .map((question) => ({ label: question.label, value: answers[question.key]! })),
    motivation: draft.motivation,
    idea: draft.idea || null,
    submittedAt: new Date(),
  };

  const received = renderApplicationReceived(summary);
  const ack = await sendLoggedEmail({
    template: 'affiliation.candidature.accuse',
    to: draft.email,
    subject: received.subject,
    rendered: received.rendered,
    entityType: 'affiliate_application',
    entityId: row.application_id,
  });

  const team = teamAddress();
  if (team) {
    const adminUrl = `${getSiteUrl()}/administration/affiliation/candidatures/${row.application_id}/`;
    const notification = renderApplicationTeam(summary, adminUrl);
    await sendLoggedEmail({
      template: 'affiliation.candidature.equipe',
      to: team,
      recipientKind: 'EQUIPE',
      subject: notification.subject,
      rendered: notification.rendered,
      entityType: 'affiliate_application',
      entityId: row.application_id,
    });
  }

  return NextResponse.json({ ok: true, stored: true, emailSent: ack.state === 'sent' });
}
