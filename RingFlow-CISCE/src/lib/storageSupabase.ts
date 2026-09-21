/**
 * Hosted Supabase Storage backend for category documents.
 *
 * Only used when FILE_STORAGE_BACKEND=supabase. The default ("local") keeps
 * everything on the event server so tournaments run fully offline.
 *
 * The bucket must exist and be public: `category-docs`.
 *
 * Server-only.
 */

import { createClient } from "@/utils/supabase/server";

const BUCKET = "category-docs";

/** Upload bytes under `key`; returns the public URL. */
export async function putSupabaseFile(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

/** Delete `key`, ignoring "not found". */
export async function deleteSupabaseFile(key: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(BUCKET).remove([key]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}
