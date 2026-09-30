import type { Metadata } from 'next';
import Link from 'next/link';

import AdminPage from '@/components/admin/AdminPage';
import PaymentMethodForm from '@/components/admin/PaymentMethodForm';
import { updatePaymentMethod } from '@/lib/commerce/actions';
import {
  countPaymentsByStatus,
  formatAmount,
  listPaymentMethods,
  listPayments,
  PAYMENT_METHOD_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  sumAmounts,
} from '@/lib/commerce/admin';
import { formatMoment } from '@/lib/relation/labels';
import { requireModule } from '@/lib/rbac/guards';
import type { PaymentStatus } from '@/lib/supabase/types';

export const metadata: Metadata = {
  title: 'Paiements',
  robots: { index: false, follow: false },
};

/**
 * Module « Paiements » — phase 4G.
 *
 * L'écran de travail que la décision D-10 rend nécessaire. Une déclaration de
 * paiement attend qu'une personne la vérifie : c'est le premier tableau, et il
 * est trié pour que les déclarations en attente viennent en tête.
 *
 * ## Vérifier se fait depuis la commande
 *
 * Les boutons « Confirmer » et « Rejeter » ne sont pas ici mais sur la fiche
 * de la commande. Ce n'est pas une omission : on ne confirme pas un paiement
 * en regardant une ligne de tableau, on le confirme après avoir ouvert le
 * dossier, lu le justificatif et comparé le montant. L'écran suit le geste.
 *
 * ## Les moyens de paiement
 *
 * Le second bloc est l'unique endroit où se saisissent les coordonnées. Le
 * § 19 interdit d'en inventer ; la contrepartie est qu'il en faut un, et un
 * seul. Il demande `settings.update`, permission critique — activer un moyen,
 * c'est le proposer à tous les clients.
 */
