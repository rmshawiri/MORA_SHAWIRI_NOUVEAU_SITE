import Image from 'next/image';
import Link from 'next/link';
import CheckList from '@/components/sections/CheckList';
import Faq from '@/components/sections/Faq';
import Hero from '@/components/sections/Hero';
import Marquee from '@/components/sections/Marquee';
import SectionHead from '@/components/sections/SectionHead';
import Timeline from '@/components/sections/Timeline';
import JsonLd from '@/components/seo/JsonLd';
import {
  ArrowRight,
  ChartBars,
  ChatBubble,
  ChatLines,
  CreditCard,
  Mobile,
  Monitor,
  Relation,
  Scale,
  Search,
  Shield,
  TrendingUp,
  Users,
  WhatsappOutline,
} from '@/components/ui/Icon';
import { getSiteUrl } from '@/lib/env';
import { breadcrumbSchema, faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';
import { site, whatsappLink } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'Formation Maîtriser la Prospection et la Relation Client — 5 000 KMF',
  description:
    'Formation professionnelle MORA Shawiri en communication commerciale, prospection et relation client. Six modules, manuel remis, exercices et certificat. Présentiel ou à distance, 5 000 KMF.',
  path: '/formation-prospection-relation-client/',
  images: ['/images/offre-formation-prospection.webp'],
});

const ENROLL_MESSAGE =
  'Bonjour MORA Shawiri, je souhaite m’inscrire à la formation « Maîtriser la Prospection et la Relation Client ».';

const marqueeItems = [
  'Communication professionnelle',
  'Prospection commerciale',
  'Relation client',
  'WhatsApp professionnel',
  'Négociation',
  'Développement commercial',
];

const blockers = [
  {
    title: '« Je ne sais pas par où commencer »',
    text: 'Vous savez que vous devez prospecter, mais vous ne savez pas qui contacter en premier, ni avec quel message.',
  },
  {
    title: '« Mes messages restent sans réponse »',
    text: 'Vous écrivez, on ne vous répond pas, et vous n’osez pas relancer de peur de déranger.',
  },
  {
    title: '« Je baisse mes prix pour convaincre »',
    text: 'Faute d’argumentaire structuré, la négociation se termine toujours sur une remise.',
  },
  {
    title: '« Mes clients n’achètent qu’une fois »',
    text: 'La vente est conclue, puis le lien se perd. Aucun suivi, aucune recommandation, aucun retour.',
  },
  {
    title: '« Je perds le fil de mes contacts »',
    text: 'Les échanges se dispersent entre appels, messages et notes. Les dossiers les plus avancés sont oubliés.',
  },
  {
    title: '« Je manque d’assurance à l’oral »',
    text: 'Au téléphone ou en rendez-vous, vous perdez vos moyens et le discours se dilue.',
  },
];

const benefits = [
  {
    Icon: Search,
    title: 'Vous savez qui contacter',
    text: 'Un profil de client cible défini, une liste de prospects qualifiés, un ordre de priorité clair.',
  },
  {
    Icon: ChatBubble,
    title: 'Vous parlez juste',
    text: 'Un discours centré sur le problème du client, des réponses préparées aux objections courantes.',
  },
  {
    Icon: ChartBars,
    title: 'Vous relancez sans gêne',
    text: 'Un rythme de relances assumé et professionnel, qui rattrape la majorité des dossiers perdus.',
  },
  {
    Icon: Shield,
    title: 'Vous fidélisez',
    text: 'Un suivi après-vente simple qui transforme un client unique en client régulier et en source de recommandations.',
  },
];

const skills = [
  {
    Icon: ChatLines,
    title: 'Communication professionnelle',
    text: 'Structurer son message, adapter son ton, écouter activement et poser les bonnes questions.',
  },
  {
    Icon: Search,
    title: 'Prospection commerciale',
    text: 'Cibler, constituer un fichier, prendre contact et obtenir un rendez-vous.',
  },
  {
    Icon: Relation,
    title: 'Relation client',
    text: 'Créer la confiance, gérer une réclamation, entretenir le lien et faire revenir le client.',
  },
  {
    Icon: WhatsappOutline,
    title: 'WhatsApp professionnel',
    text: 'Transformer WhatsApp en véritable canal de vente : profil, catalogue, messages types, suivi.',
  },
  {
    Icon: Scale,
    title: 'Négociation',
    text: 'Défendre son prix, traiter les objections et conclure sans céder systématiquement de remise.',
  },
  {
    Icon: TrendingUp,
    title: 'Développement commercial',
    text: 'Suivre ses indicateurs, organiser sa semaine commerciale et tenir un rythme régulier.',
  },
];

