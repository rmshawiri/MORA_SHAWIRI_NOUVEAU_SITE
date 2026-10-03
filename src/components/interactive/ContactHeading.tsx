'use client';

import { useSyncExternalStore } from 'react';

import type { OfferContext } from '@/lib/catalogue/public';

/**
 * Titre du formulaire de la page Contact.
 *
 * Remarques 01 (A6) : arrivé depuis une offre **à prix défini**, le visiteur
 * connaît déjà le prix — le titre ne lui parle donc plus de « devis gratuit »
 * mais de commande. Partout ailleurs (offre sur devis, accès direct), le
 * rendu est exactement celui d'avant : même balisage, même texte.
 */
const subscribe = () => () => {};
const getSearch = () => window.location.search;
const getServerSearch = () => '';

export default function ContactHeading({ offers }: { offers: readonly OfferContext[] }) {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const requested = new URLSearchParams(search).get('offre');
  const offer = requested ? offers.find((entry) => entry.id === requested) : undefined;

  if (offer?.priceAmount) {
    return (
      <>
        <h2 style={{ fontSize: 'var(--text-h3)' }}>Commander cette offre</h2>
        <p style={{ marginBottom: 8 }}>
          Le prix de cette offre est affiché : indiquez la quantité souhaitée et vos précisions. Vous recevez un
          accusé de réception par e-mail, puis la confirmation de MORA Shawiri au prix affiché.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 style={{ fontSize: 'var(--text-h3)' }}>Demander un devis gratuit</h2>
      <p style={{ marginBottom: 8 }}>
        Votre demande nous parvient directement, et vous en recevez un accusé de réception
        par e-mail. Vous pourrez ensuite, si vous le souhaitez, en envoyer une copie sur
        WhatsApp.
      </p>
    </>
  );
}
