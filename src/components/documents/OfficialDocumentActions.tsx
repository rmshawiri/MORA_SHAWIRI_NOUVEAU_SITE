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
}: {
  reference: string;
  /** Titre proposé à l'application de destination. */
  title: string;
  space?: 'admin' | 'espace';
}) {
  const pdf = `/api/documents/${encodeURIComponent(reference)}/`;
  const tone =
    space === 'admin'
      ? { ok: 'admin-notice admin-notice--ok', error: 'admin-notice admin-notice--error' }
      : { ok: 'auth-notice auth-notice--ok', error: 'form-alert' };
  return (
    <div className="btn-row">
      <a className="btn btn--ghost" href={`${pdf}?affichage=1`} target="_blank" rel="noreferrer">
        Voir
      </a>
      <a className="btn btn--ghost" href={pdf} download={`${reference}.pdf`}>
        Télécharger
      </a>
      <DocumentShareButton reference={reference} title={title} label="Partager le PDF" tone={tone} />
    </div>
  );
}
