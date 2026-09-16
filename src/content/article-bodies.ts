/**
 * Corps des articles du blog, structurés en blocs typés.
 *
 * Contenu repris intégralement de l'ébauche (dossier `00 Ebauche à reproduire`).
 * Le format en blocs évite toute injection de HTML brut et garde les articles
 * modifiables sans toucher au balisage.
 */

/** Segment de texte : chaîne simple, `b` pour gras, `i` pour italique. */
export type Inline = string | { b: string } | { i: string };

export type ArticleBlock =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; content: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'note'; content: Inline[] };

export const articleBodies: Record<string, ArticleBlock[]> = {
  "echec-prospection-client": [
    {
      "type": "h2",
      "text": "La prospection n’échoue presque jamais par manque d’effort"
    },
    {
      "type": "p",
      "content": [
        "Quand une activité manque de clients, le premier réflexe est de conclure qu’il faut « prospecter davantage ». Dans la réalité que nous observons auprès des entrepreneurs et des PME aux Comores, le problème est rarement la quantité d’efforts. C’est l’absence de méthode."
      ]
    },
    {
      "type": "p",
      "content": [
        "Un entrepreneur qui envoie quarante messages en une semaine, puis plus rien pendant un mois, produit moins de résultats qu’un entrepreneur qui contacte cinq personnes par jour avec un discours préparé et une relance planifiée. La prospection est un travail de régularité et de mémoire, pas un travail d’intensité."
      ]
    },
    {
      "type": "p",
      "content": [
        "Avant de changer d’outil ou de canal, il faut donc identifier la cause réelle du blocage. Elles sont peu nombreuses, et elles reviennent toujours."
      ]
    },
    {
      "type": "h2",
      "text": "Les sept causes réelles de l’échec en prospection"
    },
    {
      "type": "h3",
      "text": "1. La cible n’est pas définie"
    },
    {
      "type": "p",
      "content": [
        "« Tout le monde peut être mon client » est la phrase la plus coûteuse en prospection. Sans profil de client cible — secteur, taille, ville, budget, problème précis — impossible d’écrire un message pertinent, de choisir un canal ni de savoir à qui parler en priorité. Le message devient générique, donc ignoré."
      ]
    },
    {
      "type": "h3",
      "text": "2. Le discours parle de vous, pas du client"
    },
    {
      "type": "p",
      "content": [
        "« Nous sommes une entreprise dynamique qui propose de nombreux services » n’intéresse personne. Le prospect ne cherche pas un prestataire : il cherche la résolution d’un problème qui lui coûte de l’argent, du temps ou de la crédibilité. Un discours efficace nomme ce problème avant de nommer l’offre."
      ]
    },
    {
      "type": "h3",
      "text": "3. Les relances n’existent pas"
    },
    {
      "type": "p",
      "content": [
        "C’est la cause la plus fréquente et la plus silencieuse. Un premier message reste sans réponse, et le dossier est abandonné. Or l’absence de réponse n’est presque jamais un refus : c’est un oubli, un mauvais moment, une priorité concurrente. La majorité des accords se concluent après plusieurs points de contact, pas au premier."
      ]
    },
    {
      "type": "h3",
      "text": "4. Un seul canal est utilisé"
    },
    {
      "type": "p",
      "content": [
        "Certains prospects répondent sur WhatsApp, d’autres seulement par téléphone, d’autres uniquement en face à face après une recommandation. S’appuyer sur un unique canal revient à ne parler qu’à une fraction de son marché."
      ]
    },
    {
      "type": "h3",
      "text": "5. On prospecte uniquement quand le carnet est vide"
    },
    {
      "type": "p",
      "content": [
        "La prospection menée dans l’urgence se voit : elle est pressante, mal ciblée, et elle négocie mal ses prix. Prospecter pendant les périodes chargées est inconfortable, mais c’est ce qui évite les mois creux."
      ]
    },
    {
      "type": "h3",
      "text": "6. On confond visibilité et prospection"
    },
    {
      "type": "p",
      "content": [
        "Publier sur les réseaux sociaux crée de la visibilité. La prospection, elle, est un contact nominatif adressé à une personne identifiée. Les deux sont complémentaires, mais la première ne remplace jamais la seconde."
      ]
    },
    {
      "type": "h3",
      "text": "7. Rien n’est écrit"
    },
    {
      "type": "p",
      "content": [
        "Sans trace des contacts, des dates et des réponses, la mémoire fait le tri à votre place — et elle le fait mal. Les dossiers les plus avancés sont souvent ceux que l’on oublie de relancer."
      ]
    },
    {
      "type": "note",
      "content": [
        "À retenir : dans la plupart des cas, ce n’est pas l’offre qui est mauvaise, c’est le suivi qui est inexistant. Un simple tableau de relances produit un effet immédiat sur le chiffre d’affaires."
      ]
    },
    {
      "type": "h2",
      "text": "Le contexte comorien change les canaux, pas les principes"
    },
    {
      "type": "p",
      "content": [
        "Aux Comores comme dans une grande partie de l’Afrique, la relation commerciale repose fortement sur la confiance interpersonnelle et sur la recommandation. Cela a trois conséquences pratiques."
      ]
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "WhatsApp est un canal professionnel."
          },
          " Il doit donc être traité comme tel : photo de profil nette, nom d’entreprise, message structuré, catalogue à jour, horaires de réponse annoncés."
        ],
        [
          {
            "b": "La rencontre physique reste décisive."
          },
          " Un message bien écrit sert souvent à obtenir un rendez-vous, pas à conclure la vente."
        ],
        [
          {
            "b": "La recommandation vaut plus que la publicité."
          },
          " Demander explicitement à un client satisfait deux noms à contacter est la source de prospects la plus rentable qui existe."
        ]
      ]
    },
    {
      "type": "p",
      "content": [
        "Les principes de la prospection professionnelle — cibler, préparer, contacter, relancer, mesurer — restent identiques. Seule leur mise en œuvre s’adapte au terrain."
      ]
    },
    {
      "type": "h2",
      "text": "Un système de prospection simple, en cinq étapes"
    },
    {
      "type": "h3",
      "text": "Étape 1 — Construire une liste de trente noms"
    },
    {
      "type": "p",
      "content": [
        "Pas trois cents : trente. Des organisations réelles, identifiées, correspondant à votre cible, avec pour chacune un nom de personne à joindre. Cette liste est votre matière première pour le mois."
      ]
    },
    {
      "type": "h3",
      "text": "Étape 2 — Préparer un message d’accroche court"
    },
    {
      "type": "p",
      "content": [
        "Quatre lignes suffisent : d’où vous venez, le problème que vous constatez chez des structures comme la sienne, ce que vous avez fait pour d’autres, et une demande simple. Une seule question à la fin, jamais trois."
      ]
    },
    {
      "type": "h3",
      "text": "Étape 3 — Planifier les relances dès le premier contact"
    },
    {
      "type": "p",
      "content": [
        "Une relance à J+3, une à J+10, une dernière à J+30. Chaque relance apporte un élément nouveau — un exemple, une précision, une ressource utile — au lieu de répéter « avez-vous vu mon message »."
      ]
    },
    {
      "type": "h3",
      "text": "Étape 4 — Qualifier au lieu de convaincre"
    },
    {
      "type": "p",
      "content": [
        "Trois questions permettent de savoir s’il y a un projet : quel est le problème aujourd’hui, qu’avez-vous déjà essayé, qui décide et à quelle échéance. Un prospect non qualifié consomme un temps que vous devriez consacrer à un autre."
      ]
    },
    {
      "type": "h3",
      "text": "Étape 5 — Tenir un tableau de suivi"
    },
    {
      "type": "p",
      "content": [
        "Un simple tableau à six colonnes suffit : nom, contact, date du premier échange, statut, prochaine action, date de la prochaine action. Aucun outil coûteux n’est nécessaire — la discipline compte plus que le logiciel."
      ]
    },
    {
      "type": "h2",
      "text": "Les indicateurs qui disent la vérité"
    },
    {
      "type": "p",
      "content": [
        "Suivre son activité commerciale n’exige que quatre chiffres, relevés chaque semaine :"
      ]
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "Nombre de nouveaux contacts"
          },
          " — mesure votre régularité, la seule variable entièrement sous votre contrôle."
        ],
        [
          {
            "b": "Taux de réponse"
          },
          " — mesure la pertinence de votre message et de votre ciblage."
        ],
        [
          {
            "b": "Taux de rendez-vous obtenus"
          },
          " — mesure la qualité de votre accroche."
        ],
        [
          {
            "b": "Taux de conversion en client"
          },
          " — mesure votre capacité à qualifier et à conclure."
        ]
      ]
    },
    {
      "type": "p",
      "content": [
        "Quand un chiffre baisse, il indique précisément l’étape à corriger. C’est tout l’intérêt de mesurer : vous cessez de deviner."
      ]
    },
    {
      "type": "h2",
      "text": "De la prospection à la relation client"
    },
    {
      "type": "p",
      "content": [
        "Obtenir un client coûte toujours plus cher que le conserver. Une fois la vente conclue, trois gestes simples changent la valeur d’un client dans le temps : un point de suivi après la livraison, une prise de nouvelles sans intention de vente, et une demande de recommandation formulée clairement."
      ]
    },
    {
      "type": "p",
      "content": [
        "C’est exactement l’enchaînement que nous travaillons dans notre formation ",
        {
          "i": "Maîtriser la Prospection et la Relation Client"
        },
        " : construire un discours qui parle au client, structurer un suivi qui ne laisse rien tomber, et transformer un premier accord en relation durable."
      ]
    },
    {
      "type": "h2",
      "text": "Par où commencer cette semaine"
    },
    {
      "type": "p",
      "content": [
        "Trois actions, réalisables en deux heures : écrivez le profil précis de votre client idéal ; listez trente noms correspondant à ce profil ; ouvrez un tableau de suivi et contactez les cinq premiers aujourd’hui. La méthode s’affine ensuite, mais elle ne remplace jamais le fait de commencer."
      ]
    }
  ],
  "gestion-documentaire-entreprise": [
    {
      "type": "h2",
      "text": "Le coût invisible du désordre documentaire"
    },
    {
      "type": "p",
      "content": [
        "Le désordre documentaire ne provoque pas de crise spectaculaire. Il produit des frottements quotidiens : dix minutes perdues à retrouver une facture, une relance client impossible à justifier, un devis renvoyé dans une ancienne version, un contrat qu’il faut redemander au client lui-même."
      ]
    },
    {
      "type": "p",
      "content": [
        "Additionnés, ces frottements représentent plusieurs heures par semaine — un coût réel, jamais inscrit dans les comptes. Ils produisent aussi un coût de crédibilité : une organisation qui met trois jours à retrouver une pièce donne l’image d’une organisation approximative, même lorsque son travail est excellent."
      ]
    },
    {
      "type": "p",
      "content": [
        "La gestion documentaire n’est donc pas une préoccupation d’administration lourde. C’est une condition de la fiabilité perçue et de la sérénité interne."
      ]
    },
    {
      "type": "h2",
      "text": "Ce que recouvre réellement la gestion documentaire"
    },
    {
      "type": "p",
      "content": [
        "Il ne s’agit pas seulement de « ranger des fichiers ». Une gestion documentaire fonctionnelle traite cinq questions :"
      ]
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "Où vit un document ?"
          },
          " Un emplacement unique et connu, plutôt que cinq copies dispersées."
        ],
        [
          {
            "b": "Comment le nomme-t-on ?"
          },
          " Une règle de nommage qui rend la recherche immédiate."
        ],
        [
          {
            "b": "Qui y a accès ?"
          },
          " Des droits clairs : consultation, modification, suppression."
        ],
        [
          {
            "b": "Combien de temps le conserve-t-on ?"
          },
          " Un cycle de vie, de la création à l’archivage."
        ],
        [
          {
            "b": "Comment est-il protégé ?"
          },
          " Des sauvegardes testées, pas seulement configurées."
        ]
      ]
    },
    {
      "type": "h2",
      "text": "Six risques concrets que court une PME mal organisée"
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "La perte définitive."
          },
          " Un téléphone volé, un ordinateur en panne, une clé USB oubliée : sans copie, l’historique commercial disparaît."
        ],
        [
          {
            "b": "Le conflit contractuel."
          },
          " Sans contrat signé retrouvable, la discussion avec un client mécontent devient une négociation de parole contre parole."
        ],
        [
          {
            "b": "L’erreur de version."
          },
          " Un devis envoyé avec d’anciens prix ou un rapport transmis avec les mauvais chiffres."
        ],
        [
          {
            "b": "La dépendance à une personne."
          },
          " Quand une seule personne sait où se trouvent les documents, son absence bloque l’entreprise."
        ],
        [
          {
            "b": "Le retard de facturation."
          },
          " Des prestations livrées mais non facturées, faute de suivi documentaire."
        ],
        [
          {
            "b": "L’impossibilité de candidater."
          },
          " Un appel d’offres, un financement ou un partenariat exige des pièces administratives à jour, disponibles rapidement."
        ]
      ]
    },
    {
      "type": "p",
      "content": [
        "Ce dernier point est décisif pour beaucoup de PME africaines : les opportunités de financement et de marchés publics ne se perdent pas par manque de compétence, mais par manque de dossier prêt."
      ]
    },
    {
      "type": "h2",
      "text": "Ce que vous gagnez concrètement"
    },
    {
      "type": "p",
      "content": [
        "Une organisation documentaire structurée produit des effets mesurables dès les premières semaines : recherche d’un document en quelques secondes, transmission facilitée entre collaborateurs, réponses plus rapides aux clients, suivi des échéances contractuelles, et surtout capacité à déléguer sans expliquer à chaque fois où se trouve quoi."
      ]
    },
    {
      "type": "h2",
      "text": "Une méthode en cinq mouvements"
    },
    {
      "type": "h3",
      "text": "1. Une arborescence simple et stable"
    },
    {
      "type": "p",
      "content": [
        "Deux niveaux suffisent dans la plupart des cas : un premier par domaine (Clients, Administratif, Comptabilité, Ressources humaines, Modèles), un second par entité ou par année. Une arborescence trop profonde ne sera pas respectée."
      ]
    },
    {
      "type": "h3",
      "text": "2. Une règle de nommage unique"
    },
    {
      "type": "p",
      "content": [
        "La règle la plus robuste commence par la date au format inversé, ce qui trie les fichiers chronologiquement sans effort."
      ]
    },
    {
      "type": "note",
      "content": [
        "Modèle de nommage : ",
        {
          "b": "AAAA-MM-JJ_Client_TypeDeDocument_v1"
        },
        " — par exemple ",
        {
          "i": "2026-06-24_MairieDeMoroni_Devis_v2"
        },
        ". Une seule règle, appliquée partout, remplace n’importe quel logiciel de recherche."
      ]
    },
    {
      "type": "h3",
      "text": "3. Un cycle de vie assumé"
    },
    {
      "type": "p",
      "content": [
        "Trois états seulement : en cours, validé, archivé. Les documents archivés quittent les dossiers de travail. Ce qui est terminé ne doit plus encombrer ce qui est actif."
      ]
    },
    {
      "type": "h3",
      "text": "4. Une sauvegarde réellement testée"
    },
    {
      "type": "p",
      "content": [
        "La règle habituelle est simple : trois copies, sur deux supports différents, dont une hors des locaux — un disque externe et un espace en ligne, par exemple. Et une vérification trimestrielle : une sauvegarde jamais restaurée est une hypothèse, pas une sécurité."
      ]
    },
    {
      "type": "h3",
      "text": "5. Des droits d’accès explicites"
    },
    {
      "type": "p",
      "content": [
        "Tout le monde n’a pas besoin de tout modifier. Distinguer lecture et écriture évite la majorité des suppressions accidentelles."
      ]
    },
    {
      "type": "h2",
      "text": "Numériser sans tout numériser"
    },
    {
      "type": "p",
      "content": [
        "Le papier reste très présent dans de nombreuses PME. Il n’est pas nécessaire de tout scanner : commencez par ce qui a une valeur juridique ou financière — contrats, factures, attestations, pièces administratives, procès-verbaux. Le reste peut attendre. Un scan lisible, nommé correctement et sauvegardé vaut mieux qu’un projet de numérisation totale qui n’aboutit jamais."
      ]
    },
    {
      "type": "h2",
      "text": "Par où commencer"
    },
    {
      "type": "p",
      "content": [
        "Choisissez un seul domaine — les contrats clients, par exemple. Rassemblez tout au même endroit, appliquez la règle de nommage, archivez ce qui est clos, mettez en place la sauvegarde. Puis passez au domaine suivant. Une organisation documentaire se construit domaine par domaine ; elle ne se décrète pas en une journée."
      ]
    },
    {
      "type": "p",
      "content": [
        "C’est précisément le type de chantier que nous menons avec nos clients : audit de l’existant, arborescence, nomenclature, numérisation des pièces essentielles, sauvegarde et formation de l’équipe qui devra la faire vivre."
      ]
    }
  ],
  "template-organisation": [
    {
      "type": "h2",
      "text": "Définition simple"
    },
    {
      "type": "p",
      "content": [
        "Un template — un modèle — est un document préparé à l’avance dont la structure, la mise en forme et les mentions obligatoires sont déjà décidées. Il ne reste qu’à remplir ce qui change réellement : le nom du client, les montants, les dates, le contenu propre à la situation."
      ]
    },
    {
      "type": "p",
      "content": [
        "Un devis, une facture, un contrat de prestation, un rapport d’activité, une présentation commerciale, une fiche de poste, un visuel de publication : tous ces documents peuvent exister sous forme de modèle. Et tous, sans modèle, sont recréés de zéro chaque fois — avec des différences, des oublis et un temps perdu considérable."
      ]
    },
    {
      "type": "h2",
      "text": "Ce qu’un template n’est pas"
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "Ce n’est pas un document figé."
          },
          " Un bon modèle évolue ; il est simplement versionné et daté."
        ],
        [
          {
            "b": "Ce n’est pas une contrainte créative."
          },
          " Il fixe le cadre, pas le contenu : vous cessez de réfléchir à la forme pour vous concentrer sur le fond."
        ],
        [
          {
            "b": "Ce n’est pas réservé aux grandes structures."
          },
          " Une entreprise de deux personnes en tire un bénéfice proportionnellement plus grand, parce que chaque heure y compte davantage."
        ]
      ]
    },
    {
      "type": "h2",
      "text": "Les modèles qui font gagner le plus de temps"
    },
    {
      "type": "p",
      "content": [
        "Dans une PME, neuf modèles couvrent l’essentiel du quotidien :"
      ]
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "Devis"
          },
          " — structure, conditions, délai de validité, mentions de paiement."
        ],
        [
          {
            "b": "Facture"
          },
          " — numérotation cohérente et références obligatoires."
        ],
        [
          {
            "b": "Contrat de prestation"
          },
          " — périmètre, livrables, délais, responsabilités."
        ],
        [
          {
            "b": "Proposition commerciale"
          },
          " — problème, solution, périmètre, prix, prochaine étape."
        ],
        [
          {
            "b": "Rapport d’activité"
          },
          " — mêmes rubriques d’un mois sur l’autre, donc comparable."
        ],
        [
          {
            "b": "Tableau de suivi"
          },
          " — prospects, projets, échéances, paiements."
        ],
        [
          {
            "b": "Présentation institutionnelle"
          },
          " — pour un rendez-vous, un partenaire ou un bailleur."
        ],
        [
          {
            "b": "Visuels de publication"
          },
          " — un gabarit par type de message, aux couleurs de votre marque."
        ],
        [
          {
            "b": "Messages types"
          },
          " — premier contact, relance, confirmation, remerciement."
        ]
      ]
    },
    {
      "type": "h2",
      "text": "Trois effets que produit un modèle"
    },
    {
      "type": "h3",
      "text": "1. Le temps"
    },
    {
      "type": "p",
      "content": [
        "Rédiger un devis à partir d’une page blanche prend souvent trente à quarante-cinq minutes. À partir d’un modèle, dix minutes suffisent. Sur cinq devis par semaine, l’économie annuelle représente plusieurs semaines de travail."
      ]
    },
    {
      "type": "h3",
      "text": "2. La cohérence"
    },
    {
      "type": "p",
      "content": [
        "Deux documents envoyés par la même entreprise doivent se ressembler. Quand chaque document a sa propre présentation, le client perçoit — souvent inconsciemment — une organisation instable. La cohérence est un signal de sérieux avant d’être un choix graphique."
      ]
    },
    {
      "type": "h3",
      "text": "3. La délégation"
    },
    {
      "type": "p",
      "content": [
        "C’est l’effet le plus sous-estimé. Sans modèle, déléguer suppose de transmettre un savoir-faire complet. Avec un modèle, une nouvelle personne produit un document conforme dès le premier jour. Le modèle est ce qui rend une entreprise transmissible."
      ]
    },
    {
      "type": "note",
      "content": [
        "À retenir : un template transforme une compétence individuelle en procédure d’entreprise. C’est ce qui permet de croître sans que la qualité dépende d’une seule personne."
      ]
    },
    {
      "type": "h2",
      "text": "Anatomie d’un bon template"
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "Un en-tête complet"
          },
          " — logo, dénomination, contacts, numéro de document."
        ],
        [
          {
            "b": "Des rubriques fixes"
          },
          " — les mêmes titres, dans le même ordre, à chaque usage."
        ],
        [
          {
            "b": "Des zones à remplir clairement repérées"
          },
          " — placeholders visibles, impossibles à oublier."
        ],
        [
          {
            "b": "Les mentions obligatoires déjà rédigées"
          },
          " — conditions, validité, modalités de paiement."
        ],
        [
          {
            "b": "Une version et une date"
          },
          " — pour savoir lequel est le modèle en vigueur."
        ],
        [
          {
            "b": "Un format modifiable et un format d’envoi"
          },
          " — la source pour travailler, le PDF pour transmettre."
        ]
      ]
    },
    {
      "type": "h2",
      "text": "Les erreurs fréquentes"
    },
    {
      "type": "p",
      "content": [
        "Un modèle trop chargé n’est pas utilisé. Un modèle non centralisé se duplique en cinq variantes contradictoires. Un modèle sans placeholders laisse passer le nom du client précédent — l’erreur la plus embarrassante en prospection. Et un modèle qui n’est jamais revu finit par contenir des informations obsolètes que l’on diffuse sans le voir."
      ]
    },
    {
      "type": "h2",
      "text": "Déployer vos modèles en une semaine"
    },
    {
      "type": "p",
      "content": [
        "Jour 1 : listez les cinq documents que vous produisez le plus souvent. Jour 2 : pour chacun, retrouvez la meilleure version existante. Jour 3 : nettoyez-la, ajoutez l’en-tête, les rubriques fixes et les placeholders. Jour 4 : rangez tout dans un dossier « Modèles » unique, en lecture seule. Jour 5 : utilisez-les sur un cas réel et corrigez ce qui bloque."
      ]
    },
    {
      "type": "p",
      "content": [
        "Une semaine de travail, et l’organisation change de niveau — durablement."
      ]
    }
  ],
  "site-internet-entrepreneur": [
    {
      "type": "h2",
      "text": "Être vu ne suffit pas : il faut être vérifiable"
    },
    {
      "type": "p",
      "content": [
        "Le bouche-à-oreille fonctionne, une page active suffit à se faire connaître dans son quartier ou son secteur. Le blocage arrive plus tard, au moment de la décision : un client institutionnel, un partenaire ou un acheteur important ne se contente pas d’un numéro transmis par un ami. Il cherche votre nom, et ce qu’il trouve — ou ne trouve pas — détermine s’il vous perçoit comme une entreprise structurée."
      ]
    },
    {
      "type": "p",
      "content": [
        "Un site internet n’est pas un panneau publicitaire. C’est une pièce de crédibilité, au même titre qu’une facture propre ou qu’un devis bien présenté."
      ]
    },
    {
      "type": "h2",
      "text": "Ce que les réseaux sociaux ne remplacent pas"
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "La présentation maîtrisée."
          },
          " Sur un fil chronologique, vos informations essentielles — services, références, contacts — sont noyées. Un visiteur voit votre dernière publication, pas votre offre."
        ],
        [
          {
            "b": "La propriété du canal."
          },
          " Un compte peut être restreint, suspendu ou perdu. Votre historique commercial disparaît avec lui."
        ],
        [
          {
            "b": "La présence dans les recherches."
          },
          " Une publication n’est pas indexée comme une page web. Quand quelqu’un cherche « comptable Moroni » ou « imprimerie Anjouan », ce sont des pages de site qui répondent."
        ]
      ]
    },
    {
      "type": "p",
      "content": [
        "Il ne s’agit pas de choisir : les réseaux créent la conversation, le site la transforme en confiance."
      ]
    },
    {
      "type": "h2",
      "text": "Sept apports concrets d’un site bien conçu"
    },
    {
      "type": "h3",
      "text": "1. Il filtre les demandes"
    },
    {
      "type": "p",
      "content": [
        "Une page de services claire évite les échanges interminables sur ce que vous faites et ne faites pas. Les demandes arrivent mieux qualifiées."
      ]
    },
    {
      "type": "h3",
      "text": "2. Il travaille en votre absence"
    },
    {
      "type": "p",
      "content": [
        "Délais, zone d’intervention, moyens de paiement, garanties : une FAQ bien rédigée répond la nuit, le week-end et pendant vos rendez-vous."
      ]
    },
    {
      "type": "h3",
      "text": "3. Il vous rend trouvable localement"
    },
    {
      "type": "p",
      "content": [
        "Des pages structurées autour de vos services et de votre ville vous placent dans les résultats de recherche là où vos concurrents sans site sont absents."
      ]
    },
    {
      "type": "h3",
      "text": "4. Il vous rend comparable — à votre avantage"
    },
    {
      "type": "p",
      "content": [
        "Face à une entreprise sans site, votre présentation structurée pèse dans la décision, souvent plus que la différence réelle entre les deux offres."
      ]
    },
    {
      "type": "h3",
      "text": "5. Il capitalise"
    },
    {
      "type": "p",
      "content": [
        "Chaque page publiée reste et continue de travailler des mois plus tard. Une publication, elle, vit quelques heures."
      ]
    },
    {
      "type": "h3",
      "text": "6. Il peut vendre directement"
    },
    {
      "type": "p",
      "content": [
        "Formulaire de commande, prise de rendez-vous, paiement en ligne ou simple bouton WhatsApp : le site raccourcit le chemin entre l’intérêt et l’acte d’achat."
      ]
    },
    {
      "type": "h3",
      "text": "7. C’est un actif"
    },
    {
      "type": "p",
      "content": [
        "Un site, son nom de domaine, son contenu et son référencement ont une valeur qui vous appartient et qui se transmet avec l’entreprise."
      ]
    },
    {
      "type": "note",
      "content": [
        "À retenir : un site de cinq pages bien construites vaut mieux qu’un site de vingt pages inutilisées. Accueil, services, références, à propos, contact — dans cet ordre."
      ]
    },
    {
      "type": "h2",
      "text": "Le minimum viable pour bien démarrer"
    },
    {
      "type": "p",
      "content": [
        "Cinq pages, une promesse claire en haut de l’accueil, une page par service principal, des preuves — réalisations, témoignages, clients — et un moyen de contact visible sur chaque écran. Ajoutez une fiche d’établissement en ligne pour la recherche locale, et vous couvrez l’essentiel des situations."
      ]
    },
    {
      "type": "h2",
      "text": "Combien de temps, combien d’efforts"
    },
    {
      "type": "p",
      "content": [
        "Un site vitrine professionnel se réalise généralement en deux à quatre semaines. L’essentiel du travail n’est pas technique : il consiste à décider ce que vous voulez dire, à qui, dans quel ordre, et quelle action vous attendez du visiteur. Le code est aujourd’hui la partie la plus simple ; la clarté se travaille."
      ]
    },
    {
      "type": "h2",
      "text": "Les quatre erreurs les plus coûteuses"
    },
    {
      "type": "ul",
      "items": [
        [
          {
            "b": "Le site lent."
          },
          " La qualité de connexion varie fortement aux Comores : un site alourdi d’images non optimisées perd ses visiteurs avant d’avoir affiché son titre."
        ],
        [
          {
            "b": "Le site non pensé pour mobile."
          },
          " La majorité de vos visiteurs arrivent depuis un smartphone."
        ],
        [
          {
            "b": "La brochure figée."
          },
          " Publiée une fois, jamais mise à jour, avec des informations obsolètes : elle inspire moins confiance qu’une absence de site."
        ],
        [
          {
            "b": "L’absence d’action attendue."
          },
          " Un site sans appel à l’action clair informe, mais ne convertit pas."
        ]
      ]
    },
    {
      "type": "h2",
      "text": "Et si votre activité fonctionne déjà bien ?"
    },
    {
      "type": "p",
      "content": [
        "C’est le meilleur moment. Un site construit sur une activité qui marche s’appuie sur des références réelles, des témoignages disponibles et une offre éprouvée. Attendre un ralentissement pour s’en occuper, c’est devoir construire dans l’urgence, avec moins de matière et moins de recul."
      ]
    },
    {
      "type": "h2",
      "text": "Par où commencer"
    },
    {
      "type": "p",
      "content": [
        "Répondez par écrit à trois questions : quel service voulez-vous vendre en priorité, quelle est l’objection principale de vos clients, et quelle action doit effectuer un visiteur convaincu. Un site construit autour de ces trois réponses produit des résultats ; un site construit autour d’un modèle graphique produit une jolie page."
      ]
    }
  ]
};
