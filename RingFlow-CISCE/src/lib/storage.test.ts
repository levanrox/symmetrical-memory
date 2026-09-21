/**
 * Unit tests for storage key handling (src/lib/storage.ts).
 *
 * The strict key format is the path-traversal defence: only keys generated
 * by categoryDocKey() are ever valid.
 */

import { describe, expect, it } from "vitest";
import { categoryDocKey, validateStorageKey, storageBackend } from "./storage";

const T = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const C = "11111111-2222-3333-4444-555555555555";

describe("categoryDocKey", () => {
  it("builds the canonical key", () => {
    expect(categoryDocKey(T, C)).toBe(`category-docs/${T}/${C}.pdf`);
  });

  it("throws on non-uuid-ish ids", () => {
    expect(() => categoryDocKey("../escape", C)).toThrow();
    expect(() => categoryDocKey(T, "a/b")).toThrow();
    expect(() => categoryDocKey("", C)).toThrow();
  });
});

describe("validateStorageKey", () => {
  it("accepts keys built by categoryDocKey", () => {
    const key = categoryDocKey(T, C);
    expect(validateStorageKey(key)).toBe(key);
  });

  it("rejects path traversal", () => {
    expect(validateStorageKey(`category-docs/${T}/../secret.pdf`)).toBeNull();
    expect(validateStorageKey(`category-docs/../../etc/passwd.pdf`)).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(validateStorageKey(`/etc/category-docs/${T}/${C}.pdf`)).toBeNull();
  });

  it("rejects wrong extensions and wrong prefixes", () => {
    expect(validateStorageKey(`category-docs/${T}/${C}.exe`)).toBeNull();
    expect(validateStorageKey(`category-docs/${T}/${C}`)).toBeNull();
    expect(validateStorageKey(`other-docs/${T}/${C}.pdf`)).toBeNull();
  });

  it("rejects empty and malformed keys", () => {
    expect(validateStorageKey("")).toBeNull();
    expect(validateStorageKey(`category-docs/${T}.pdf`)).toBeNull();
    expect(validateStorageKey(`category-docs/${T}/${C}/extra.pdf`)).toBeNull();
  });
});

describe("storageBackend", () => {
  it("defaults to local", () => {
    const prev = process.env.FILE_STORAGE_BACKEND;
    delete process.env.FILE_STORAGE_BACKEND;
    expect(storageBackend()).toBe("local");
    if (prev !== undefined) process.env.FILE_STORAGE_BACKEND = prev;
  });

  it("honours the supabase opt-in", () => {
    const prev = process.env.FILE_STORAGE_BACKEND;
    process.env.FILE_STORAGE_BACKEND = "supabase";
    expect(storageBackend()).toBe("supabase");
    if (prev === undefined) delete process.env.FILE_STORAGE_BACKEND;
    else process.env.FILE_STORAGE_BACKEND = prev;
  });
});
