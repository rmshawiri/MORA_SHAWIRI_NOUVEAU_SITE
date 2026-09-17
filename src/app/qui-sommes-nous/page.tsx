import Image from 'next/image';
import Link from 'next/link';
import CheckList from '@/components/sections/CheckList';
import CtaBand from '@/components/sections/CtaBand';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import Testimonials from '@/components/sections/Testimonials';
import Timeline from '@/components/sections/Timeline';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight } from '@/components/ui/Icon';
import { breadcrumbSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Qui sommes-nous — Une équipe comorienne, des standards internationaux',
  description:
    'MORA Shawiri, agence digitale basée à Moroni : notre mission, nos valeurs et notre méthode en cinq étapes pour rendre la performance numérique accessible à chaque organisation.',
  path: '/qui-sommes-nous/',
});

const values = [
  {
    num: '01',
    title: 'Confiance',
    text: 'Devis transparents, périmètre écrit, délais annoncés. Vous savez toujours ce que vous payez et où en est votre projet.',
  },
  {
    num: '02',
    title: 'Excellence',
    text: 'Chaque livrable suit les standards internationaux : design soigné, code propre, performance et sécurité vérifiées.',
  },
  {
    num: '03',
    title: 'Proximité',
    text: 'Nous parlons votre langue, nous connaissons votre marché, et nous restons joignables avant, pendant et après le projet.',
  },
  {
    num: '04',
    title: 'Innovation',
    text: 'Automatisation, outils métiers, nouveaux usages : nous retenons la technologie qui sert réellement votre activité.',
  },
  {
    num: '05',
    title: 'Accessibilité',
    text: 'Des solutions calibrées pour le contexte comorien, afin qu’aucune organisation ne reste à l’écart du numérique.',
  },
  {
    num: '06',
    title: 'Résultats',
    text: 'Un bel outil ne suffit pas. Nous visons ce qui compte : visibilité, demandes entrantes, temps gagné.',
  },
];

const journey = [
  {
    marker: '01',
    title: 'Diagnostic gratuit',
    text: 'Un premier échange pour comprendre votre activité, vos objectifs et votre maturité numérique actuelle. Aucun engagement.',
  },
  {
    marker: '02',
    title: 'Feuille de route',
    text: 'Nous priorisons les actions à fort impact et construisons un plan réaliste, adapté à votre budget et à votre calendrier.',
  },
  {
    marker: '03',
    title: 'Conception',
    text: 'Design, développement, rédaction, visuels : nous produisons, vous validez à chaque étape clé.',
  },
  {
    marker: '04',
    title: 'Mise en ligne',
    text: 'Déploiement, vérifications techniques, référencement de départ et contrôle sur tous les écrans.',
  },
  {
    marker: '05',
    title: 'Transfert & suivi',
    text: 'Formation de vos équipes, documentation, puis maintenance et conseil pour que les résultats durent.',
  },
];

