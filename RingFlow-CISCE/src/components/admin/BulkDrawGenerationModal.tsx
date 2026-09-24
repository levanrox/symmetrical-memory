"use client";

import React, { useState, useEffect } from "react";
import {
  getTournamentDrawPreflight,
  generateAllTournamentDraws,
} from "@/actions/draws";
import type { DrawPreflightReport, DrawPreflightItem } from "@/lib/draws/generateDraws";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: string;
  onCompleted: () => void;
}

export function BulkDrawGenerationModal({
  isOpen,
  onClose,
  tournamentId,
  onCompleted,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<DrawPreflightReport | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "protected" | "skipped">("generate");
  const [search, setSearch] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    generated: number;
    protected: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setExecutionResult(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    getTournamentDrawPreflight(tournamentId)
      .then((data) => {
        if (mounted) {
          setReport(data);
          setLoading(false);
          // If none to generate, default to protected tab
          if (data.toGenerate.length === 0 && data.protected.length > 0) {
            setActiveTab("protected");
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load draw preflight:", err);
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, tournamentId]);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      const res = await generateAllTournamentDraws(tournamentId);
      setExecutionResult({
        generated: res.generatedCount,
        protected: res.protectedCount,
        skipped: res.skippedCount,
        errors: res.errors || [],
      });
      onCompleted();
    } catch (err: any) {
      alert(`Generation failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
    }
  };

  if (!isOpen) return null;

  const currentList: DrawPreflightItem[] =
    activeTab === "generate"
      ? report?.toGenerate || []
      : activeTab === "protected"
      ? report?.protected || []
      : report?.skipped || [];

  const filteredList = currentList.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-[#FAF9F5] w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#E1DDCF]">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E1DDCF]">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-emerald-50 text-[#0E9C7C] flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">auto_mode</span>
            </span>
            <div>
              <h2 className="font-bold text-base text-[#1B1815]">Batch Tournament Draw Provisioning</h2>
              <p className="text-xs text-[#68645A]">
                Intelligent bracket generation with automatic protection for active and locked divisions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-hidden flex flex-col flex-1 max-h-[75vh]">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
              <span className="w-8 h-8 border-3 border-[#0E9C7C] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium text-[#68645A]">
                Analyzing tournament categories, match progression, and lock statuses...
              </p>
            </div>
          ) : executionResult ? (
            /* Execution Summary View */
            <div className="py-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-800 mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">check</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#1B1815]">Draw Provisioning Complete!</h3>
                <p className="text-xs text-[#68645A] max-w-md mx-auto mt-1">
                  Brackets have been computed with seeded school separation and bye assignments.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto pt-2 font-data-mono">
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="block text-[11px] font-bold text-emerald-800 uppercase">Generated</span>
                  <span className="text-xl font-bold text-emerald-900">{executionResult.generated}</span>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <span className="block text-[11px] font-bold text-amber-800 uppercase">Protected</span>
                  <span className="text-xl font-bold text-amber-900">{executionResult.protected}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-100 border border-slate-200">
                  <span className="block text-[11px] font-bold text-slate-700 uppercase">Skipped</span>
                  <span className="text-xl font-bold text-slate-900">{executionResult.skipped}</span>
                </div>
              </div>

              {executionResult.errors.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-left text-xs text-amber-900 max-w-md mx-auto max-h-32 overflow-y-auto">
                  <span className="font-bold block mb-1">Notices:</span>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {executionResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-bold font-data-mono text-xs transition-colors cursor-pointer"
                >
                  RETURN TO CATEGORIES
                </button>
              </div>
            </div>
          ) : (
            /* Pre-flight Impact Matrix */
            <div className="flex flex-col flex-1 space-y-4 overflow-hidden">
              {/* Metric Cards */}
              <div className="grid grid-cols-3 gap-3 font-data-mono">
                <button
                  type="button"
                  onClick={() => setActiveTab("generate")}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    activeTab === "generate"
                      ? "border-[#0E9C7C] bg-emerald-50/60 shadow-xs"
                      : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#0E9C7C] uppercase tracking-wider">
                      Will Generate
                    </span>
                    <span className="w-2 h-2 rounded-full bg-[#0E9C7C]" />
                  </div>
                  <span className="text-2xl font-bold text-[#1B1815] mt-1 block">
                    {report?.toGenerate.length ?? 0}
                  </span>
                  <span className="text-[10px] text-[#68645A] block mt-0.5">New & draft divisions</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("protected")}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    activeTab === "protected"
                      ? "border-amber-500 bg-amber-50/60 shadow-xs"
                      : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                      Protected
                    </span>
                    <span className="material-symbols-outlined text-[14px] text-amber-600">lock</span>
                  </div>
                  <span className="text-2xl font-bold text-[#1B1815] mt-1 block">
                    {report?.protected.length ?? 0}
                  </span>
                  <span className="text-[10px] text-[#68645A] block mt-0.5">Active, scored or locked</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("skipped")}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    activeTab === "skipped"
                      ? "border-slate-500 bg-slate-100 shadow-xs"
                      : "border-[#E1DDCF] bg-white hover:border-[#C0BAA8]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      Skipped
                    </span>
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                  </div>
                  <span className="text-2xl font-bold text-[#1B1815] mt-1 block">
                    {report?.skipped.length ?? 0}
                  </span>
                  <span className="text-[10px] text-[#68645A] block mt-0.5">&lt; 2 athletes registered</span>
                </button>
              </div>

              {/* Explanatory Banner */}
              <div className="p-3 rounded-xl border border-[#E1DDCF] bg-white text-xs text-[#504C42] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#0E9C7C]">verified_user</span>
                  <span>
                    <strong>Zero-Wipe Guarantee:</strong> All {report?.protected.length ?? 0} active, locked, or completed categories will be <strong>untouched and 100% preserved</strong>.
                  </span>
                </div>
              </div>

              {/* Filter and Category List */}
              <div className="flex-1 flex flex-col overflow-hidden border border-[#E1DDCF] rounded-xl bg-white shadow-xs">
                <div className="p-2.5 border-b border-[#E1DDCF] bg-[#FAF9F5] flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1B1815] font-data-mono">
                    {activeTab === "generate" && `Categories Ready to Generate (${filteredList.length})`}
                    {activeTab === "protected" && `Protected Categories Preserved (${filteredList.length})`}
                    {activeTab === "skipped" && `Skipped Ineligible Categories (${filteredList.length})`}
                  </span>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search category name..."
                    className="px-2.5 py-1 text-xs border border-[#E1DDCF] rounded-lg bg-white w-48 focus:outline-none focus:ring-1 focus:ring-[#0E9C7C]"
                  />
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-[#F0ECE1]">
                  {filteredList.length === 0 ? (
                    <div className="p-6 text-center text-xs text-[#8C877C] italic">
                      No categories found in this section.
                    </div>
                  ) : (
                    filteredList.map((c) => (
                      <div key={c.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-[#FAF9F5] transition-colors">
                        <div>
                          <span className="text-xs font-bold text-[#1B1815] block">{c.name}</span>
                          <span className="text-[11px] text-[#68645A] font-data-mono">
                            {c.athletesCount} athletes registered • {c.reason}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-bold font-data-mono px-2 py-0.5 rounded ${
                            c.action === "GENERATE"
                              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                              : c.action === "PROTECT"
                              ? "bg-amber-50 text-amber-900 border border-amber-200"
                              : "bg-slate-100 text-slate-700 border border-slate-200"
                          }`}
                        >
                          {c.action}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#E1DDCF]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isExecuting}
                  className="px-4 py-2 rounded-xl border border-[#E1DDCF] text-xs font-bold font-data-mono text-[#504C42] hover:bg-[#F5F3EC] transition-colors cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  type="button"
                  disabled={isExecuting || (report?.toGenerate.length ?? 0) === 0}
                  onClick={handleExecute}
                  className="px-6 py-2.5 rounded-xl bg-[#0E9C7C] hover:bg-[#0B7C63] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold font-data-mono tracking-wider transition-colors cursor-pointer flex items-center gap-2 shadow-sm"
                >
                  {isExecuting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>PROVISIONING DRAWS...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                      <span>GENERATE {report?.toGenerate.length ?? 0} CATEGORIES</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
