import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_ROUTES, NEXT_PARAM, safeInternalPath } from '@/lib/auth/routes';
import { getServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Point d'arrivée des liens envoyés par e-mail.
 *
 * Deux parcours y aboutissent : la confirmation d'adresse après inscription, et
 * la réinitialisation de mot de passe. Dans les deux cas, le lien porte une
 * preuve à usage unique que cette route échange contre une session, avant de
 * conduire la personne là où elle doit aller.
 *
 * ## Deux formes de preuve, et pourquoi les deux sont acceptées
 *
 * **`?code=…`** — le flux PKCE, celui que `@supabase/ssr` utilise par défaut.
 * Le vérificateur est déposé en cookie au moment de la demande ; le lien doit
 * donc être ouvert dans le **même navigateur**. C'est une contrainte réelle :
 * ouvrir le lien sur un autre appareil échoue, et il faut le dire clairement
 * plutôt que d'afficher une erreur technique.
 *
 * **`?token_hash=…&type=…`** — la vérification directe, qui ne dépend d'aucun
 * cookie et fonctionne donc d'un appareil à l'autre. Elle suppose que les
 * gabarits d'e-mail du projet Supabase utilisent `{{ .TokenHash }}`. Ce n'est
 * pas le cas aujourd'hui — les gabarits par défaut n'ont pas été modifiés —,
 * mais la route la reconnaît déjà : le jour où les gabarits seront ajustés,
 * rien ne sera à reprendre ici.
 *
 * ## Ce que cette route ne fait pas
 *
 * Elle n'accorde aucun droit. Elle ouvre une session, exactement comme une
 * connexion par mot de passe, et rien de plus : un administrateur arrivé par
 * un lien de réinitialisation obtient une session `AAL1`, qui ne lui ouvre pas
 * l'administration tant qu'il n'a pas présenté son second facteur. Un lien reçu
 * par e-mail ne contourne donc pas la double authentification.
 *
 * `04_AUTHENTIFICATION.md` § 16-19 (jeton temporaire, à usage unique), § 91
 * (lien de vérification), § 173 (messages sans fuite d'information).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const destination = safeInternalPath(
    searchParams.get(NEXT_PARAM),
    AUTH_ROUTES.clientArea,
  );

  const failure = new URL(AUTH_ROUTES.signIn, origin);
  failure.searchParams.set('lien', 'invalide');

  // Supabase peut refuser le lien avant même de rediriger ici — jeton expiré,
  // déjà servi. Le message affiché reste générique (§ 173).
  if (searchParams.get('error') || searchParams.get('error_code')) {
    return NextResponse.redirect(failure);
  }

  const supabase = await getServerSupabaseClient();
  if (!supabase) return NextResponse.redirect(failure);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failure);

    return NextResponse.redirect(new URL(destination, origin));
  }

  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return NextResponse.redirect(failure);

    return NextResponse.redirect(new URL(destination, origin));
  }

  return NextResponse.redirect(failure);
}

/** Types de lien acceptés. Tout autre type est refusé sans autre examen. */
function isEmailOtpType(
  value: string | null,
): value is 'signup' | 'recovery' | 'invite' | 'email_change' | 'magiclink' | 'email' {
  return (
    value === 'signup' ||
    value === 'recovery' ||
    value === 'invite' ||
    value === 'email_change' ||
    value === 'magiclink' ||
    value === 'email'
  );
}
