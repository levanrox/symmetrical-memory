"use client";

import { useEffect } from "react";

/**
 * BackNavigationGuard intercepts accidental mobile browser back swipes/presses
 * on primary dashboard/balancing views, keeping users safely inside their session
 * without accidental logouts or history drops.
 */
export default function BackNavigationGuard() {
  useEffect(() => {
    // Only engage if window and history are available
    if (typeof window === "undefined" || !window.history) return;

    // Push guard state into history
    const stateObj = { ringflowGuard: true };
    try {
      window.history.pushState(stateObj, "", window.location.href);
    } catch (_) {}

    const handlePopState = (e: PopStateEvent) => {
      // Re-push state so subsequent back taps don't inadvertently exit
      try {
        window.history.pushState(stateObj, "", window.location.href);
      } catch (_) {}
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return null;
}
