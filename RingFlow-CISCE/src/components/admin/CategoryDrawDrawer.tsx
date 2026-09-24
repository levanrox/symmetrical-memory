"use client";

import React, { useState } from "react";
import { setCategoryDrawOption, toggleCategoryDrawLock, generateCategoryDraw, setKataDrawFormat } from "@/actions/draws";
import { downloadCategoryDrawPdf } from "@/actions/drawPdfs";
import {
  KATA_DRAW_FORMAT_OPTIONS,
  KATA_RANKING_METHOD_OPTIONS,
  kataDrawFormatLabel,
} from "@/lib/draws/kataSettings";

export type CategoryDrawInfo = {
  id: string;
  name: string;
  age_bracket: string | null;
  weight_class: string | null;
  athletes_count: number;
  expected_matches: number;
  doc_url?: string | null;
  bronze_medals?: number | null;
  draw_state?: string | null;
  is_locked?: boolean;
  confirmed_matches?: number;
  live_matches?: number;
  total_matches?: number;
  has_draw?: boolean;
  /** Kata draw settings; null/undefined = event defaults. */
  kataFormat?: string | null;
  kataRankingMethod?: string | null;
  kataAdvancePerGroup?: number | null;
  kataGroupSize?: number | null;
  /** True when the draw engine treats this category as kata. */
  is_kata?: boolean;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  category: CategoryDrawInfo | null;
  tournamentId: string;
  onViewBracket: (cat: CategoryDrawInfo) => void;
  onRefresh: () => void;
}

