import type { Metadata } from 'next';

import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import { formatMoment } from '@/lib/affiliation/labels';
import { getMySpace, myDocuments } from '@/lib/affiliation/space';

export const metadata: Metadata = {
  title: 'Mes documents',
  robots: { index: false, follow: false },
};

/**
 * Documents (phase 4H-8).
 *
 * Fiches affilié (FIAF) et relevés de versement (RVAF) dont l'affilié est le
 * titulaire — rendus, archivés et partagés par le moteur de 4H-7 : voir,
 * télécharger, partager le vrai fichier PDF ; aucun lien public. L'aperçu de
 * la fiche montre l'état actuel, sans numéro ni valeur officielle.
 */
export default async function DocumentsPage() {
  const space = await getMySpace();
  if (space.state !== 'ready') return null;
  const { affiliate } = space;

  const documents = await myDocuments(space);
  const sheets = documents.filter((doc) => doc.doc_type === 'FIAF');
  const current = sheets.find((doc) => doc.status === 'EMIS') ?? null;
  const previous = sheets.filter((doc) => doc.status !== 'EMIS');
  const statements = documents.filter((doc) => doc.doc_type === 'RVAF');

  return (
    <>
      <SpaceCard title="Ma fiche affilié" intro="Votre fiche officielle récapitule votre affiliation et vos conditions à sa date d’émission.">
        {current ? (
          <SpaceList label="Fiche en vigueur">
            <SpaceItem
              title={current.reference}
              status="En vigueur"
              tone="ok"
              meta={`Émise le ${formatMoment(current.issued_at)}${current.version > 1 ? ` · version ${current.version}` : ''}`}
            >
              <OfficialDocumentActions reference={current.reference} title={`Fiche affilié ${current.reference}`} space="espace" />
            </SpaceItem>
          </SpaceList>
        ) : (
          <SpaceEmpty title="Aucune fiche officielle émise pour le moment">MORA Shawiri l’émet lorsque vos conditions sont arrêtées.</SpaceEmpty>
        )}
        <p className="aff-more">
          <a href={`/api/affiliation/fiche/${affiliate.id}/apercu/?affichage=1`} target="_blank" rel="noreferrer">
            Voir l’aperçu de ma fiche avec mes conditions actuelles
          </a>
        </p>
        <p className="form__note">L’aperçu n’a ni numéro ni valeur officielle : il montre votre situation à l’instant.</p>
      </SpaceCard>

      {previous.length > 0 ? (
        <SpaceCard title="Versions précédentes" intro="Une fiche remplacée reste consultable telle qu’elle a été émise.">
          <SpaceList label="Fiches remplacées">
            {previous.map((doc) => (
              <SpaceItem
                key={doc.id}
                title={doc.reference}
                status={doc.status === 'REMPLACE' ? 'Remplacée' : 'Annulée'}
                tone="muted"
                meta={`Émise le ${formatMoment(doc.issued_at)} · version ${doc.version}`}
              >
                <OfficialDocumentActions reference={doc.reference} title={`Fiche affilié ${doc.reference}`} space="espace" />
              </SpaceItem>
            ))}
          </SpaceList>
        </SpaceCard>
      ) : null}

      <SpaceCard title="Mes relevés de versement" intro="Un relevé officiel par versement confirmé.">
        {statements.length === 0 ? (
          <SpaceEmpty title="Aucun relevé pour le moment">Le relevé de chaque versement apparaîtra ici dès sa confirmation.</SpaceEmpty>
        ) : (
          <SpaceList label="Relevés de versement">
            {statements.map((doc) => (
              <SpaceItem key={doc.id} title={doc.reference} status="Relevé officiel" tone="ok" meta={`Émis le ${formatMoment(doc.issued_at)}`}>
                <OfficialDocumentActions reference={doc.reference} title={`Relevé de versement ${doc.reference}`} space="espace" />
              </SpaceItem>
            ))}
          </SpaceList>
        )}
      </SpaceCard>
    </>
  );
}
