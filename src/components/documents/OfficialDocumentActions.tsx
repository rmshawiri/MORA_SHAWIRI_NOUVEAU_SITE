import DocumentShareButton from './DocumentShareButton';

/**
 * Voir, télécharger, partager une pièce officielle — le même trio partout
 * (facture, fiche affilié, relevé de versement), administration comme espace
 * privé. Les trois passent par la route authentifiée `/api/documents/…` :
 * aucun lien public, aucune URL permanente. Partager joint le **vrai fichier
 * PDF** (feuille de partage native — WhatsApp sur les appareils qui le
 * permettent), avec repli honnête par téléchargement.
 */
export default function OfficialDocumentActions({
  reference,
  title,
  space = 'admin',
  ownerOnly = false,
}: {
  reference: string;
  /** Titre proposé à l'application de destination. */
  title: string;
  space?: 'admin' | 'espace';
  /**
   * Espace client (4I-2) : la route exige que le compte soit le titulaire de la
   * pièce, même s'il détient par ailleurs des droits d'administration.
   */
  ownerOnly?: boolean;
}) {
  const pdf = `/api/documents/${encodeURIComponent(reference)}/`;
  const mode = ownerOnly ? 'espace=client' : '';
  const tone =
    space === 'admin'
      ? { ok: 'admin-notice admin-notice--ok', error: 'admin-notice admin-notice--error' }
      : { ok: 'auth-notice auth-notice--ok', error: 'form-alert' };
  return (
    <div className="btn-row">
      <a className="btn btn--ghost" href={`${pdf}?affichage=1${mode ? `&${mode}` : ''}`} target="_blank" rel="noreferrer">
        Voir
      </a>
      <a className="btn btn--ghost" href={mode ? `${pdf}?${mode}` : pdf} download={`${reference}.pdf`}>
        Télécharger
      </a>
      <DocumentShareButton reference={reference} title={title} label="Partager le PDF" tone={tone} ownerOnly={ownerOnly} />
    </div>
  );
}