export default function AboutPage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Qui sommes-nous', path: '/qui-sommes-nous/' },
          ]),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Qui sommes-nous' }]}
        eyebrow="Qui sommes-nous"
        title="Une équipe comorienne, des standards internationaux"
        lead="MORA Shawiri est née d’une conviction : les organisations des Comores méritent des outils numériques du même niveau que les meilleures agences internationales — conçus ici, pour votre réalité."
      />

      <section className="section" aria-labelledby="fondateur-title">
        <div className="container">
          <div className="founder">
            <div className="founder__frame reveal">
              <span className="founder__halo" aria-hidden="true" />
              <div className="founder__photo">
                <Image
                  src="/images/fondateur.webp"
                  alt="MOHAMED Rachade, fondateur et dirigeant de MORA Shawiri, en costume, bras croisés"
                  width={1240}
                  height={1250}
                  priority
                  sizes="(max-width: 1024px) 100vw, 40vw"
                />
              </div>
              <div className="founder__caption">
                <strong>MOHAMED Rachade</strong>
                <span>Fondateur &amp; DG de MORA Shawiri</span>
              </div>
            </div>

            <div className="split__body reveal">
              <p className="eyebrow">Le mot du fondateur</p>
              <h2 id="fondateur-title">
                « Le numérique ne doit pas être un privilège réservé aux grandes structures. »
              </h2>
              <p className="founder__quote">
                Trop d’entrepreneurs talentueux restent invisibles faute d’outils. Notre rôle est de
                leur donner les mêmes armes que les grandes entreprises : un site crédible, une
                identité forte, des données organisées et les compétences pour s’en servir.
              </p>
              <p>
                MORA Shawiri accompagne les entrepreneurs, PME, institutions, écoles, cabinets et
                associations dans la construction de leur présence numérique. Nous couvrons
                l’ensemble de la chaîne — stratégie, design, développement, contenus, données,
                formation — avec un seul interlocuteur et une seule exigence : votre performance.
              </p>
              <p>
                Basés à Moroni, nous intervenons sur les trois îles de l’Union des Comores et
                accompagnons à distance des clients dans tout le monde francophone.
              </p>
              <p className="founder__signature">Le Choix Optimal pour votre performance</p>
              <div className="btn-row" style={{ marginTop: 32 }}>
                <Link className="btn btn--primary" href="/contact/">
                  Discuter de votre projet <ArrowRight />
                </Link>
                <Link className="btn btn--ghost" href="/services/">
                  Voir nos services
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="mission-title">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow">Notre mission</p>
              <h2 id="mission-title">
                Rendre la performance numérique accessible à chaque organisation
              </h2>
              <p className="lead">
                Entrepreneurs, PME, administrations, collectivités, associations, écoles, cabinets
                médicaux et professionnels indépendants : chacun de nos clients a une ambition. Notre
                métier est de la transformer en présence numérique qui produit des résultats
                concrets.
              </p>
              <CheckList
                items={[
                  <span key="1">
                    <strong>Comprendre avant de produire</strong> — chaque projet démarre par un
                    diagnostic, pas par un modèle.
                  </span>,
                  <span key="2">
                    <strong>Livrer utilisable</strong> — un outil que vous savez faire vivre vaut
                    mieux qu’un outil parfait que vous n’osez pas toucher.
                  </span>,
                  <span key="3">
                    <strong>Rester disponible</strong> — votre activité évolue, votre outil doit
                    suivre.
                  </span>,
                ]}
              />
            </div>
            <div className="split__media reveal">
              <figure className="portrait-panel">
                <Image
                  src="/images/section-mission.webp"
                  alt="Entrepreneur accompagné par MORA Shawiri dans sa transformation numérique"
                  width={1023}
                  height={1537}
                  sizes="(max-width: 767px) 100vw, 45vw"
                  loading="lazy"
                />
              </figure>
            </div>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="valeurs-title">
        <div className="container">
          <SectionHead
            eyebrow="Nos valeurs"
            title="Ce qui guide chacune de nos décisions"
            titleId="valeurs-title"
            center
          />
          <div className="grid grid--3 reveal-group">
            {values.map((value) => (
              <article className="card card--accent" key={value.num}>
                <p className="card__num">{value.num}</p>
                <h3>{value.title}</h3>
                <p>{value.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--brand" aria-labelledby="parcours-title">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow eyebrow--light">Notre manière de travailler</p>
              <h2 id="parcours-title">Cinq étapes, de l’idée à l’autonomie</h2>
              <p className="lead">
                Une méthode identique sur chaque projet : c’est ce qui rend les délais tenables et
                les résultats reproductibles.
              </p>
              <div className="btn-row" style={{ marginTop: 32 }}>
                <Link className="btn btn--gold" href="/contact/">
                  Commencer par le diagnostic gratuit <ArrowRight />
                </Link>
              </div>
            </div>
            <Timeline items={journey} light />
          </div>
        </div>
      </section>

      <Testimonials
        eyebrow="Ils témoignent"
        title="La parole à nos clients"
        titleId="temoignages-about"
      />

      <CtaBand
        title="Faisons connaissance"
        text="Racontez-nous votre projet lors d’un premier échange gratuit, à Moroni ou en visioconférence."
        primaryLabel="Demander un devis gratuit"
        whatsappMessage="Bonjour MORA Shawiri, j’aimerais en savoir plus sur votre accompagnement."
      />
    </>
  );
}
