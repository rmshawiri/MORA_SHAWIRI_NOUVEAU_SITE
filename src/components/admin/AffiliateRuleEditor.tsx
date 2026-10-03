'use client';

import { useActionState, useMemo, useRef, useState } from 'react';

import AdminNotice from './AdminNotice';
import ConfirmDialog from './ConfirmDialog';
import type { AdminActionState } from '@/lib/admin/actions';
import {
  computeCommission,
  formatKmf,
  offerConstraint,
  validateRule,
  type Rule,
  type Tier,
} from '@/lib/domain/affiliation';
import { moroniToday } from '@/lib/affiliation/time';

/**
 * Publication d'une règle de commission — phase 4H-3.
 *
 * Le formulaire montre, avant toute publication, ce que la règle rapporterait
 * sur quelques assiettes types : c'est le même moteur que celui de la base
 * (`affiliate_compute`, comparé en contrôle). Une grille mal saisie se voit
 * donc avant d'exister.
 *
 * Publier ne modifie aucune règle existante : la version en cours est close à
 * la date d'effet, une nouvelle version s'ouvre (aucun recalcul rétroactif).
 */

const INITIAL: AdminActionState = { status: 'idle', message: '' };

const SAMPLES = [20_000, 30_000, 50_000, 100_000, 200_000, 500_000, 900_000];

type TierRow = { to: string; mode: 'rate' | 'fixed'; value: string; min: string; max: string; label: string };

export type RuleOffer = { value: string; label: string; eligible: boolean; maxRate: number | null };

const num = (raw: string) => {
  const value = raw.trim().replace(/\s/g, '').replace(',', '.');
  return value === '' ? null : Number(value);
};

