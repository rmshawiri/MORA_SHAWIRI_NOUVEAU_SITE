import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import AdminPage from '@/components/admin/AdminPage';
import AffiliateAttributionPanel from '@/components/admin/AffiliateAttributionPanel';
import AffiliateRuleEditor from '@/components/admin/AffiliateRuleEditor';
import AffiliationDecisionForm, { type DecisionInput } from '@/components/admin/AffiliationDecisionForm';
import {
  AffiliateStatusBadge,
  EmailStatusBadge,
  PayoutAccountBadge,
  RuleStateBadge,
} from '@/components/admin/AffiliationBadges';
import { PayoutStatusBadge } from '@/components/admin/AffiliationBadges';
import CommissionsTable from '@/components/admin/CommissionsTable';
import ConfirmForm from '@/components/admin/ConfirmForm';
import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { retryEmail } from '@/lib/affiliation/actions';
import {
  activateAffiliate,
  addAffiliateNote,
  changeAffiliateStatus,
  createCampaign,
  endRule,
  proposePayoutAccount,
  publishRule,
  reviewPayoutAccount,
  saveCode,
  toggleCampaign,
  updateAffiliateIdentity,
  updateAffiliateTerms,
  withdrawRule,
} from '@/lib/affiliation/affiliate-actions';
import {
  ACQUISITION_TRIGGER_LABELS,
  AFFILIATE_STATUS_ACTIONS,
  AFFILIATE_STATUS_LABELS,
  PAYOUT_FREQUENCY_LABELS,
  PROTECTION_MODE_LABELS,
  RULE_KIND_LABELS,
  affiliateLink,
  describeDiscount,
  describeRuleRow,
  ruleOriginFor,
  ruleState,
} from '@/lib/affiliation/affiliates';
import {
  findAffiliate,
  formatMoment,
  listAffiliateDocuments,
  listCommissions,
  listPayouts,
  readCommissionTotals,
  listCategories,
  listOffers,
  listPayoutMethods,
  readPayoutAccountDetails,
} from '@/lib/affiliation/admin';
import { maskPayoutValue } from '@/lib/affiliation/applications';
import { adjustCommission } from '@/lib/affiliation/commission-actions';
import { issueAffiliateSheet } from '@/lib/affiliation/document-actions';
import { kmf } from '@/lib/affiliation/commissions';
import { formatPayoutDay } from '@/lib/affiliation/payouts';
import { RULE_ORIGIN_LABELS } from '@/lib/domain/affiliation';
import { getSiteUrl } from '@/lib/env';
import { requireModule } from '@/lib/rbac/guards';
import type { AcquisitionTrigger, PayoutFrequency, ProspectProtectionMode } from '@/lib/supabase/types-affiliation';

export const metadata: Metadata = {
  title: 'Fiche affilié',
  robots: { index: false, follow: false },
};

/** Retours possibles d'un acte : liste fermée, jamais un texte reçu. */
const RESULTS: Record<string, string> = {
  CREE: 'La fiche est créée en préparation. Réglez maintenant la catégorie, les règles et les coordonnées de versement, puis activez-la.',
  ACTIVE: 'L’affilié est activé : sa référence est attribuée et son espace est ouvert.',
  SUSPENDU: 'L’affiliation est suspendue.',
  REACTIVE: 'L’affiliation est réactivée.',
  TERMINE: 'L’affiliation est close. Son historique est conservé.',
  PARAMETRES: 'La catégorie et les paramètres sont enregistrés.',
  REGLE: 'La règle est publiée. Les commissions déjà enregistrées ne changent pas.',
  DEROGATION: 'La règle est publiée avec sa dérogation contractuelle.',
  REGLE_CLOSE: 'La règle est close.',
  REGLE_RETIREE: 'La version programmée est retirée.',
  CODE_CREE: 'Le code de réduction est créé.',
  CODE_MODIFIE: 'Le code de réduction est modifié.',
  CAMPAGNE: 'La campagne est créée.',
  COORDONNEES_SAISIES: 'Les coordonnées sont enregistrées en attente de validation.',
  COORDONNEES_VALIDEES: 'Les coordonnées de versement sont validées.',
  COORDONNEES_REFUSEES: 'Les coordonnées de versement sont refusées.',
  NOTE: 'La note est enregistrée.',
  IDENTITE: 'L’identité est mise à jour.',
  RENVOI: 'L’e-mail est reparti.',
  AJUSTEMENT: 'L’ajustement est enregistré. Il sera imputé sur le prochain versement.',
  FICHE_EMISE: 'La fiche officielle est émise, archivée avec son empreinte. La précédente est marquée « remplacée ».',
  FICHE_EMISE_SANS_ARCHIVE: 'La fiche officielle est émise. Son archive sera déposée au premier téléchargement.',
};
const PROSPECT_RESULTS: Record<string, string> = {
  PROSPECT_A_VERIFIER: 'Le prospect est pris en vérification.',
  PROSPECT_RECONNU: 'Le prospect est reconnu et protégé pour cet affilié.',
  PROSPECT_REFUSE: 'L’origine du prospect est refusée.',
};
const MAIL_RESULTS: Record<string, string> = {
  sent: ' L’affilié a été notifié par e-mail.',
  failed: ' L’e-mail n’a pas pu partir : il est journalisé ci-dessous et peut être renvoyé.',
  skipped: '',
};

const PAYOUT_KEY_LABELS: Record<string, string> = {
  numero: 'Numéro',
  titulaire: 'Titulaire',
  banque: 'Banque',
  compte: 'Compte / RIB',
  email: 'E-mail du compte',
  ordre: 'À l’ordre de',
};

const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Indian/Comoro',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
  return parts.replace(' ', 'T');
};

