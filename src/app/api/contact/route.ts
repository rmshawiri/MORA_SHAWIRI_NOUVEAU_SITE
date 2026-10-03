import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { getSmtpConfig } from '@/lib/env';
import {
  formatReceivedAt,
  renderConfirmationEmail,
  renderTeamEmail,
  type MailRequest,
  type MailRow,
} from '@/lib/emails/templates';
import { attachReferral } from '@/lib/affiliation/attach';
import { getPublicCatalogue } from '@/lib/catalogue/public';
import { parseQuantity } from '@/lib/catalogue/quantity';
import { clientKey, rateLimit } from '@/lib/rate-limit';
import {
  persistAppointmentRequest,
  persistQuoteRequest,
  type PersistOutcome,
} from '@/lib/relation/submit';

/**
 * Réception des demandes envoyées depuis le site (devis et rendez-vous).
 *
 * Exécutée exclusivement côté serveur : les identifiants SMTP proviennent des
 * variables d'environnement et ne traversent jamais le navigateur.
 *
 * La réponse de cette route fait foi côté client : aucun message de succès ne
 * doit être affiché sans un `200` (`06_CONTACT.md` § 71-72).
 *
 * ## Phase 4F — deux responsabilités, et l'ordre entre elles
 *
 * La demande est désormais **enregistrée en base** en plus d'être relayée par
 * e-mail. Le point 6 du cadrage demande de trancher le comportement de chaque
 * cas ; voici la règle, et la raison.
 *
 * **La base d'abord, l'e-mail ensuite.** C'est un test explicite du plan de
 * développement : « l'échec d'envoi d'e-mail ne perd plus la demande ».
 * Enregistrer après aurait exactement l'effet inverse.
 *
 * **Une demande enregistrée est une demande reçue.** Donc :
 *
 * | Base | E-mail équipe | Réponse | Pourquoi |
 * |---|---|---|---|
 * | acceptée | envoyé | `200` | le cas normal |
 * | acceptée | échoué | `200` | la demande existe. Afficher une erreur pousserait le visiteur à la renvoyer, et MORA Shawiri la traiterait deux fois |
 * | acceptée | SMTP absent | `200` | idem |
 * | indisponible | envoyé | `200` | comportement d'avant 4F, préservé à l'identique : rien n'est perdu |
 * | indisponible | échoué | `502` | là, rien n'est arrivé. Il faut le dire |
 * | indisponible | SMTP absent | `503` | idem |
 * | refusée (fréquence) | — | `429` | le refus est légitime |
 *
 * Le point 6 met en garde contre « message de succès affiché alors qu'aucune
 * demande n'existe ». La symétrie est tout aussi vraie : afficher un échec
 * alors que la demande existe est le même défaut, et il coûte un doublon.
 *
 * **Le contenu des e-mails est inchangé.** La référence attribuée par la base
 * n'y figure pas : l'ajouter modifierait deux gabarits validés, sans nécessité
 * pour cette phase. Elle vit en administration.
 */

export const runtime = 'nodejs';

/** Longueurs maximales acceptées, pour borner la charge utile. */
const LIMITS = {
  nom: 120,
  organisation: 160,
  email: 160,
  telephone: 40,
  sujet: 120,
  budget: 80,
  offre: 160,
  message: 4000,
} as const;

type Field = keyof typeof LIMITS;

/** L'adresse e-mail est obligatoire : sans elle, aucun accusé de réception. */
const REQUIRED: readonly Field[] = ['nom', 'email', 'sujet', 'message'];

/**
 * Seul le message libre conserve ses retours à la ligne. Partout ailleurs CR et
 * LF sont retirés : `nom` et `sujet` composent l'objet de l'e-mail, et un saut
 * de ligne y ouvrirait la porte à une injection d'en-tête SMTP.
 */
