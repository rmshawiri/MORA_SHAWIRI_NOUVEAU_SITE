import { NextResponse } from 'next/server';

import { getQuotePreviewPdf } from '@/lib/documents/commercial-documents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aperçu d'un brouillon de devis — corrections post-4I.
 *
 * Pas une pièce officielle : sans numéro, marqué « aperçu » sur chaque page,
 * jamais archivé, jamais journalisé comme document. La base décide qui le lit
 * (`quotes.view`) ; tout refus répond comme une adresse inexistante.
 */
export async function GET(request: Request, context: { params: Promise<{ quoteId: string }> }): Promise<NextResponse> {
  const { quoteId } = await context.params;
  const preview = await getQuotePreviewPdf(quoteId);
  if (!preview) {
    return new NextResponse('Document introuvable.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const inline = new URL(request.url).searchParams.get('affichage') === '1';
  return new NextResponse(preview.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${preview.fileName}"`,
      'Content-Length': String(preview.bytes.byteLength),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
