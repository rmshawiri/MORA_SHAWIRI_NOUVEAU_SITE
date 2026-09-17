import Link from 'next/link';
import type { ReactNode } from 'react';
import { site } from '@/lib/site';

/**
 * Documents légaux du site, publiés en pages autonomes et indexables
 * (`01_STRUCTURE_DES_URLS.md` § 80).
 *
 * Sources officielles, dans `01 Documents de référence/12_DOCUMENTATION/` :
 *   03_MENTIONS_LEGALES.md · 04_POLITIQUE_DE_CONFIDENTIALITE.md ·
 *   05_POLITIQUE_DES_COOKIES.md · 06_CONDITIONS_GENERALES_D_UTILISATION.md ·
 *   07_CONDITIONS_GENERALES_DE_VENTE.md
 *
 * Deux règles ont été appliquées sans exception :
 *  - **aucune information juridique n'est inventée.** Les éléments marqués
 *    « à compléter » dans les sources (immatriculation, forme juridique,
 *    adresse professionnelle complète) ne sont pas publiés ;
 *  - **aucune fonctionnalité inexistante n'est décrite.** Le site est
 *    aujourd'hui un site vitrine : ni compte client, ni panier, ni paiement en
 *    ligne, ni téléchargement. Les clauses des sources qui les concernent
 *    seront publiées avec les modules correspondants.
 */

export type LegalDocument = {
  /** Segment d'URL, sans slash (ex. `mentions-legales`). */
  slug: string;
  /** Titre affiché en `h1`. */
  title: string;
  /** Titre de la balise `<title>`. */
  metaTitle: string;
  description: string;
  updated: string;
  lead: string;
  body: ReactNode;
};

const mailLink = <a href={site.emailHref}>{site.email}</a>;
const phoneLink = <a href={site.phoneHref}>{site.phone}</a>;

const UPDATED = 'Dernière mise à jour : 16 septembre 2026';

