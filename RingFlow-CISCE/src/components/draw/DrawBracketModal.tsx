"use client";

import React, { useEffect, useState } from "react";
import { getAthleteDraw, getCategoryDraw } from "@/actions/draws";
import { downloadCategoryDrawPdf } from "@/actions/drawPdfs";
import { DrawBracket } from "./DrawBracket";
import { KataDrawTables } from "./KataDrawTables";

interface Props {
  categoryId: string;
  categoryName: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectMatch?: (match: any) => void;
  activeMatchId?: string | null;
  /** Load the draw through one athlete's search result instead of as a whole tree. */
  athleteId?: string | null;
  /** Extra line under the title, e.g. "Showing <name>'s path". */
  subtitle?: string;
  /** Draw sheets are an official artifact; the public side does not get them. */
  allowPdf?: boolean;
}

export function DrawBracketModal({
  categoryId,
  categoryName,
  isOpen,
  onClose,
  onSelectMatch,
  activeMatchId,
  athleteId,
  subtitle,
  allowPdf = true,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [drawData, setDrawData] = useState<any>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setLoading(true);

    const request = athleteId ? getAthleteDraw(athleteId) : getCategoryDraw(categoryId);

    request
      .then((data) => {
        if (mounted) {
          setDrawData(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load category draw:", err);
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [categoryId, isOpen, athleteId]);

  const handleDownloadPdf = async () => {
    try {
      setIsDownloadingPdf(true);
      const res = await downloadCategoryDrawPdf(categoryId);
      if (res.success && res.base64) {
        // Download base64 as PDF
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = res.filename;
        link.click();
      }
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-[#FAF9F5] w-full max-w-6xl h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#E1DDCF]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E1DDCF]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0E9C7C] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">account_tree</span>
            </span>
            <div>
              <h2 className="font-bold text-base text-[#1B1815]">
                {categoryName || drawData?.categoryName || "Draw bracket"}
              </h2>
              <p className="text-xs text-[#68645A]">
                {subtitle ||
                  (athleteId
                    ? "Showing this athlete's path, highlighted in the bracket"
                    : "Live bracket with bout results")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-4 overflow-hidden">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <span className="w-8 h-8 border-3 border-[#0E9C7C] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium text-[#68645A]">Loading draw...</p>
            </div>
          ) : drawData?.locked ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <span className="material-symbols-outlined text-4xl text-[#8C877C] mb-2">
                lock
              </span>
              <h3 className="font-bold text-base text-[#1B1815] mb-1">Bracket not published</h3>
              <p className="text-xs text-[#68645A] max-w-sm mb-4">
                The organiser has not opened the live bracket for spectators. Search for an
                athlete to see their own path through this draw.
              </p>
            </div>
          ) : !drawData || !drawData.matches || drawData.matches.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6">
              <span className="material-symbols-outlined text-4xl text-[#8C877C] mb-2">
                schema
              </span>
              <h3 className="font-bold text-base text-[#1B1815] mb-1">No Draw Generated Yet</h3>
              <p className="text-xs text-[#68645A] max-w-sm mb-4">
                This category doesn&apos;t have an active digital draw. Click &ldquo;Generate Digital Draw&rdquo; in category options to create one.
              </p>
            </div>
          ) : drawData.kataDraw ? (
            /* Kata group formats render as tables (one per group, every
               participant named), not as a tree — the scoring-sheet view. */
            <KataDrawTables
              kataDraw={drawData.kataDraw}
              matches={drawData.matches}
              categoryName={categoryName || drawData.categoryName || "Draw"}
              tournamentSize={drawData.draw?.tournamentSize}
              highlightAthleteId={drawData.highlightAthleteId ?? athleteId ?? null}
              activeMatchId={activeMatchId}
              onDownloadPdf={allowPdf ? handleDownloadPdf : undefined}
              isDownloadingPdf={isDownloadingPdf}
              onSelectMatch={
                onSelectMatch
                  ? (m) => {
                      onSelectMatch(m);
                      onClose();
                    }
                  : undefined
              }
            />
          ) : (
            <DrawBracket
              matches={drawData.matches}
              categoryName={categoryName || drawData.categoryName || "Draw"}
              tournamentSize={drawData.draw?.tournamentSize}
              bronzeMedals={drawData.bronzeMedals ?? 2}
              podium={drawData.podium ?? null}
              highlightAthleteId={drawData.highlightAthleteId ?? athleteId ?? null}
              activeMatchId={activeMatchId}
              onDownloadPdf={allowPdf ? handleDownloadPdf : undefined}
              isDownloadingPdf={isDownloadingPdf}
              onSelectMatch={
                onSelectMatch
                  ? (m) => {
                      onSelectMatch(m);
                      onClose();
                    }
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
