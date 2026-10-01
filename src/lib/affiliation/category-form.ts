/**
 * Champs du formulaire d'une catégorie — partagés par la création et la
 * modification, pour qu'aucune des deux ne propose un réglage que l'autre
 * ignore.
 */

import type { DecisionInput } from '@/components/admin/AffiliationDecisionForm';
import type { AffiliateCategoryRow } from '@/lib/supabase/types-affiliation';

import { ACQUISITION_TRIGGER_LABELS, PAYOUT_FREQUENCY_LABELS, PROTECTION_MODE_LABELS } from './affiliates';

export function categoryInputs(category: AffiliateCategoryRow | null): DecisionInput[] {
  return [
    {
      kind: 'row',
      inputs: [
        { kind: 'text', name: 'label', label: 'Libellé', required: true, maxLength: 80, defaultValue: category?.label ?? '' },
        { kind: 'text', name: 'sort_order', label: 'Ordre', inputMode: 'numeric', defaultValue: category?.sort_order?.toString() ?? '0' },
      ],
    },
    { kind: 'textarea', name: 'description', label: 'Description interne', defaultValue: category?.description ?? '' },
    {
      kind: 'row',
      inputs: [
        {
          kind: 'text', name: 'attribution_window_days', label: 'Fenêtre d’attribution (jours)', inputMode: 'numeric', required: true,
          defaultValue: category?.attribution_window_days?.toString() ?? '90',
        },
        {
          kind: 'select', name: 'acquisition_trigger', label: 'Exigibilité', defaultValue: category?.acquisition_trigger ?? 'PAIEMENT_INTEGRAL',
          options: Object.entries(ACQUISITION_TRIGGER_LABELS).map(([value, label]) => ({ value, label })),
        },
      ],
    },
    {
      kind: 'row',
      inputs: [
        {
          kind: 'select', name: 'prospect_protection_mode', label: 'Protection d’un prospect', defaultValue: category?.prospect_protection_mode ?? 'DUREE',
          options: Object.entries(PROTECTION_MODE_LABELS).map(([value, label]) => ({ value, label })),
        },
        {
          kind: 'text', name: 'prospect_protection_months', label: 'Durée de protection (mois)', inputMode: 'numeric',
          defaultValue: category?.prospect_protection_months?.toString() ?? '6',
        },
        {
          kind: 'text', name: 'post_end_survival_months', label: 'Survie après la fin (mois)', inputMode: 'numeric',
          defaultValue: category?.post_end_survival_months?.toString() ?? '',
        },
      ],
    },
    {
      kind: 'row',
      inputs: [
        {
          kind: 'select', name: 'payout_frequency', label: 'Fréquence de versement', defaultValue: category?.payout_frequency ?? 'FIN_DE_MOIS',
          options: Object.entries(PAYOUT_FREQUENCY_LABELS).map(([value, label]) => ({ value, label })),
        },
        {
          kind: 'text', name: 'payout_min_amount', label: 'Seuil de versement (KMF)', inputMode: 'decimal',
          defaultValue: category?.payout_min_amount?.toString() ?? '', hint: 'Vide : aucun seuil.',
        },
      ],
    },
    { kind: 'checkbox', name: 'is_internal', label: 'Catégorie interne (attribuée par l’administration seulement)', defaultChecked: category?.is_internal ?? false },
    { kind: 'checkbox', name: 'is_active', label: 'Catégorie active', defaultChecked: category?.is_active ?? true },
  ];
}