/**
 * Fiche affilié — phase 4H-3.
 *
 * Une seule page pour tout ce qui concerne un affilié, dans l'ordre où l'on
 * s'en sert : qui il est, où il en est, ce qu'il gagne, comment il recommande,
 * comment il est payé, ce qui s'est passé. Chaque bloc s'affiche sous sa
 * permission ; chaque acte la revérifie, et la base encore.
 *
 * Les blocs Attribution, Finance et Documents s'ajoutent avec leurs lots
 * (4H-4 à 4H-7).
 */
export default async function AffiliePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireModule('affiliation');
  const { id } = await params;
  const query = await searchParams;
  const detail = await findAffiliate(id);
  if (!detail) notFound();

  const { affiliate, category, terms, rules, campaigns, codes, payoutAccounts, events, notes, emails, blockers } = detail;
  const can = {
    update: context.can('affiliates.update'),
    create: context.can('affiliates.create'),
    disable: context.can('affiliates.disable'),
    rules: context.can('affiliate_rules.manage'),
    derogate: context.can('affiliate_rules.derogate'),
    codes: context.can('affiliate_codes.manage'),
    payoutView: context.can('payouts.view'),
    payoutManage: context.can('payouts.manage'),
    commissions: context.can('commissions.view'),
    commissionsManage: context.can('commissions.manage'),
    issueSheet: context.can('affiliate_documents.issue'),
  };
  const isSelf = affiliate.user_id !== null && affiliate.user_id === context.access.userId;

  const [categories, offers, methods, commissions, totals, payouts, documents] = await Promise.all([
    can.rules ? listCategories() : Promise.resolve([]),
    can.rules || can.codes ? listOffers() : Promise.resolve([]),
    listPayoutMethods(),
    can.commissions ? listCommissions({ affiliateId: id }) : Promise.resolve([]),
    can.commissions ? readCommissionTotals(id) : Promise.resolve(null),
    can.payoutView ? listPayouts({ affiliateId: id }) : Promise.resolve([]),
    listAffiliateDocuments(id, affiliate.user_id),
  ]);
  const payoutDetails = can.payoutView
    ? Object.fromEntries(
        await Promise.all(payoutAccounts.map(async (account) => [account.id, await readPayoutAccountDetails(account.id)] as const)),
      )
    : {};
  const methodLabel = (code: string) => methods.find((method) => method.code === code)?.label ?? code;
  const offerLabel = (type: string, offerId: string | null) =>
    offers.find((offer) => offer.type === type && offer.id === offerId)?.title ?? 'Offre';

  const pick = (table: Record<string, string>, key: unknown) =>
    typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
  const result = pick(RESULTS, query.resultat) ?? pick(PROSPECT_RESULTS, query.affiliation);
  const mailResult = pick(MAIL_RESULTS, query.mail) ?? '';

  const site = getSiteUrl();
  const mainLink = affiliateLink(site, affiliate.slug);
  const ownRules = rules.filter((rule) => rule.affiliate_id === affiliate.id);
  const categoryRules = rules.filter((rule) => rule.category_id === affiliate.category_id);
  const statusActions = AFFILIATE_STATUS_ACTIONS[affiliate.status];

  const inherit = (value: unknown) => value === null || value === undefined;

  return (
    <AdminPage
      eyebrow={`Affiliation — ${category?.label ?? 'catégorie inconnue'}`}
      title={affiliate.display_name}
      lead={`${AFFILIATE_STATUS_LABELS[affiliate.status]}${affiliate.reference ? ` — ${affiliate.reference}` : ' — référence attribuée à l’activation'}.`}
      actions={
        <>
          <Link className="btn btn--ghost" href="/administration/affiliation/affilies/">
            Retour aux affiliés
          </Link>
          {detail.applicationId ? (
            <Link className="btn btn--ghost" href={`/administration/affiliation/candidatures/${detail.applicationId}/`}>
              Candidature d’origine
            </Link>
          ) : null}
        </>
      }
    >
      {result ? (
        <div className={`admin-notice ${query.mail === 'failed' ? 'admin-notice--error' : 'admin-notice--ok'}`} role="status">
          <p>
            {result}
            {mailResult}
          </p>
        </div>
      ) : null}

      {isSelf ? (
        <div className="admin-notice admin-notice--error" role="note">
          <p>
            Cette affiliation est la vôtre. Vous la consultez, mais aucune décision ne peut être prise par vous : la base
            le refuse.
          </p>
        </div>
      ) : null}

      {/* ------------------------------------------------------------ Activation */}
      {affiliate.status === 'PREPARATION' ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Activation</h2>
            <p>Un affilié ne devient actif qu’avec une configuration financière complète.</p>
          </div>
          {blockers.length > 0 ? (
            <ul className="admin-timeline">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : (
            <p>Tout est prêt : la référence AFIL sera attribuée et l’espace affilié ouvert.</p>
          )}
          {can.create && blockers.length === 0 && !isSelf ? (
            <AffiliationDecisionForm
              action={activateAffiliate}
              fields={{ id: affiliate.id }}
              trigger="Activer l’affilié"
              title="Activer cet affilié ?"
              consequence={`Une référence officielle est attribuée, le compte ${affiliate.contact_email} est rattaché (ou créé s’il n’existe pas) et reçoit l’accès à l’espace affilié.`}
              confirmLabel="Activer"
              variant="gold"
              inputs={[
                { kind: 'date', name: 'started_on', label: 'Date de début', hint: 'Vide : aujourd’hui.' },
                { kind: 'checkbox', name: 'notify', label: 'Envoyer l’e-mail d’activation', defaultChecked: true },
              ]}
            />
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------- Identité */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Identité</h2>
          <p>
            <AffiliateStatusBadge status={affiliate.status} />
          </p>
        </div>
        <dl className="admin-def">
          <dt>Référence</dt>
          <dd>{affiliate.reference ?? '—'}</dd>
          <dt>Origine</dt>
          <dd>{affiliate.origin === 'ADMINISTRATION' ? 'Ajout direct par l’administration' : 'Candidature acceptée'}</dd>
          <dt>Nature</dt>
          <dd>{affiliate.party_type === 'ORGANISATION' ? 'Organisation' : 'Personne'}</dd>
          {affiliate.legal_name ? (
            <>
              <dt>Raison sociale</dt>
              <dd>{affiliate.legal_name}</dd>
            </>
          ) : null}
          <dt>E-mail</dt>
          <dd>{affiliate.contact_email}</dd>
          <dt>Téléphone</dt>
          <dd>{affiliate.contact_phone ?? '—'}</dd>
          <dt>Lieu</dt>
          <dd>{[affiliate.city, affiliate.country].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Compte</dt>
          <dd>{affiliate.user_id ? 'Rattaché' : 'Rattaché à l’activation'}</dd>
          <dt>Début</dt>
          <dd>{affiliate.started_on ?? '—'}</dd>
          {affiliate.ended_on ? (
            <>
              <dt>Fin</dt>
              <dd>
                {affiliate.ended_on}
                {affiliate.end_reason ? ` — ${affiliate.end_reason}` : ''}
              </dd>
            </>
          ) : null}
          <dt>Convention</dt>
          <dd>
            {affiliate.contract_reference ?? '—'}
            {affiliate.contract_signed_on ? `, signée le ${affiliate.contract_signed_on}` : ''}
          </dd>
        </dl>
        {can.update && affiliate.status !== 'TERMINE' ? (
          <AffiliationDecisionForm
            action={updateAffiliateIdentity}
            fields={{ id: affiliate.id }}
            trigger="Modifier l’identité"
            title="Enregistrer ces informations ?"
            consequence="Les informations courantes de l’affilié sont mises à jour. L’historique garde l’avant et l’après."
            confirmLabel="Enregistrer"
            inputs={[
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'display_name', label: 'Nom affiché', required: true, defaultValue: affiliate.display_name, maxLength: 120 },
                  { kind: 'text', name: 'legal_name', label: 'Raison sociale', defaultValue: affiliate.legal_name ?? '', maxLength: 160 },
                  {
                    kind: 'select', name: 'party_type', label: 'Nature', defaultValue: affiliate.party_type,
                    options: [{ value: 'PERSONNE', label: 'Personne' }, { value: 'ORGANISATION', label: 'Organisation' }],
                  },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'contact_email', label: 'E-mail', type: 'email', required: true, defaultValue: affiliate.contact_email, maxLength: 254,
                    hint: affiliate.user_id ? 'Celle du compte rattaché : elle ne change plus.' : undefined },
                  { kind: 'text', name: 'contact_phone', label: 'Téléphone', type: 'tel', defaultValue: affiliate.contact_phone ?? '', maxLength: 40 },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'city', label: 'Ville', defaultValue: affiliate.city ?? '', maxLength: 80 },
                  { kind: 'text', name: 'country', label: 'Pays', defaultValue: affiliate.country ?? '', maxLength: 80 },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'contract_reference', label: 'Référence de convention', defaultValue: affiliate.contract_reference ?? '', maxLength: 120 },
                  { kind: 'date', name: 'contract_signed_on', label: 'Signée le', defaultValue: affiliate.contract_signed_on ?? '' },
                ],
              },
            ]}
          />
        ) : null}
      </section>

      {/* --------------------------------------------------------------- Statut */}
      {can.disable && statusActions.length > 0 && !isSelf ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Statut</h2>
            <p>Une suspension arrête les nouvelles attributions ; une clôture est définitive. L’historique est conservé.</p>
          </div>
          <div className="admin-table__actions">
            {statusActions.map((status) => {
              const label = status === 'ACTIF' ? 'Réactiver' : status === 'SUSPENDU' ? 'Suspendre' : 'Clore l’affiliation';
              const inputs: DecisionInput[] = [
                { kind: 'textarea', name: 'reason', label: 'Motif interne', required: true, maxLength: 1000 },
              ];
              if (status === 'TERMINE') inputs.push({ kind: 'date', name: 'ended_on', label: 'Date de fin', hint: 'Vide : aujourd’hui.' });
              if (affiliate.status !== 'PREPARATION') {
                inputs.push(
                  { kind: 'textarea', name: 'message', label: 'Message à l’affilié (facultatif)' },
                  { kind: 'checkbox', name: 'notify', label: 'Notifier l’affilié par e-mail', defaultChecked: true },
                );
              }
              return (
                <AffiliationDecisionForm
                  key={status}
                  action={changeAffiliateStatus}
                  fields={{ id: affiliate.id, status }}
                  trigger={label}
                  title={`${label} ?`}
                  consequence={
                    status === 'TERMINE'
                      ? 'Les liens et codes cessent d’attribuer des affaires. Les commissions acquises restent dues ; rien n’est supprimé.'
                      : status === 'SUSPENDU'
                        ? 'Les liens et codes cessent d’attribuer des affaires jusqu’à la réactivation.'
                        : 'Les liens et codes attribuent de nouveau les affaires.'
                  }
                  confirmLabel={label}
                  variant={status === 'ACTIF' ? 'primary' : 'danger'}
                  inputs={inputs}
                />
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ---------------------------------------------- Catégorie et paramètres */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Catégorie et paramètres</h2>
          <p>Les valeurs sans surcharge viennent de la catégorie. Modifier cet affilié ne touche aucun autre affilié.</p>
        </div>
        {terms ? (
          <dl className="admin-def">
            <dt>Catégorie</dt>
            <dd>{category?.label ?? '—'}</dd>
            <dt>Fenêtre d’attribution</dt>
            <dd>
              {terms.attribution_window_days} jours{' '}
              <small>{inherit(affiliate.attribution_window_days) ? '(catégorie)' : '(individuel)'}</small>
            </dd>
            <dt>Protection d’un prospect</dt>
            <dd>
              {PROTECTION_MODE_LABELS[terms.prospect_protection_mode as ProspectProtectionMode]}
              {terms.prospect_protection_mode === 'DUREE' ? ` — ${terms.prospect_protection_months} mois` : ''}
              {terms.post_end_survival_months !== null ? `, survie ${terms.post_end_survival_months} mois après la fin` : ''}{' '}
              <small>{inherit(affiliate.prospect_protection_mode) ? '(catégorie)' : '(individuel)'}</small>
            </dd>
            <dt>Exigibilité</dt>
            <dd>
              {ACQUISITION_TRIGGER_LABELS[terms.acquisition_trigger as AcquisitionTrigger]}{' '}
              <small>{inherit(affiliate.acquisition_trigger) ? '(catégorie)' : '(individuel)'}</small>
            </dd>
            <dt>Versements</dt>
            <dd>
              {PAYOUT_FREQUENCY_LABELS[terms.payout_frequency as PayoutFrequency]}
              {terms.payout_min_amount ? `, à partir de ${terms.payout_min_amount} KMF` : ', sans seuil'}{' '}
              <small>{inherit(affiliate.payout_frequency) && inherit(affiliate.payout_min_amount) ? '(catégorie)' : '(individuel)'}</small>
            </dd>
            <dt>Auto-affiliation</dt>
            <dd>{terms.self_referral_allowed ? `Autorisée — ${affiliate.self_referral_reason ?? ''}` : 'Interdite'}</dd>
          </dl>
        ) : null}
        {can.rules && affiliate.status !== 'TERMINE' && !isSelf ? (
          <AffiliationDecisionForm
            action={updateAffiliateTerms}
            fields={{ id: affiliate.id }}
            trigger="Modifier la catégorie et les paramètres"
            title="Enregistrer ces paramètres ?"
            consequence="Les nouveaux paramètres valent pour la suite. Les commissions déjà enregistrées gardent les leurs."
            confirmLabel="Enregistrer"
            inputs={[
              {
                kind: 'select', name: 'category_id', label: 'Catégorie', defaultValue: affiliate.category_id,
                options: categories.map((entry) => ({ value: entry.id, label: `${entry.label}${entry.is_internal ? ' (interne)' : ''}${entry.is_active ? '' : ' — inactive'}` })),
              },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'attribution_window_days', label: 'Fenêtre d’attribution (jours)', inputMode: 'numeric',
                    defaultValue: affiliate.attribution_window_days?.toString() ?? '', hint: 'Vide : celle de la catégorie.' },
                  {
                    kind: 'select', name: 'acquisition_trigger', label: 'Exigibilité', defaultValue: affiliate.acquisition_trigger ?? '',
                    options: [{ value: '', label: 'Celle de la catégorie' }, ...Object.entries(ACQUISITION_TRIGGER_LABELS).map(([value, label]) => ({ value, label }))],
                  },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  {
                    kind: 'select', name: 'prospect_protection_mode', label: 'Protection d’un prospect', defaultValue: affiliate.prospect_protection_mode ?? '',
                    options: [{ value: '', label: 'Celle de la catégorie' }, ...Object.entries(PROTECTION_MODE_LABELS).map(([value, label]) => ({ value, label }))],
                  },
                  { kind: 'text', name: 'prospect_protection_months', label: 'Durée de protection (mois)', inputMode: 'numeric',
                    defaultValue: affiliate.prospect_protection_months?.toString() ?? '' },
                  { kind: 'text', name: 'post_end_survival_months', label: 'Survie après la fin (mois)', inputMode: 'numeric',
                    defaultValue: affiliate.post_end_survival_months?.toString() ?? '' },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  {
                    kind: 'select', name: 'payout_frequency', label: 'Fréquence de versement', defaultValue: affiliate.payout_frequency ?? '',
                    options: [{ value: '', label: 'Celle de la catégorie' }, ...Object.entries(PAYOUT_FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))],
                  },
                  { kind: 'text', name: 'payout_min_amount', label: 'Seuil de versement (KMF)', inputMode: 'decimal',
                    defaultValue: affiliate.payout_min_amount?.toString() ?? '', hint: 'Vide : celui de la catégorie (ou aucun).' },
                ],
              },
              { kind: 'checkbox', name: 'self_referral_allowed', label: 'Autoriser l’auto-affiliation pour cet affilié',
                hint: 'Exception individuelle et motivée, par exemple pour un membre de l’équipe.', defaultChecked: affiliate.self_referral_allowed },
              { kind: 'textarea', name: 'self_referral_reason', label: 'Motif de l’autorisation', defaultValue: affiliate.self_referral_reason ?? '' },
              { kind: 'textarea', name: 'reason', label: 'Motif de la modification', required: true, maxLength: 1000 },
            ]}
          />
        ) : null}
      </section>

      {/* --------------------------------------------------------------- Règles */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Règles de commission</h2>
          <p>
            Ordre d’application : offre (affilié), offre (catégorie), règle individuelle, règle de catégorie. Chaque
            version reste en base ; une commission garde celle qui l’a calculée.
          </p>
        </div>
        {rules.length === 0 ? (
          <p className="admin-field__hint">Aucune règle, ni pour l’affilié, ni pour sa catégorie.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Règles applicables à l’affilié</caption>
              <thead>
                <tr>
                  <th scope="col">Origine</th>
                  <th scope="col">Cible</th>
                  <th scope="col">Règle</th>
                  <th scope="col">Période</th>
                  <th scope="col">État</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {[...ownRules, ...categoryRules].map((rule) => {
                  const state = ruleState(rule);
                  return (
                    <tr key={rule.id}>
                      <th scope="row">
                        {RULE_ORIGIN_LABELS[ruleOriginFor(rule)]}
                        {rule.contractual_derogation ? (
                          <span className="admin-badge admin-badge--gold"> Dérogation</span>
                        ) : null}
                      </th>
                      <td>{rule.target_type === 'ALL' ? 'Toutes les offres' : offerLabel(rule.target_type, rule.service_id ?? rule.product_id)}</td>
                      <td>
                        <strong>{RULE_KIND_LABELS[rule.kind]}</strong> — {describeRuleRow(rule)}
                        <span className="admin-field__hint"> (version {rule.version})</span>
                      </td>
                      <td>
                        {formatMoment(rule.valid_from)} → {rule.valid_to ? formatMoment(rule.valid_to) : 'sans fin'}
                      </td>
                      <td>
                        <RuleStateBadge state={state} />
                      </td>
                      <td>
                        {can.rules && !isSelf && rule.affiliate_id === affiliate.id && (!rule.contractual_derogation || can.derogate) ? (
                          state === 'EN_VIGUEUR' && rule.valid_to === null ? (
                            <AffiliationDecisionForm
                              action={endRule}
                              fields={{ rule: rule.id }}
                              trigger="Clore"
                              title="Clore cette règle maintenant ?"
                              consequence="La règle cesse de s’appliquer aux nouvelles affaires ; le niveau suivant reprend la main."
                              confirmLabel="Clore la règle"
                              variant="danger"
                              inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
                            />
                          ) : state === 'PROGRAMMEE' ? (
                            <AffiliationDecisionForm
                              action={withdrawRule}
                              fields={{ rule: rule.id }}
                              trigger="Retirer"
                              title="Retirer cette version programmée ?"
                              consequence="Elle n’a jamais été appliquée ; la version précédente reste en vigueur."
                              confirmLabel="Retirer la version"
                              variant="danger"
                              inputs={[{ kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 }]}
                            />
                          ) : (
                            '—'
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {can.rules && affiliate.status !== 'TERMINE' && !isSelf ? (
          <AffiliateRuleEditor
            action={publishRule}
            ownerType="AFFILIATE"
            ownerId={affiliate.id}
            canDerogate={can.derogate}
            offers={offers.map((offer) => ({
              value: `${offer.type}:${offer.id}`,
              label: `${offer.type === 'SERVICE' ? 'Service' : 'Produit'} — ${offer.title}`,
              eligible: offer.eligible,
              maxRate: offer.maxRate,
            }))}
          />
        ) : null}
      </section>

      {/* ------------------------------------------------------------ Attribution */}
      {affiliate.status !== 'PREPARATION' ? (
        <AffiliateAttributionPanel
          context={context}
          affiliateId={affiliate.id}
          campaigns={campaigns}
          path={`/administration/affiliation/affilies/${affiliate.id}/`}
        />
      ) : null}

      {/* ------------------------------------------------------------ Commissions */}
      {can.commissions && affiliate.status !== 'PREPARATION' ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Commissions</h2>
            <p>
              {totals
                ? `Prévisionnelles ${kmf(totals.forecast)} · acquises ${kmf(totals.acquired)} · à verser ${kmf(totals.to_pay)} · versées ${kmf(totals.paid)}${totals.adjustments_pending !== 0 ? ` · ajustements à imputer ${kmf(totals.adjustments_pending)}` : ''}.`
                : 'Totaux indisponibles.'}
            </p>
          </div>
          <CommissionsTable rows={commissions} showAffiliate={false} caption={`Commissions de ${affiliate.display_name}`} />
          {can.commissionsManage && !isSelf ? (
            <div className="btn-row">
              <AffiliationDecisionForm
                action={adjustCommission}
                fields={{ affiliate: affiliate.id, return: `/administration/affiliation/affilies/${affiliate.id}/` }}
                trigger="Ajustement hors commission"
                title="Enregistrer cet ajustement ?"
                consequence="Un ajustement rattaché à l’affilié, sans commission précise (correction de versement par exemple). Il sera imputé sur le prochain versement et ne se supprime pas."
                confirmLabel="Enregistrer"
                inputs={[
                  {
                    kind: 'text',
                    name: 'amount',
                    label: 'Montant (KMF)',
                    hint: 'Négatif pour réduire, par exemple -5000.',
                    required: true,
                    maxLength: 20,
                    inputMode: 'decimal',
                  },
                  { kind: 'textarea', name: 'reason', label: 'Motif', required: true, maxLength: 1000 },
                ]}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------ Versements */}
      {can.payoutView && affiliate.status !== 'PREPARATION' ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Versements</h2>
            <p>
              {payouts.length === 0
                ? 'Aucun versement.'
                : `${payouts.filter((p) => p.status === 'CONFIRME').length} versement(s) confirmé(s).`}{' '}
              <Link href="/administration/affiliation/versements/">Préparer ou suivre les versements</Link>
            </p>
          </div>
          {payouts.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Versements de {affiliate.display_name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Versement</th>
                    <th scope="col">Montant</th>
                    <th scope="col">État</th>
                    <th scope="col">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((payout) => (
                    <tr key={payout.id}>
                      <th scope="row">
                        <Link href={`/administration/affiliation/versements/${payout.id}/`}>
                          {payout.reference ?? payout.period_label ?? 'Brouillon'}
                        </Link>
                      </th>
                      <td>{kmf(payout.total_amount)}</td>
                      <td>
                        <PayoutStatusBadge status={payout.status} />
                      </td>
                      <td>{payout.confirmed_at ? formatPayoutDay(payout.confirmed_at) : formatMoment(payout.cancelled_at ?? payout.prepared_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------ Documents */}
      {affiliate.status !== 'PREPARATION' ? (
        <section className="admin-card" id="documents">
          <div className="admin-card__head">
            <h2>Documents officiels</h2>
            <p>
              Fiche affilié (FIAF) et relevés de versement (RVAF). Une pièce émise se rend toujours depuis son
              instantané : elle ne change plus. L’aperçu montre l’état actuel, sans numéro ni valeur officielle.
            </p>
          </div>
          <div className="btn-row">
            <a
              className="btn btn--ghost"
              href={`/api/affiliation/fiche/${affiliate.id}/apercu/?affichage=1`}
              target="_blank"
              rel="noreferrer"
            >
              Aperçu actuel de la fiche
            </a>
            {can.issueSheet && !isSelf && affiliate.reference ? (
              <AffiliationDecisionForm
                action={issueAffiliateSheet}
                fields={{ id: affiliate.id }}
                trigger="Émettre la fiche officielle"
                title="Émettre la fiche officielle ?"
                consequence="Une référence FIAF est attribuée et le contenu actuel est figé. La fiche précédente, s’il y en a une, devient « remplacée » et reste consultable."
                confirmLabel="Émettre"
                variant="gold"
                inputs={[]}
              />
            ) : null}
          </div>
          {documents.length === 0 ? (
            <p className="admin-field__hint">Aucune pièce émise.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption className="sr-only">Pièces officielles de {affiliate.display_name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Pièce</th>
                    <th scope="col">Nature</th>
                    <th scope="col">État</th>
                    <th scope="col">Émise le</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <th scope="row">{doc.reference}</th>
                      <td>
                        {doc.doc_type === 'FIAF' ? `Fiche affilié — version ${doc.version}` : 'Relevé de versement'}
                      </td>
                      <td>
                        <span className={`admin-badge ${doc.status === 'EMIS' ? 'admin-badge--ok' : 'admin-badge--muted'}`}>
                          {doc.status === 'EMIS' ? 'En vigueur' : doc.status === 'REMPLACE' ? 'Remplacée' : 'Annulée'}
                        </span>
                      </td>
                      <td>{formatMoment(doc.issued_at)}</td>
                      <td>
                        <OfficialDocumentActions
                          reference={doc.reference}
                          title={`${doc.doc_type === 'FIAF' ? 'Fiche affilié' : 'Relevé de versement'} ${doc.reference}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ------------------------------------------------- Liens et campagnes */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Liens et campagnes</h2>
          <p>Le lien principal est stable. Une campagne mesure un canal ; elle ne change pas la rémunération.</p>
        </div>
        <dl className="admin-def">
          <dt>Lien principal</dt>
          <dd>
            <code>{mainLink}</code>
            {affiliate.status !== 'ACTIF' ? <small> — n’attribue d’affaires que lorsque l’affilié est actif.</small> : null}
          </dd>
        </dl>
        {campaigns.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Campagnes de l’affilié</caption>
              <thead>
                <tr>
                  <th scope="col">Campagne</th>
                  <th scope="col">Lien</th>
                  <th scope="col">État</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <th scope="row">{campaign.label}</th>
                    <td>
                      <code>{affiliateLink(site, affiliate.slug, campaign.code)}</code>
                    </td>
                    <td>{campaign.is_active ? 'Active' : 'Désactivée'}</td>
                    <td>
                      {can.update ? (
                        <ConfirmForm
                          action={toggleCampaign}
                          fields={{ campaign: campaign.id, active: campaign.is_active ? '0' : '1' }}
                          trigger={campaign.is_active ? 'Désactiver' : 'Activer'}
                          consequence={campaign.is_active ? 'Ce lien cessera d’attribuer de nouvelles affaires.' : 'Ce lien attribuera de nouveau les affaires.'}
                          confirmLabel={campaign.is_active ? 'Désactiver' : 'Activer'}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {can.update && affiliate.status !== 'TERMINE' ? (
          <AffiliationDecisionForm
            action={createCampaign}
            fields={{ affiliate_id: affiliate.id }}
            trigger="Créer une campagne"
            title="Créer cette campagne ?"
            consequence="Un lien supplémentaire est créé ; son code ne pourra plus changer."
            confirmLabel="Créer la campagne"
            inputs={[
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'label', label: 'Libellé', required: true, maxLength: 80, placeholder: 'WhatsApp' },
                  { kind: 'text', name: 'code', label: 'Code du lien', required: true, maxLength: 32, placeholder: 'whatsapp',
                    hint: 'Minuscules, chiffres et tirets. Aucune donnée personnelle.' },
                ],
              },
            ]}
          />
        ) : null}
      </section>

      {/* ----------------------------------------------------- Codes de réduction */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Codes de réduction</h2>
          <p>Une réduction accordée au client, jamais une commission. Un seul code par affaire, saisi par MORA Shawiri.</p>
        </div>
        {codes.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Codes de réduction de l’affilié</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Réduction</th>
                  <th scope="col">Validité</th>
                  <th scope="col">Conditions</th>
                  <th scope="col">État</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr key={code.id}>
                    <th scope="row">
                      <code>{code.code}</code>
                      {code.label ? <span className="admin-field__hint"> {code.label}</span> : null}
                    </th>
                    <td>{describeDiscount(code.discount_kind, code.discount_value)}</td>
                    <td>
                      {formatMoment(code.valid_from)} → {code.valid_to ? formatMoment(code.valid_to) : 'sans fin'}
                    </td>
                    <td>
                      {[
                        code.min_order_amount ? `à partir de ${code.min_order_amount} KMF` : null,
                        code.max_discount_amount ? `plafond ${code.max_discount_amount} KMF` : null,
                        code.max_uses ? `${code.max_uses} utilisations` : null,
                        code.max_uses_per_customer ? `${code.max_uses_per_customer} par client` : null,
                        code.service_ids.length + code.product_ids.length > 0 ? 'offres limitées' : null,
                        code.excluded_service_ids.length + code.excluded_product_ids.length > 0 ? 'avec exclusions' : null,
                      ]
                        .filter(Boolean)
                        .join(', ') || 'aucune'}
                    </td>
                    <td>{code.is_active ? 'Actif' : 'Inactif'}</td>
                    <td>
                      {can.codes && !isSelf ? (
                        <AffiliationDecisionForm
                          action={saveCode}
                          fields={{ affiliate_id: affiliate.id, code_id: code.id }}
                          trigger="Modifier"
                          title={`Modifier le code ${code.code} ?`}
                          consequence="Les nouvelles conditions valent pour les prochaines affaires ; une affaire déjà conclue garde celles qui s’appliquaient."
                          confirmLabel="Enregistrer"
                          inputs={codeInputs(code, offers)}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {can.codes && affiliate.status !== 'TERMINE' && !isSelf ? (
          <AffiliationDecisionForm
            action={saveCode}
            fields={{ affiliate_id: affiliate.id }}
            trigger="Créer un code"
            title="Créer ce code de réduction ?"
            consequence="Le code est unique sur tout le site et désigne cet affilié. Il ne pourra pas être renommé."
            confirmLabel="Créer le code"
            inputs={[
              { kind: 'text', name: 'code', label: 'Code', required: true, maxLength: 24, placeholder: 'PARTENAIRE10' },
              ...codeInputs(null, offers),
            ]}
          />
        ) : null}
      </section>

      {/* ------------------------------------------------ Coordonnées de versement */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Coordonnées de versement</h2>
          <p>Une demande devient active après validation. Les anciennes coordonnées restent en base.</p>
        </div>
        {payoutAccounts.length === 0 ? (
          <p className="admin-field__hint">Aucune coordonnée.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Coordonnées de versement de l’affilié</caption>
              <thead>
                <tr>
                  <th scope="col">Moyen</th>
                  <th scope="col">Coordonnées</th>
                  <th scope="col">Origine</th>
                  <th scope="col">État</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {payoutAccounts.map((account) => {
                  const details = payoutDetails[account.id];
                  return (
                    <tr key={account.id}>
                      <th scope="row">{methodLabel(account.method_code)}</th>
                      <td>
                        {details
                          ? Object.entries(details)
                              .map(([key, value]) =>
                                `${PAYOUT_KEY_LABELS[key] ?? key} : ${['titulaire', 'banque', 'ordre'].includes(key) ? value : maskPayoutValue(value)}`,
                              )
                              .join(' · ') || '—'
                          : can.payoutView
                            ? '—'
                            : 'Sous payouts.view'}
                      </td>
                      <td>
                        {account.source === 'CANDIDATURE' ? 'Candidature' : account.source === 'AFFILIE' ? 'Demande de l’affilié' : 'Administration'}
                        <span className="admin-field__hint"> — {formatMoment(account.requested_at)}</span>
                      </td>
                      <td>
                        <PayoutAccountBadge status={account.status} />
                        {account.review_note ? <span className="admin-field__hint"> {account.review_note}</span> : null}
                      </td>
                      <td>
                        {account.status === 'DEMANDE' && can.payoutManage && !isSelf ? (
                          <div className="admin-table__actions">
                            <AffiliationDecisionForm
                              action={reviewPayoutAccount}
                              fields={{ account: account.id, decision: 'VALIDER' }}
                              trigger="Valider"
                              title="Valider ces coordonnées ?"
                              consequence="Elles deviennent les coordonnées de versement actives. Les précédentes restent en base, marquées remplacées."
                              confirmLabel="Valider"
                              inputs={[
                                { kind: 'textarea', name: 'note', label: 'Note (facultative)' },
                                ...(affiliate.status === 'PREPARATION'
                                  ? []
                                  : [{ kind: 'checkbox' as const, name: 'notify', label: 'Notifier l’affilié', defaultChecked: true }]),
                              ]}
                            />
                            <AffiliationDecisionForm
                              action={reviewPayoutAccount}
                              fields={{ account: account.id, decision: 'REFUSER' }}
                              trigger="Refuser"
                              title="Refuser ces coordonnées ?"
                              consequence="La demande est refusée ; les coordonnées actives restent inchangées."
                              confirmLabel="Refuser"
                              variant="danger"
                              inputs={[
                                { kind: 'textarea', name: 'note', label: 'Motif', required: true },
                                ...(affiliate.status === 'PREPARATION'
                                  ? []
                                  : [{ kind: 'checkbox' as const, name: 'notify', label: 'Notifier l’affilié', defaultChecked: true }]),
                              ]}
                            />
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {can.payoutManage && affiliate.status !== 'TERMINE' && !isSelf ? (
          <AffiliationDecisionForm
            action={proposePayoutAccount}
            fields={{ affiliate_id: affiliate.id }}
            trigger="Saisir des coordonnées"
            title="Enregistrer ces coordonnées ?"
            consequence="Elles sont enregistrées en attente de validation, comme une demande."
            confirmLabel="Enregistrer"
            inputs={[
              { kind: 'select', name: 'method', label: 'Moyen', options: methods.map((method) => ({ value: method.code, label: method.label })) },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'detail_numero', label: 'Numéro (mobile money)', maxLength: 120 },
                  { kind: 'text', name: 'detail_titulaire', label: 'Titulaire', maxLength: 120 },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'detail_banque', label: 'Banque (virement)', maxLength: 120 },
                  { kind: 'text', name: 'detail_compte', label: 'Compte / RIB (virement)', maxLength: 120 },
                ],
              },
              {
                kind: 'row',
                inputs: [
                  { kind: 'text', name: 'detail_email', label: 'E-mail du compte (PayPal)', type: 'email', maxLength: 120 },
                  { kind: 'text', name: 'detail_ordre', label: 'À l’ordre de (chèque)', maxLength: 120 },
                ],
              },
            ]}
          />
        ) : null}
      </section>

      {/* ----------------------------------------------------------------- Notes */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Notes internes</h2>
          <p>Jamais visibles de l’affilié.</p>
        </div>
        {can.update ? (
          <AffiliationDecisionForm
            action={addAffiliateNote}
            fields={{ id: affiliate.id }}
            trigger="Ajouter une note"
            title="Enregistrer cette note ?"
            consequence="La note rejoint la fiche. Elle n’est jamais adressée à l’affilié."
            confirmLabel="Enregistrer"
            inputs={[{ kind: 'textarea', name: 'note', label: 'Note', required: true, maxLength: 4000 }]}
          />
        ) : null}
        <ul className="admin-timeline">
          {notes.map((note) => (
            <li key={note.id}>
              <span className="admin-field__hint">
                {formatMoment(note.created_at)}
                {note.author_label ? `, ${note.author_label}` : ''}
              </span>
              <p className="admin-longtext">{note.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ Historique */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Historique</h2>
          <p>Statuts, paramètres, règles, codes, coordonnées : chaque changement, avec son auteur et son motif.</p>
        </div>
        <ul className="admin-timeline">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.summary}</strong>
              <span className="admin-field__hint">
                {' '}
                — {formatMoment(event.created_at)}
                {event.actor_label ? `, par ${event.actor_label}` : ''}
              </span>
              {event.reason ? <p className="admin-longtext">Motif : {event.reason}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      {/* --------------------------------------------------------------- E-mails */}
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>E-mails</h2>
          <p>Chaque envoi est journalisé. Un e-mail en échec peut être renvoyé à l’identique.</p>
        </div>
        {emails.length === 0 ? (
          <p className="admin-field__hint">Aucun e-mail journalisé pour cet affilié.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">E-mails adressés à l’affilié</caption>
              <thead>
                <tr>
                  <th scope="col">Objet</th>
                  <th scope="col">Résultat</th>
                  <th scope="col">Dernière tentative</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <tr key={email.id}>
                    <th scope="row">{email.subject}</th>
                    <td>
                      <EmailStatusBadge status={email.status} />
                      {email.last_error ? <span className="admin-field__hint"> {email.last_error}</span> : null}
                    </td>
                    <td>{formatMoment(email.last_attempt_at ?? email.created_at)}</td>
                    <td>
                      {email.status === 'ECHEC' && can.update ? (
                        <ConfirmForm
                          action={retryEmail}
                          fields={{ email: email.id }}
                          trigger="Renvoyer"
                          consequence="Le même e-mail est renvoyé, à l’identique."
                          confirmLabel="Renvoyer l’e-mail"
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminPage>
  );
}

function codeInputs(
  code: {
    label: string | null;
    is_active: boolean;
    discount_kind: 'PERCENT' | 'FIXED';
    discount_value: number;
    valid_from: string;
    valid_to: string | null;
    min_order_amount: number | null;
    max_discount_amount: number | null;
    max_uses: number | null;
    max_uses_per_customer: number | null;
    service_ids: string[];
    excluded_service_ids: string[];
    product_ids: string[];
    excluded_product_ids: string[];
  } | null,
  offers: readonly { type: 'SERVICE' | 'PRODUCT'; id: string; title: string }[],
): DecisionInput[] {
  const services = offers.filter((offer) => offer.type === 'SERVICE').map((offer) => ({ value: offer.id, label: offer.title }));
  const products = offers.filter((offer) => offer.type === 'PRODUCT').map((offer) => ({ value: offer.id, label: offer.title }));
  const inputs: DecisionInput[] = [
    {
      kind: 'row',
      inputs: [
        { kind: 'text', name: 'label', label: 'Libellé interne', defaultValue: code?.label ?? '', maxLength: 120 },
        {
          kind: 'select', name: 'discount_kind', label: 'Type de réduction', defaultValue: code?.discount_kind ?? 'PERCENT',
          options: [{ value: 'PERCENT', label: 'Pourcentage' }, { value: 'FIXED', label: 'Montant fixe (KMF)' }],
        },
        { kind: 'text', name: 'discount_value', label: 'Valeur', required: true, inputMode: 'decimal', defaultValue: code?.discount_value?.toString() ?? '' },
      ],
    },
    {
      kind: 'row',
      inputs: [
        { kind: 'datetime', name: 'valid_from', label: 'Début (heure de Moroni)', defaultValue: toLocal(code?.valid_from ?? null), hint: 'Vide : maintenant.' },
        { kind: 'datetime', name: 'valid_to', label: 'Fin (heure de Moroni)', defaultValue: toLocal(code?.valid_to ?? null), hint: 'Vide : sans fin.' },
      ],
    },
    {
      kind: 'row',
      inputs: [
        { kind: 'text', name: 'min_order_amount', label: 'Montant minimum de l’affaire (KMF)', inputMode: 'decimal', defaultValue: code?.min_order_amount?.toString() ?? '' },
        { kind: 'text', name: 'max_discount_amount', label: 'Plafond de réduction (KMF)', inputMode: 'decimal', defaultValue: code?.max_discount_amount?.toString() ?? '' },
      ],
    },
    {
      kind: 'row',
      inputs: [
        { kind: 'text', name: 'max_uses', label: 'Utilisations maximum', inputMode: 'numeric', defaultValue: code?.max_uses?.toString() ?? '' },
        { kind: 'text', name: 'max_uses_per_customer', label: 'Par client, au maximum', inputMode: 'numeric', defaultValue: code?.max_uses_per_customer?.toString() ?? '' },
      ],
    },
  ];
  if (services.length > 0) {
    inputs.push(
      { kind: 'checklist', name: 'service_ids', label: 'Limité aux services (aucun coché : tous)', options: services, defaultValues: code?.service_ids },
      { kind: 'checklist', name: 'excluded_service_ids', label: 'Services exclus', options: services, defaultValues: code?.excluded_service_ids },
    );
  }
  if (products.length > 0) {
    inputs.push(
      { kind: 'checklist', name: 'product_ids', label: 'Limité aux produits (aucun coché : tous)', options: products, defaultValues: code?.product_ids },
      { kind: 'checklist', name: 'excluded_product_ids', label: 'Produits exclus', options: products, defaultValues: code?.excluded_product_ids },
    );
  }
  inputs.push({ kind: 'checkbox', name: 'is_active', label: 'Code actif', defaultChecked: code?.is_active ?? true });
  return inputs;
}