const modules = [
  {
    marker: '1',
    title: 'Poser les bases de la communication professionnelle',
    text: 'Comprendre ce que le client écoute réellement : structure d’un message clair, choix des mots, posture, écoute active, questions ouvertes. Exercice : reformuler sa présentation en trente secondes.',
  },
  {
    marker: '2',
    title: 'Préparer sa prospection',
    text: 'Définir son client cible, construire un fichier de prospects exploitable, hiérarchiser les priorités et préparer son argumentaire selon le profil. Exercice : liste de trente prospects qualifiés.',
  },
  {
    marker: '3',
    title: 'Prendre contact et obtenir le rendez-vous',
    text: 'Accroches par téléphone, en face à face et par écrit. Franchir les barrages, susciter l’intérêt en quelques secondes, proposer une suite claire. Exercice : mises en situation d’appels et de messages.',
  },
  {
    marker: '4',
    title: 'Convaincre, négocier, conclure',
    text: 'Découverte du besoin, argumentation par bénéfices, traitement des objections les plus fréquentes, défense du prix et techniques de conclusion. Exercice : jeu de rôle acheteur / vendeur.',
  },
  {
    marker: '5',
    title: 'Faire de WhatsApp un canal professionnel',
    text: 'Profil et catalogue, messages d’accroche et de relance, bonnes pratiques de réponse, organisation des conversations et suivi. Exercice : rédaction de sa séquence de relance.',
  },
  {
    marker: '6',
    title: 'Fidéliser et développer son activité',
    text: 'Suivi après-vente, gestion des réclamations, demande de recommandation, tableau de suivi et indicateurs à relever chaque semaine. Exercice : construction de son tableau de bord commercial.',
  },
];

const audiences = ['Entrepreneurs', 'Commerciaux', 'Freelances', 'Vendeurs', 'Étudiants', 'Particuliers'];

const formationFaq = [
  {
    question: 'Faut-il une expérience commerciale pour suivre la formation ?',
    answer:
      'Non. La formation part des bases et convient aussi bien à un débutant qu’à un vendeur expérimenté souhaitant structurer sa méthode. Les exercices sont adaptés au niveau de chaque participant.',
  },
  {
    question: 'Où se déroule la formation ?',
    answer:
      'Elle est disponible en présentiel ou à distance. Le lieu exact de la session en présentiel vous est communiqué à l’inscription, avec l’horaire retenu.',
  },
  {
    question: 'Comment se déroule le paiement ?',
    answer:
      'La participation est de 5 000 KMF. Vous pouvez régler par Mvola, par Holo ou sur place. Votre place est confirmée dès réception du paiement, dans la limite des places disponibles.',
  },
  {
    question: 'Reçoit-on un document à la fin ?',
    answer:
      'Oui : un certificat de participation, le manuel de formation et le support participants, avec les modèles de messages et le tableau de suivi.',
  },
  {
    question: 'La formation est-elle adaptée à une petite activité ?',
    answer:
      'Particulièrement. Les méthodes enseignées ne nécessitent ni budget publicitaire ni logiciel payant : un téléphone, un fichier de prospects et de la régularité suffisent pour les appliquer.',
  },
  {
    question: 'Peut-on inscrire plusieurs personnes de la même entreprise ?',
    answer:
      'Oui. Indiquez-le lors de votre demande : nous organisons également des sessions dédiées pour les équipes commerciales.',
  },
];

/** Fiche formation au format schema.org. */
function courseSchema() {
  const siteUrl = getSiteUrl();
  return {
    '@type': 'Course',
    name: 'Maîtriser la Prospection et la Relation Client',
    description:
      'Formation professionnelle en communication commerciale, prospection et relation client : six modules, exercices, manuel et certificat de participation.',
    provider: { '@id': `${siteUrl}/#organisation` },
    inLanguage: 'fr',
    offers: {
      '@type': 'Offer',
      price: '5000',
      priceCurrency: 'KMF',
      availability: 'https://schema.org/LimitedAvailability',
      url: `${siteUrl}/formation-prospection-relation-client/`,
    },
    hasCourseInstance: [
      {
        '@type': 'CourseInstance',
        courseMode: 'onsite',
        location: { '@type': 'Place', address: site.addressLabel },
      },
      { '@type': 'CourseInstance', courseMode: 'online' },
    ],
  };
}

