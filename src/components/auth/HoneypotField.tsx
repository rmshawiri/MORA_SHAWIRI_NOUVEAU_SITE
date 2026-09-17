'use client';

/**
 * Pot de miel.
 *
 * Champ hors flux visuel et retiré de l'arbre d'accessibilité : aucun humain ne
 * le voit ni ne l'entend, un automate peu soigné le remplit. Le serveur écarte
 * alors la demande.
 *
 * `04_AUTHENTIFICATION.md` § 38 écarte le CAPTCHA systématique — « il ne doit
 * pas être imposé inutilement à chaque connexion » — et § 126 demande malgré
 * tout de protéger l'inscription contre les robots. Le pot de miel n'impose
 * rien à personne ; la limitation de fréquence s'occupe des automates
 * sérieux.
 *
 * Le nom `site_web` reprend la convention du formulaire de contact, qui utilise
 * déjà ce procédé.
 */
export default function HoneypotField() {
  return (
    <div className="hp-field" aria-hidden="true">
      <label htmlFor="site_web">Ne remplissez pas ce champ</label>
      <input id="site_web" name="site_web" type="text" tabIndex={-1} autoComplete="off" />
    </div>
  );
}
