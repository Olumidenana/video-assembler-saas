import { NextResponse, type NextRequest } from "next/server";

/**
 * A video shared into the installed app before its service worker was ready
 * (the worker normally takes these): the file can't be kept server-side, so
 * open the editor and ask to add it there.
 */
export function POST(request: NextRequest) {
  return NextResponse.redirect(new URL("/editor?shared=0", request.nextUrl.origin), 303);
}
