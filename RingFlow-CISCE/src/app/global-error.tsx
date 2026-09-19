"use client";

import React from "react";

// Note for whoever touches the build next: Next 16.2.x crashes while
// prerendering its internal /_global-error route
// (`Cannot read properties of null (reading 'useContext')`, upstream issues
// vercel/next.js#86178, #84994, #87719, #95741 — still open). A plain
// `next build` therefore fails on this app regardless of the code here, while
// `npm run build:verify` (next build --debug-prerender) completes. Nothing in
// this file causes or cures it; it only gives the app its own last-resort page.

/**
 * Last-resort boundary: this page replaces the whole document, so it must not
 * depend on the app's providers or layout. Kept deliberately plain and on the
 * product's palette.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F5F3EC",
          color: "#1B1815",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <main
          style={{
            maxWidth: "420px",
            width: "100%",
            background: "#FFFFFF",
            border: "1px solid #E1DDCF",
            borderRadius: "12px",
            padding: "28px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "14px", color: "#68645A", margin: "0 0 20px", lineHeight: 1.5 }}>
            The page could not be displayed. Reloading usually clears it; if it keeps happening,
            the tournament desk is still running for everyone else.
          </p>
          {error?.digest ? (
            <p style={{ fontSize: "11px", color: "#8C877C", margin: "0 0 20px" }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 20px",
              borderRadius: "8px",
              border: "none",
              background: "#0E9C7C",
              color: "#FFFFFF",
              fontWeight: 800,
              fontSize: "13px",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
