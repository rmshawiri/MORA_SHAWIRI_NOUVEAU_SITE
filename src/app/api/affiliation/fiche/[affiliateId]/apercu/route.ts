import { NextResponse } from 'next/server';

import { getSheetPreviewPdf } from '@/lib/documents/affiliate-documents';
import { recordAuditEvent } from '@/lib/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aperçu actuel d'une fiche affilié — phase 4H-7.
 *
 * Pas une pièce officielle : sans numéro, marqué « aperçu » sur chaque page,
 * jamais archivé. La base décide qui le lit (l'affilié lui-même, ou
 * `affiliates.view`) ; tout refus répond comme une adresse inexistante.
 */
export async function GET(request: Request, context: { params: Promise<{ affiliateId: string }> }): Promise<NextResponse> {
  const { affiliateId } = await context.params;
  const preview = await getSheetPreviewPdf(affiliateId);
  if (!preview) {
    return new NextResponse('Document introuvable.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  await recordAuditEvent({
    action: 'documents.apercu',
    resourceType: 'affiliate',
    resourceId: affiliateId,
    result: 'SUCCES',
    metadata: { type: 'FIAF' },
  });
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
