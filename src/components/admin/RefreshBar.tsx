'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * Horodatage des données affichées, et bouton pour les recharger.
 *
 * ## La règle que ce composant applique
 *
 * Le prompt maître (§ 45-48, § 80-81) interdit **tout rechargement
 * automatique** : ni sur `focus`, ni sur `visibilitychange`, ni sur
 * `pageshow`. Une personne qui revient sur son onglet doit retrouver
 * exactement l'écran qu'elle avait laissé — un tableau qui se réordonne pendant
 * qu'on lit une ligne fait perdre la ligne.
 *
 * Ce composant est donc, littéralement, l'inverse d'un rafraîchissement
 * automatique : aucun `setInterval`, aucun écouteur d'événement de fenêtre.
 * Il ne se passe rien tant que personne ne clique.
 *
 * La contrepartie est due : si les chiffres ne bougent pas tout seuls, il faut
 * dire de quand ils datent. D'où l'horodatage, posé par le serveur au rendu.
 *
 * ## Pourquoi l'heure arrive du serveur
 *
 * Formater côté client produirait un premier rendu différent du rendu serveur —
 * fuseau et locale du navigateur — donc une erreur d'hydratation. L'heure est
 * donc calculée une fois, au rendu de la page, et affichée telle quelle.
 *
 * ## Ce que fait le bouton
 *
 * `router.refresh()` redemande le rendu serveur de la page : les données sont
 * réellement relues en base. Le § 189 l'exige — « Une actualisation doit
 * récupérer les données réellement mises à jour. Elle ne doit pas simplement
 * modifier visuellement les chiffres. »
 */
export default function RefreshBar({ stamp }: { stamp: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  // Le « Actualisé » disparaît de lui-même : une confirmation permanente
  // finirait par ne plus rien confirmer.
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 4000);
    return () => window.clearTimeout(timer);
  }, [done]);

  return (
    <div className="admin-refresh">
      <span className="admin-refresh__stamp">
        Dernière actualisation : {stamp}
        {done ? ' — actualisé' : null}
      </span>

      <button
        className="btn btn--ghost"
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            router.refresh();
            setDone(true);
          })
        }
      >
        {pending ? 'Actualisation…' : 'Actualiser'}
      </button>
    </div>
  );
}
