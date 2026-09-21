"use server";

import { logger } from "@/lib/logger";

/**
 * Whether Cloudflare Turnstile verification is enforced.
 *
 * The event server is designed to run on an offline LAN, where reaching
 * Cloudflare's siteverify endpoint is impossible. Verification therefore
 * defaults to OFF and must be explicitly enabled with
 * TURNSTILE_ENABLED=true (plus TURNSTILE_SECRET_KEY).
 */
export function turnstileEnabled(): boolean {
  return process.env.TURNSTILE_ENABLED === "true";
}

export async function verifyTurnstileToken(token: string) {
  if (!turnstileEnabled()) {
    logger.warn(
      "[Turnstile] disabled (TURNSTILE_ENABLED is not 'true') — skipping bot check."
    );
    return { success: true, skipped: true };
  }

  if (!token || typeof token !== "string") {
    return { success: false, error: "Captcha verification token is required" };
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    logger.error("[Turnstile] TURNSTILE_SECRET_KEY is not defined in environment variables");
    return { success: false, error: "Server configuration error" };
  }

  try {
    const formData = new FormData();
    formData.append("secret", secretKey.trim());
    formData.append("response", token);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      logger.error(`[Turnstile] Cloudflare siteverify endpoint returned status: ${res.status}`);
      return { success: false, error: "Failed to connect to verification server" };
    }

    const data = await res.json();
    if (data.success) {
      return { success: true };
    } else {
      logger.error("[Turnstile] Verification failed");
      return { success: false, error: "Security check failed. Please try again." };
    }
  } catch (error) {
    logger.error({ error }, "[Turnstile] Verification error");
    return { success: false, error: "An error occurred during security verification" };
  }
}

