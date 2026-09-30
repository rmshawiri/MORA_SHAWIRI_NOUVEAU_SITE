import Link from 'next/link';
import CommissionCalculator from '@/components/interactive/CommissionCalculator';
import CheckList from '@/components/sections/CheckList';
import CtaBand from '@/components/sections/CtaBand';
import Faq from '@/components/sections/Faq';
import PageHero from '@/components/sections/PageHero';
import SectionHead from '@/components/sections/SectionHead';
import Steps from '@/components/sections/Steps';
import JsonLd from '@/components/seo/JsonLd';
import { ArrowRight, Handshake, UsersGroup } from '@/components/ui/Icon';
import { breadcrumbSchema, faqSchema, jsonLdGraph, pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata({
  title: 'Affiliation — Recommandez MORA Shawiri, recevez une commission',
  description:
    'Programme d’affiliation MORA Shawiri : 10 à 15 % de commission sur chaque projet signé grâce à votre recommandation. Inscription gratuite, sans quota ni obligation de résultat.',
  path: '/affiliation/',
});

const howItWorks = [
  {
    title: 'Inscrivez-vous gratuitement',
    text: 'Envoyez-nous un message en précisant « Affiliation ». Vous recevez votre code partenaire personnel sous 48 h.',
  },
  {
    title: 'Recommandez',
    text: 'Mettez-nous en relation avec votre contact, ou transmettez-lui simplement votre code. Nous prenons le relais.',
  },
  {
    title: 'Recevez votre commission',
    text: 'Dès que le projet est signé et le premier règlement encaissé, votre commission est versée par mobile money ou virement.',
  },
];

const commissionTiers = [
  {
    badge: 'Commission',
    badgeClass: 'badge',
    rate: '10 %',
    title: 'Projets web',
    text: 'Sites vitrines, boutiques en ligne, applications sur mesure.',
    highlighted: false,
  },
  {
    badge: 'Taux le plus courant',
    badgeClass: 'badge badge--gold',
    rate: '12 %',
    title: 'Formules d’accompagnement',
    text: 'Accompagnements complets : web, identité visuelle, marketing, organisation.',
    highlighted: true,
  },
  {
    badge: 'Commission',
    badgeClass: 'badge',
    rate: '15 %',
    title: 'Formations & visuels',
    text: 'Formations professionnelles, packs visuels, templates et prestations ponctuelles.',
    highlighted: false,
  },
];

const examples = [
  {
    title: 'Exemple 1 — Site vitrine',
    amount: '450 000 KMF',
    rate: '10 %',
    commission: '45 000 KMF',
    hint: 'Vous recommandez une PME qui commande un site vitrine professionnel.',
  },
  {
    title: 'Exemple 2 — Accompagnement global',
    amount: '1 200 000 KMF',
    rate: '12 %',
    commission: '144 000 KMF',
    hint: 'Une école vous suit et signe une formule Croissance : site, identité visuelle et référencement.',
  },
  {
    title: 'Exemple 3 — Formation & visuels',
    amount: '250 000 KMF',
    rate: '15 %',
    commission: '37 500 KMF',
    hint: 'Un vendeur marketplace commande la formation prospection et un pack visuels produits.',
  },
];

const affiliationFaq = [
  {
    question: 'Qui peut devenir affilié ?',
    answer:
      'Toute personne majeure : entrepreneur, salarié, étudiant, consultant, membre d’association. Si vous côtoyez des organisations qui ont besoin du numérique, le programme est fait pour vous.',
  },
  {
    question: 'Quand ma commission est-elle versée ?',
    answer:
      'Dès que le client signe le devis et règle son premier acompte. Vous n’attendez pas la fin du projet pour être payé.',
  },
  {
    question: 'Que se passe-t-il si mon contact ne signe pas tout de suite ?',
    answer:
      'Votre recommandation reste attachée à votre code partenaire pendant 12 mois. Si le contact signe dans ce délai, la commission vous revient.',
  },
  {
    question: 'Puis-je recommander plusieurs clients ?',
    answer:
      'Oui, sans limite. Chaque projet signé génère sa propre commission, ce qui permet de construire un revenu complémentaire régulier.',
  },
  {
    question: 'Sur quel montant le pourcentage est-il calculé ?',
    answer:
      'Sur le montant hors taxes du projet effectivement signé, hors frais avancés pour votre compte (nom de domaine, hébergement, licences tierces).',
  },
];

export default function AffiliationPage() {
  return (
    <>
      <JsonLd
        data={jsonLdGraph([
          breadcrumbSchema([
            { label: 'Accueil', path: '/' },
            { label: 'Affiliation', path: '/affiliation/' },
          ]),
          faqSchema(affiliationFaq),
        ])}
      />

      <PageHero
        breadcrumb={[{ label: 'Accueil', href: '/' }, { label: 'Affiliation' }]}
        eyebrow="Programme d’affiliation"
        title="Votre réseau a de la valeur. Faites-le fructifier."
        lead="Vous connaissez une entreprise, une école ou une association qui a besoin d’un site web ou d’un accompagnement numérique ? Recommandez MORA Shawiri et recevez une commission sur chaque projet signé."
      />

      <section className="section" aria-labelledby="fonctionnement-title">
        <div className="container">
          <SectionHead
            eyebrow="Comment ça marche"
            title="Trois étapes, zéro paperasse"
            titleId="fonctionnement-title"
            center
          />
          <Steps items={howItWorks} style={{ maxWidth: 1000, marginInline: 'auto' }} />
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="commissions-title">
        <div className="container">
          <SectionHead
            eyebrow="Vos gains"
            title="Des commissions claires, versées rapidement"
            titleId="commissions-title"
            lead="Le pourcentage s’applique au montant hors taxes du projet signé grâce à votre recommandation."
            center
          />
          <div className="grid grid--3 reveal-group">
            {commissionTiers.map((tier) => (
              <article
                className="card card--accent"
                key={tier.title}
                style={tier.highlighted ? { borderColor: 'var(--shawiri-gold)' } : undefined}
              >
                <span className={tier.badgeClass}>{tier.badge}</span>
                <p
                  className="offer__price"
                  style={{ fontSize: '2.5rem', lineHeight: 1, fontWeight: 800 }}
                >
                  {tier.rate}
                </p>
                <h3>{tier.title}</h3>
                <p>{tier.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="simulateur-title">
        <div className="container">
          <SectionHead
            eyebrow="Simulateur"
            title={'Combien pouvez-vous gagner ?'}
            titleId="simulateur-title"
            lead="Ajustez le montant du projet et le type de prestation pour estimer votre commission."
            center
          />

          <CommissionCalculator />

          <div className="grid grid--3 reveal-group" style={{ marginTop: 40 }}>
            {examples.map((example) => (
              <div className="calc__example" key={example.title}>
                <h3>{example.title}</h3>
                <dl>
                  <div>
                    <dt>Montant du projet signé</dt>
                    <dd>{example.amount}</dd>
                  </div>
                  <div>
                    <dt>Taux applicable</dt>
                    <dd>{example.rate}</dd>
                  </div>
                  <div className="total">
                    <dt>Votre commission</dt>
                    <dd>{example.commission}</dd>
                  </div>
                </dl>
                <p className="field__hint">{example.hint}</p>
              </div>
            ))}
          </div>

          <div
            className="card card--brand reveal"
            style={{
              marginTop: 32,
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 24,
            }}
          >
            <div style={{ maxWidth: '62ch' }}>
              <h3>Trois recommandations sur un trimestre</h3>
              <p>
                En cumulant les trois exemples ci-dessus, votre revenu complémentaire atteint{' '}
                <strong style={{ color: 'var(--shawiri-gold)' }}>226 500 KMF</strong>, sans avoir
                produit une seule ligne de travail technique. Vous avez simplement fait une mise en
                relation utile.
              </p>
            </div>
            <Link className="btn btn--gold" href="/contact/">
              Devenir partenaire <ArrowRight />
            </Link>
          </div>

          <p className="form__note" style={{ marginTop: 24, textAlign: 'center' }}>
            Les montants ci-dessus sont des exemples de calcul destinés à illustrer le mécanisme des
            commissions. Ils ne constituent pas une grille tarifaire : toutes nos prestations sont
            chiffrées sur devis.
          </p>
        </div>
      </section>

      <section className="section section--brand" aria-labelledby="pourquoi-affil">
        <div className="container">
          <div className="split">
            <div className="split__body reveal">
              <p className="eyebrow eyebrow--light">Pourquoi rejoindre le programme</p>
              <h2 id="pourquoi-affil">Un partenariat gagnant pour vous et pour votre réseau</h2>
              <CheckList
                light
                items={[
                  <span key="1">
                    <strong>Aucun investissement</strong> — inscription gratuite, sans quota ni
                    obligation de résultat.
                  </span>,
                  <span key="2">
                    <strong>Aucune compétence technique requise</strong> — vous présentez, nous
                    gérons le devis, la production et le suivi.
                  </span>,
                  <span key="3">
                    <strong>Un contact rendu service</strong> — vous orientez votre réseau vers un
                    prestataire qui livre et forme.
                  </span>,
                  <span key="4">
                    <strong>Suivi transparent</strong> — vous êtes informé de l’avancement des
                    dossiers que vous avez apportés.
                  </span>,
                ]}
              />
            </div>
            <div className="proof-grid reveal" style={{ gridTemplateColumns: '1fr' }}>
              <article className="proof">
                <Handshake />
                <h3>Idéal pour les consultants</h3>
                <p>
                  Complétez votre offre sans recruter : vous conseillez, nous exécutons la partie
                  numérique.
                </p>
              </article>
              <article className="proof">
                <UsersGroup />
                <h3>Idéal pour les réseaux associatifs</h3>
                <p>
                  Financez vos activités en orientant vos membres vers des outils dont ils ont
                  besoin.
                </p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--alt" aria-labelledby="faq-title">
        <div className="container">
          <SectionHead
            eyebrow="FAQ affiliation"
            title="Tout ce que les partenaires nous demandent"
            titleId="faq-title"
            center
          />
          <Faq items={affiliationFaq} />
        </div>
      </section>

      <CtaBand
        title="Devenez partenaire dès aujourd’hui"
        text="Inscription gratuite en deux minutes : envoyez-nous un message en mentionnant « Affiliation »."
        primaryLabel="M’inscrire au programme"
        whatsappMessage="Bonjour MORA Shawiri, je souhaite rejoindre le programme d’affiliation."
      />
    </>
  );
}
