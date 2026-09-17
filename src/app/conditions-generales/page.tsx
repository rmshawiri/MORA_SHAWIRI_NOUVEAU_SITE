import LegalArticle from '@/components/sections/LegalArticle';
import { findLegalDocument } from '@/content/legal';
import { pageMetadata } from '@/lib/seo';

const doc = findLegalDocument('conditions-generales')!;

export const metadata = pageMetadata({
  title: doc.metaTitle,
  description: doc.description,
  path: '/conditions-generales/',
});

export default function ConditionsGeneralesPage() {
  return <LegalArticle doc={doc} />;
}
