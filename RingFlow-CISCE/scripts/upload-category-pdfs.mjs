#!/usr/bin/env node

/**
 * Bulk Category PDF Uploader for RingFlow
 *
 * Uploads athlete list PDFs directly to Supabase Storage and updates the database.
 * Completely bypasses Next.js / Vercel body size limits.
 *
 * Features:
 * - Exact & fuzzy name matching identical to the RingFlow web app
 * - Duplicate conflict detection (multiple files mapping to the same category)
 * - Overwrite detection (categories that already have a PDF attached)
 * - Interactive summary and confirmation before any upload
 * - Real-time progress and error handling
 *
 * Usage:
 *   node scripts/upload-category-pdfs.mjs <folder_path> [tournament_id]
 */

// Polyfill WebSocket for Node < 22 environments where Supabase Realtime checks for native WebSocket
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = class DummyWebSocket {
    constructor() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  };
}

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

// ── 1. Load Environment Variables from .env.local / .env ──────────────────────
function loadEnv() {
  const envFiles = [".env.local", ".env"];
  const env = {};

  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key] && !env[key]) {
          env[key] = val;
        }
      }
    }
  }

  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || (!serviceRoleKey && !anonKey)) {
  console.error("\n❌ Missing Supabase credentials in .env.local.");
  console.error("Please ensure NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY are set.\n");
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const askQuestion = (query) => new Promise((resolve) => rl.question(query, resolve));

// ── 2. Matching Helpers (Identical to categoryDocs.ts) ─────────────────────────
function normalize(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\./g, "");
}

function filenameToName(filename) {
  return filename.replace(/\.pdf$/i, "").trim();
}

function findMatch(candidateName, categories) {
  const norm = normalize(candidateName);
  // 1. Exact normalized match
  const exact = categories.find((c) => normalize(c.name) === norm);
  if (exact) return exact;
  // 2. Contains match (less strict)
  const contains = categories.find(
    (c) => normalize(c.name).includes(norm) || norm.includes(normalize(c.name))
  );
  return contains ?? null;
}

