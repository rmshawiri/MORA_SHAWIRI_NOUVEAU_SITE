'use client';

import { useEffect } from 'react';

/**
 * Une page privée restaurée par le bouton « Précédent » est rechargée.
 *
 * Après une déconnexion, le navigateur peut ressortir de son cache de
 * navigation (bfcache) l'image d'une page privée telle qu'elle était. Elle
 * n'est plus exploitable — chaque action revérifie la session côté serveur —
 * mais ses données resteraient affichées. Recharger la page la soumet de
 * nouveau au proxy et aux gardes : une session close mène à la connexion.
 *
 * Aucun rechargement en dehors de ce cas : `persisted` n'est vrai que pour
 * une restauration depuis le bfcache.
 */
export default function ReloadOnRestore() {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return null;
}