export default function AffiliateRuleEditor({
  action,
  ownerType,
  ownerId,
  offers,
  canDerogate,
}: {
  action: (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  ownerType: 'CATEGORY' | 'AFFILIATE';
  ownerId: string;
  offers: readonly RuleOffer[];
  canDerogate: boolean;
}) {
  const [state, formAction] = useActionState(action, INITIAL);
  const [open, setOpen] = useState(false);
  const [openedOn, setOpenedOn] = useState<AdminActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [target, setTarget] = useState('ALL');
  const [kind, setKind] = useState<Rule['kind']>('PERCENT');
  const [rate, setRate] = useState('');
  const [fixed, setFixed] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [minBase, setMinBase] = useState('');
  const [derogation, setDerogation] = useState(false);
  const [startMode, setStartMode] = useState<'IMMEDIAT' | 'PROGRAMME'>('IMMEDIAT');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  // Lue au choix « programmée », jamais au rendu : la date du jour à Moroni
  // borne le calendrier sans risque d'écart entre serveur et navigateur.
  const [today, setToday] = useState<string | undefined>(undefined);
  const [tiers, setTiers] = useState<TierRow[]>([
    { to: '', mode: 'rate', value: '', min: '', max: '', label: '' },
  ]);

  const tierValues: Tier[] = useMemo(
    () =>
      tiers.map((row, index) => {
        const last = index === tiers.length - 1;
        // Chaque palier commence exactement où finit le précédent.
        const from = index === 0 ? 0 : (num(tiers[index - 1]!.to) ?? 0);
        return {
          from,
          to: last ? null : num(row.to),
          rate: row.mode === 'rate' ? num(row.value) : null,
          fixedAmount: row.mode === 'fixed' ? num(row.value) : null,
          minCommission: num(row.min),
          maxCommission: num(row.max),
          label: row.label.trim() || null,
        };
      }),
    [tiers],
  );

  const draft: Rule = {
    id: 'brouillon',
    version: 1,
    owner: ownerType === 'AFFILIATE' ? { type: 'AFFILIATE', id: ownerId } : { type: 'CATEGORY', id: ownerId },
    target:
      target === 'ALL'
        ? { type: 'ALL' }
        : { type: target.split(':')[0] as 'SERVICE' | 'PRODUCT', id: target.split(':')[1]! },
    kind,
    rate: kind === 'PERCENT' ? num(rate) : null,
    fixedAmount: kind === 'FIXED' ? num(fixed) : null,
    tiers: kind === 'TIERED' ? tierValues : null,
    minCommission: kind === 'EXCLUDED' ? null : num(min),
    maxCommission: kind === 'EXCLUDED' ? null : num(max),
    minBase: num(minBase),
    validFrom: '2026-01-01T00:00:00Z',
    contractualDerogation: derogation,
  };

  const problems = validateRule(draft);
  const offer = offers.find((entry) => entry.value === target) ?? null;
  const constraint = offer
    ? offerConstraint(draft, { eligible: offer.eligible, maxRate: offer.maxRate })
    : { allowed: true as const, capRate: null };

  const confirming = openedOn === state;

  if (state.status === 'ok') return <AdminNotice state={state} />;

  if (!open) {
    return (
      <button className="btn btn--ghost" type="button" onClick={() => setOpen(true)}>
        Publier une règle
      </button>
    );
  }

  const updateTier = (index: number, patch: Partial<TierRow>) =>
    setTiers((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <form ref={formRef} action={formAction} className="admin-form admin-confirm">
      <AdminNotice state={state} />
      <input type="hidden" name="owner_type" value={ownerType} />
      <input type="hidden" name="owner_id" value={ownerId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="tiers" value={JSON.stringify(tierValues)} />

      <p>
        La nouvelle version s’applique aux affaires conclues à partir de sa date d’effet. Les commissions déjà
        enregistrées gardent la règle qui les a calculées.
      </p>

      <div className="admin-form__grid">
        <label className="admin-field">
          <span className="admin-field__label">S’applique à</span>
          <select className="admin-input" name="target" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="ALL">Toutes les offres</option>
            {offers.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
                {entry.eligible ? '' : ' — non éligible'}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span className="admin-field__label">Type de rémunération</span>
          <select className="admin-input" value={kind} onChange={(event) => setKind(event.target.value as Rule['kind'])}>
            <option value="PERCENT">Pourcentage</option>
            <option value="FIXED">Montant fixe</option>
            <option value="TIERED">Paliers</option>
            <option value="EXCLUDED">Exclusion (aucune commission)</option>
          </select>
        </label>
      </div>

      {kind === 'PERCENT' ? (
        <label className="admin-field">
          <span className="admin-field__label">Taux (%)</span>
          <input className="admin-input" name="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </label>
      ) : null}
      {kind === 'FIXED' ? (
        <label className="admin-field">
          <span className="admin-field__label">Montant fixe (KMF)</span>
          <input className="admin-input" name="fixed_amount" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} required />
        </label>
      ) : null}

      {kind === 'TIERED' ? (
        <fieldset className="admin-field">
          <legend className="admin-field__label">Paliers — chaque palier commence où finit le précédent</legend>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">De (KMF)</th>
                  <th scope="col">Jusqu’à, exclu (KMF)</th>
                  <th scope="col">Rémunération</th>
                  <th scope="col">Valeur</th>
                  <th scope="col">Minimum</th>
                  <th scope="col">Maximum</th>
                  <th scope="col">Libellé</th>
                  <th scope="col">
                    <span className="sr-only">Retirer</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((row, index) => {
                  const last = index === tiers.length - 1;
                  return (
                    <tr key={index}>
                      <td>
                        {Number.isFinite(tierValues[index]?.from as number)
                          ? formatKmf(BigInt(Math.round((tierValues[index]!.from as number) * 100)))
                          : '—'}
                      </td>
                      <td>
                        {last ? (
                          'sans limite'
                        ) : (
                          <input className="admin-input" aria-label={`Fin du palier ${index + 1}`} inputMode="decimal" value={row.to}
                            onChange={(e) => updateTier(index, { to: e.target.value })} />
                        )}
                      </td>
                      <td>
                        <select className="admin-input" aria-label={`Mode du palier ${index + 1}`} value={row.mode}
                          onChange={(e) => updateTier(index, { mode: e.target.value as TierRow['mode'] })}>
                          <option value="rate">%</option>
                          <option value="fixed">KMF fixe</option>
                        </select>
                      </td>
                      <td>
                        <input className="admin-input" aria-label={`Valeur du palier ${index + 1}`} inputMode="decimal" value={row.value}
                          onChange={(e) => updateTier(index, { value: e.target.value })} />
                      </td>
                      <td>
                        <input className="admin-input" aria-label={`Minimum du palier ${index + 1}`} inputMode="decimal" value={row.min}
                          onChange={(e) => updateTier(index, { min: e.target.value })} />
                      </td>
                      <td>
                        <input className="admin-input" aria-label={`Maximum du palier ${index + 1}`} inputMode="decimal" value={row.max}
                          onChange={(e) => updateTier(index, { max: e.target.value })} />
                      </td>
                      <td>
                        <input className="admin-input" aria-label={`Libellé du palier ${index + 1}`} value={row.label} maxLength={60}
                          onChange={(e) => updateTier(index, { label: e.target.value })} />
                      </td>
                      <td>
                        {tiers.length > 1 ? (
                          <button type="button" className="btn btn--ghost"
                            onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}>
                            Retirer
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn--ghost"
            onClick={() => setTiers((current) => [...current, { to: '', mode: 'rate', value: '', min: '', max: '', label: '' }])}>
            Ajouter un palier
          </button>
        </fieldset>
      ) : null}

      {kind !== 'EXCLUDED' ? (
        <div className="admin-form__grid">
          <label className="admin-field">
            <span className="admin-field__label">Commission minimale (KMF)</span>
            <input className="admin-input" name="min_commission" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Commission maximale (KMF)</span>
            <input className="admin-input" name="max_commission" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
          <label className="admin-field">
            <span className="admin-field__label">Seuil d’assiette (KMF)</span>
            <input className="admin-input" name="min_base" inputMode="decimal" value={minBase} onChange={(e) => setMinBase(e.target.value)} />
            <span className="admin-field__hint">En deçà, aucune commission.</span>
          </label>
        </div>
      ) : null}

      <fieldset className="admin-fieldset">
        <legend>Prise d’effet</legend>
        <label className="admin-check">
          <input
            type="radio"
            name="effective_mode"
            value="IMMEDIAT"
            checked={startMode === 'IMMEDIAT'}
            onChange={() => setStartMode('IMMEDIAT')}
          />
          <span>
            Immédiatement
            <small>La règle est en vigueur dès la publication.</small>
          </span>
        </label>
        <label className="admin-check">
          <input
            type="radio"
            name="effective_mode"
            value="PROGRAMME"
            checked={startMode === 'PROGRAMME'}
            onChange={() => {
              setStartMode('PROGRAMME');
              setToday(moroniToday());
            }}
          />
          <span>
            À une date et une heure à venir
            <small>La règle reste « Programmée » jusqu’à cet instant, heure de Moroni (UTC+3).</small>
          </span>
        </label>
        {startMode === 'PROGRAMME' ? (
          <div className="admin-form__grid">
            <label className="admin-field">
              <span className="admin-field__label">Date (heure de Moroni)</span>
              <input
                className="admin-input"
                type="date"
                name="effective_date"
                required
                min={today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="admin-field">
              <span className="admin-field__label">Heure (heure de Moroni)</span>
              <input
                className="admin-input"
                type="time"
                name="effective_time"
                required
                step={60}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        {startMode === 'PROGRAMME' ? (
          <p className="admin-field__hint">
            {startDate && startTime
              ? `La règle commencera le ${startDate.split('-').reverse().join('/')} à ${startTime}, heure de Moroni.`
              : 'Indiquez la date et l’heure : aucune heure n’est supposée.'}
          </p>
        ) : null}
      </fieldset>

      <label className="admin-field">
        <span className="admin-field__label">Libellé (facultatif)</span>
        <input className="admin-input" name="label" maxLength={120} />
      </label>

      {ownerType === 'AFFILIATE' && canDerogate ? (
        <>
          <label className="admin-check">
            <input type="checkbox" name="derogation" value="1" checked={derogation} onChange={(e) => setDerogation(e.target.checked)} />
            <span>
              Dérogation contractuelle
              <small>Lève le plafond de commission de l’offre pour cet affilié seulement. Ne rend jamais éligible une offre qui ne l’est pas.</small>
            </span>
          </label>
          {derogation ? (
            <label className="admin-field">
              <span className="admin-field__label">Motif de la dérogation</span>
              <textarea className="admin-input admin-input--area" name="derogation_reason" rows={2} required maxLength={1000}
                placeholder="Par exemple : convention de partenariat signée le …" />
            </label>
          ) : null}
        </>
      ) : null}

      <label className="admin-field">
        <span className="admin-field__label">Motif de la modification</span>
        <textarea className="admin-input admin-input--area" name="reason" rows={2} required maxLength={1000} />
      </label>

      <section aria-label="Aperçu du calcul">
        <h3>Aperçu</h3>
        {problems.length > 0 ? (
          <div className="admin-notice admin-notice--error" role="status">
            <p>{problems.join(' ')}</p>
          </div>
        ) : !constraint.allowed ? (
          <div className="admin-notice admin-notice--error" role="status">
            <p>Cette offre n’est pas éligible à l’affiliation : aucune commission ne serait versée, dérogation comprise.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">Commission calculée sur des assiettes types</caption>
              <thead>
                <tr>
                  <th scope="col">Assiette</th>
                  <th scope="col">Commission</th>
                  <th scope="col">Détail</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLES.map((base) => {
                  const result = computeCommission(draft, base, { capRate: constraint.capRate });
                  const notes = [
                    result.reason === 'EXCLUE' ? 'exclue' : null,
                    result.reason === 'SOUS_SEUIL' ? 'sous le seuil' : null,
                    result.minApplied ? 'minimum appliqué' : null,
                    result.maxApplied ? 'maximum appliqué' : null,
                    result.capApplied ? 'plafond de l’offre' : null,
                  ].filter(Boolean);
                  return (
                    <tr key={base}>
                      <th scope="row">{formatKmf(BigInt(base) * 100n)}</th>
                      <td>{formatKmf(result.amountCents)}</td>
                      <td>{notes.join(', ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {offer && constraint.allowed && constraint.capRate !== null ? (
          <p className="admin-field__hint">
            Plafond de l’offre : {String(constraint.capRate).replace('.', ',')} % de l’assiette.
          </p>
        ) : null}
      </section>

      <div className="admin-table__actions">
        <button
          className="btn btn--primary"
          type="button"
          disabled={problems.length > 0}
          onClick={() => {
            if (formRef.current?.reportValidity()) setOpenedOn(state);
          }}
        >
          Continuer
        </button>
        <button className="btn btn--ghost" type="button" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setOpenedOn(null)}
        title={derogation ? 'Publier cette règle avec dérogation contractuelle ?' : 'Publier cette règle ?'}
        confirmLabel="Publier la règle"
        variant={derogation ? 'gold' : 'primary'}
      >
        <p>
          La version en cours de cette règle sera close à la date d’effet. Les commissions déjà enregistrées ne
          changent pas.
        </p>
      </ConfirmDialog>
    </form>
  );
}