export const legalDocuments: readonly LegalDocument[] = [
  {
    slug: 'mentions-legales',
    title: 'Mentions légales',
    metaTitle: 'Mentions légales',
    description:
      'Éditeur, responsable de la publication, hébergement, propriété intellectuelle et responsabilité du site MORA Shawiri.',
    updated: UPDATED,
    lead: 'Identité de l’éditeur du site, responsable de la publication, hébergement et règles d’utilisation applicables.',
    body: (
      <>
        <h2>1. Éditeur du site</h2>
        <p>
          Le présent site est édité par <strong>MORA Shawiri</strong>, structure numérique
          indépendante établie à Moroni, Union des Comores.
        </p>
        <ul>
          <li>Nom commercial : MORA Shawiri</li>
          <li>Nature de la structure : structure numérique indépendante</li>
          <li>Localisation : {site.addressLabel}</li>
          <li>Téléphone et WhatsApp : {phoneLink}</li>
          <li>Courriel : {mailLink}</li>
          <li>
            Activité : services numériques et administratifs, création de sites et
            d’applications, identité visuelle et design, templates professionnels, gestion
            documentaire et saisie de données, conseil, audit, formation et programme
            d’affiliation
          </li>
        </ul>
        <p>
          Les informations d’immatriculation définitives de la structure sont communiquées sur
          simple demande écrite adressée à {mailLink}.
        </p>

        <h2>2. Responsable de la publication</h2>
        <p>
          Le responsable de la publication du site est <strong>Mohamed Rachade</strong>. Toute
          demande relative au contenu publié peut lui être adressée à {mailLink}.
        </p>

        <h2>3. Hébergement</h2>
        <p>
          Le site est hébergé par <strong>Vercel Inc.</strong> (États-Unis), qui assure
          l’hébergement applicatif, le déploiement et la diffusion de contenu. Les coordonnées
          complètes de l’hébergeur sont communiquées sur simple demande écrite adressée à{' '}
          {mailLink}.
        </p>
        <p>
          D’autres services techniques peuvent intervenir pour le domaine et l’acheminement des
          courriels. Les services affichés publiquement correspondent aux services réellement
          utilisés en production.
        </p>

        <h2>4. Propriété du site et propriété intellectuelle</h2>
        <p>
          Le site, son architecture, son identité visuelle, ses contenus originaux, ses éléments
          graphiques, ses textes, ses fonctionnalités et ses éléments techniques sont exploités par
          MORA Shawiri selon les droits dont elle dispose sur chacun de ces éléments.
        </p>
        <p>
          Sauf indication contraire, les éléments originaux publiés sur le site — textes, logos,
          éléments graphiques, illustrations, images, icônes, interfaces, contenus éditoriaux,
          ressources, documents, modèles, éléments de marque et organisation des contenus — sont
          protégés par les droits applicables. Toute reproduction, représentation, modification,
          distribution ou exploitation non autorisée d’un élément protégé peut être interdite.
        </p>

        <h2>5. Marque MORA Shawiri</h2>
        <p>
          Le nom et l’identité visuelle <strong>MORA Shawiri</strong> constituent des éléments de
          marque utilisés par la structure. Le logo, les couleurs, les éléments graphiques et les
          autres éléments identitaires ne doivent pas être utilisés d’une manière susceptible de
          créer une confusion avec MORA Shawiri.
        </p>

        <h2>6. Contenus de tiers, images et médias</h2>
        <p>
          Certains contenus ou services peuvent provenir de tiers : leurs droits restent attachés à
          leurs titulaires respectifs et les conditions d’utilisation applicables sont respectées.
          MORA Shawiri ne revendique pas la propriété des éléments appartenant à des tiers.
        </p>
        <p>
          Les images, photographies, illustrations et autres médias utilisés sur le site sont créés
          par MORA Shawiri, fournis avec une autorisation appropriée, ou utilisés conformément à
          leur licence.
        </p>

        <h2>7. Responsabilité relative aux informations publiées</h2>
        <p>
          MORA Shawiri s’efforce de maintenir des informations exactes, compréhensibles,
          pertinentes et régulièrement mises à jour. Certaines informations peuvent toutefois
          évoluer : les prix, disponibilités, délais, conditions commerciales et caractéristiques
          des offres doivent être vérifiés au moment de la demande concernée. Seul un devis accepté
          engage les parties.
        </p>

        <h2>8. Disponibilité du site</h2>
        <p>
          MORA Shawiri s’efforce de maintenir le site accessible. Des interruptions peuvent
          néanmoins survenir, notamment en raison d’une maintenance, d’une mise à jour, d’une panne
          technique, d’un problème d’hébergement ou de réseau, d’un incident de sécurité ou d’un
          événement indépendant de sa volonté.
        </p>

        <h2>9. Liens externes et services tiers</h2>
        <p>
          Le site contient des liens vers des services externes, notamment WhatsApp et les réseaux
          sociaux de MORA Shawiri. Lorsque l’utilisateur quitte le site pour accéder à un service
          tiers, les conditions et politiques de ce service s’appliquent. MORA Shawiri n’exerce
          aucun contrôle sur leur contenu.
        </p>

        <h2>10. Données personnelles et cookies</h2>
        <p>
          Les modalités de traitement des données personnelles sont détaillées dans la{' '}
          <Link href="/politique-de-confidentialite/">politique de confidentialité</Link>. L’usage
          des cookies et technologies similaires est détaillé dans la{' '}
          <Link href="/politique-de-cookies/">politique des cookies</Link>.
        </p>

        <h2>11. Comportements interdits</h2>
        <p>Il est notamment interdit d’utiliser le site pour :</p>
        <ul>
          <li>tenter d’obtenir un accès non autorisé ;</li>
          <li>contourner les mécanismes de sécurité ;</li>
          <li>introduire un programme malveillant ;</li>
          <li>perturber volontairement le service ;</li>
          <li>exploiter une vulnérabilité sans autorisation ;</li>
          <li>usurper l’identité d’une autre personne ;</li>
          <li>utiliser frauduleusement les fonctionnalités ou le programme d’affiliation ;</li>
          <li>collecter massivement des données sans autorisation.</li>
        </ul>

        <h2>12. Signalement d’une vulnérabilité</h2>
        <p>
          Toute personne découvrant un problème de sécurité est invitée à le signaler à MORA
          Shawiri par un moyen de contact officiel. Il est recommandé de ne pas exploiter la
          vulnérabilité, de ne pas accéder à des données qui ne lui appartiennent pas, de ne rien
          supprimer, de ne pas perturber le fonctionnement du site et de ne pas publier la
          vulnérabilité avant sa prise en charge.
        </p>

        <h2>13. Responsabilité</h2>
        <p>
          MORA Shawiri met en œuvre des moyens raisonnables pour assurer le bon fonctionnement du
          site. Sa responsabilité s’apprécie conformément aux règles de droit applicables et aux
          conditions contractuelles applicables au service concerné. Aucune clause des présentes
          mentions légales ne doit être interprétée comme excluant une responsabilité qui ne peut
          légalement être exclue ou limitée.
        </p>

        <h2>14. Droit applicable et règlement des litiges</h2>
        <p>
          L’utilisation du site est soumise aux règles de droit applicables à la situation
          concernée, appréciées notamment au regard du lieu d’établissement de MORA Shawiri, de la
          nature de l’activité et du lieu du client. En cas de différend, les parties recherchent en
          priorité une solution amiable ; à défaut, les modalités de règlement sont déterminées
          conformément aux documents contractuels applicables et au droit compétent.
        </p>

        <h2>15. Modification des mentions légales</h2>
        <p>
          MORA Shawiri peut modifier les présentes mentions légales, notamment en cas de changement
          de structure, d’adresse, de responsable, ou d’évolution du site et de ses services. La
          version publiée sur le site correspond à la version en vigueur.
        </p>

        <h2>16. Contact</h2>
        <p>
          Pour toute question, réclamation ou demande d’information : {mailLink} — {phoneLink}.
        </p>
      </>
    ),
  },

  {
    slug: 'politique-de-confidentialite',
    title: 'Politique de confidentialité',
    metaTitle: 'Politique de confidentialité',
    description:
      'Données collectées, finalités, durée de conservation, destinataires, sécurité et droits des personnes sur le site MORA Shawiri.',
    updated: UPDATED,
    lead: 'Quelles informations nous recueillons, pourquoi, combien de temps nous les conservons et comment exercer vos droits.',
    body: (
      <>
        <h2>1. Notre engagement</h2>
        <p>
          MORA Shawiri accorde une importance particulière à la protection des données
          personnelles. Nous ne collectons que les informations nécessaires au traitement de votre
          demande, nous ne les revendons jamais et nous ne les utilisons pas à des fins
          publicitaires.
        </p>

        <h2>2. Données collectées</h2>
        <p>Selon votre usage du site, nous pouvons être amenés à traiter :</p>
        <ul>
          <li>vos coordonnées : nom, organisation, adresse électronique, numéro de téléphone ;</li>
          <li>
            les informations relatives à votre projet : besoin exprimé, offre consultée, budget
            indicatif, message libre ;
          </li>
          <li>
            les informations relatives à une demande de rendez-vous : sujet, format, date et
            créneau souhaités ;
          </li>
          <li>les échanges que vous initiez avec nous par courriel, téléphone ou WhatsApp.</li>
        </ul>
        <p>
          Nous ne collectons aucune donnée sensible et ne demandons jamais d’informations bancaires
          par l’intermédiaire du site.
        </p>

        <h2>3. Formulaires, demandes et rendez-vous</h2>
        <p>
          Le site ne dispose d’aucune base de données : les informations que vous saisissez ne sont
          pas stockées sur le site. Elles sont transmises par courriel à MORA Shawiri au moment où
          vous envoyez votre demande, et un accusé de réception vous est adressé à l’adresse que
          vous avez indiquée.
        </p>
        <p>
          Ces informations sont utilisées exclusivement pour vous répondre, établir un devis et
          assurer le suivi de la relation commerciale.
        </p>

        <h2>4. Base du traitement</h2>
        <p>
          Les données sont traitées parce qu’elles sont nécessaires pour répondre à votre demande et
          préparer, le cas échéant, la prestation que vous sollicitez. Vous restez libre de ne pas
          les communiquer : dans ce cas, nous ne pourrons simplement pas traiter votre demande.
        </p>

        <h2>5. Protection des formulaires</h2>
        <p>
          Afin de prévenir les envois automatisés et les abus, le site applique une limitation du
          nombre de demandes envoyées depuis une même connexion et un mécanisme de détection des
          robots. Ces protections ne collectent aucune donnée supplémentaire vous concernant et
          n’utilisent aucun cookie.
        </p>

        <h2>6. WhatsApp</h2>
        <p>
          Lorsque vous nous contactez via WhatsApp, la conversation est hébergée par le service
          WhatsApp et soumise à la politique de confidentialité de son éditeur. Nous conservons ces
          échanges le temps nécessaire au suivi de votre demande.
        </p>

        <h2>7. Cookies et mesure d’audience</h2>
        <p>
          Ce site ne dépose aucun cookie publicitaire ni traceur à des fins de profilage, et aucun
          outil de mesure d’audience n’est activé à ce jour. Le détail figure dans la{' '}
          <Link href="/politique-de-cookies/">politique des cookies</Link>. Si un tel outil était
          mis en place, cette politique serait mise à jour et votre consentement serait recueilli
          avant tout dépôt de cookie non essentiel.
        </p>

        <h2>8. Durée de conservation</h2>
        <ul>
          <li>Demandes n’ayant pas abouti : jusqu’à 12 mois après le dernier échange ;</li>
          <li>
            Dossiers clients : pendant la durée de la relation contractuelle, puis selon les
            obligations légales de conservation comptable ;
          </li>
          <li>Échanges informels (messagerie) : supprimés dès qu’ils ne sont plus utiles au suivi.</li>
        </ul>

        <h2>9. Destinataires des données</h2>
        <p>
          Vos données sont traitées par l’équipe de MORA Shawiri. Elles ne sont ni cédées ni louées
          à des tiers. Elles peuvent être communiquées à un prestataire technique intervenant pour
          notre compte — hébergement du site, acheminement des courriels — tenu à la même
          confidentialité, ou à une autorité compétente sur demande légale.
        </p>

        <h2>10. Sécurité</h2>
        <p>
          Nous mettons en œuvre des mesures raisonnables pour protéger vos informations : accès
          restreint, connexion sécurisée du site, en-têtes de sécurité, identifiants techniques
          jamais exposés au navigateur, et bonnes pratiques internes de gestion documentaire. Aucun
          système informatique ne peut toutefois être considéré comme totalement exempt de risque.
        </p>

        <h2>11. Vos droits</h2>
        <p>
          Vous disposez d’un droit d’accès, de rectification, d’effacement, d’opposition et de
          limitation du traitement de vos données. Vous pouvez également demander à ne plus être
          contacté à tout moment.
        </p>
        <p>
          Pour exercer ces droits, écrivez-nous à {mailLink} en précisant votre demande. Nous vous
          répondons dans un délai raisonnable, et au plus tard sous 30 jours.
        </p>

        <h2>12. Modification de la présente politique</h2>
        <p>
          Cette politique peut évoluer avec le site et ses fonctionnalités. La version publiée sur
          cette page est la version en vigueur.
        </p>

        <h2>13. Contact</h2>
        <p>
          MORA Shawiri — {site.addressLabel}
          <br />
          {mailLink} — {phoneLink}
        </p>
      </>
    ),
  },

  {
    slug: 'politique-de-cookies',
    title: 'Politique des cookies',
    metaTitle: 'Politique des cookies',
    description:
      'Ce que sont les cookies, ceux que le site MORA Shawiri utilise réellement aujourd’hui, et comment les gérer depuis votre navigateur.',
    updated: UPDATED,
    lead: 'Ce site n’utilise aujourd’hui aucun cookie de mesure d’audience ni de publicité. Voici le détail, et ce qui changerait si cela évoluait.',
    body: (
      <>
        <h2>1. Objet</h2>
        <p>
          La présente politique explique comment le site MORA Shawiri utilise les cookies et les
          technologies similaires : ce qu’est un cookie, les catégories existantes, ceux que le site
          utilise réellement, et la façon de les gérer. Elle se lit avec les{' '}
          <Link href="/mentions-legales/">mentions légales</Link>, la{' '}
          <Link href="/politique-de-confidentialite/">politique de confidentialité</Link> et les{' '}
          <Link href="/conditions-generales/">conditions générales</Link>.
        </p>

        <h2>2. Qu’est-ce qu’un cookie ?</h2>
        <p>
          Un cookie est un petit fichier ou élément d’information enregistré sur l’appareil d’un
          utilisateur lors de la consultation d’un site. Les cookies permettent notamment de faire
          fonctionner certaines fonctionnalités, de mémoriser des préférences, de maintenir une
          session, de mesurer l’utilisation du site ou d’en analyser les performances. Des
          technologies similaires — stockage local du navigateur, par exemple — peuvent servir
          certaines de ces finalités.
        </p>

        <h2>3. Ce que ce site utilise aujourd’hui</h2>
        <p>
          <strong>
            Le site MORA Shawiri ne dépose actuellement aucun cookie de mesure d’audience, aucun
            cookie publicitaire et aucun traceur de profilage.
          </strong>{' '}
          Il ne propose ni compte utilisateur, ni panier, ni paiement en ligne : les cookies
          d’authentification, de session et de paiement décrits ci-dessous ne sont donc pas
          utilisés.
        </p>
        <p>
          Aucun bandeau de consentement n’est affiché, parce qu’aucun cookie soumis à consentement
          n’est déposé.
        </p>

        <h2>4. Catégories de cookies</h2>
        <p>Les cookies d’un site se classent généralement en cinq catégories :</p>
        <ul>
          <li>
            <strong>Strictement nécessaires</strong> — indispensables au fonctionnement du service
            demandé : authentification, maintien de session, sécurité, protection contre certaines
            attaques ;
          </li>
          <li>
            <strong>Préférences</strong> — mémorisation d’un affichage, d’une langue ou d’un état
            d’interface ;
          </li>
          <li>
            <strong>Statistiques</strong> — mesure du nombre de visiteurs, des pages consultées, des
            parcours et des performances ;
          </li>
          <li>
            <strong>Marketing</strong> — mesure des campagnes et des conversions ;
          </li>
          <li>
            <strong>Technologies similaires</strong> — stockage local, identifiants techniques et
            mécanismes équivalents.
          </li>
        </ul>
        <p>Chaque catégorie ne peut être utilisée que pour les finalités prévues.</p>

        <h2>5. Services tiers</h2>
        <p>
          Le site propose des liens vers WhatsApp et vers les réseaux sociaux de MORA Shawiri. Ces
          liens n’activent aucun script tiers sur le site : ils ouvrent simplement le service
          concerné. Dès lors que vous interagissez avec WhatsApp ou un réseau social, vous êtes
          soumis aux règles et politiques de ce service, qui peut utiliser ses propres technologies
          de suivi.
        </p>

        <h2>6. Si une mesure d’audience était activée</h2>
        <p>
          MORA Shawiri peut, à l’avenir, activer un outil de mesure d’audience afin de comprendre
          comment le site est utilisé. Dans ce cas :
        </p>
        <ul>
          <li>la présente politique serait mise à jour et l’outil réellement utilisé y serait nommé ;</li>
          <li>
            lorsque la réglementation applicable l’exige, un mécanisme de consentement permettrait
            d’accepter, de refuser, de personnaliser et de modifier vos choix ultérieurement ;
          </li>
          <li>
            le refus des cookies non nécessaires n’empêcherait pas l’accès aux fonctionnalités
            essentielles du site.
          </li>
        </ul>

        <h2>7. Sécurité des cookies</h2>
        <p>
          Lorsque des cookies techniques seront nécessaires — par exemple avec l’arrivée d’un espace
          client — ils seront configurés avec les paramètres de sécurité appropriés :
          <code>HttpOnly</code> pour les cookies qui n’ont pas à être lus par un script,{' '}
          <code>Secure</code> pour n’être transmis qu’en connexion chiffrée, et un attribut{' '}
          <code>SameSite</code> adapté à leur usage.
        </p>

        <h2>8. Gérer les cookies depuis votre navigateur</h2>
        <p>
          Vous pouvez à tout moment consulter, bloquer ou supprimer les cookies enregistrés sur
          votre appareil depuis les paramètres de votre navigateur. La navigation privée limite
          également leur conservation au-delà de la session.
        </p>
        <p>
          Le blocage des cookies strictement nécessaires peut empêcher le bon fonctionnement de
          certaines fonctionnalités des sites qui en utilisent. Ce n’est pas le cas du site MORA
          Shawiri dans sa configuration actuelle.
        </p>

        <h2>9. Modification de la présente politique</h2>
        <p>
          Cette politique est mise à jour dès qu’un nouveau service ou une nouvelle fonctionnalité
          entraîne l’utilisation de cookies. La version publiée sur cette page est la version en
          vigueur.
        </p>

        <h2>10. Contact</h2>
        <p>
          Pour toute question relative aux cookies : {mailLink} — {phoneLink}.
        </p>
      </>
    ),
  },

  {
    slug: 'conditions-generales',
    title: 'Conditions générales',
    metaTitle: 'Conditions générales',
    description:
      'Conditions d’utilisation du site MORA Shawiri et conditions applicables aux demandes, devis, prestations, paiements et réclamations.',
    updated: UPDATED,
    lead: 'Les règles d’utilisation du site, et les conditions applicables aux demandes, devis et prestations de MORA Shawiri.',
    body: (
      <>
        <h2>1. Objet et champ d’application</h2>
        <p>
          Les présentes conditions générales régissent l’utilisation du site MORA Shawiri ainsi que
          les demandes, devis et prestations qui en découlent. Elles se lisent avec les{' '}
          <Link href="/mentions-legales/">mentions légales</Link>, la{' '}
          <Link href="/politique-de-confidentialite/">politique de confidentialité</Link> et la{' '}
          <Link href="/politique-de-cookies/">politique des cookies</Link>.
        </p>
        <p>
          Le site est aujourd’hui un site vitrine : il ne propose ni compte client, ni panier, ni
          paiement en ligne. Les conditions relatives à ces fonctionnalités seront publiées lorsque
          celles-ci seront mises en service.
        </p>

        <h2>2. Définitions</h2>
        <ul>
          <li>
            <strong>Site</strong> — le site internet MORA Shawiri et les interfaces numériques
            directement associées ;
          </li>
          <li>
            <strong>Utilisateur</strong> — toute personne accédant au site ;
          </li>
          <li>
            <strong>Client</strong> — un utilisateur qui demande ou commande une prestation
            proposée par MORA Shawiri ;
          </li>
          <li>
            <strong>Service</strong> — une prestation proposée par MORA Shawiri ;
          </li>
          <li>
            <strong>Contenu</strong> — les textes, images, documents, illustrations, interfaces et
            autres éléments publiés sur le site.
          </li>
        </ul>

        <h2>3. Acceptation et évolution des conditions</h2>
        <p>
          L’accès et l’utilisation du site impliquent l’acceptation des présentes conditions.
          MORA Shawiri peut les modifier afin de tenir compte de l’évolution du site, de nouvelles
          fonctionnalités ou de nouvelles obligations applicables. La version applicable est celle
          publiée sur le site à la date concernée, sous réserve des règles impératives applicables.
        </p>

        <h2>4. Accès, disponibilité et maintenance</h2>
        <p>
          Le site est destiné à être accessible au public, sous réserve de sa disponibilité et des
          contraintes techniques. MORA Shawiri peut interrompre temporairement certaines
          fonctionnalités afin d’effectuer une maintenance, d’installer une mise à jour, de corriger
          un problème, d’améliorer les performances ou de renforcer la sécurité.
        </p>

        <h2>5. Utilisation du site</h2>
        <p>
          L’utilisateur s’engage à utiliser le site conformément aux présentes conditions et aux
          règles applicables, de manière loyale, sans porter atteinte aux droits de tiers, sans
          compromettre la sécurité et sans perturber le fonctionnement du site. Les comportements
          interdits sont énumérés dans les{' '}
          <Link href="/mentions-legales/">mentions légales</Link>.
        </p>

        <h2>6. Exactitude des informations transmises</h2>
        <p>
          L’utilisateur est responsable de l’exactitude des informations qu’il fournit. Une
          information incorrecte peut notamment empêcher le traitement d’une demande, l’envoi d’un
          courriel ou la confirmation d’un rendez-vous.
        </p>

        <h2>7. Informations commerciales</h2>
        <p>
          Les informations affichées sur le site peuvent évoluer : prix, disponibilités, délais,
          descriptions, promotions, caractéristiques et conditions. Les informations applicables à
          une demande sont celles présentées au moment de l’opération, sous réserve des règles
          contractuelles applicables.
        </p>

        <h2>8. Prix</h2>
        <p>
          Les prix affichés sur le site sont exprimés en francs comoriens (KMF). Ils correspondent
          aux prix définis par MORA Shawiri au moment de leur publication et peuvent être modifiés.
          Une modification de prix n’affecte pas une prestation déjà définitivement acceptée, sauf
          si les conditions applicables en disposent autrement.
        </p>
        <p>
          En cas d’erreur manifeste de prix, MORA Shawiri se réserve le droit de vérifier la demande
          avant son exécution et de contacter le client afin de déterminer la suite à y donner.
        </p>

        <h2>9. Promotions et codes promotionnels</h2>
        <p>
          MORA Shawiri peut proposer des réductions, offres spéciales, codes promotionnels ou
          campagnes temporaires. Chaque promotion a ses propres conditions — durée, prestation
          concernée, nombre d’utilisations, cumul éventuel. Un code expiré ou invalide ne peut pas
          être utilisé, et il est interdit de contourner les conditions d’une promotion.
        </p>

        <h2>10. Demandes de devis</h2>
        <p>
          Certains services nécessitent une demande de devis. Le client fournit les informations
          nécessaires à l’évaluation de son besoin. <strong>Une demande de devis ne constitue pas
          une commande</strong> : les informations présentées sur le site constituent une
          présentation de l’offre et non un engagement définitif de réalisation.
        </p>

        <h2>11. Contenu et validité du devis</h2>
        <p>
          Un devis peut préciser la prestation, la quantité, le prix, le délai, les modalités de
          réalisation, les conditions de paiement, sa durée de validité et les conditions
          particulières applicables. Après expiration de sa durée de validité, MORA Shawiri peut le
          confirmer, en modifier le prix ou les conditions, ou établir un nouveau devis.
        </p>

        <h2>12. Acceptation du devis</h2>
        <p>
          Le client peut accepter un devis selon la procédure indiquée, notamment par courriel, par
          signature ou par confirmation via un canal officiellement accepté. L’acceptation entraîne
          les conséquences prévues par le devis et les conditions applicables.
        </p>

        <h2>13. Rendez-vous</h2>
        <p>
          Lorsque le site permet de demander un rendez-vous, les informations saisies doivent être
          vérifiées avant l’envoi. Un rendez-vous peut être soumis à confirmation, modification,
          annulation ou conditions particulières. Toute annulation suit la procédure indiquée par
          MORA Shawiri.
        </p>

        <h2>14. Moyens de paiement</h2>
        <p>
          Les moyens de paiement disponibles sont ceux affichés au moment de la demande ou
          communiqués officiellement par MORA Shawiri. Ils peuvent évoluer. Aucun paiement n’est
          effectué directement sur le site : le règlement est convenu avec MORA Shawiri au moment de
          la validation du devis.
        </p>

        <h2>15. Facturation</h2>
        <p>
          Lorsque MORA Shawiri émet une facture ou un document équivalent, celui-ci peut être
          transmis par courriel ou par tout autre moyen approprié.
        </p>

        <h2>16. Réalisation des prestations</h2>
        <p>
          Les prestations sur mesure peuvent nécessiter des informations complémentaires, des
          fichiers du client, des validations, des échanges ou un rendez-vous, ainsi qu’un acompte
          lorsque le devis le prévoit. Le client fournit dans les délais convenus les informations,
          fichiers, contenus, validations et accès réellement nécessaires.
        </p>
        <p>
          Le client garantit qu’il dispose des droits nécessaires sur les fichiers qu’il transmet et
          s’engage à ne fournir aucun contenu illégal, malveillant, contrefaisant ou portant
          atteinte aux droits d’un tiers.
        </p>

        <h2>17. Délais de réalisation</h2>
        <p>
          Les délais indiqués dépendent de la nature du service, de sa complexité, de la
          disponibilité, de la réception des informations nécessaires et des validations du client.
          Lorsqu’un délai est estimatif, cela est indiqué. Un retard du client dans la fourniture
          d’un élément nécessaire, d’une validation ou d’un paiement peut entraîner un ajustement du
          délai de réalisation.
        </p>

        <h2>18. Propriété intellectuelle des livrables</h2>
        <p>
          L’accès au site ne transfère pas la propriété des contenus. Les droits relatifs aux
          livrables d’une prestation sont ceux définis par le devis et les conditions acceptées.
        </p>

        <h2>19. Réclamations</h2>
        <p>
          Pour effectuer une réclamation, le client fournit, lorsque possible, son nom, son adresse
          électronique, la prestation concernée, la description du problème et les éléments
          justificatifs utiles. MORA Shawiri examine les réclamations dans un délai raisonnable et
          peut demander des informations complémentaires, proposer une correction, une nouvelle
          livraison, une solution commerciale appropriée, ou procéder à un remboursement lorsque
          celui-ci est dû.
        </p>

        <h2>20. Annulation et remboursement</h2>
        <p>
          Lorsqu’une prestation a déjà été exécutée en tout ou partie, les conditions relatives à
          son annulation ou à son remboursement s’apprécient selon l’état d’exécution, les
          conditions acceptées, la nature de la prestation et le droit applicable.
        </p>

        <h2>21. Services tiers</h2>
        <p>
          Le fonctionnement du site dépend de services externes — hébergement, acheminement des
          courriels, diffusion de contenu. Une indisponibilité d’un service tiers peut affecter
          certaines fonctionnalités du site.
        </p>

        <h2>22. Programme d’affiliation</h2>
        <p>
          Le site présente un programme d’affiliation. Les affiliés sont soumis aux règles du
          programme et aux conditions applicables, définies séparément. Les règles contractuelles
          applicables prévalent en cas de contradiction avec un document informatif.
        </p>

        <h2>23. Sécurité</h2>
        <p>
          MORA Shawiri met en œuvre des mesures adaptées pour protéger le site et les données
          traitées. Aucun système informatique ne peut toutefois être considéré comme totalement
          exempt de risque : les utilisateurs doivent également adopter des pratiques de sécurité
          appropriées.
        </p>

        <h2>24. Nullité d’une clause et absence de renonciation</h2>
        <p>
          Si une disposition des présentes conditions est déclarée invalide ou inapplicable, les
          autres dispositions restent applicables dans la mesure permise par le droit applicable. Le
          fait pour MORA Shawiri de ne pas exercer immédiatement un droit prévu par les présentes
          conditions ne constitue pas une renonciation à ce droit.
        </p>

        <h2>25. Droit applicable et différends</h2>
        <p>
          En cas de différend, les parties recherchent en priorité une solution amiable. À défaut,
          les modalités de règlement sont déterminées conformément aux documents contractuels
          applicables et au droit compétent.
        </p>

        <h2>26. Contact</h2>
        <p>
          Pour toute question relative aux présentes conditions : {mailLink} — {phoneLink}.
        </p>
      </>
    ),
  },
] as const;

/** Retrouve un document légal par son segment d'URL. */
export function findLegalDocument(slug: string): LegalDocument | undefined {
  return legalDocuments.find((document) => document.slug === slug);
}

/** Liens légaux du pied de page, dans l'ordre d'affichage. */
export const legalLinks = legalDocuments.map((document) => ({
  href: `/${document.slug}/`,
  label: document.title,
}));
