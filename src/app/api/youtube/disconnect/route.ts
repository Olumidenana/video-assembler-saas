import { NextResponse } from "next/server";
import { getViewer } from "@/lib/billing/account";
import { deleteConnection } from "@/lib/social/youtube";

/** Forgets the connected channel and revokes the permission on Google's side. */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer.user) return NextResponse.json({ error: "sign_in" }, { status: 401 });
  await deleteConnection(viewer.user.id);
  return NextResponse.json({ ok: true });
}