export default async function PaiementsPage() {
  const context = await requireModule('paiements');
  const payments = await listPayments();
  const counts = countPaymentsByStatus(payments);

  const canConfigure = context.can('settings.view') || context.can('settings.update');
  const methods = canConfigure ? await listPaymentMethods() : [];

  const aVerifier = counts.EN_VERIFICATION + counts.EN_ATTENTE + counts.INITIE;
  const confirme = sumAmounts(
    payments.filter((payment) => payment.status === 'PAYE').map((payment) => payment.amount),
  );

  return (
    <AdminPage
      eyebrow="Activité"
      title="Paiements"
      lead="Les règlements déclarés par les clients et ceux constatés par MORA Shawiri. Une déclaration n’est jamais une confirmation : un paiement ne compte qu’après vérification."
    >
      <section className="admin-card">
        <div className="admin-card__head">
          <h2>Déclarations et règlements</h2>
          <p>
            {payments.length} paiement(s) enregistré(s), dont {aVerifier} à vérifier.{' '}
            {counts.PAYE} confirmé(s), {counts.ECHEC} rejeté(s), {counts.ANNULE} annulé(s),{' '}
            {counts.REMBOURSE + counts.PARTIELLEMENT_REMBOURSE} remboursé(s) en tout ou partie.
            Total confirmé : {formatAmount(confirme)}.
          </p>
        </div>

        {payments.length === 0 ? (
          <div className="admin-empty">
            <p className="admin-empty__title">Aucun paiement enregistré</p>
            <p>
              C’est l’état réel de la base. Les déclarations faites par les clients depuis leur
              espace apparaissent ici, ainsi que les règlements reçus hors ligne et saisis depuis
              une commande.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <caption className="sr-only">
                Paiements, les déclarations à vérifier en tête
              </caption>
              <thead>
                <tr>
                  <th scope="col">Commande</th>
                  <th scope="col">Client</th>
                  <th scope="col">Moyen</th>
                  <th scope="col">Montant</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Déclaré le</th>
                  <th scope="col">Dossier</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <th scope="row">
                      <code>{payment.orders?.reference ?? '—'}</code>
                    </th>
                    <td>{payment.orders?.customer_name ?? '—'}</td>
                    <td>{payment.method_code}</td>
                    <td>{formatAmount(payment.amount, payment.currency)}</td>
                    <td>{statusBadge(payment.status)}</td>
                    <td>{formatMoment(payment.declared_at ?? payment.created_at)}</td>
                    <td>
                      {payment.orders?.reference ? (
                        <Link
                          className="btn btn--ghost"
                          href={`/administration/commandes/${payment.orders.reference}/`}
                        >
                          Ouvrir
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {context.can('payments.verify') ? null : (
          <div className="admin-notice">
            <p>
              Vous consultez les paiements sans pouvoir les vérifier. La permission{' '}
              <code>payments.verify</code> est nécessaire pour confirmer ou rejeter une
              déclaration — c’est une permission critique, accordée compte par compte.
            </p>
          </div>
        )}
      </section>

      {canConfigure ? (
        <section className="admin-card">
          <div className="admin-card__head">
            <h2>Moyens de paiement</h2>
            <p>
              Ce que le client voit au moment de payer. Un moyen désactivé n’apparaît nulle part et
              ne peut pas être utilisé, même par un appel direct. Les coordonnées saisies ici sont
              les seules que le site affiche : aucune n’est écrite dans le code.
            </p>
            <p>
              Aucun secret d’API ne se saisit ici, et n’a pas à y être : le jour où une passerelle
              sera intégrée, sa clé ira dans les variables d’environnement du serveur.
            </p>
          </div>

          {!context.can('settings.update') ? (
            <div className="admin-notice">
              <p>
                Vous consultez la configuration sans pouvoir la modifier. La permission{' '}
                <code>settings.update</code> est nécessaire.
              </p>
            </div>
          ) : null}

          {methods.map((method) => (
            <PaymentMethodForm
              key={method.code}
              action={updatePaymentMethod}
              code={method.code}
              label={`${method.label} — ${PAYMENT_METHOD_KIND_LABELS[method.kind]}`}
              isActive={method.is_active}
              instructions={method.instructions}
              accountNumber={method.account_number}
              accountHolder={method.account_holder}
              requiresProof={method.requires_proof}
              note={METHOD_NOTES[method.code]}
            />
          ))}
        </section>
      ) : null}
    </AdminPage>
  );
}

/**
 * Précisions propres à certains moyens.
 *
 * Elles disent l'état réel plutôt que de laisser croire qu'un moyen est prêt.
 * Wakati n'a pas lancé son service ; les coordonnées bancaires n'ont pas été
 * communiquées ; PayPal attend une décision sur son mode d'intégration. Dans
 * les trois cas, le § 194 demande d'afficher clairement l'indisponibilité.
 */
const METHOD_NOTES: Record<string, string | undefined> = {
  WAKATI:
    'Wakati n’a pas encore lancé son service. Le moyen est préparé mais ne doit être activé que lorsqu’il sera réellement utilisable. Son fonctionnement resterait manuel tant qu’aucune interface officielle n’est intégrée.',
  VIREMENT:
    'Les coordonnées bancaires n’ont pas encore été communiquées. Saisissez-les ici avant d’activer le moyen — rien n’a été inventé à votre place.',
  PAYPAL:
    'Le compte existe, mais aucune intégration automatique n’est en place et aucun document du projet n’en prévoit. Activer ce moyen le ferait fonctionner comme les autres : déclaration du client, puis vérification manuelle dans votre interface PayPal.',
};

function statusBadge(status: PaymentStatus) {
  const className =
    status === 'PAYE'
      ? 'admin-badge--ok'
      : status === 'EN_VERIFICATION'
        ? 'admin-badge--gold'
        : status === 'ECHEC' || status === 'ANNULE'
          ? 'admin-badge--danger'
          : 'admin-badge--muted';

  return <span className={`admin-badge ${className}`}>{PAYMENT_STATUS_LABELS[status]}</span>;
}
