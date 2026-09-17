import type { FaqItem } from '@/components/sections/Faq';

/**
 * Base officielle de la FAQ.
 *
 * Source unique : `01 Documents de référence/02_CONTENUS/05_FAQ.md`.
 * Les questions et les réponses en sont reprises ; les catégories suivent § 60.
 *
 * Deux règles ont guidé les rares adaptations, toutes signalées en commentaire :
 *  - aucune information n'est inventée (§ 65) ;
 *  - aucun parcours inexistant n'est annoncé : le site ne dispose pas encore de
 *    commande en ligne, les réponses parlent donc de « demande » là où le
 *    document parlait de « commande » automatisée.
 */

export type FaqCategory = {
  id: string;
  title: string;
  items: readonly FaqItem[];
};

export const faqCategories: readonly FaqCategory[] = [
  {
    id: 'general',
    title: 'Général',
    items: [
      {
        question: 'Qu’est-ce que MORA Shawiri ?',
        answer:
          'MORA Shawiri est une structure digitale indépendante qui propose des services, des solutions, des outils, des formations et progressivement des ressources et produits destinés à accompagner les particuliers, entrepreneurs, professionnels, entreprises et porteurs de projets dans leurs besoins. Notre approche repose notamment sur la personnalisation, la proximité, l’efficacité et l’accessibilité.',
      },
      {
        question: 'Quelle est la différence entre vos services et vos produits ?',
        answer:
          'Un service correspond à une prestation réalisée par MORA Shawiri pour répondre à un besoin. Un produit correspond à un article ou une ressource commercialisé comme produit. La boutique MORA Shawiri pourra accueillir les deux, mais ils resteront clairement différenciés.',
      },
      {
        question: 'Vos services peuvent-ils être personnalisés ?',
        answer:
          'Oui, lorsque la nature du service le permet. MORA Shawiri privilégie une approche basée sur la compréhension du besoin. C’est notamment pour cette raison que certaines prestations sont proposées sur devis plutôt qu’avec un tarif unique.',
      },
    ],
  },
  {
    id: 'services',
    title: 'Services',
    items: [
      {
        question: 'Quels services proposez-vous ?',
        answer:
          'Accompagnement digital, audit stratégique, conception de templates, création d’applications mobiles, création de logos, développement de SaaS, création de sites e-commerce, création de sites vitrines, formation, gestion documentaire, création et optimisation de visuels produits, saisie de données. La liste complète et les conditions de chaque service figurent dans la section Services.',
      },
      {
        question: 'Proposez-vous la création de sites, d’applications et de SaaS ?',
        answer:
          'Oui. MORA Shawiri propose notamment la création de site vitrine, la création de site e-commerce, la création d’application mobile professionnelle et la création de SaaS professionnel. Ces projets étant personnalisés, ils sont actuellement proposés sur devis.',
      },
      {
        question: 'Que comprend la gestion documentaire ?',
        answer:
          'Elle peut notamment concerner l’organisation, le classement, la structuration ou la mise en forme de documents et de fichiers selon vos besoins. Le périmètre dépend de la demande : le service est donc proposé sur devis.',
      },
      {
        question: 'Que comprend le service de saisie de données ?',
        answer:
          'La prestation peut notamment concerner la saisie, la transcription, l’organisation, le classement ou la mise en forme de données que vous nous fournissez. Le périmètre dépend du besoin réel : le service est donc proposé sur devis.',
      },
      {
        question: 'Je ne sais pas quel service correspond à mon besoin. Que dois-je faire ?',
        answer:
          'Contactez-nous et expliquez simplement votre situation. L’objectif est de comprendre votre besoin avant de vous orienter vers une solution.',
      },
      {
        question: 'Je ne trouve pas exactement le service dont j’ai besoin. Que faire ?',
        answer:
          'Présentez-nous votre besoin directement, même s’il ne correspond pas exactement à une offre affichée, via le formulaire de demande ou WhatsApp. MORA Shawiri pourra analyser votre demande et déterminer si une solution adaptée peut être proposée.',
      },
    ],
  },
  {
    id: 'tarifs',
    title: 'Tarifs',
    items: [
      {
        question: 'Tous vos services ont-ils un prix fixe ?',
        answer:
          'Non. Certains services disposent d’un prix fixe tandis que d’autres sont proposés sur devis. Les prestations complexes ou fortement personnalisées nécessitent généralement une analyse du besoin avant de déterminer leur tarif.',
      },
      {
        question: 'Quels sont les services dont le prix est déjà défini ?',
        answer:
          'Audit Stratégique Global : 30 000 KMF. Création de Logo : 15 000 KMF. Formation — Maîtriser la Prospection et la Relation Client : 5 000 KMF. Offre Basique — Optimisation Image Produit : 250 KMF / image. Offre Pro — Création de Visuel Produit Marketing : 500 KMF / visuel. Offre Premium — Pack Branding Marketplace : 750 KMF / pack. Les autres services actuellement proposés sont sur devis.',
      },
      {
        question: 'Que signifie « sur devis » ?',
        answer:
          'Cela signifie que le prix dépend de votre besoin, du périmètre du projet et du travail nécessaire. Vous commencez par nous présenter votre besoin à travers le parcours prévu sur le site ; MORA Shawiri analyse ensuite la demande afin de vous proposer une tarification adaptée.',
      },
      {
        question: 'Les tarifs affichés sont-ils définitifs ?',
        answer:
          'Les tarifs affichés correspondent aux prix actuellement définis par MORA Shawiri au moment de leur publication. MORA Shawiri peut faire évoluer ses offres et ses tarifs : le prix applicable dépend des conditions affichées au moment de la demande. Les services sur devis sont, par définition, tarifés selon le besoin et le périmètre du projet.',
      },
      {
        question: 'Proposez-vous des promotions ?',
        answer:
          'MORA Shawiri peut proposer ponctuellement des offres promotionnelles. Lorsqu’une promotion officielle est active, ses conditions et sa période de validité sont clairement indiquées sur le site. Aucune promotion ne doit être considérée comme permanente sans indication officielle.',
      },
    ],
  },
  {
    id: 'devis',
    title: 'Demandes et devis',
    items: [
      {
        question: 'Comment puis-je demander un devis ?',
        answer:
          'Depuis la carte du service concerné en Boutique, cliquez sur le bouton de demande : le formulaire s’ouvre avec l’offre déjà renseignée. Vous pouvez ajouter un message libre pour transmettre toute information complémentaire que vous jugez importante.',
      },
      {
        question: 'Puis-je ajouter une information qui n’a pas été demandée dans le formulaire ?',
        answer:
          'Oui. Le formulaire comporte un champ de message libre. Vous pouvez y ajouter toute précision, question, contrainte ou information que vous souhaitez nous communiquer. Ce champ est particulièrement important lorsque votre situation ne correspond pas exactement aux questions proposées.',
      },
      {
        question: 'Puis-je vérifier mes informations avant d’envoyer ma demande ?',
        answer:
          'Oui. Pour la prise de rendez-vous, un récapitulatif de votre demande est affiché avant l’envoi et chaque réponse reste modifiable. Pour le formulaire de devis, vos informations restent visibles et modifiables tant que vous n’avez pas envoyé la demande.',
      },
      {
        question: 'Que se passe-t-il après ma demande de devis ?',
        answer:
          'Votre demande nous parvient et vous en recevez un accusé de réception par e-mail. Si des informations complémentaires sont nécessaires, nous pouvons revenir vers vous. Une proposition ou un devis peut ensuite être préparé selon la nature de votre projet.',
      },
      {
        question: 'Puis-je modifier une demande après l’avoir envoyée ?',
        answer:
          'Si vous souhaitez ajouter ou corriger une information après l’envoi, contactez MORA Shawiri en rappelant l’objet de votre demande. L’équipe pourra vous indiquer la marche à suivre selon l’état de son traitement.',
      },
      {
        question: 'J’ai un projet particulier qui ne correspond pas exactement à une offre. Que faire ?',
        answer:
          'Utilisez le bouton « Présenter mon projet » lorsqu’il est disponible. Vous pourrez présenter votre idée, vos objectifs, vos besoins et vos contraintes, et ajouter un message libre. MORA Shawiri pourra ensuite analyser votre demande et vous orienter vers la solution la plus adaptée.',
      },
      // Adapté : le document décrit un achat direct configuré. Aucun parcours de
      // commande automatisé n'existe encore sur le site ; la réponse parle donc
      // de demande directe depuis la carte de l'offre.
      {
        question: 'Tous les services peuvent-ils être demandés directement ?',
        answer:
          'Les services disposant d’un prix déjà défini peuvent être demandés directement depuis leur carte en Boutique. Les services nécessitant une analyse personnalisée sont proposés sur devis. Le bouton affiché sur chaque carte indique l’action appropriée.',
      },
      {
        question: 'Comment savoir si un service est actuellement disponible ?',
        answer:
          'Le statut et le parcours disponibles sont indiqués sur la carte du service. Lorsqu’une prestation est temporairement indisponible, cette information est clairement indiquée.',
      },
    ],
  },
  {
    id: 'rendez-vous',
    title: 'Rendez-vous',
    items: [
      {
        question: 'Est-il possible de prendre rendez-vous avec MORA Shawiri ?',
        answer:
          'Oui, lorsque le service ou la situation le nécessite — notamment lorsqu’un échange préalable est utile pour comprendre un projet. Le parcours permet de recueillir les informations nécessaires avant de proposer les créneaux réellement disponibles.',
      },
      {
        question: 'Dois-je prendre rendez-vous avant chaque demande ?',
        answer:
          'Non. Certains services peuvent être demandés directement lorsqu’ils disposent d’un prix fixe et d’un parcours standardisé. Les rendez-vous sont principalement utiles lorsque le projet nécessite un échange ou une analyse approfondie.',
      },
    ],
  },
  {
    id: 'offres',
    title: 'Offres et produits',
    items: [
      {
        question: 'Combien coûte la création d’un logo ?',
        answer:
          'La prestation Création de Logo est actuellement proposée au prix de 15 000 KMF. La demande peut être effectuée directement depuis la carte du service en Boutique.',
      },
      {
        question: 'Combien coûte l’Audit Stratégique Global ?',
        answer:
          'L’Audit Stratégique Global est actuellement proposé au prix de 30 000 KMF. Il permet notamment d’analyser différents aspects d’une activité, de son organisation, de ses services, de sa présence numérique et de ses outils afin d’identifier des points d’amélioration et de formuler des recommandations.',
      },
      {
        question: 'Qu’est-ce que l’Offre Basique — Optimisation Image Produit ?',
        answer:
          'L’Offre Basique permet d’optimiser une image de produit existante afin d’améliorer sa présentation pour une utilisation professionnelle ou commerciale. Le tarif est de 250 KMF par image ; le montant total est calculé selon le nombre d’images demandées.',
      },
      {
        question: 'Quelle est la différence entre l’Offre Basique et l’Offre Pro ?',
        answer:
          'L’Offre Basique consiste principalement à optimiser une image existante (250 KMF / image). L’Offre Pro consiste à créer un visuel produit marketing (500 KMF / visuel).',
      },
      {
        question: 'Qu’est-ce que le Pack Branding Marketplace ?',
        answer:
          'Le Pack Branding Marketplace donne à une marque une présentation visuelle plus professionnelle et cohérente sur une marketplace. Il comprend notamment l’adaptation du logo, un visuel de profil, une bannière marketplace, un visuel de présentation de marque, 3 visuels produits, une mini-charte visuelle marketplace et l’harmonisation de l’ensemble. Le prix est de 750 KMF par pack.',
      },
      {
        question: 'Quelle offre choisir entre Basique, Pro et Premium ?',
        answer:
          'Basique (250 KMF / image) : vous avez déjà une image et souhaitez l’optimiser. Pro (500 KMF / visuel) : vous souhaitez créer un visuel marketing pour présenter votre produit. Premium (750 KMF / pack) : vous souhaitez améliorer plus largement la présentation visuelle de votre marque sur une marketplace. Si vous hésitez, contactez-nous pour discuter de votre besoin.',
      },
      // Adapté : le document évoque un sélecteur de quantité à la commande, qui
      // n'existe pas encore. Le tarif unitaire, lui, est officiel.
      {
        question: 'Puis-je demander plusieurs images ou plusieurs visuels ?',
        answer:
          'Oui. Le tarif est de 250 KMF par image pour l’Offre Basique et de 500 KMF par visuel pour l’Offre Pro. Indiquez la quantité souhaitée dans votre demande : le montant total suit le tarif unitaire (par exemple 5 images : 1 250 KMF, 10 images : 2 500 KMF).',
      },
      {
        question: 'Avez-vous déjà des produits à vendre ?',
        answer:
          'Pas encore. Au lancement du nouveau site, les services constituent l’offre commerciale principale de MORA Shawiri. La boutique est toutefois conçue pour accueillir progressivement de futurs produits.',
      },
      {
        question: 'Pourquoi la section Produits est-elle vide ?',
        answer:
          'Les produits ne sont pas encore disponibles au lancement du nouveau site. MORA Shawiri préfère publier uniquement des offres réellement disponibles plutôt que de présenter des produits fictifs ou non finalisés. En attendant, vous pouvez découvrir les services actuellement proposés.',
      },
    ],
  },
  {
    id: 'formation',
    title: 'Formation',
    items: [
      {
        question: 'Combien coûte la formation Maîtriser la Prospection et la Relation Client ?',
        answer:
          'La formation est proposée au prix de 5 000 KMF. Le même tarif s’applique au format en ligne et au format présentiel.',
      },
      {
        question: 'Puis-je suivre la formation en ligne ou en présentiel ?',
        answer:
          'Oui, les deux formats sont prévus, au même tarif de 5 000 KMF. En ligne : après validation du processus d’inscription et de paiement, le participant reçoit le lien d’accès à la formation. En présentiel : le participant peut choisir ce format lorsqu’une session est programmée, et les informations relatives à la session lui sont ensuite communiquées.',
      },
      {
        question: 'Comment puis-je m’inscrire à la formation ?',
        answer:
          'Rendez-vous sur la page de la formation : elle détaille le programme, les modalités et le tarif, et vous permet de nous adresser votre demande d’inscription en précisant le format souhaité.',
      },
    ],
  },
  {
    id: 'affiliation',
    title: 'Affiliation',
    items: [
      {
        question: 'Puis-je recommander les offres MORA Shawiri et recevoir une commission ?',
        answer:
          'MORA Shawiri prévoit un programme d’affiliation permettant aux affiliés de recommander certaines offres et de recevoir une commission selon les règles du programme. Les conditions, modalités d’attribution et règles de validation sont définies séparément.',
      },
      {
        question: 'Quels services peuvent être recommandés dans le cadre de l’affiliation ?',
        answer:
          'Les 14 services du catalogue initial sont actuellement considérés comme éligibles au programme d’affiliation, sous réserve des règles générales du programme.',
      },
      {
        question: 'Comment fonctionne le programme d’affiliation ?',
        answer:
          'Le principe consiste à permettre à un affilié de recommander une offre MORA Shawiri à travers son lien ou son mécanisme d’affiliation. Lorsqu’une conversion éligible est correctement attribuée et validée selon les règles du programme, une commission peut être enregistrée.',
      },
      {
        question: 'Une commission est-elle automatiquement validée dès qu’une personne achète ?',
        answer:
          'Pas nécessairement. Une conversion doit respecter les conditions du programme avant qu’une commission puisse être considérée comme validée. Les règles précises concernant l’attribution, la validation, les annulations ou les remboursements sont définies dans les conditions du programme d’affiliation.',
      },
    ],
  },
  {
    id: 'contact',
    title: 'Contact et confidentialité',
    items: [
      {
        question: 'Puis-je vous contacter directement sur WhatsApp ?',
        answer:
          'Oui. WhatsApp est l’un des moyens de communication utilisés par MORA Shawiri. Lorsque le bouton « Discuter sur WhatsApp » est disponible, il ouvre une conversation avec un message prérempli correspondant au service concerné.',
      },
      {
        question: 'Pourquoi proposez-vous WhatsApp comme moyen de contact ?',
        answer:
          'WhatsApp facilite les échanges directs avec MORA Shawiri. Il peut notamment être utilisé pour poser une question, demander une précision, discuter d’un besoin, poursuivre un échange ou obtenir une information avant une demande.',
      },
      {
        question: 'Comment puis-je contacter MORA Shawiri ?',
        answer:
          'Vous pouvez utiliser les moyens de contact disponibles sur la page Contact. Selon votre besoin : WhatsApp, le formulaire du site, ou la prise de rendez-vous lorsque cette option est adaptée.',
      },
      {
        question: 'Où puis-je trouver vos coordonnées ?',
        answer:
          'Toutes les coordonnées officielles de MORA Shawiri sont regroupées sur la page Contact et dans le pied de page du site.',
      },
      {
        question: 'Comment sont traitées mes données personnelles ?',
        answer:
          'Les informations transmises à MORA Shawiri dans le cadre des formulaires, demandes ou rendez-vous sont traitées conformément à la politique de confidentialité du site. Seules les informations nécessaires au traitement de la demande sont collectées.',
      },
    ],
  },
] as const;

/** Toutes les questions à plat : alimente le bloc de données structurées FAQPage. */
export const faqAllItems: readonly FaqItem[] = faqCategories.flatMap((category) => category.items);
