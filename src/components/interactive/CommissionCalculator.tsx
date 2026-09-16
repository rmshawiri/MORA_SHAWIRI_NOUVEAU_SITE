'use client';

import { useMemo, useState } from 'react';
import { whatsappLink } from '@/lib/site';

/** Taux de commission publiés sur la page Affiliation. */
const RATES = [
  { value: 10, label: 'Projet web — 10 %' },
  { value: 12, label: 'Formule d’accompagnement — 12 %' },
  { value: 15, label: 'Formation ou pack visuels — 15 %' },
] as const;

const DEFAULT_AMOUNT = 450_000;
const DEFAULT_RATE = 12;

const formatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

const JOIN_MESSAGE = 'Bonjour MORA Shawiri, je souhaite rejoindre le programme d’affiliation.';

/**
 * Simulateur de commission du programme d'affiliation.
 *
 * Calcul purement local : aucune donnée n'est transmise. Le résultat reste
 * indicatif, chaque prestation étant chiffrée sur devis.
 */
export default function CommissionCalculator() {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [rate, setRate] = useState<number>(DEFAULT_RATE);

  const commission = useMemo(() => Math.round((amount * rate) / 100), [amount, rate]);

  return (
    <div className="calc reveal">
      <div className="form">
        <div className="field">
          <label htmlFor="calc-amount">Montant du projet signé (KMF)</label>
          <input
            id="calc-amount"
            type="number"
            min={50000}
            max={10000000}
            step={25000}
            value={amount}
            onChange={(event) => setAmount(Number.parseInt(event.target.value, 10) || 0)}
          />
          <p className="field__hint">
            Exemples observés : site vitrine, boutique en ligne, accompagnement global.
          </p>
        </div>
        <div className="field">
          <label htmlFor="calc-rate">Type de prestation recommandée</label>
          <select
            id="calc-rate"
            value={rate}
            onChange={(event) => setRate(Number.parseFloat(event.target.value))}
          >
            {RATES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <p className="form__note">
          Simulation indicative. Le montant exact dépend du devis signé par le client ; nos
          prestations sont chiffrées sur devis.
        </p>
      </div>

      <div className="calc__out">
        <p className="eyebrow eyebrow--light" style={{ margin: 0 }}>
          Votre commission estimée
        </p>
        <p className="calc__amount" aria-live="polite">
          <span>{formatter.format(commission)}</span>
          <small>KMF</small>
        </p>
        <div className="calc__row">
          <span>Montant du projet</span>
          <strong>{formatter.format(amount)} KMF</strong>
        </div>
        <div className="calc__row">
          <span>Taux appliqué</span>
          <strong>{String(rate).replace('.', ',')} %</strong>
        </div>
        <p style={{ fontSize: '.875rem', margin: 0 }}>
          Versée dès l’encaissement du premier acompte, par mobile money ou virement.
        </p>
        <a
          className="btn btn--gold btn--block"
          href={whatsappLink(JOIN_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Obtenir mon code partenaire
        </a>
      </div>
    </div>
  );
}
