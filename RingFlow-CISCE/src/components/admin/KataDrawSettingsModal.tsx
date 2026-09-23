"use client";

import React, { useState } from "react";
import {
  KATA_DRAW_FORMAT_OPTIONS,
  KATA_RANKING_METHOD_OPTIONS,
} from "@/lib/draws/kataSettings";

export interface KataDrawSettingsDraft {
  /** "" = event default (single elimination). */
  kataFormat: string;
  /** "" = event default (WKF victory points). */
  kataRankingMethod: string;
  /** "" = default (2). */
  kataAdvancePerGroup: string;
  /** "" = default (WKF 3.7.9 group sizing). */
  kataGroupSize: string;
}

interface Props {
  categoryName: string;
  initial: KataDrawSettingsDraft;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: KataDrawSettingsDraft) => void;
}

const fieldLabel =
  "block font-label-caps text-[11px] text-on-surface-variant mb-1";
const selectClass =
  "w-full rounded-lg border border-outline-variant bg-white px-3 py-3 text-sm text-[#3D3A33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]";
const inputClass =
  "w-full rounded-lg border border-outline-variant bg-white px-3 py-3 text-sm font-data-mono text-[#3D3A33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]";

export function KataDrawSettingsModal({
  categoryName,
  initial,
  saving,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<KataDrawSettingsDraft>(initial);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Kata draw settings for ${categoryName}`}
    >
      <div
        className="bg-[#FAF9F5] w-full max-w-md rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#E1DDCF]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E1DDCF]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-emerald-50 text-[#0E9C7C] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">tune</span>
            </span>
            <div className="min-w-0">
              <h2 className="font-bold text-[#1B1815] text-base leading-tight truncate">
                Kata draw settings
              </h2>
              <p className="text-xs text-[#68645A] truncate">{categoryName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className={fieldLabel} htmlFor="kata-draw-format">
              Draw format
            </label>
            <select
              id="kata-draw-format"
              value={draft.kataFormat}
              onChange={(e) =>
                setDraft({ ...draft, kataFormat: e.target.value })
              }
              className={selectClass}
            >
              <option value="">Elimination (default)</option>
              {KATA_DRAW_FORMAT_OPTIONS.filter(
                (o) => o.value !== "SINGLE_ELIM_REPECHAGE"
              ).map((o) => (
                <option key={o.value} value={o.value} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#68645A] mt-1">
              {
                KATA_DRAW_FORMAT_OPTIONS.find((o) => o.value === draft.kataFormat)
                  ?.hint
              }
            </p>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="kata-ranking-method">
              Group ranking
            </label>
            <select
              id="kata-ranking-method"
              value={draft.kataRankingMethod}
              onChange={(e) =>
                setDraft({ ...draft, kataRankingMethod: e.target.value })
              }
              className={selectClass}
            >
              <option value="">Victory points (default)</option>
              {KATA_RANKING_METHOD_OPTIONS.filter(
                (o) => o.value !== "WKF_VICTORY_POINTS"
              ).map((o) => (
                <option key={o.value} value={o.value} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#68645A] mt-1">
              {
                KATA_RANKING_METHOD_OPTIONS.find(
                  (o) => o.value === draft.kataRankingMethod
                )?.hint
              }
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel} htmlFor="kata-advance-per-group">
                Advance / group
              </label>
              <input
                id="kata-advance-per-group"
                type="number"
                min={1}
                max={8}
                inputMode="numeric"
                placeholder="2"
                value={draft.kataAdvancePerGroup}
                onChange={(e) =>
                  setDraft({ ...draft, kataAdvancePerGroup: e.target.value })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={fieldLabel} htmlFor="kata-group-size">
                Group size
              </label>
              <input
                id="kata-group-size"
                type="number"
                min={2}
                max={128}
                inputMode="numeric"
                placeholder="WKF 3.7.9"
                value={draft.kataGroupSize}
                onChange={(e) =>
                  setDraft({ ...draft, kataGroupSize: e.target.value })
                }
                className={inputClass}
              />
            </div>
          </div>
          <p className="text-[11px] text-[#68645A]">
            Blank fields use the defaults. Settings apply the next time the
            draw is generated.
          </p>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-[#E1DDCF] bg-[#F5F3EC]">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-3 border border-outline-variant rounded-xl text-sm font-bold text-[#3D3A33] hover:bg-white transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving}
            className="flex-1 px-4 py-3 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white rounded-xl text-sm font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
