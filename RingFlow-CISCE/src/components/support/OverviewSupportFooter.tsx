"use client";

import React, { useState } from "react";

// Obfuscated contact payloads (reversed base64 to prevent static bot scraping & crawler regex)
const ENCODED_CONTACTS = {
  ullas: "0ADN4EDIyQjNzYDIxkzK",
  prateek: "yQjM2cDIxADOzkDIxkzK",
  mail: "=YXZk5ycvlGZ1R3c4VncjBEdjFGdu92Y",
};

function decodePayload(encoded: string): string {
  if (typeof window === "undefined") return "";
  try {
    return atob(encoded.split("").reverse().join(""));
  } catch {
    return "";
  }
}

export default function OverviewSupportFooter() {
  const [revealed, setRevealed] = useState<{ ullas: boolean; prateek: boolean; mail: boolean }>({
    ullas: false,
    prateek: false,
    mail: false,
  });

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const reveal = (key: "ullas" | "prateek" | "mail") => {
    setRevealed(prev => ({ ...prev, [key]: true }));
  };

  const revealAll = () => {
    setRevealed({ ullas: true, prateek: true, mail: true });
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const ullasPhone = revealed.ullas ? decodePayload(ENCODED_CONTACTS.ullas) : null;
  const prateekPhone = revealed.prateek ? decodePayload(ENCODED_CONTACTS.prateek) : null;
  const supportMail = revealed.mail ? decodePayload(ENCODED_CONTACTS.mail) : null;

  const allRevealed = revealed.ullas && revealed.prateek && revealed.mail;

  return (
    <footer className="w-full mt-8 pt-2 pb-6">
      <div className="bg-gradient-to-br from-[#F4FAF7] via-[#FAF9F5] to-[#FAF9F5] border-2 border-[#0E9C7C]/30 rounded-2xl p-4 sm:p-5 shadow-[0_2px_14px_rgba(14,156,124,0.06)] relative overflow-hidden">
        {/* Top vibrant emerald accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0E9C7C] via-[#10B981] to-[#0E9C7C]" />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-[#E1DDCF]">
          <div className="flex items-start sm:items-center gap-3">
            {/* Person with Headset / Support Agent SVG Badge */}
            <div className="w-10 h-10 rounded-xl bg-[#E3F6F0] border border-[#0E9C7C]/30 text-[#0B7C63] flex items-center justify-center shrink-0 shadow-2xs">
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
                <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-[14.5px] font-bold text-[#0F172A] leading-tight">
                  Operations &amp; Tournament Support
                </h4>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-[#E3F6F0] text-[#0B7C63] px-2 py-0.5 rounded-full border border-[#0E9C7C]/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E9C7C] animate-ping" />
                  <span>Support Helpline</span>
                </span>
              </div>
              <p className="text-[12px] text-[#475569] mt-0.5 leading-snug">
                For schedule delays, tatami conflicts, or match scoring disputes
              </p>
            </div>
          </div>

          <div className="shrink-0 self-start sm:self-auto pl-13 sm:pl-0">
            {!allRevealed ? (
              <button
                type="button"
                onClick={revealAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0E9C7C]/40 bg-[#E3F6F0] hover:bg-[#D2F2E7] text-[#0B7C63] text-xs font-semibold shadow-2xs hover:shadow-xs transition-all cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Reveal all</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0B7C63] bg-[#E3F6F0] px-2.5 py-1 rounded-lg border border-[#0E9C7C]/30">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Contacts revealed</span>
              </span>
            )}
          </div>
        </div>

        {/* 3 Contact Items */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3.5">
          {/* Ullas */}
          <div className="flex flex-col justify-between p-3 rounded-xl border border-[#E1DDCF] hover:border-[#0E9C7C]/50 bg-white/80 backdrop-blur-xs transition-all hover:shadow-xs">
            <div className="mb-2">
              <span className="text-[13.5px] font-bold text-[#0F172A]">Ullas</span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#E1DDCF]/60">
              <div className="flex items-center gap-2 min-w-0">
                {/* Phone SVG */}
                <svg
                  className="w-4 h-4 text-[#0B7C63] shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {revealed.ullas && ullasPhone ? (
                  <a
                    href={`tel:${ullasPhone.replace(/\s+/g, "")}`}
                    className="font-mono text-[13px] font-bold text-[#0F172A] hover:text-[#0B7C63] transition-colors"
                  >
                    {ullasPhone}
                  </a>
                ) : (
                  <span className="font-mono text-[12.5px] font-medium text-[#64748B]">+91 ••••• 18404</span>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-1">
                {revealed.ullas && ullasPhone ? (
                  <>
                    <a
                      href={`tel:${ullasPhone.replace(/\s+/g, "")}`}
                      className="p-1.5 rounded-lg text-[#0B7C63] hover:bg-[#E3F6F0] transition-colors"
                      title="Call directly"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopy(ullasPhone, "ullas")}
                      className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#ECE9DF] transition-colors cursor-pointer"
                      title="Copy phone number"
                    >
                      {copiedKey === "ullas" ? (
                        <span className="text-[11px] font-bold text-[#0B7C63]">Copied!</span>
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => reveal("ullas")}
                    className="text-[11.5px] font-semibold text-[#0B7C63] hover:underline px-2.5 py-1 rounded-md bg-[#E3F6F0] hover:bg-[#D2F2E7] border border-[#0E9C7C]/20 transition-all cursor-pointer"
                  >
                    Show
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Prateek */}
          <div className="flex flex-col justify-between p-3 rounded-xl border border-[#E1DDCF] hover:border-[#0E9C7C]/50 bg-white/80 backdrop-blur-xs transition-all hover:shadow-xs">
            <div className="mb-2">
              <span className="text-[13.5px] font-bold text-[#0F172A]">Prateek</span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#E1DDCF]/60">
              <div className="flex items-center gap-2 min-w-0">
                {/* Phone SVG */}
                <svg
                  className="w-4 h-4 text-[#0B7C63] shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {revealed.prateek && prateekPhone ? (
                  <a
                    href={`tel:${prateekPhone.replace(/\s+/g, "")}`}
                    className="font-mono text-[13px] font-bold text-[#0F172A] hover:text-[#0B7C63] transition-colors"
                  >
                    {prateekPhone}
                  </a>
                ) : (
                  <span className="font-mono text-[12.5px] font-medium text-[#64748B]">+91 ••••• 76242</span>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-1">
                {revealed.prateek && prateekPhone ? (
                  <>
                    <a
                      href={`tel:${prateekPhone.replace(/\s+/g, "")}`}
                      className="p-1.5 rounded-lg text-[#0B7C63] hover:bg-[#E3F6F0] transition-colors"
                      title="Call directly"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopy(prateekPhone, "prateek")}
                      className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#ECE9DF] transition-colors cursor-pointer"
                      title="Copy phone number"
                    >
                      {copiedKey === "prateek" ? (
                        <span className="text-[11px] font-bold text-[#0B7C63]">Copied!</span>
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => reveal("prateek")}
                    className="text-[11.5px] font-semibold text-[#0B7C63] hover:underline px-2.5 py-1 rounded-md bg-[#E3F6F0] hover:bg-[#D2F2E7] border border-[#0E9C7C]/20 transition-all cursor-pointer"
                  >
                    Show
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* CruxStudios */}
          <div className="flex flex-col justify-between p-3 rounded-xl border border-[#E1DDCF] hover:border-[#0284C7]/50 bg-white/80 backdrop-blur-xs transition-all hover:shadow-xs">
            <div className="mb-2">
              <span className="text-[13.5px] font-bold text-[#0F172A]">CruxStudios</span>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#E1DDCF]/60">
              <div className="flex items-center gap-2 min-w-0">
                {/* Mail SVG */}
                <svg
                  className="w-4 h-4 text-[#0284C7] shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                {revealed.mail && supportMail ? (
                  <a
                    href={`mailto:${supportMail}`}
                    className="font-mono text-[12.5px] font-bold text-[#0F172A] hover:text-[#0284C7] transition-colors truncate block"
                    title={supportMail}
                  >
                    {supportMail}
                  </a>
                ) : (
                  <span className="font-mono text-[12px] font-medium text-[#64748B] truncate block">c•••••@cruxstudios.dev</span>
                )}
              </div>

              <div className="shrink-0 flex items-center gap-1">
                {revealed.mail && supportMail ? (
                  <>
                    <a
                      href={`mailto:${supportMail}`}
                      className="p-1.5 rounded-lg text-[#0284C7] hover:bg-[#E0F2FE] transition-colors"
                      title="Send email"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleCopy(supportMail, "mail")}
                      className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#ECE9DF] transition-colors cursor-pointer"
                      title="Copy email"
                    >
                      {copiedKey === "mail" ? (
                        <span className="text-[11px] font-bold text-[#0284C7]">Copied!</span>
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => reveal("mail")}
                    className="text-[11.5px] font-semibold text-[#0284C7] hover:underline px-2.5 py-1 rounded-md bg-[#E0F2FE] hover:bg-[#BAE6FD] border border-[#0284C7]/20 transition-all cursor-pointer"
                  >
                    Show
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer info line */}
        <div className="mt-3.5 pt-3 border-t border-[#E1DDCF] flex items-center justify-between text-[11px] text-[#64748B]">
          <span>Protected with anti-scraping obfuscation to prevent bot harvesting.</span>
          <a
            href="https://cruxstudios.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#0F172A] transition-colors inline-flex items-center gap-1 font-medium"
          >
            <span>Powered by CruxStudios</span>
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}
