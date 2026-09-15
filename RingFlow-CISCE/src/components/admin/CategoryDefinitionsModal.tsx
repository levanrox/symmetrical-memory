"use client";

import React, { useEffect, useState } from "react";
import {
  getTournamentCategoryDefinitions,
  saveCategoryDefinitions,
  loadPresetCategoryDefinitions,
} from "@/actions/categoryDefinitions";
import {
  OFFICIAL_PRESETS,
  type CategoryDefinitionInput,
} from "@/lib/constants/categoryPresets";

interface Props {
  tournamentId: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function CategoryDefinitionsModal({
  tournamentId,
  isOpen,
  onClose,
  onSaved,
}: Props) {
  const [definitions, setDefinitions] = useState<CategoryDefinitionInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"table" | "json">("table");
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    getTournamentCategoryDefinitions(tournamentId)
      .then((defs) => {
        const mapped: CategoryDefinitionInput[] = defs.map((d) => ({
          id: d.id,
          categoryName: d.categoryName,
          eventType: d.eventType as any,
          gender: d.gender as any,
          minAge: d.minAge,
          maxAge: d.maxAge,
          minWeight: d.minWeight ? parseFloat(d.minWeight) : null,
          maxWeight: d.maxWeight ? parseFloat(d.maxWeight) : null,
          rules: (d.rules as any) || {},
        }));
        setDefinitions(mapped);
        setJsonInput(JSON.stringify(mapped, null, 2));
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [tournamentId, isOpen]);

  const handleLoadPreset = async (key: string) => {
    if (!confirm(`Load the "${key}" official rule preset? This will configure standard age, gender, and weight categories.`)) return;

    try {
      setSaving(true);
      await loadPresetCategoryDefinitions(tournamentId, key);
      const defs = await getTournamentCategoryDefinitions(tournamentId);
      const mapped: CategoryDefinitionInput[] = defs.map((d) => ({
        id: d.id,
        categoryName: d.categoryName,
        eventType: d.eventType as any,
        gender: d.gender as any,
        minAge: d.minAge,
        maxAge: d.maxAge,
        minWeight: d.minWeight ? parseFloat(d.minWeight) : null,
        maxWeight: d.maxWeight ? parseFloat(d.maxWeight) : null,
        rules: (d.rules as any) || {},
      }));
      setDefinitions(mapped);
      setJsonInput(JSON.stringify(mapped, null, 2));
      alert(`Successfully loaded ${mapped.length} categories from ${key}!`);
      if (onSaved) onSaved();
    } catch (err: any) {
      alert(`Failed to load preset: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    let toSave = definitions;
    if (activeTab === "json") {
      try {
        const parsed = JSON.parse(jsonInput);
        if (!Array.isArray(parsed)) throw new Error("JSON must be an array of category definitions");
        toSave = parsed.map((item) => ({
          categoryName: item.categoryName || item.name || "Untitled",
          eventType: item.eventType || item.event || "kumite",
          gender: item.gender || item.sex || "any",
          minAge: item.minAge != null ? Number(item.minAge) : null,
          maxAge: item.maxAge != null ? Number(item.maxAge) : null,
          minWeight: item.minWeight != null ? Number(item.minWeight) : null,
          maxWeight: item.maxWeight != null ? Number(item.maxWeight) : null,
        }));
      } catch (err: any) {
        setJsonError(err.message);
        return;
      }
    }

    try {
      setSaving(true);
      setJsonError("");
      await saveCategoryDefinitions(tournamentId, toSave);
      alert("Category definitions saved & synced with operational categories!");
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddRow = () => {
    const newRow: CategoryDefinitionInput = {
      categoryName: "New_Category",
      eventType: "kumite",
      gender: "M",
      minAge: 12,
      maxAge: 13,
      minWeight: 40,
      maxWeight: 45,
    };
    const updated = [...definitions, newRow];
    setDefinitions(updated);
    setJsonInput(JSON.stringify(updated, null, 2));
  };

  const handleDeleteRow = (index: number) => {
    const updated = definitions.filter((_, i) => i !== index);
    setDefinitions(updated);
    setJsonInput(JSON.stringify(updated, null, 2));
  };

  const handleUpdateRow = (index: number, field: keyof CategoryDefinitionInput, value: any) => {
    const updated = [...definitions];
    updated[index] = { ...updated[index], [field]: value };
    setDefinitions(updated);
    setJsonInput(JSON.stringify(updated, null, 2));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-[#FAF9F5] w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[#E1DDCF]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#E1DDCF]">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0E9C7C] flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">rule</span>
            </span>
            <div>
              <h2 className="font-bold text-base text-[#1B1815]">
                Official Category Definitions
              </h2>
              <p className="text-xs text-[#68645A]">
                Configure age, gender, and weight rules for automatic athlete assignment
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#F5F3EC] transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-[#FAF9F5] border-b border-[#E1DDCF]">
          {/* Quick presets */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[#68645A] uppercase tracking-wider">
              Presets:
            </span>
            <button
              onClick={() => handleLoadPreset("CISCE_OFFICIAL")}
              disabled={saving}
              className="px-3 py-1 bg-white hover:bg-emerald-50 text-[#0E9C7C] border border-[#0E9C7C]/30 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
            >
              Load CISCE Official (28 Cats)
            </button>
          </div>

          {/* View toggle & Add button */}
          <div className="flex items-center gap-2">
            <div className="flex bg-[#F5F3EC] rounded-lg p-1 border border-[#E1DDCF]">
              <button
                onClick={() => setActiveTab("table")}
                className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                  activeTab === "table" ? "bg-white shadow-xs text-[#0E9C7C]" : "text-[#68645A]"
                }`}
              >
                Table View
              </button>
              <button
                onClick={() => setActiveTab("json")}
                className={`px-3 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                  activeTab === "json" ? "bg-white shadow-xs text-[#0E9C7C]" : "text-[#68645A]"
                }`}
              >
                JSON / Rule Editor
              </button>
            </div>

            {activeTab === "table" && (
              <button
                onClick={handleAddRow}
                className="flex items-center gap-1 px-3 py-1 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Add Category
              </button>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <span className="w-8 h-8 border-3 border-[#0E9C7C] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium text-[#68645A]">Loading definitions...</p>
            </div>
          ) : activeTab === "table" ? (
            <div className="bg-white rounded-xl border border-[#E1DDCF] overflow-hidden shadow-2xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-[#FAF9F5] border-b border-[#E1DDCF]">
                  <tr>
                    <th className="px-4 py-3 font-bold text-[#68645A]">Category Name</th>
                    <th className="px-3 py-3 font-bold text-[#68645A] w-28">Event</th>
                    <th className="px-3 py-3 font-bold text-[#68645A] w-24">Gender</th>
                    <th className="px-3 py-3 font-bold text-[#68645A] w-28">Age Min-Max</th>
                    <th className="px-3 py-3 font-bold text-[#68645A] w-36">Weight (Kg)</th>
                    <th className="px-3 py-3 font-bold text-[#68645A] text-right w-16">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1DDCF]">
                  {definitions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[#8C877C]">
                        No category definitions found. Click &ldquo;Load CISCE Official&rdquo; or &ldquo;Add Category&rdquo; to begin.
                      </td>
                    </tr>
                  ) : (
                    definitions.map((def, idx) => (
                      <tr key={idx} className="hover:bg-[#FAF9F5]/80">
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={def.categoryName}
                            onChange={(e) => handleUpdateRow(idx, "categoryName", e.target.value)}
                            className="w-full bg-white border border-[#E1DDCF] rounded px-2 py-1 font-semibold text-[#1B1815] outline-none focus:border-[#0E9C7C]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={def.eventType}
                            onChange={(e) => handleUpdateRow(idx, "eventType", e.target.value)}
                            className="w-full bg-white border border-[#E1DDCF] rounded px-2 py-1 font-medium outline-none focus:border-[#0E9C7C]"
                          >
                            <option value="kumite">Kumite</option>
                            <option value="kata">Kata</option>
                            <option value="team_kumite">Team Kumite</option>
                            <option value="team_kata">Team Kata</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={def.gender}
                            onChange={(e) => handleUpdateRow(idx, "gender", e.target.value)}
                            className="w-full bg-white border border-[#E1DDCF] rounded px-2 py-1 font-medium outline-none focus:border-[#0E9C7C]"
                          >
                            <option value="M">Male (M)</option>
                            <option value="F">Female (F)</option>
                            <option value="any">Any</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              placeholder="Min"
                              value={def.minAge ?? ""}
                              onChange={(e) => handleUpdateRow(idx, "minAge", e.target.value ? Number(e.target.value) : null)}
                              className="w-12 bg-white border border-[#E1DDCF] rounded px-1.5 py-1 text-center outline-none focus:border-[#0E9C7C]"
                            />
                            <span>-</span>
                            <input
                              type="number"
                              placeholder="Max"
                              value={def.maxAge ?? ""}
                              onChange={(e) => handleUpdateRow(idx, "maxAge", e.target.value ? Number(e.target.value) : null)}
                              className="w-12 bg-white border border-[#E1DDCF] rounded px-1.5 py-1 text-center outline-none focus:border-[#0E9C7C]"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {def.eventType === "kata" || def.eventType === "team_kata" ? (
                            <span className="text-[11px] text-[#8C877C] italic">Ignored for Kata</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                placeholder="Min"
                                step="0.1"
                                value={def.minWeight ?? ""}
                                onChange={(e) => handleUpdateRow(idx, "minWeight", e.target.value ? Number(e.target.value) : null)}
                                className="w-14 bg-white border border-[#E1DDCF] rounded px-1.5 py-1 text-center outline-none focus:border-[#0E9C7C]"
                              />
                              <span>-</span>
                              <input
                                type="number"
                                placeholder="Max"
                                step="0.1"
                                value={def.maxWeight ?? ""}
                                onChange={(e) => handleUpdateRow(idx, "maxWeight", e.target.value ? Number(e.target.value) : null)}
                                className="w-14 bg-white border border-[#E1DDCF] rounded px-1.5 py-1 text-center outline-none focus:border-[#0E9C7C]"
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleDeleteRow(idx)}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
                            title="Delete"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col h-full gap-2">
              <p className="text-xs text-[#68645A]">
                Paste or edit category definition rules in JSON format:
              </p>
              {jsonError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                  {jsonError}
                </div>
              )}
              <textarea
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                  setJsonError("");
                }}
                className="flex-1 w-full bg-white border border-[#E1DDCF] rounded-xl p-4 font-mono text-xs text-[#1B1815] outline-none focus:border-[#0E9C7C] resize-none"
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-white border-t border-[#E1DDCF]">
          <span className="text-xs text-[#68645A]">
            {definitions.length} {definitions.length === 1 ? "category configured" : "categories configured"}
          </span>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[#F5F3EC] hover:bg-[#E1DDCF] text-[#3D3A33] rounded-lg text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white rounded-lg text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">save</span>
              {saving ? "Saving & Syncing..." : "Save & Sync Categories"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
