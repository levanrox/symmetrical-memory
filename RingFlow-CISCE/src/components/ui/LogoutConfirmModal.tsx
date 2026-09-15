"use client";

import React, { useEffect } from "react";

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmLabel?: string;
  isLoggingOut?: boolean;
}

export default function LogoutConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Sign Out",
  message = "Are you sure you want to sign out? You will need to sign in or request access again to regain access.",
  confirmLabel = "Sign Out",
  isLoggingOut = false,
}: LogoutConfirmModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoggingOut) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isLoggingOut]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoggingOut) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        className="bg-[#FAF9F5] border border-[#E1DDCF] rounded-2xl shadow-2xl max-w-sm w-full p-5 sm:p-6 text-left select-none relative animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-start gap-3.5 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-100/80 border border-red-200/80 text-red-600 flex items-center justify-center shrink-0">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 id="logout-modal-title" className="text-[16px] font-bold text-[#0F172A] tracking-tight">
              {title}
            </h3>
            <p className="text-[13px] text-slate-600 mt-1 leading-relaxed">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-6 pt-3 border-t border-[#E1DDCF]/70">
          <button
            type="button"
            disabled={isLoggingOut}
            onClick={onClose}
            className="px-4 py-2 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-200/60 rounded-xl border border-[#E1DDCF] transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoggingOut}
            onClick={onConfirm}
            className="px-4 py-2 text-[13.5px] font-bold text-white bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isLoggingOut ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing out...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
