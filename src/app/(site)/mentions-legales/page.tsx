import LegalArticle from '@/components/sections/LegalArticle';
import { findLegalDocument } from '@/content/legal';
import { pageMetadata } from '@/lib/seo';

const doc = findLegalDocument('mentions-legales')!;

export const metadata = pageMetadata({
  title: doc.metaTitle,
  description: doc.description,
  path: '/mentions-legales/',
});

export default function MentionsLegalesPage() {
  return <LegalArticle doc={doc} />;
}
