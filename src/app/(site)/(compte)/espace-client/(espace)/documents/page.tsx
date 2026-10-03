import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { myOfficialDocuments, type MyDocument } from '@/lib/client/commerce';
import { formatClientDate } from '@/lib/client/labels';
import { todayInComoros } from '@/lib/client/relation-rules';
import { getMyClientSpace } from '@/lib/client/space';
import { ORDER_STATUS_LABELS } from '@/lib/commerce/labels';

export const metadata: Metadata = {
  title: 'Mes documents',
  robots: { index: false, follow: false },
};

/**
 * Mes documents (phase 4I-2, complétée par les remarques 01).
 *
 * Toutes les pièces officielles dont le client est le titulaire, au même
 * endroit : devis (DVCL), bons de commande (CMCL), factures (FACL). Voir,
 * télécharger, partager le **vrai PDF**, par la route authentifiée et
 * l'archive privée — en mode « espace client », qui exige d'être le titulaire
 * de la pièce, quels que soient les droits du compte. Aucun lien public.
 */

const SECTIONS: { kind: MyDocument['kind']; title: string; intro: string; empty: string; noun: string }[] = [
  {
    kind: 'DVCL',
    title: 'Mes devis',
    intro: 'Chaque devis est celui du jour de son émission. Vous y répondez depuis sa fiche.',
    empty: 'Un devis émis par MORA Shawiri pour l’une de vos demandes apparaîtra ici.',
    noun: 'Devis',
  },
  {
    kind: 'CMCL',
    title: 'Mes bons de commande',
    intro: 'Le bon de commande reprend votre commande telle qu’elle a été confirmée.',
    empty: 'Le bon de commande apparaît ici dès que MORA Shawiri l’établit pour une commande confirmée.',
    noun: 'Bon de commande',
  },
  {
    kind: 'FACL',
    title: 'Mes factures',
    intro: 'Chaque facture est celle du jour de son émission, au format PDF.',
    empty: 'Une facture est émise par MORA Shawiri pour une commande ; elle apparaîtra ici.',
    noun: 'Facture',
  },
];

function stateOf(document: MyDocument, today: string): { label: string; tone: 'ok' | 'todo' | 'muted' | 'warn' } {
  if (document.kind === 'DVCL') {
    if (document.documentStatus === 'REMPLACE') return { label: 'Remplacé', tone: 'muted' };
    switch (document.quoteStatus) {
      case 'ENVOYE':
        return document.quoteValidUntil && document.quoteValidUntil < today
          ? { label: 'Expiré', tone: 'muted' }
          : { label: 'En attente de votre réponse', tone: 'todo' };
      case 'ACCEPTE':
        return { label: 'Accepté', tone: 'ok' };
      case 'REFUSE':
        return { label: 'Refusé', tone: 'muted' };
      case 'EXPIRE':
        return { label: 'Expiré', tone: 'muted' };
      case 'ANNULE':
        return { label: 'Annulé', tone: 'muted' };
      default:
        return { label: 'Émis', tone: 'muted' };
    }
  }
  if (document.kind === 'CMCL') {
    const status = document.orderStatus;
    return { label: status ? `Commande ${ORDER_STATUS_LABELS[status].toLowerCase()}` : 'Établi', tone: status === 'TERMINEE' ? 'ok' : 'todo' };
  }
  return { label: 'Émise', tone: 'ok' };
}

export default async function MesDocumentsPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const { documents, failed } = await myOfficialDocuments(space);
  const today = todayInComoros();

  return (
    <>
      {failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Une partie de vos documents n’a pas pu être chargée. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}

      {SECTIONS.map((section) => {
        const entries = documents.filter((document) => document.kind === section.kind);
        return (
          <SpaceCard key={section.kind} title={section.title} intro={section.intro}>
            {entries.length === 0 ? (
              <SpaceEmpty title="Aucun document pour le moment.">{section.empty}</SpaceEmpty>
            ) : (
              <SpaceList label={section.title}>
                {entries.map((document) => {
                  const state = stateOf(document, today);
                  return (
                    <SpaceItem
                      key={document.id}
                      title={
                        <>
                          <span className="espace-doc-kind">{section.noun}</span> {document.reference}
                        </>
                      }
                      status={state.label}
                      tone={state.tone}
                      meta={
                        <>
                          {document.kind === 'CMCL' ? 'Établi' : document.kind === 'FACL' ? 'Émise' : 'Émis'} le{' '}
                          {formatClientDate(document.date)}
                          {document.kind === 'DVCL' ? (
                            <>
                              {' · '}
                              <Link href={`/espace-client/devis/${document.reference}/`}>Voir la fiche du devis</Link>
                            </>
                          ) : document.orderReference ? (
                            <>
                              {' · '}
                              <Link href={`/espace-client/commandes/${document.orderReference}/`}>
                                {document.kind === 'FACL' ? document.orderReference : 'Voir la commande'}
                              </Link>
                            </>
                          ) : null}
                        </>
                      }
                    >
                      <OfficialDocumentActions
                        reference={document.reference}
                        title={`${section.noun} ${document.reference}`}
                        space="espace"
                        ownerOnly
                      />
                    </SpaceItem>
                  );
                })}
              </SpaceList>
            )}
          </SpaceCard>
        );
      })}
    </>
  );
}
