import type { Metadata } from 'next';
import Link from 'next/link';

import { SpaceCard } from '@/components/affiliation/SpaceUi';
import ClientProfileForm from '@/components/client/ClientProfileForm';
import { AUTH_ROUTES } from '@/lib/auth/routes';
import { updateMyClientProfile } from '@/lib/client/actions';
import { CONTACT_PREFERENCE_LABELS } from '@/lib/client/profile';
import { getMyClientSpace } from '@/lib/client/space';
import { formatClientDate } from '@/lib/client/labels';

export const metadata: Metadata = {
  title: 'Mon profil',
  robots: { index: false, follow: false },
};

/**
 * Profil client (phase 4I-1).
 *
 * Modifiables par le client : nom, téléphone, WhatsApp, préférence de
 * contact — par `update_my_client_profile`, journalisée. En lecture seule :
 * la référence client (définitive) et l'adresse e-mail de connexion (seule
 * source de vérité, non modifiable en 4I).
 */
export default async function ProfilClientPage() {
  const space = await getMyClientSpace();
  if (space.state !== 'ready') return null;
  const { client, context } = space;

  return (
    <>
      <SpaceCard title="Mon compte" intro="Ces informations identifient votre compte auprès de MORA Shawiri.">
        <dl className="auth-meta">
          <div>
            <dt>Référence client</dt>
            <dd>
              <code>{client.reference}</code>
            </dd>
          </div>
          <div>
            <dt>Adresse e-mail de connexion</dt>
            <dd>{context.email ?? '—'}</dd>
          </div>
          <div>
            <dt>Client depuis le</dt>
            <dd>{formatClientDate(client.created_at)}</dd>
          </div>
          <div>
            <dt>Préférence de contact</dt>
            <dd>{client.contact_preference ? CONTACT_PREFERENCE_LABELS[client.contact_preference] : 'Pas de préférence'}</dd>
          </div>
        </dl>
      </SpaceCard>

      <SpaceCard title="Mes coordonnées" intro="Elles permettent à MORA Shawiri de vous joindre au sujet de vos commandes, devis et rendez-vous.">
        <ClientProfileForm
          action={updateMyClientProfile}
          initial={{
            nom: context.profile.full_name ?? '',
            telephone: context.profile.phone ?? '',
            whatsapp: client.whatsapp ?? '',
            preference: client.contact_preference ?? '',
          }}
        />
      </SpaceCard>

      <SpaceCard title="Sécurité" intro="Votre mot de passe est le seul élément qui protège votre compte. Choisissez-en un que vous n’utilisez nulle part ailleurs.">
        <div className="btn-row">
          <Link className="btn btn--ghost" href={AUTH_ROUTES.changePassword}>
            Changer mon mot de passe
          </Link>
          {context.isAdmin ? (
            <Link className="btn btn--ghost" href={AUTH_ROUTES.adminArea}>
              Administration
            </Link>
          ) : null}
        </div>
      </SpaceCard>
    </>
  );
}