export function CategoryDrawDrawer({
  isOpen,
  onClose,
  category,
  tournamentId,
  onViewBracket,
  onRefresh,
}: Props) {
  const [isSavingBronze, setIsSavingBronze] = useState(false);
  const [isTogglingLock, setIsTogglingLock] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [showEmergencyReset, setShowEmergencyReset] = useState(false);
  const [resetConfirmInput, setResetConfirmInput] = useState("");
  const [isSavingKata, setIsSavingKata] = useState(false);
  const [kataAdvanceInput, setKataAdvanceInput] = useState("");
  const [kataGroupSizeInput, setKataGroupSizeInput] = useState("");

  // Keep the kata numeric inputs in sync when a different category is opened.
  // (Runs before the early return below so hook order stays stable.)
  const kataAdvanceSeed = category?.kataAdvancePerGroup ?? null;
  const kataGroupSizeSeed = category?.kataGroupSize ?? null;
  const kataOpenId = category?.id ?? null;
  React.useEffect(() => {
    setKataAdvanceInput(kataAdvanceSeed != null ? String(kataAdvanceSeed) : "");
    setKataGroupSizeInput(kataGroupSizeSeed != null ? String(kataGroupSizeSeed) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kataOpenId]);

  if (!isOpen || !category) return null;

  const confirmed = category.confirmed_matches ?? 0;
  const live = category.live_matches ?? 0;
  const total = category.total_matches ?? category.expected_matches ?? 0;
  const hasDraw = Boolean(category.has_draw || category.draw_state);
  const isLocked = Boolean(category.is_locked || category.draw_state === "LOCKED");

  let lifecycle: "NO_DRAW" | "DRAFT" | "LOCKED" | "IN_PROGRESS" | "COMPLETED" = "NO_DRAW";
  if (hasDraw) {
    if (total > 0 && confirmed >= total) {
      lifecycle = "COMPLETED";
    } else if (confirmed > 0 || live > 0) {
      lifecycle = "IN_PROGRESS";
    } else if (isLocked) {
      lifecycle = "LOCKED";
    } else {
      lifecycle = "DRAFT";
    }
  }

  const handleBronzeChange = async (val: 0 | 1 | 2 | 3 | null) => {
    if (lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") {
      alert("Cannot change bronze format while matches are in progress or completed.");
      return;
    }
    setIsSavingBronze(true);
    try {
      const res = await setCategoryDrawOption(category.id, val);
      if (res.success) {
        onRefresh();
      } else {
        alert(res.error || "Failed to save bronze medal setting.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update bronze setting.");
    } finally {
      setIsSavingBronze(false);
    }
  };

  /**
   * Records kata draw settings for this category. Saved to the category row
   * and takes effect the next time the draw is generated. Mirrors the bronze
   * flow: guard against live matches, save, refresh.
   */
  const handleKataSave = async (patch: {
    kataFormat?: string | null;
    kataRankingMethod?: string | null;
    kataAdvancePerGroup?: number | string | null;
    kataGroupSize?: number | string | null;
  }) => {
    if (!category) return;
    if (lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") {
      alert("Cannot change kata draw settings while matches are in progress or completed.");
      return;
    }
    setIsSavingKata(true);
    try {
      const res = await setKataDrawFormat(category.id, patch);
      if (res.success) {
        onRefresh();
      } else {
        alert(res.error || "Failed to save kata draw settings.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to save kata draw settings.");
    } finally {
      setIsSavingKata(false);
    }
  };

  const handleKataGroupSave = async () => {
    await handleKataSave({
      kataAdvancePerGroup: kataAdvanceInput === "" ? null : kataAdvanceInput,
      kataGroupSize: kataGroupSizeInput === "" ? null : kataGroupSizeInput,
    });
  };

  const handleToggleLock = async () => {
    if (!hasDraw) {
      alert("Generate a draw first before locking.");
      return;
    }
    setIsTogglingLock(true);
    try {
      const res = await toggleCategoryDrawLock(category.id);
      if (res.success) {
        onRefresh();
      } else {
        alert(res.error || "Failed to toggle draw lock state.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to update lock.");
    } finally {
      setIsTogglingLock(false);
    }
  };

  const handleRegenerate = async (force: boolean = false) => {
    if (lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") {
      if (!force) {
        alert("Matches are already live or completed in this category. Complete redrawing is forbidden to protect scores.");
        return;
      }
    }
    setIsRegenerating(true);
    try {
      const res = await generateCategoryDraw(category.id, { forceRegenerate: force });
      if (res.success) {
        setShowEmergencyReset(false);
        setResetConfirmInput("");
        onRefresh();
      } else {
        alert(res.error || "Failed to generate draw.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to generate draw.");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const res = await downloadCategoryDrawPdf(category.id);
      if (res.success && res.base64) {
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteNumbers], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename;
        link.click();
      } else {
        const errorMsg = ("error" in res && res.error) || "Failed to download draw PDF.";
        alert(errorMsg);
      }
    } catch (err: any) {
      alert(err?.message || "Download failed.");
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const bronzeValue = category.bronze_medals === null || category.bronze_medals === undefined ? "inherit" : String(category.bronze_medals);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs animate-in fade-in flex justify-end">
      <div
        className="w-full max-w-lg bg-[#FAF9F5] h-full shadow-2xl flex flex-col border-l border-[#E1DDCF] animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Drawer Header */}
        <div className="px-6 py-5 bg-white border-b border-[#E1DDCF] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold font-data-mono tracking-wider text-[#0E9C7C] uppercase">
              Tournament Draw Management
            </span>
            <h2 className="text-lg font-bold text-[#1B1815] mt-0.5">{category.name}</h2>
            <div className="flex items-center gap-2 text-xs text-[#68645A] mt-1 font-data-mono">
              <span>{category.age_bracket || "All Ages"}</span>
              <span>•</span>
              <span>{category.weight_class || "Open Weight"}</span>
              <span>•</span>
              <span className="font-bold text-[#1B1815]">{category.athletes_count} Athletes</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Lifecycle Status Banner */}
          <div className="rounded-xl p-4 border bg-white shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#8C877C] uppercase tracking-wider">
                Current Draw Lifecycle State
              </span>
              {lifecycle === "NO_DRAW" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-slate-100 text-slate-700 border border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-slate-400" />
                  NO DRAW
                </span>
              )}
              {lifecycle === "DRAFT" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-amber-50 text-amber-900 border border-amber-200">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  DRAFT (EDITABLE)
                </span>
              )}
              {lifecycle === "LOCKED" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-indigo-50 text-indigo-900 border border-indigo-200">
                  <span className="material-symbols-outlined text-[13px]">lock</span>
                  OFFICIAL & LOCKED
                </span>
              )}
              {lifecycle === "IN_PROGRESS" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-emerald-50 text-emerald-900 border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  LIVE IN PROGRESS
                </span>
              )}
              {lifecycle === "COMPLETED" && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold font-data-mono bg-emerald-100 text-emerald-950 border border-emerald-300">
                  <span className="material-symbols-outlined text-[14px] text-amber-600">workspace_premium</span>
                  COMPLETED
                </span>
              )}
            </div>

            <p className="text-xs text-[#504C42] mt-3 leading-relaxed">
              {lifecycle === "NO_DRAW" && "This category does not have a generated bracket yet. Athletes are registered and ready for seed computation."}
              {lifecycle === "DRAFT" && "Draft bracket generated. Seeding and byes are positioned. You can review the bracket, adjust bronze formats, or rebuild before publishing."}
              {lifecycle === "LOCKED" && "Draw is officially locked and published. It is protected from bulk regeneration and ready for mat dispatch."}
              {lifecycle === "IN_PROGRESS" && `Tournament matches are actively being conducted on the tatami (${confirmed} scored, ${live} live). Bracket structure is protected.`}
              {lifecycle === "COMPLETED" && "All category bouts are complete. Podiums and final standings are awarded and locked."}
            </p>

            {hasDraw && (
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-[#F0ECE1] text-center font-data-mono">
                <div className="p-2 rounded-lg bg-[#FAF9F5]">
                  <span className="block text-[11px] text-[#8C877C]">Confirmed</span>
                  <span className="text-sm font-bold text-[#1B1815]">{confirmed}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#FAF9F5]">
                  <span className="block text-[11px] text-[#8C877C]">Live Now</span>
                  <span className="text-sm font-bold text-[#0E9C7C]">{live}</span>
                </div>
                <div className="p-2 rounded-lg bg-[#FAF9F5]">
                  <span className="block text-[11px] text-[#8C877C]">Total Matches</span>
                  <span className="text-sm font-bold text-[#1B1815]">{total}</span>
                </div>
              </div>
            )}
          </div>

          {/* Bronze Medal Format Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#1B1815] uppercase tracking-wider flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-[#C08A5A]">workspace_premium</span>
                Bronze Medal & Repechage Format
              </label>
              {(lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") && (
                <span className="text-[10px] font-bold font-data-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  LOCKED BY LIVE MATCHES
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {[
                {
                  value: "inherit",
                  title: "Default (Inherit Event Setting)",
                  desc: "Follows the tournament-wide bronze policy configured in Settings.",
                },
                {
                  value: "2",
                  title: "Official WKF (2 Bronzes · Full)",
                  desc: "Full repechage ladders for everyone beaten by finalists. Standard WKF format.",
                },
                {
                  value: "1",
                  title: "Local Official (1 Bronze Playoff)",
                  desc: "Early losers eliminated; losing semi-finalists face off in a single bronze match.",
                },
                {
                  value: "3",
                  title: "Local Official (Joint 3rd · 2 Bronzes)",
                  desc: "Both semi-final losers awarded bronze directly without any extra bouts.",
                },
                {
                  value: "0",
                  title: "No Bronze",
                  desc: "Pure single elimination stopping at the final. No bronze bouts.",
                },
              ].map((opt) => {
                const isSelected = bronzeValue === opt.value;
                const isDisabled = lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingBronze;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      const numVal = opt.value === "inherit" ? null : (Number(opt.value) as 0 | 1 | 2 | 3);
                      handleBronzeChange(numVal);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-[#0E9C7C] bg-emerald-50/50 shadow-xs"
                        : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                    } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${isSelected ? "text-[#0E9C7C]" : "text-[#1B1815]"}`}>
                        {opt.title}
                      </span>
                      {isSelected && (
                        <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">check_circle</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#68645A] mt-1">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Kata Draw Format & Group Settings (kata categories only) */}
          {category.is_kata && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#1B1815] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">table_chart</span>
                  Kata Draw Format
                </label>
                {(lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED") && (
                  <span className="text-[10px] font-bold font-data-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    LOCKED BY LIVE MATCHES
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2">
                {KATA_DRAW_FORMAT_OPTIONS.map((opt) => {
                  const current = category.kataFormat ?? "SINGLE_ELIM_REPECHAGE";
                  const isSelected = current === opt.value;
                  const isDisabled =
                    lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => void handleKataSave({ kataFormat: opt.value })}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#0E9C7C] bg-emerald-50/50 shadow-xs"
                          : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                      } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${isSelected ? "text-[#0E9C7C]" : "text-[#1B1815]"}`}>
                          {opt.label}
                        </span>
                        {isSelected && (
                          <span className="material-symbols-outlined text-[16px] text-[#0E9C7C]">check_circle</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#68645A] mt-1">{opt.hint}</p>
                    </button>
                  );
                })}
              </div>

              {/* Ranking method */}
              <label className="text-xs font-bold text-[#1B1815] uppercase tracking-wider flex items-center gap-1.5 pt-1">
                <span className="material-symbols-outlined text-[16px] text-[#C08A5A]">leaderboard</span>
                Group Ranking Method
              </label>
              <div className="grid grid-cols-2 gap-2">
                {KATA_RANKING_METHOD_OPTIONS.map((opt) => {
                  const current = category.kataRankingMethod ?? "WKF_VICTORY_POINTS";
                  const isSelected = current === opt.value;
                  const isDisabled =
                    lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => void handleKataSave({ kataRankingMethod: opt.value })}
                      title={opt.hint}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#0E9C7C] bg-emerald-50/50 shadow-xs"
                          : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                      } ${isDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <span className={`text-xs font-bold block ${isSelected ? "text-[#0E9C7C]" : "text-[#1B1815]"}`}>
                        {opt.label}
                      </span>
                      <span className="text-[11px] text-[#68645A]">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>

              {/* Advancers & group size */}
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-bold text-[#68645A] uppercase tracking-wider">
                    Advance / group
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={kataAdvanceInput}
                    onChange={(e) => setKataAdvanceInput(e.target.value)}
                    placeholder="Default (2)"
                    disabled={lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata}
                    className="mt-1 w-full px-3 py-2 border border-[#E1DDCF] rounded-xl bg-white font-data-mono text-xs text-[#1B1815] focus:outline-none focus:ring-2 focus:ring-[#0E9C7C] disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-[#68645A] uppercase tracking-wider">
                    Group size
                  </span>
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={kataGroupSizeInput}
                    onChange={(e) => setKataGroupSizeInput(e.target.value)}
                    placeholder="Auto (WKF 3.7.9)"
                    disabled={lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata}
                    className="mt-1 w-full px-3 py-2 border border-[#E1DDCF] rounded-xl bg-white font-data-mono text-xs text-[#1B1815] focus:outline-none focus:ring-2 focus:ring-[#0E9C7C] disabled:opacity-60"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isSavingKata}
                onClick={() => void handleKataGroupSave()}
                className="w-full py-2.5 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold font-data-mono text-xs tracking-wider transition-colors cursor-pointer"
              >
                {isSavingKata ? "SAVING..." : "SAVE GROUP SETTINGS"}
              </button>
              <p className="text-[11px] text-[#68645A] leading-relaxed">
                Current: {kataDrawFormatLabel(category.kataFormat)} · blanks mean event
                defaults. Takes effect the next time the draw is generated.
              </p>
            </div>
          )}

          {/* Primary Bracket Actions */}
          <div className="space-y-2.5 pt-2">
            <span className="text-xs font-bold text-[#1B1815] uppercase tracking-wider block">
              Operational Actions
            </span>

            {/* View Interactive Digital Bracket */}
            <button
              type="button"
              onClick={() => {
                onViewBracket(category);
                onClose();
              }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-[#E1DDCF] hover:border-[#0E9C7C] hover:bg-emerald-50/30 transition-all cursor-pointer group shadow-xs"
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0E9C7C] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">account_tree</span>
                </span>
                <div className="text-left">
                  <span className="text-xs font-bold text-[#1B1815] group-hover:text-[#0E9C7C] transition-colors block">
                    View Interactive Bracket
                  </span>
                  <span className="text-[11px] text-[#68645A]">Explore rounds, match scores, and live tree</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[#8C877C] group-hover:text-[#0E9C7C] transition-colors">
                chevron_right
              </span>
            </button>

            {/* Download Official Draw Sheet PDF */}
            <button
              type="button"
              disabled={isDownloadingPdf || !hasDraw}
              onClick={handleDownloadPdf}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-[#E1DDCF] hover:border-[#3D3A33] transition-all cursor-pointer group shadow-xs ${
                !hasDraw ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-[#3D3A33] flex items-center justify-center">
                  <span className="material-symbols-outlined text-[18px]">
                    {isDownloadingPdf ? "sync" : "picture_as_pdf"}
                  </span>
                </span>
                <div className="text-left">
                  <span className="text-xs font-bold text-[#1B1815] block">
                    {isDownloadingPdf ? "Generating PDF..." : "Download Official Draw Sheet PDF"}
                  </span>
                  <span className="text-[11px] text-[#68645A]">High-resolution print-ready bracket sheet</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-[18px] text-[#8C877C]">download</span>
            </button>

            {/* Lock / Unlock Toggle */}
            {hasDraw && (
              <button
                type="button"
                disabled={isTogglingLock || lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED"}
                onClick={handleToggleLock}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all cursor-pointer shadow-xs ${
                  isLocked
                    ? "bg-amber-50/50 border-amber-200 hover:bg-amber-100/50 text-amber-900"
                    : "bg-indigo-50/50 border-indigo-200 hover:bg-indigo-100/50 text-indigo-900"
                } ${isTogglingLock ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${isLocked ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800"}`}>
                    <span className="material-symbols-outlined text-[18px]">
                      {isLocked ? "lock_open" : "lock"}
                    </span>
                  </span>
                  <div className="text-left">
                    <span className="text-xs font-bold block">
                      {isLocked ? "Unlock Draw (Back to Draft)" : "Publish & Lock Draw"}
                    </span>
                    <span className="text-[11px] opacity-80">
                      {isLocked
                        ? "Unlocks bracket for seed adjustments or re-generation"
                        : "Locks bracket against bulk regeneration and makes it official"}
                    </span>
                  </div>
                </div>
              </button>
            )}

            {/* Rebuild Draw (for Draft or Empty) */}
            {(lifecycle === "NO_DRAW" || lifecycle === "DRAFT") && (
              <button
                type="button"
                disabled={isRegenerating}
                onClick={() => handleRegenerate(false)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-bold text-xs font-data-mono tracking-wider transition-all cursor-pointer shadow-sm"
              >
                <span className={`material-symbols-outlined text-[18px] ${isRegenerating ? "animate-spin" : ""}`}>
                  autorenew
                </span>
                <span>{hasDraw ? "REGENERATE DRAFT BRACKET" : "GENERATE DIGITAL BRACKET"}</span>
              </button>
            )}
          </div>

          {/* Emergency Administrative Override Accordion (For in-progress emergencies) */}
          {(lifecycle === "IN_PROGRESS" || lifecycle === "COMPLETED" || isLocked) && (
            <div className="border border-red-200 rounded-xl bg-red-50/40 p-4 space-y-3">
              <button
                type="button"
                onClick={() => setShowEmergencyReset(!showEmergencyReset)}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-2 text-red-800 font-bold text-xs uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  Emergency Administrative Override
                </div>
                <span className="material-symbols-outlined text-[18px] text-red-600">
                  {showEmergencyReset ? "expand_less" : "expand_more"}
                </span>
              </button>

              {showEmergencyReset && (
                <div className="pt-2 border-t border-red-200 space-y-3 text-xs text-red-900">
                  <p className="leading-relaxed">
                    <strong>CAUTION:</strong> WKF rules prohibit redrawing once competition starts. Forcing a redraw will <strong>PERMANENTLY ERASE</strong> all {confirmed} confirmed match results, scores, and podiums in this category.
                  </p>
                  <p>To authorize this emergency action, type <strong>RESET</strong> below:</p>
                  <input
                    type="text"
                    value={resetConfirmInput}
                    onChange={(e) => setResetConfirmInput(e.target.value)}
                    placeholder="Type RESET to confirm"
                    className="w-full px-3 py-2 border border-red-300 rounded-lg bg-white font-data-mono text-xs text-red-950 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <button
                    type="button"
                    disabled={resetConfirmInput.trim() !== "RESET" || isRegenerating}
                    onClick={() => handleRegenerate(true)}
                    className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold font-data-mono text-xs transition-colors cursor-pointer"
                  >
                    {isRegenerating ? "PURGING AND REBUILDING..." : "CONFIRM EMERGENCY REDRAW"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
