import type { ReactNode } from 'react';
import { site } from '@/lib/site';

/**
 * Textes légaux affichés en fenêtre modale depuis le pied de page.
 * Source : `assets/js/legal.js` de l'ébauche. Modifier ce fichier met à jour
 * l'ensemble du site : les mentions ne sont dupliquées nulle part ailleurs.
 */

export type LegalKey = 'legal' | 'privacy';

export type LegalDocument = {
  title: string;
  updated: string;
  foot: string;
  body: ReactNode;
};

const mailLink = <a href={site.emailHref}>{site.email}</a>;
const phoneLink = <a href={site.phoneHref}>{site.phone}</a>;

export const legalDocuments: Record<LegalKey, LegalDocument> = {
  legal: {
    title: 'Mentions légales',
    updated: 'Dernière mise à jour : juillet 2026',
    foot: `Pour toute question relative à ces mentions légales : ${site.email}`,
    body: (
      <>
        <h3>1. Éditeur du site</h3>
        <p>
          Le présent site est édité par <strong>MORA Shawiri</strong>, agence digitale établie à
          Moroni, Union des Comores.
        </p>
        <ul>
          <li>Adresse : Moroni, Grande Comore — Union des Comores</li>
          <li>Téléphone : {phoneLink}</li>
          <li>Courriel : {mailLink}</li>
          <li>
            Activité : conception de sites web, identité visuelle, marketing digital, gestion
            documentaire, conseil et formation
          </li>
        </ul>

        <h3>2. Responsable de la publication</h3>
        <p>
          La responsabilité éditoriale du site est assurée par la direction de MORA Shawiri. Toute
          demande relative au contenu publié peut être adressée à {mailLink}.
        </p>

        <h3>3. Hébergement</h3>
        <p>
          Le site est hébergé par un prestataire d’hébergement web professionnel. Les coordonnées
          complètes de l’hébergeur sont communiquées sur simple demande écrite adressée à {mailLink}.
        </p>

        <h3>4. Propriété intellectuelle</h3>
        <p>
          L’ensemble des éléments composant ce site — structure, textes, visuels, photographies,
          logos, icônes, mise en page, code source et éléments graphiques — est la propriété
          exclusive de MORA Shawiri ou de ses partenaires, et est protégé par le droit de la
          propriété intellectuelle.
        </p>
        <p>
          Toute reproduction, représentation, adaptation, diffusion ou exploitation, totale ou
          partielle, par quelque procédé que ce soit, sans autorisation écrite préalable de MORA
          Shawiri, est interdite et pourrait constituer une contrefaçon.
        </p>
        <p>
          Les marques, dénominations et logos de nos clients ou partenaires cités sur le site
          restent la propriété de leurs titulaires respectifs.
        </p>

        <h3>5. Responsabilité</h3>
        <p>
          MORA Shawiri apporte le plus grand soin à l’exactitude des informations publiées sur ce
          site. Ces informations sont fournies à titre indicatif et peuvent être modifiées à tout
          moment, notamment les descriptions de prestations, les délais et les tarifs, qui ne
          constituent pas une offre contractuelle. Seul un devis signé engage les parties.
        </p>
        <p>
          MORA Shawiri ne saurait être tenue responsable des dommages directs ou indirects résultant
          de l’utilisation du site, d’une interruption de service, de la présence d’un virus, ou de
          l’usage fait des informations qu’il contient.
        </p>
        <p>
          Le site peut renvoyer vers des sites tiers (réseaux sociaux, WhatsApp, partenaires). MORA
          Shawiri n’exerce aucun contrôle sur leur contenu et décline toute responsabilité à leur
          égard.
        </p>

        <h3>6. Liens hypertextes</h3>
        <p>
          La mise en place d’un lien vers ce site est libre, dès lors qu’elle ne porte pas atteinte à
          l’image de MORA Shawiri et que la page liée s’ouvre dans une fenêtre indépendante. MORA
          Shawiri se réserve le droit de demander la suppression de tout lien qu’elle jugerait
          préjudiciable.
        </p>

        <h3>7. Droit applicable</h3>
        <p>
          Les présentes mentions légales sont régies par le droit en vigueur en Union des Comores.
          Tout litige relatif à l’utilisation du site relève de la compétence des juridictions
          comoriennes, après recherche d’une solution amiable.
        </p>

        <h3>8. Contact</h3>
        <p>
          Pour toute question, réclamation ou demande d’information : {mailLink} — {phoneLink}.
        </p>
      </>
    ),
  },

  privacy: {
    title: 'Politique de confidentialité',
    updated: 'Dernière mise à jour : juillet 2026',
    foot: `Pour exercer vos droits : ${site.email}`,
    body: (
      <>
        <h3>1. Notre engagement</h3>
        <p>
          MORA Shawiri accorde une importance particulière à la protection des données personnelles.
          Nous ne collectons que les informations nécessaires au traitement de votre demande, nous ne
          les revendons jamais et nous ne les utilisons pas à des fins publicitaires.
        </p>

        <h3>2. Données collectées</h3>
        <p>Selon votre usage du site, nous pouvons être amenés à traiter :</p>
        <ul>
          <li>vos coordonnées : nom, organisation, adresse électronique, numéro de téléphone ;</li>
          <li>
            les informations relatives à votre projet : besoin exprimé, budget indicatif, message ;
          </li>
          <li>les échanges que vous initiez avec nous par courriel, téléphone ou WhatsApp.</li>
        </ul>
        <p>
          Nous ne collectons aucune donnée sensible et ne demandons jamais d’informations bancaires
          par l’intermédiaire du site.
        </p>

        <h3>3. Formulaires et demandes de devis</h3>
        <p>
          Le formulaire de contact et les demandes de devis ne stockent aucune donnée sur le site :
          les informations que vous saisissez servent uniquement à composer le message que vous nous
          transmettez, par WhatsApp ou par courriel. Vous restez maître de l’envoi.
        </p>
        <p>
          Ces informations sont utilisées exclusivement pour vous répondre, établir un devis et
          assurer le suivi de la relation commerciale.
        </p>

        <h3>4. WhatsApp</h3>
        <p>
          Lorsque vous nous contactez via WhatsApp, la conversation est hébergée par le service
          WhatsApp et soumise à la politique de confidentialité de son éditeur. Nous conservons ces
          échanges le temps nécessaire au suivi de votre demande.
        </p>

        <h3>5. Cookies et mesure d’audience</h3>
        <p>
          Ce site ne dépose aucun cookie publicitaire ni traceur à des fins de profilage. Seules des
          informations techniques strictement nécessaires au bon affichage des pages peuvent être
          utilisées par votre navigateur.
        </p>
        <p>
          Aucun outil de mesure d’audience (tel que Google Analytics) n’est activé à ce jour. Si un
          tel outil était mis en place, cette politique serait mise à jour et votre consentement
          serait recueilli avant tout dépôt de cookie non essentiel.
        </p>

        <h3>6. Durée de conservation</h3>
        <ul>
          <li>Demandes n’ayant pas abouti : jusqu’à 12 mois après le dernier échange ;</li>
          <li>
            Dossiers clients : pendant la durée de la relation contractuelle, puis selon les
            obligations légales de conservation comptable ;
          </li>
          <li>Échanges informels (messagerie) : supprimés dès qu’ils ne sont plus utiles au suivi.</li>
        </ul>

        <h3>7. Destinataires des données</h3>
        <p>
          Vos données sont traitées par l’équipe de MORA Shawiri. Elles ne sont ni cédées ni louées à
          des tiers. Elles peuvent être communiquées à un prestataire technique intervenant pour
          notre compte (hébergement, messagerie), tenu à la même confidentialité, ou à une autorité
          compétente sur demande légale.
        </p>

        <h3>8. Sécurité</h3>
        <p>
          Nous mettons en œuvre des mesures raisonnables pour protéger vos informations : accès
          restreint, connexion sécurisée du site, sauvegardes régulières et bonnes pratiques internes
          de gestion documentaire.
        </p>

        <h3>9. Vos droits</h3>
        <p>
          Vous disposez d’un droit d’accès, de rectification, d’effacement, d’opposition et de
          limitation du traitement de vos données. Vous pouvez également demander à ne plus être
          contacté à tout moment.
        </p>
        <p>
          Pour exercer ces droits, écrivez-nous à {mailLink} en précisant votre demande. Nous vous
          répondons dans un délai raisonnable, et au plus tard sous 30 jours.
        </p>

        <h3>10. Contact</h3>
        <p>
          MORA Shawiri — Moroni, Union des Comores
          <br />
          {mailLink} — {phoneLink}
        </p>
      </>
    ),
  },
};
