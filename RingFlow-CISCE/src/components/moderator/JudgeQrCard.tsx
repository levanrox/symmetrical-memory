"use client";

/**
 * JudgeQrCard (P5) — the printable judge join card for one tatami.
 *
 * Renders the join URL as a QR code using the `qrcode` npm package (pure
 * local computation — no external calls, works fully offline on venue WiFi).
 * The embedded print stylesheet prints ONLY this card: everything else on
 * the page is hidden via visibility, and the card is re-anchored to fill the
 * printed page.
 */

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";

interface JudgeQrCardProps {
  eventName: string;
  /** e.g. "TATAMI 1" — rendered big. */
  tatamiLabel: string;
  /** The URL encoded in the QR (what judges scan). */
  joinUrl: string;
  /** The human-typable code shown under the QR. */
  joinCode: string;
  /** ISO expiry of the code. */
  expiresAt: string;
}

export default function JudgeQrCard({
  eventName,
  tatamiLabel,
  joinUrl,
  joinCode,
  expiresAt,
}: JudgeQrCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setQrDataUrl(null);
    QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: "M",
      width: 640,
      margin: 2,
    })
      .then((url) => {
        if (alive) setQrDataUrl(url);
      })
      .catch((err) => console.error("QR render failed:", err));
    return () => {
      alive = false;
    };
  }, [joinUrl]);

  return (
    <>
      <style>{`
@media print {
  @page { margin: 10mm; }
  body { background: #ffffff !important; }
  body * { visibility: hidden !important; }
  #judge-qr-print-root, #judge-qr-print-root * { visibility: visible !important; }
  #judge-qr-print-root {
    position: fixed !important;
    inset: 0 !important;
    margin: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 12px !important;
    border: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    max-width: none !important;
  }
  #judge-qr-print-root img { width: 300px !important; height: 300px !important; }
  #judge-qr-print-root .qr-no-print { display: none !important; }
}
`}</style>

      <div
        id="judge-qr-print-root"
        className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl border border-outline-variant bg-white p-6 text-center shadow-sm"
      >
        <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          {eventName}
        </p>
        <h2 className="text-4xl font-black uppercase tracking-tight text-on-surface">
          {tatamiLabel}
        </h2>
        <p className="text-sm font-semibold text-on-surface-variant">
          Judges — scan to join this tatami
        </p>

        {qrDataUrl ? (
          /* next/image optimization is meaningless for a generated data-URL. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`QR code to join ${tatamiLabel} as a judge`}
            className="h-56 w-56 rounded-lg border border-outline-variant"
            width={224}
            height={224}
          />
        ) : (
          <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-surface-container">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-secondary border-t-transparent" />
          </div>
        )}

        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant">
            Manual code
          </p>
          <p className="font-mono text-3xl font-black tracking-widest text-on-surface">
            {joinCode}
          </p>
        </div>

        <p className="text-xs text-on-surface-variant">
          Nothing is granted by scanning — the moderator approves each judge.
          <br />
          Code expires {new Date(expiresAt).toLocaleString()}.
        </p>
      </div>
    </>
  );
}
