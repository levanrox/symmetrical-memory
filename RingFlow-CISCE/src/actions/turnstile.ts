"use server";

export async function verifyTurnstileToken(token: string) {
  if (!token || typeof token !== "string") {
    return { success: false, error: "Captcha verification token is required" };
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error("[Turnstile] TURNSTILE_SECRET_KEY is not defined in environment variables");
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
      console.error(`[Turnstile] Cloudflare siteverify endpoint returned status: ${res.status}`);
      return { success: false, error: "Failed to connect to verification server" };
    }

    const data = await res.json();
    if (data.success) {
      return { success: true };
    } else {
      console.error("[Turnstile] Verification failed:", data);
      return { success: false, error: "Security check failed. Please try again." };
    }
  } catch (error) {
    console.error("[Turnstile] Verification error:", error);
    return { success: false, error: "An error occurred during security verification" };
  }
}

