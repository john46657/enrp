import { NextResponse, type NextRequest } from 'next/server';

/**
 * Läuft vor jeder Seite (nicht für /api und statische Dateien) und gibt den aufgerufenen Pfad an die
 * Seiten weiter, damit nach dem Login dorthin zurückgesprungen wird.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Immer überschreiben: Ein vom Browser mitgeschickter Wert wird so nie übernommen.
  headers.set('x-pathname', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
};
