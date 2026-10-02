'use client';

/**
 * Erreur d'une rubrique de l'espace client (phase 4I-1).
 *
 * Message compréhensible, sans détail technique (§ 95, § 98) : ni trace, ni
 * code, ni message de la base. Le bouton relance la rubrique.
 */
export default function ClientSpaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="auth-notice auth-notice--warn" role="alert">
      <p>Nous n’avons pas pu charger ces informations. Veuillez réessayer.</p>
      <div className="btn-row">
        <button type="button" className="btn btn--ghost" onClick={() => reset()}>
          Réessayer
        </button>
      </div>
    </div>
  );
}
