"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { revalidatePath } from "next/cache";

export async function signInWithAdminPassword(
  formData: FormData | { email?: string; password?: string }
) {
  let email = "";
  let password = "";

  if (formData instanceof FormData) {
    email = (formData.get("email") as string) || "";
    password = (formData.get("password") as string) || "";
  } else if (formData && typeof formData === "object") {
    email = formData.email || "";
    password = formData.password || "";
  }

  email = email.trim().toLowerCase();
  password = password.trim();

  if (!email || !password) {
    return { success: false, error: "Email and password are required." };
  }

  // Find admin by email
  const existing = await db
    .select()
    .from(admins)
    .where(eq(admins.email, email))
    .limit(1);

  if (!existing || existing.length === 0) {
    return { success: false, error: "Invalid email or password." };
  }

  const admin = existing[0];

  // If admin has no passwordHash set yet (e.g. initial migration or seed default),
  // allow 'admin123' as default password and automatically hash & persist it.
  if (!admin.passwordHash) {
    if (password === "admin123") {
      const newHash = await hashPassword("admin123");
      await db
        .update(admins)
        .set({ passwordHash: newHash })
        .where(eq(admins.id, admin.id));
    } else {
      return { success: false, error: "Invalid email or password." };
    }
  } else {
    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) {
      return { success: false, error: "Invalid email or password." };
    }
  }

  // Set secure session cookie
  try {
    const cookieStore = await cookies();
    cookieStore.set("admin_session", admin.id, {
      path: "/",
      maxAge: 86400 * 7, // 7 days
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    cookieStore.set("admin_dev_id", admin.id, {
      path: "/",
      maxAge: 86400 * 7,
      sameSite: "lax",
    });
  } catch {}

  try {
    revalidatePath("/admin");
  } catch {}

  return { success: true, adminId: admin.id, email: admin.email };
}

export async function logoutAdminAction() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("admin_session");
    cookieStore.delete("admin_dev_id");
  } catch {}
  try {
    revalidatePath("/admin");
  } catch {}
  return { success: true };
}

/** Legacy stub kept for backward compatibility */
export async function signInWithGoogleAdmin(turnstileToken?: string) {
  return { success: false, error: "Google OAuth is disabled in local LAN mode. Please use Email & Password." };
}
