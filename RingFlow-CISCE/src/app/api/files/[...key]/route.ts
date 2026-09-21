import { getFile } from "@/lib/storage";

/**
 * Serves files stored by the local storage backend (see src/lib/storage.ts).
 * Keys are strictly validated — only category-docs/<uuid>/<uuid>.pdf is
 * reachable, so directory traversal is impossible.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const key = (await params).key.join("/");
  const bytes = await getFile(key);
  if (!bytes) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      // Documents change when re-uploaded; the DB row is the source of truth
      // and clients always re-read it, so disable caching.
      "Cache-Control": "no-store",
    },
  });
}