// ── 3. Main Script ─────────────────────────────────────────────────────────────
async function main() {
  console.log("==================================================");
  console.log("   RingFlow Bulk Category PDF Uploader");
  console.log("==================================================\n");

  let supabase;

  const clientOptions = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: globalThis.WebSocket,
    },
  };

  if (serviceRoleKey) {
    // Service role key automatically bypasses all RLS policies
    supabase = createClient(supabaseUrl, serviceRoleKey, clientOptions);
    console.log("✔ Authenticated via SUPABASE_SERVICE_ROLE_KEY (RLS bypassed for all storage/tables).\n");
  } else {
    supabase = createClient(supabaseUrl, anonKey, clientOptions);
    console.log("ℹ️  SUPABASE_SERVICE_ROLE_KEY not found. Using Anon key.");
    console.log("   Signing in as Admin using email/password...\n");

    const email = await askQuestion("Admin Email: ");
    const password = await askQuestion("Admin Password: ");

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });

    if (authError || !authData.user) {
      console.error("\n❌ Authentication failed:", authError?.message || "Unknown error");
      rl.close();
      process.exit(1);
    }
    console.log(`\n✔ Logged in as ${authData.user.email}\n`);
  }

  // Parse Folder Path
  let folderPath = process.argv[2];
  if (!folderPath) {
    folderPath = await askQuestion("Enter the folder path containing PDFs: ");
  }
  folderPath = path.resolve(folderPath.trim().replace(/^['"]|['"]$/g, ""));

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    console.error(`\n❌ Folder not found: "${folderPath}"`);
    rl.close();
    process.exit(1);
  }

  // Parse or Select Tournament
  let tournamentId = process.argv[3];
  if (!tournamentId) {
    console.log("Fetching recent tournaments from database...");
    const { data: tournaments, error: tourError } = await supabase
      .from("tournaments")
      .select("id, name, event_date, status")
      .order("created_at", { ascending: false })
      .limit(10);

    if (tourError || !tournaments || tournaments.length === 0) {
      console.error("❌ Failed to fetch tournaments or no tournaments found:", tourError?.message);
      rl.close();
      process.exit(1);
    }

    console.log("\nSelect Tournament:");
    tournaments.forEach((t, index) => {
      console.log(`  [${index + 1}] ${t.name} (Status: ${t.status}, ID: ${t.id})`);
    });

    const selection = await askQuestion("\nEnter number (1-" + tournaments.length + ") or paste Tournament UUID: ");
    const selNum = parseInt(selection.trim(), 10);
    if (!isNaN(selNum) && selNum >= 1 && selNum <= tournaments.length) {
      tournamentId = tournaments[selNum - 1].id;
    } else {
      tournamentId = selection.trim();
    }
  }

  // Verify tournament
  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("id", tournamentId)
    .single();

  if (tErr || !tournament) {
    console.error(`\n❌ Tournament with ID "${tournamentId}" not found.`);
    rl.close();
    process.exit(1);
  }

  console.log(`\nSelected Tournament: "${tournament.name}" (${tournament.id})`);

  // Fetch Categories for Tournament
  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, name, age_bracket, weight_class, doc_url")
    .eq("tournament_id", tournamentId);

  if (catError || !categories || categories.length === 0) {
    console.error("\n❌ No categories found for this tournament. Please create categories first.");
    rl.close();
    process.exit(1);
  }

  console.log(`Found ${categories.length} categories in database.\n`);

  // Scan folder for PDFs
  const allFiles = fs.readdirSync(folderPath);
  const pdfFiles = allFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log(`❌ No .pdf files found in "${folderPath}".`);
    rl.close();
    process.exit(1);
  }

  console.log(`Found ${pdfFiles.length} PDF file(s) in folder.`);

  // ── Match PDFs with Overwrite & Duplicate Conflict Handling ────────────────
  const newUploads = [];
  const overwrites = [];
  const unmatched = [];
  const categoryAssignedFiles = new Map(); // categoryId -> [filenames]

  for (const filename of pdfFiles) {
    const candidateName = filenameToName(filename);
    const cat = findMatch(candidateName, categories);

    if (!cat) {
      unmatched.push(filename);
      continue;
    }

    // Track duplicate assignments to the same category
    if (!categoryAssignedFiles.has(cat.id)) {
      categoryAssignedFiles.set(cat.id, []);
    }
    categoryAssignedFiles.get(cat.id).push(filename);

    const isOverwrite = Boolean(cat.doc_url);
    if (isOverwrite) {
      overwrites.push({ filename, category: cat });
    } else {
      newUploads.push({ filename, category: cat });
    }
  }

  // Check for duplicate conflicts (multiple files in the folder matching same category)
  const conflicts = [];
  for (const [catId, files] of categoryAssignedFiles.entries()) {
    if (files.length > 1) {
      const cat = categories.find((c) => c.id === catId);
      conflicts.push({ category: cat, files });
    }
  }

  console.log("\n==================================================");
  console.log("                MATCH REPORT");
  console.log("==================================================");
  console.log(`  📄 Total PDF Files Scanned : ${pdfFiles.length}`);
  console.log(`  ✨ New Attachments          : ${newUploads.length}`);
  console.log(`  ⚠️  Overwrites (Already Attached): ${overwrites.length}`);
  console.log(`  ❓ Unmatched (No Category)  : ${unmatched.length}`);
  if (conflicts.length > 0) {
    console.log(`  🚨 Duplicate Conflicts     : ${conflicts.length}`);
  }
  console.log("==================================================\n");

  // Show Duplicate Conflicts
  if (conflicts.length > 0) {
    console.log("🚨 DUPLICATE CONFLICT WARNING:");
    console.log("   Multiple files in your folder matched the SAME category:");
    conflicts.forEach((c) => {
      console.log(`   - Category "${c.category.name}":`);
      c.files.forEach((f) => console.log(`       -> ${f}`));
    });
    console.log("   (If you proceed, the last file in the list will overwrite the earlier ones)\n");
  }

  // Show Overwrites
  if (overwrites.length > 0) {
    console.log(`⚠️  OVERWRITE WARNING (${overwrites.length} categories already have a PDF attached):`);
    overwrites.forEach((item) => {
      console.log(`   - "${item.filename}" will REPLACE existing PDF for "${item.category.name}"`);
    });
    console.log();
  }

  // Show Unmatched
  if (unmatched.length > 0) {
    console.log(`❓ UNMATCHED FILES (${unmatched.length} files will be skipped):`);
    unmatched.forEach((f) => console.log(`   - ${f}`));
    console.log();
  }

  const totalToUpload = newUploads.length + overwrites.length;
  if (totalToUpload === 0) {
    console.log("❌ No files matched any category names. Nothing to upload.");
    rl.close();
    process.exit(0);
  }

  // Confirmation prompt with overwrite distinction
  let confirmMessage = `Proceed to upload ${totalToUpload} PDF(s)`;
  if (overwrites.length > 0) {
    confirmMessage += ` (including ${overwrites.length} OVERWRITE${overwrites.length > 1 ? "S" : ""})`;
  }
  confirmMessage += "? (y/N): ";

  const proceed = await askQuestion(confirmMessage);
  if (proceed.trim().toLowerCase() !== "y") {
    console.log("\nAborted by user. No files were uploaded.");
    rl.close();
    process.exit(0);
  }

  console.log("\nUploading directly to Supabase Storage ('category-docs')...\n");

  const filesToUpload = [...newUploads, ...overwrites];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < filesToUpload.length; i++) {
    const { filename, category } = filesToUpload[i];
    const filePath = path.join(folderPath, filename);
    const storagePath = `${tournamentId}/${category.id}.pdf`;
    const progressPrefix = `[${i + 1}/${filesToUpload.length}]`;

    try {
      const fileBuffer = fs.readFileSync(filePath);

      // 1. Upload to Supabase Storage with cacheControl=0 to prevent CDN caching
      const { error: uploadError } = await supabase.storage
        .from("category-docs")
        .upload(storagePath, fileBuffer, {
          contentType: "application/pdf",
          upsert: true,
          cacheControl: "0",
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      // 2. Get public URL with cache-busting timestamp
      const { data: urlData } = supabase.storage
        .from("category-docs")
        .getPublicUrl(storagePath);

      const docUrl = urlData?.publicUrl ? `${urlData.publicUrl}?t=${Date.now()}` : null;

      // 3. Update category doc_url in DB
      const { error: updateError } = await supabase
        .from("categories")
        .update({ doc_url: docUrl })
        .eq("id", category.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      const isOverwrite = Boolean(category.doc_url);
      const actionTag = isOverwrite ? "[REPLACED]" : "[ATTACHED]";
      console.log(`✔ ${progressPrefix} ${actionTag} ${filename} -> "${category.name}"`);
      successCount++;
    } catch (err) {
      console.error(`✖ ${progressPrefix} FAILED ${filename}: ${err.message}`);
      errorCount++;
    }
  }

  console.log("\n==================================================");
  console.log(`✔ Upload Complete: ${successCount} files saved.`);
  if (errorCount > 0) console.log(`✖ Errors:          ${errorCount} failed.`);
  if (unmatched.length > 0) console.log(`⚠️  Skipped:         ${unmatched.length} unmatched files.`);
  console.log("==================================================\n");

  rl.close();
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  rl.close();
  process.exit(1);
});
