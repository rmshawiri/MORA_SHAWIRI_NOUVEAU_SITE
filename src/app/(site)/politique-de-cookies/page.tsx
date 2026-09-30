import LegalArticle from '@/components/sections/LegalArticle';
import { findLegalDocument } from '@/content/legal';
import { pageMetadata } from '@/lib/seo';

const doc = findLegalDocument('politique-de-cookies')!;

export const metadata = pageMetadata({
  title: doc.metaTitle,
  description: doc.description,
  path: '/politique-de-cookies/',
});

export default function PolitiqueDeCookiesPage() {
  return <LegalArticle doc={doc} />;
}
