import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard, SpaceEmpty, SpaceItem, SpaceList } from '@/components/affiliation/SpaceUi';
import OfficialDocumentActions from '@/components/documents/OfficialDocumentActions';
import { myInvoices } from '@/lib/client/commerce';
import { formatClientDate } from '@/lib/client/labels';
import { getMyClientSpace } from '@/lib/client/space';

export const metadata: Metadata = {
  title: 'Mes documents',
  robots: { index: false, follow: false },
};

/**
 * Mes documents (phase 4I-2).
 *
 * Les pièces officielles dont le client est le titulaire : aujourd'hui, ses
 * factures (FACL). Voir, télécharger, partager le **vrai PDF**, par la route
 * authentifiée et l'archive privée de 4G — en mode « espace client », qui
 * exige d'être le titulaire de la pièce, quels que soient les droits du
 * compte. Aucun lien public.
 *
 * Pas de devis en PDF : le devis se consulte à l'écran (décision 4 du
 * 2026-10-02).
 */
export default async function MesDocumentsPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;

  const { invoices, orders, failed } = await myInvoices(space);
  const orderRef = (id: string | null) => orders.find((order) => order.id === id)?.reference ?? null;

  return (
    <>
      {failed ? (
        <div className="auth-notice auth-notice--warn" role="alert">
          <p>Une partie de vos documents n’a pas pu être chargée. Veuillez réessayer dans un instant.</p>
        </div>
      ) : null}

      <SpaceCard title="Mes factures" intro="Chaque facture est celle du jour de son émission, au format PDF.">
        {invoices.length === 0 ? (
          <SpaceEmpty title="Aucune facture pour le moment.">
            Une facture est émise par MORA Shawiri pour une commande ; elle apparaîtra ici.
          </SpaceEmpty>
        ) : (
          <SpaceList label="Mes factures">
            {invoices.map((invoice) => {
              const order = orderRef(invoice.orderId);
              return (
                <SpaceItem
                  key={invoice.id}
                  title={invoice.reference}
                  meta={
                    <>
                      Émise le {formatClientDate(invoice.issued_at)}
                      {order ? (
                        <>
                          {' · '}
                          <Link href={`/espace-client/commandes/${order}/`}>{order}</Link>
                        </>
                      ) : null}
                    </>
                  }
                >
                  <OfficialDocumentActions reference={invoice.reference} title={`Facture ${invoice.reference}`} space="espace" ownerOnly />
                </SpaceItem>
              );
            })}
          </SpaceList>
        )}
      </SpaceCard>
    </>
  );
}
