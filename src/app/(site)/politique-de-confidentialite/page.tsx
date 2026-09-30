import LegalArticle from '@/components/sections/LegalArticle';
import { findLegalDocument } from '@/content/legal';
import { pageMetadata } from '@/lib/seo';

const doc = findLegalDocument('politique-de-confidentialite')!;

export const metadata = pageMetadata({
  title: doc.metaTitle,
  description: doc.description,
  path: '/politique-de-confidentialite/',
});

export default function PolitiqueDeConfidentialitePage() {
  return <LegalArticle doc={doc} />;
}
