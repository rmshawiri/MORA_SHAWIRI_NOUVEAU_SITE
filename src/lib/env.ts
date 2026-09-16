/**
 * Lecture centralisée et validée des variables d'environnement.
 *
 * Règle du projet (`07_ARCHITECTURE_TECHNIQUE/06_VARIABLES_ENVIRONNEMENT.md`) :
 * aucune valeur secrète n'est écrite dans le code, et aucune variable privée
 * n'est importée depuis un composant client. Ce module est uniquement consommé
 * côté serveur, à l'exception de `siteUrl` qui repose sur une variable
 * `NEXT_PUBLIC_*` explicitement publique.
 */

const FALLBACK_SITE_URL = 'https://mora-shawiri-nouveau-site.vercel.app';

function readOptional(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * URL publique de production. Configurable pour permettre le changement de
 * domaine sans toucher au code (cf. § 110 du document des variables).
 */
export function getSiteUrl(): string {
  const raw = readOptional('NEXT_PUBLIC_SITE_URL') ?? FALLBACK_SITE_URL;
  try {
    // Normalise : pas de slash final, protocole obligatoire.
    return new URL(raw).origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  fromName: string;
  to: string;
};

/**
 * Configuration SMTP serveur. Renvoie `null` — sans jamais lever ni journaliser
 * de valeur — lorsque la configuration est incomplète : l'application reste
 * fonctionnelle, seule la notification e-mail est désactivée.
 */
export function getSmtpConfig(): SmtpConfig | null {
  const host = readOptional('SMTP_HOST');
  const user = readOptional('SMTP_USER');
  const password = readOptional('SMTP_PASSWORD');
  const portRaw = readOptional('SMTP_PORT');

  if (!host || !user || !password) return null;

  const port = Number.parseInt(portRaw ?? '465', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  const from = readOptional('SMTP_FROM') ?? user;

  return {
    host,
    port,
    secure: port === 465,
    user,
    password,
    from,
    fromName: readOptional('SMTP_FROM_NAME') ?? 'MORA Shawiri',
    to: readOptional('CONTACT_EMAIL') ?? from,
  };
}
