/**
 * File storage abstraction for tournament/category documents.
 *
 * The app previously uploaded PDFs to hosted Supabase Storage, which requires
 * internet — a contradiction for an offline LAN event server. Two backends:
 *
 *   local    (default) — files live under FILE_STORAGE_DIR (default
 *             ./data/uploads, mounted as a Docker volume) and are served by
 *             /api/files/[...key]. Works fully offline.
 *   supabase           — the previous hosted-Storage behaviour, kept for
 *             deployments that already use it. Opt in with
 *             FILE_STORAGE_BACKEND=supabase.
 *
 * Keys are derived from tournament/category ids only — strict validation
 * rejects anything that isn't `category-docs/<uuid>/<uuid>.pdf`, so path
 * traversal is impossible by construction.
 *
 * Server-only: imports node:fs / node:path.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type StorageBackend = "local" | "supabase";

export function storageBackend(): StorageBackend {
  return process.env.FILE_STORAGE_BACKEND === "supabase" ? "supabase" : "local";
}

function storageDir(): string {
  return process.env.FILE_STORAGE_DIR || path.join(process.cwd(), "data", "uploads");
}

const UUID = /^[A-Za-z0-9-]+$/;

/** Build the storage key for a category document. Throws on invalid ids. */
export function categoryDocKey(tournamentId: string, categoryId: string): string {
  if (!UUID.test(tournamentId) || !UUID.test(categoryId)) {
    throw new Error("Invalid tournament or category id for storage key");
  }
  return `category-docs/${tournamentId}/${categoryId}.pdf`;
}

/** Validate a raw key coming back off a URL/request path. Returns null when invalid. */
export function validateStorageKey(key: string): string | null {
  if (!/^category-docs\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.pdf$/.test(key)) return null;
  return key;
}

function localPath(key: string): string {
  const full = path.resolve(storageDir(), key);
  const dir = path.resolve(storageDir());
  if (full !== dir && !full.startsWith(dir + path.sep)) {
    throw new Error("Storage key escapes the storage directory");
  }
  return full;
}

/** Store bytes under `key`. Returns the public URL path to serve it from. */
export async function putFile(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  if (storageBackend() === "supabase") {
    const { putSupabaseFile } = await import("@/lib/storageSupabase");
    return putSupabaseFile(key, bytes, contentType);
  }
  const full = localPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return `/api/files/${key}`;
}

/** Read bytes for `key` (local backend). Returns null when missing. */
export async function getFile(key: string): Promise<Buffer | null> {
  const valid = validateStorageKey(key);
  if (!valid) return null;
  if (storageBackend() === "supabase") return null; // served by Supabase directly
  try {
    return await fs.readFile(localPath(valid));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

/** Delete `key`, ignoring "not found". */
export async function deleteFile(key: string): Promise<void> {
  const valid = validateStorageKey(key);
  if (!valid) return;
  if (storageBackend() === "supabase") {
    const { deleteSupabaseFile } = await import("@/lib/storageSupabase");
    await deleteSupabaseFile(valid);
    return;
  }
  try {
    await fs.unlink(localPath(valid));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
  }
}