const MULTILINE_FIELDS: readonly Field[] = ['message'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Cinq demandes par tranche de dix minutes et par adresse. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

/** Fenêtre d'idempotence : une demande identique n'est pas renvoyée deux fois. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const recentSubmissions = new Map<string, number>();

/** Nombre maximal de réponses complémentaires acceptées (questionnaire). */
const MAX_DETAILS = 20;
const DETAIL_LABEL_MAX = 80;
const DETAIL_VALUE_MAX = 400;

/**
 * Champs ajoutés par la phase 4F, lus **hors** de la charge utile de l'e-mail.
 *
 * Ils sont volontairement séparés de `LIMITS` : celui-ci compose le message
 * envoyé à l'équipe, et y glisser une clé changerait un gabarit validé. Ces
 * quatre valeurs ne servent qu'à la base — le slug pour relier la demande au
 * catalogue, la date ISO et le créneau pour la rendre exploitable en
 * administration.
 *
 * Le formulaire affiche déjà tout cela. Ce qui change n'est pas ce que le
 * visiteur voit, c'est la forme sous laquelle la valeur arrive : la date
 * longue « lundi 5 octobre 2026 » du récapitulatif n'est pas interrogeable,
 * la même date en ISO l'est.
 */
const PERSIST_LIMITS = {
  offreSlug: 80,
  rdvDateIso: 10,
  rdvCreneau: 80,
  rdvFormat: 80,
} as const;

/** Un slug d'offre du catalogue. Revalidé en base, et ignoré s'il ne l'est pas. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Assainit une valeur reçue du navigateur.
 *
 * Retire les caractères de contrôle, borne la longueur, et — pour les champs
 * qui alimentent un en-tête d'e-mail — retire également CR et LF. Les retours à
 * la ligne restent légitimes dans le message libre : ils y sont conservés.
 */
function sanitize(value: unknown, max: number, { allowNewlines }: { allowNewlines: boolean }): string {
  if (typeof value !== 'string') return '';

  const stripped = allowNewlines
    ? // Contrôles retirés, sauf tabulation, LF et CR.
      value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    : // Contrôles retirés, CR/LF compris : protection contre l'injection d'en-têtes.
      value.replace(/[\x00-\x1f\x7f]/g, ' ');

  return stripped.trim().slice(0, max);
}

/** Lit les réponses complémentaires du questionnaire de rendez-vous. */
function readDetails(raw: unknown): MailRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MailRow[] = [];

  for (const entry of raw.slice(0, MAX_DETAILS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const label = sanitize(record.label, DETAIL_LABEL_MAX, { allowNewlines: false });
    const value = sanitize(record.value, DETAIL_VALUE_MAX, { allowNewlines: false });
    if (label && value) rows.push({ label, value });
  }

  return rows;
}

/**
 * Libellés réservés au serveur. Une offre à prix défini reçoit ses lignes de
 * récapitulatif d'ici, calculées sur le catalogue en base ; une charge utile
 * qui les forgerait les perd.
 */
const PRICED_LABELS = new Set(['Formule', 'Quantité', 'Prix unitaire affiché', 'Montant indicatif']);

const NBSP = String.fromCharCode(0xa0);
const kmf = (value: number) => `${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)}${NBSP}KMF`;

/**
 * Parcours « prix défini » (remarques 01, A6). Le prix n'est jamais lu dans la
 * requête : il est relu dans le catalogue publié. Une offre sans prix, ou
 * inconnue, ne donne rien — la demande reste une demande de devis ordinaire.
 *
 * Remarques 02 : une quantité hors de 1 à 99 n'est plus ramenée à 1 en
 * silence. La demande est refusée, avant tout enregistrement.
 */
async function pricedSummary(offerSlug: string, rawQuantity: unknown): Promise<MailRow[] | null | 'invalid_quantity'> {
  if (!offerSlug) return null;
  const { offers } = await getPublicCatalogue();
  const offer = offers.find((entry) => entry.id === offerSlug);
  if (!offer?.priceAmount) return null;
  const quantity = parseQuantity(rawQuantity);
  if (quantity === null) return 'invalid_quantity';
  return [
    { label: 'Formule', value: 'Offre à prix défini' },
    { label: 'Quantité', value: String(quantity) },
    { label: 'Prix unitaire affiché', value: `${offer.price}${offer.priceNote ? ` (${offer.priceNote})` : ''}` },
    { label: 'Montant indicatif', value: kmf(offer.priceAmount * quantity) },
  ];
}

/** Empreinte d'une demande, utilisée pour l'idempotence. Aucune donnée en clair. */
function fingerprint(key: string, fields: Record<Field, string>): string {
  return createHash('sha256')
    .update([key, fields.email, fields.sujet, fields.message].join('\x00'))
    .digest('hex');
}

/** Purge les empreintes sorties de la fenêtre d'idempotence. */
function sweepDedupe(now: number): void {
  for (const [hash, time] of recentSubmissions) {
    if (now - time >= DEDUPE_WINDOW_MS) recentSubmissions.delete(hash);
  }
}

/** Lit un champ de persistance, borné et débarrassé de ses caractères de contrôle. */
function readPersistField(raw: Record<string, unknown>, field: keyof typeof PERSIST_LIMITS): string {
  return sanitize(raw[field], PERSIST_LIMITS[field], { allowNewlines: false });
}

/**
 * Origine de la demande (§ 117 de la prise de rendez-vous).
 *
 * Trois valeurs seulement, et toutes trois constatées : un slug d'offre ne
 * peut venir que d'une carte de la Boutique ou de la page Services, le reste
 * vient du formulaire lui-même. Aucune attribution n'est devinée — c'est aussi
 * ce qui distingue cette colonne du suivi d'affiliation, hors périmètre.
 */
function originOf(kind: MailRequest['kind'], offerSlug: string, priced = false): string {
  if (offerSlug) return priced ? 'boutique-prix' : 'boutique';
  return kind === 'rendez-vous' ? 'rendez-vous' : 'contact';
}

export async function POST(request: Request) {
  const key = clientKey(request);
  const limit = rateLimit(key, RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const raw = payload as Record<string, unknown>;

  // Pot de miel : champ invisible pour l'utilisateur, rempli par les robots.
  // Réponse volontairement indistinguable d'un succès, pour ne rien apprendre à l'émetteur.
  if (typeof raw.website === 'string' && raw.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const fields = Object.fromEntries(
    (Object.keys(LIMITS) as Field[]).map((field) => [
      field,
      sanitize(raw[field], LIMITS[field], { allowNewlines: MULTILINE_FIELDS.includes(field) }),
    ]),
  ) as Record<Field, string>;

  const missing = REQUIRED.filter((field) => fields[field].length === 0);
  if (missing.length > 0) {
    return NextResponse.json({ ok: false, error: 'missing_fields', fields: missing }, { status: 400 });
  }

  if (!EMAIL_PATTERN.test(fields.email)) {
    return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 });
  }

  const kind: MailRequest['kind'] = raw.kind === 'rendez-vous' ? 'rendez-vous' : 'devis';

  const now = Date.now();
  sweepDedupe(now);
  const hash = fingerprint(key, fields);
  if (recentSubmissions.has(hash)) {
    // Demande déjà traitée : on confirme sans réémettre les e-mails (§ 66-67 des e-mails).
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // ------------------------------------------------------------------ 4F ---
  // La base d'abord. Un échec SMTP ne doit plus perdre la demande.
  const offerSlug = (() => {
    const value = readPersistField(raw, 'offreSlug');
    return SLUG_PATTERN.test(value) ? value : '';
  })();

  // Remarques 01 : récapitulatif d'une offre à prix défini, calculé ici.
  const pricedResult = kind === 'devis' ? await pricedSummary(offerSlug, raw.quantite) : null;
  if (pricedResult === 'invalid_quantity') {
    return NextResponse.json({ ok: false, error: 'invalid_quantity' }, { status: 400 });
  }
  const priced = pricedResult;
  const details = [
    ...readDetails(raw.details).filter((row) => !PRICED_LABELS.has(row.label)),
    ...(priced ?? []),
  ].slice(0, MAX_DETAILS);

  const rdvDateIso = (() => {
    const value = readPersistField(raw, 'rdvDateIso');
    return ISO_DATE_PATTERN.test(value) ? value : '';
  })();

  const source = originOf(kind, offerSlug, Boolean(priced));

  let persisted: PersistOutcome;

  if (kind === 'rendez-vous') {
    persisted = await persistAppointmentRequest(
      {
        nom: fields.nom,
        email: fields.email,
        telephone: fields.telephone,
        organisation: fields.organisation,
        sujet: fields.sujet,
        canal: readPersistField(raw, 'rdvFormat'),
        dateSouhaitee: rdvDateIso,
        creneauSouhaite: readPersistField(raw, 'rdvCreneau'),
        budget: fields.budget,
        message: fields.message,
        offreSlug: offerSlug,
        details,
        source,
      },
      key,
    );
  } else {
    persisted = await persistQuoteRequest(
      {
        nom: fields.nom,
        email: fields.email,
        telephone: fields.telephone,
        organisation: fields.organisation,
        sujet: fields.sujet,
        budget: fields.budget,
        message: fields.message,
        offreSlug: offerSlug,
        offreTitre: fields.offre,
        details,
        source,
      },
      key,
    );
  }

  if (persisted.state === 'rejected') {
    if (persisted.reason === 'rate_limited') {
      return NextResponse.json(
        { ok: false, error: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': '600' } },
      );
    }
    // La base a refusé une charge utile que la validation ci-dessus avait
    // acceptée. C'est un écart entre deux règles, donc un défaut : on le
    // signale sans prétendre que la demande est partie.
    console.error('[contact] la base a refusé la demande');
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const stored = persisted.state === 'stored';

  // Deuxième envoi identique déjà en base : la demande est acquise, et
  // réémettre les e-mails ferait un doublon chez MORA Shawiri.
  if (persisted.state === 'stored' && persisted.duplicate) {
    recentSubmissions.set(hash, now);
    return NextResponse.json({ ok: true, duplicate: true, stored: true });
  }

  // Phase 4H : la demande enregistrée est rattachée au dernier lien
  // d'affiliation suivi par ce visiteur, s'il y en a un. Le cookie ne porte
  // qu'un jeton : la base revérifie fenêtre, statut de l'affilié et
  // auto-affiliation. Un échec ne retire rien à la demande.
  if (persisted.state === 'stored' && persisted.reference && kind === 'devis') {
    await attachReferral(request, persisted.reference);
  }

  const smtp = getSmtpConfig();
  if (!smtp) {
    if (stored) {
      // La demande existe. Le dire est exact, et évite un renvoi.
      recentSubmissions.set(hash, now);
      return NextResponse.json({ ok: true, stored: true, notified: false });
    }
    return NextResponse.json({ ok: false, error: 'mail_disabled' }, { status: 503 });
  }

  const mailRequest: MailRequest = {
    kind,
    nom: fields.nom,
    organisation: fields.organisation,
    email: fields.email,
    telephone: fields.telephone,
    sujet: fields.sujet,
    budget: fields.budget,
    offre: fields.offre,
    message: fields.message,
    details,
    receivedAt: formatReceivedAt(),
  };

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
  });

  const team = renderTeamEmail(mailRequest);

  let notified = true;

  try {
    await transporter.sendMail({
      from: { name: smtp.fromName, address: smtp.from },
      to: smtp.to,
      replyTo: mailRequest.email,
      subject: team.subject,
      text: team.text,
      html: team.html,
    });
  } catch {
    // Aucune valeur de configuration n'est journalisée (§ 71-75 des variables).
    console.error('[contact] échec de la notification à l’équipe');
    notified = false;

    // Avant la phase 4F, cet échec faisait disparaître la demande : il ne
    // restait rien, et `502` était la seule réponse honnête. Elle le reste
    // quand la base est indisponible — mais pas quand la demande y est déjà.
    if (!stored) {
      return NextResponse.json({ ok: false, error: 'send_failed' }, { status: 502 });
    }
  }

  // La demande est arrivée : elle est acquise même si l'accusé de réception échoue.
  recentSubmissions.set(hash, now);

  if (!notified) {
    // Enregistrée, non notifiée. L'accusé de réception au demandeur passerait
    // par le même transport qui vient d'échouer : on ne le tente pas, et on ne
    // prétend pas l'avoir envoyé.
    return NextResponse.json({ ok: true, stored: true, notified: false });
  }

  let confirmationSent = true;
  try {
    const confirmation = renderConfirmationEmail(mailRequest);
    await transporter.sendMail({
      from: { name: smtp.fromName, address: smtp.from },
      to: mailRequest.email,
      replyTo: smtp.to,
      subject: confirmation.subject,
      text: confirmation.text,
      html: confirmation.html,
    });
  } catch {
    confirmationSent = false;
    console.error('[contact] échec de l’accusé de réception au demandeur');
  }

  return NextResponse.json({ ok: true, confirmationSent, stored, notified: true });
}
