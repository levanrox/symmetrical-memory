"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { checkStagerStatus } from "@/actions/stager";
import { useLiveEvents } from "@/hooks/useLiveEvents";

export default function StagerWaitingRoom() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [status, setStatus] = useState("pending");

  const handleApproved = (tournamentId: string) => {
    // The server action sets the httpOnly stager_token cookie — page
    // JavaScript never handles the session token itself.
    checkStagerStatus(id).catch(() => {});

    setStatus("approved");
    setTimeout(() => {
      window.location.replace(`/stager/event/${tournamentId}/balance`);
    }, 800);
  };

  // Approval lands here instantly via SSE
  useLiveEvents({ requestId: id }, () => {
    void checkStagerStatus(id)
      .then((res) => {
        if (res.status === "approved" && res.tournamentId) {
          handleApproved(res.tournamentId);
        } else if (res.status === "rejected") {
          setStatus("rejected");
        }
      })
      .catch(() => {});
  });

  useEffect(() => {
    let isCancelled = false;

    const checkStatus = async () => {
      try {
        const res = await checkStagerStatus(id);
        if (isCancelled) return;
        if (res.status === "approved" && res.tournamentId) {
          handleApproved(res.tournamentId);
        } else if (res.status === "rejected") {
          setStatus("rejected");
        }
      } catch (e) {
        console.error("Error checking stager status:", e);
      }
    };

    checkStatus();
    const pollInterval = setInterval(checkStatus, 5000);

    return () => {
      isCancelled = true;
      clearInterval(pollInterval);
    };
  }, [id]);

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body-md overflow-hidden relative">
      <header className="w-full px-4 py-6 flex items-center z-10 justify-center">
        <div className="flex items-center gap-2">
          <span className="text-headline-sm font-headline-sm font-extrabold text-primary tracking-tighter">
            Ring Flow
          </span>
          <div className="h-1.5 w-1.5 rounded-full bg-secondary" />
          <span className="text-label-caps font-label-caps text-on-surface-variant uppercase">
            Stager Terminal
          </span>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-md text-center flex flex-col items-center">

          {/* ── Pending ── */}
          {status === "pending" && (
            <>
              <div className="w-24 h-24 mb-10 relative flex justify-center items-center">
                <svg className="w-24 h-24 -rotate-90 animate-spin text-secondary" viewBox="0 0 100 100">
                  <circle
                    cx="50" cy="50" r="42"
                    stroke="currentColor" strokeWidth="5" fill="none"
                    className="text-surface-container-high opacity-30"
                  />
                  <circle
                    cx="50" cy="50" r="42"
                    stroke="currentColor" strokeWidth="5"
                    strokeDasharray="264" strokeDashoffset="180"
                    strokeLinecap="round" fill="none"
                  />
                </svg>
                <span
                  className="absolute material-symbols-outlined text-secondary text-3xl animate-pulse"
                  style={{ fontVariationSettings: '"FILL" 1' }}
                >
                  sports_kabaddi
                </span>
              </div>
              <h1 className="text-display-sm font-headline-lg text-primary mb-4 tracking-tight">
                Waiting for Admin Approval
              </h1>
              <p className="text-body-lg text-on-surface-variant max-w-xs mx-auto mb-10">
                Your request to access the Stager Terminal has been sent to the tournament director. Please wait for approval.
              </p>
              <div className="w-full max-w-xs bg-white border border-outline-variant rounded-lg p-4 flex items-center gap-3 shadow-xs">
                <span className="material-symbols-outlined text-outline">info</span>
                <span className="text-body-sm text-on-surface-variant text-left">
                  Keep this screen open. You will be redirected automatically once approved.
                </span>
              </div>
            </>
          )}

          {/* ── Approved ── */}
          {status === "approved" && (
            <>
              <div className="w-24 h-24 mb-10 rounded-full bg-green-100 flex items-center justify-center shadow-lg transform transition-transform scale-110">
                <span
                  className="material-symbols-outlined text-green-700 text-5xl"
                  style={{ fontVariationSettings: '"FILL" 1' }}
                >
                  check_circle
                </span>
              </div>
              <h1 className="text-display-sm font-headline-lg text-green-800 mb-4 tracking-tight">
                Access Granted
              </h1>
              <p className="text-body-lg text-green-700 mb-10">Entering Stager Board...</p>
            </>
          )}

          {/* ── Rejected ── */}
          {status === "rejected" && (
            <>
              <div className="w-24 h-24 mb-10 rounded-full bg-error-container flex items-center justify-center shadow-lg">
                <span
                  className="material-symbols-outlined text-error text-5xl"
                  style={{ fontVariationSettings: '"FILL" 1' }}
                >
                  cancel
                </span>
              </div>
              <h1 className="text-display-sm font-headline-lg text-error mb-4 tracking-tight">
                Access Declined
              </h1>
              <p className="text-body-lg text-on-error-container mb-10">
                The tournament administrator declined your access request.
              </p>
              <button
                onClick={() => router.push("/login/stager")}
                className="bg-error text-white px-6 py-3 rounded-lg font-headline-sm hover:opacity-90 transition-opacity"
              >
                Try Again
              </button>
            </>
          )}

        </div>
      </main>
    </div>
  );
}