export default function FormationPage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Formation', path: '/formation-prospection-relation-client/' },
          ]),
          courseSchema(),
          faqSchema(formationFaq),
        ])}
      />

      <Hero
        eyebrow="Formation professionnelle · Présentiel ou à distance"
        title={
          <>
            Maîtriser la <span className="hl-gold">Prospection</span> et la Relation Client
          </>
        }
        lead="Apprenez à aborder un prospect sans hésiter, à conduire l’échange avec assurance, à convaincre sans brader vos prix — et à transformer un premier accord en relation client durable."
        actions={
          <>
            <a
              className="btn btn--gold btn--lg"
              href={whatsappLink(ENROLL_MESSAGE)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Réserver ma place — 5 000 KMF <ArrowRight />
            </a>
            <a className="btn btn--light btn--lg" href="#programme">
              Voir le programme
            </a>
          </>
        }
        proof={[
          'Manuel de formation remis',
          'Exercices et mises en situation',
          'Certificat de participation',
        ]}
        media={
          <div className="pv-duo">
            <figure>
              <Image
                src="/images/formation-formatrice.webp"
                alt="Formatrice MORA Shawiri présentant le manuel de la formation"
                width={1023}
                height={1537}
                priority
                sizes="(max-width: 1024px) 50vw, 23vw"
              />
            </figure>
            <figure>
              <Image
                src="/images/formation-formateur.webp"
                alt="Formateur MORA Shawiri présentant les quatre piliers de la relation client"
                width={1023}
                height={1537}
                priority
                sizes="(max-width: 1024px) 50vw, 23vw"
              />
            </figure>
          </div>
        }
      />

      <Marquee items={marqueeItems} />

      <section className="section" aria-labelledby="presentation-title">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow">La formation en bref</p>
              <h2 id="presentation-title">
                Une formation opérationnelle, pensée pour être appliquée dès le lendemain
              </h2>
              <p className="lead">
                « Maîtriser la Prospection et la Relation Client » est une formation professionnelle
                destinée à développer des compétences solides en communication, en prospection
                commerciale et en relation client.
              </p>
              <p>
                Vous n’y trouverez pas de théorie récitée. Chaque notion est suivie d’un exercice,
                d’un modèle de message ou d’une mise en situation : ce que vous travaillez pendant la
                session, vous l’utilisez sur vos propres prospects ensuite.
              </p>
              <CheckList
                items={[
                  <span key="1">
                    <strong>Un cadre clair</strong> — de la préparation du premier contact jusqu’à la
                    fidélisation après la vente.
                  </span>,
                  <span key="2">
                    <strong>Des outils immédiats</strong> — scripts d’accroche, trames de relance,
                    tableau de suivi, réponses aux objections.
                  </span>,
                  <span key="3">
                    <strong>Un effectif limité</strong> — les places sont limitées afin de garantir un
                    meilleur accompagnement de chaque participant.
                  </span>,
                ]}
              />
              <div className="btn-row" style={{ marginTop: 32 }}>
                <a className="btn btn--primary" href="#tarif">
                  Voir le tarif et les modalités <ArrowRight />
                </a>
              </div>
            </div>
            <figure className="pv-plain reveal">
              <Image
                src="/images/formation-mockup-07.webp"
                alt="Manuel de la formation Maîtriser la Prospection et la Relation Client"
                width={1024}
                height={1024}
                sizes="(max-width: 767px) 100vw, 45vw"
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="problemes-title">
        <div className="container">
          <SectionHead
            eyebrow="Les blocages que nous entendons chaque semaine"
            title="Si vous vous reconnaissez ici, cette formation est faite pour vous"
            titleId="problemes-title"
            lead="Ces situations n’ont rien à voir avec un manque de sérieux. Elles viennent d’un manque de méthode — et la méthode, cela s’apprend."
            center
          />
          <div className="grid grid--3 reveal-group">
            {blockers.map((blocker) => (
              <article className="card card--accent" key={blocker.title}>
                <h3>{blocker.title}</h3>
                <p>{blocker.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--brand" aria-labelledby="benefices-title">
        <div className="container">
          <SectionHead
            eyebrow="Ce que vous en retirez"
            title="Des bénéfices concrets, mesurables sur votre activité"
            titleId="benefices-title"
            center
            onBrand
          />
          <div className="proof-grid reveal-group">
            {benefits.map(({ Icon, title, text }) => (
              <article className="proof" key={title}>
                <Icon />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="competences-title">
        <div className="container">
          <SectionHead
            eyebrow="Compétences acquises"
            title="Six compétences travaillées pendant la formation"
            titleId="competences-title"
            center
          />
          <div className="grid grid--3 reveal-group">
            {skills.map(({ Icon, title, text }) => (
              <article className="card card--accent" key={title}>
                <div className="card__icon">
                  <Icon />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--alt" id="programme" aria-labelledby="programme-title">
        <div className="container">
          <SectionHead
            eyebrow="Programme détaillé"
            title="Six modules, du premier contact à la fidélisation"
            titleId="programme-title"
            lead="Chaque module associe apports méthodologiques, modèles réutilisables et mise en pratique immédiate."
          />
          <Timeline items={modules} revealClass="reveal-group" />
        </div>
      </section>

      <section className="section" aria-labelledby="inclus-title">
        <div className="container">
          <div className="split split--media-first">
            <figure className="pv-plain reveal">
              <Image
                src="/images/formation-manuel-3d.webp"
                alt="Manuel de formation et supports remis aux participants"
                width={1254}
                height={1254}
                sizes="(max-width: 767px) 100vw, 45vw"
                loading="lazy"
              />
            </figure>
            <div className="split__body reveal">
              <p className="eyebrow">Inclus dans votre participation</p>
              <h2 id="inclus-title">Vous repartez avec des outils, pas seulement des notes</h2>
              <CheckList
                items={[
                  <span key="1">
                    <strong>Le manuel de formation</strong> — l’ensemble des méthodes, à consulter et
                    à appliquer après la session.
                  </span>,
                  <span key="2">
                    <strong>Le support participants</strong> — synthèses, trames et modèles de
                    messages prêts à réutiliser.
                  </span>,
                  <span key="3">
                    <strong>Les exercices pratiques et mises en situation</strong> — travaillés
                    pendant la formation, applicables à vos propres prospects.
                  </span>,
                  <span key="4">
                    <strong>Le certificat de participation</strong> — une preuve de compétence à
                    ajouter à votre parcours.
                  </span>,
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="public-title">
        <div className="container">
          <SectionHead
            eyebrow="Pour qui&nbsp;?"
            title="Une formation utile à tous ceux qui doivent convaincre"
            titleId="public-title"
            center
          />
          <ul className="pill-row reveal" style={{ justifyContent: 'center', marginBottom: 48 }}>
            {audiences.map((audience) => (
              <li key={audience}>{audience}</li>
            ))}
          </ul>
          <div className="grid grid--3 reveal-group">
            <article className="card">
              <h3>Entrepreneurs et freelances</h3>
              <p>
                Vous portez seul la vente de votre activité. Vous cherchez une méthode qui tient dans
                une semaine chargée.
              </p>
            </article>
            <article className="card">
              <h3>Commerciaux et vendeurs</h3>
              <p>
                Vous voulez structurer votre approche, améliorer votre taux de réponse et conclure
                plus sereinement.
              </p>
            </article>
            <article className="card">
              <h3>Étudiants et particuliers</h3>
              <p>
                Vous préparez votre entrée dans la vie professionnelle et souhaitez acquérir une
                compétence recherchée.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--brand" id="tarif" aria-labelledby="tarif-title">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow eyebrow--light">Tarif et inscription</p>
              <h2 id="tarif-title">Une compétence commerciale pour 5 000 KMF</h2>
              <p className="lead">
                Un seul client supplémentaire rembourse largement votre participation. La formation
                est proposée en présentiel ou à distance, selon votre organisation.
              </p>
              <div className="pv-price">
                <p className="pv-price__amount">
                  5 000 <small>KMF · par participant</small>
                </p>
                <p style={{ color: 'var(--text-on-brand-muted)', margin: 0 }}>
                  Places limitées afin de garantir un meilleur accompagnement de chaque participant.
                </p>
                <ul className="pv-pay">
                  <li>
                    <Mobile />
                    Mvola
                  </li>
                  <li>
                    <Mobile />
                    Holo
                  </li>
                  <li>
                    <CreditCard />
                    Paiement sur place
                  </li>
                </ul>
                <div className="btn-row">
                  <a
                    className="btn btn--gold btn--lg"
                    href={whatsappLink(ENROLL_MESSAGE)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    M’inscrire sur WhatsApp <ArrowRight />
                  </a>
                  <Link className="btn btn--light btn--lg" href="/contact/">
                    Poser une question
                  </Link>
                </div>
              </div>
            </div>
            <figure className="pv-figure reveal">
              <Image
                src="/images/formation-mockup-03.webp"
                alt="Manuel de la formation Maîtriser la Prospection et la Relation Client, en plusieurs exemplaires"
                width={1536}
                height={1024}
                sizes="(max-width: 767px) 100vw, 45vw"
                loading="lazy"
              />
            </figure>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="modalites-title">
        <div className="container">
          <SectionHead
            eyebrow="Modalités de participation"
            title="Deux façons de suivre la formation"
            titleId="modalites-title"
            center
          />
          <div className="grid grid--2 reveal-group">
            <article className="card card--accent">
              <div className="card__icon">
                <Users />
              </div>
              <h3>En présentiel</h3>
              <p>
                Formation en salle, en groupe restreint : mises en situation à deux, retours
                immédiats du formateur et échanges entre participants.
              </p>
              <CheckList
                items={['Exercices en binôme et jeux de rôle', 'Supports imprimés remis sur place']}
                style={{ marginTop: 8 }}
              />
            </article>
            <article className="card card--accent">
              <div className="card__icon">
                <Monitor />
              </div>
              <h3>À distance</h3>
              <p>
                Même programme, même formateur, en visioconférence. Idéal si vous êtes sur une autre
                île ou hors des Comores.
              </p>
              <CheckList
                items={['Supports transmis au format numérique', 'Exercices encadrés en direct']}
                style={{ marginTop: 8 }}
              />
            </article>
          </div>
          <div className="grid grid--4 reveal-group" style={{ marginTop: 32 }}>
            <article className="card card--flat">
              <h3 style={{ fontSize: '1.0625rem' }}>Effectif</h3>
              <p>Places limitées, pour un accompagnement individuel réel.</p>
            </article>
            <article className="card card--flat">
              <h3 style={{ fontSize: '1.0625rem' }}>Supports</h3>
              <p>Manuel, support participants et modèles réutilisables.</p>
            </article>
            <article className="card card--flat">
              <h3 style={{ fontSize: '1.0625rem' }}>Validation</h3>
              <p>Certificat de participation remis à l’issue de la formation.</p>
            </article>
            <article className="card card--flat">
              <h3 style={{ fontSize: '1.0625rem' }}>Inscription</h3>
              <p>
                Par WhatsApp au <a href={site.phoneHref}>{site.phone}</a> ou à{' '}
                <a href={site.emailHref}>{site.email}</a>.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead
            eyebrow="Questions fréquentes"
            title="Ce que les participants demandent avant de s’inscrire"
            titleId="faq-title"
            center
          />
          <Faq items={formationFaq} />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band reveal">
            <div className="cta-band__body">
              <h2>
                Vos prochains clients existent déjà. Il vous manque la méthode pour les atteindre.
              </h2>
              <p>
                Les places sont limitées à chaque session. Réservez la vôtre dès maintenant — en
                présentiel ou à distance, pour 5 000 KMF.
              </p>
            </div>
            <div className="btn-row">
              <Link className="btn btn--light btn--lg" href="/rendez-vous/">
                Prendre rendez-vous
              </Link>
              <a
                className="btn btn--gold btn--lg"
                href={whatsappLink(ENROLL_MESSAGE)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Réserver ma place <ArrowRight />
              </a>
              <Link className="btn btn--light btn--lg" href="/contact/">
                Être recontacté
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
