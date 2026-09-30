import ModuleAVenir from '@/components/admin/ModuleAVenir';
import { requireModule } from '@/lib/rbac/guards';

/**
 * Module « Notifications » — place tenue, contenu à venir.
 *
 * Le garde est réel et définitif : `requireModule` exige la session, le rôle,
 * le second facteur **et** la permission déclarée au registre. Seul le contenu
 * reste à écrire ; le contrôle d'accès, lui, ne sera pas repris.
 */
export default async function Page() {
  const { module } = await requireModule('notifications');
  return <ModuleAVenir module={module} />;
}
