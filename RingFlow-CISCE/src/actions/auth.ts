"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { signCookieValue } from "@/lib/auth/sessionCookies";
import { secureCookieFlag } from "@/lib/serverCookies";
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

  // First-login bootstrap: if the admin has no password yet, the operator must
  // supply ADMIN_BOOTSTRAP_PASSWORD (env). The previous behaviour — a
  // hardcoded "admin123" default — meant every fresh deployment had a publicly
  // known admin password, so it was removed.
  if (!admin.passwordHash) {
    const bootstrap = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!bootstrap) {
      return {
        success: false,
        error:
          "No admin password is set yet. Ask the event operator to configure " +
          "ADMIN_BOOTSTRAP_PASSWORD and restart the server.",
      };
    }
    if (password !== bootstrap) {
      return { success: false, error: "Invalid email or password." };
    }
    const newHash = await hashPassword(bootstrap);
    await db
      .update(admins)
      .set({ passwordHash: newHash })
      .where(eq(admins.id, admin.id));
  } else {
    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) {
      return { success: false, error: "Invalid email or password." };
    }
  }

  // Set the signed session cookie. The old duplicate `admin_dev_id` set here
  // is gone: session identity lives in exactly one signed cookie.
  try {
    const cookieStore = await cookies();
    cookieStore.set("admin_session", signCookieValue(admin.id), {
      path: "/",
      maxAge: 86400 * 7, // 7 days
      httpOnly: true,
      sameSite: "lax",
      secure: await secureCookieFlag(),
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
