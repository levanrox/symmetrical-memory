"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmImportAction,
  getImportBatchesAction,
  previewImportAction,
  rollbackImportAction,
} from "@/actions/imports";
import { SKIP_SENTINEL } from "@/lib/imports/types";
import type {
  AthletePreviewRow,
  CategoryPreviewRow,
  ImportBatchSummary,
  ImportKind,
  ImportPreview,
  ImportResolutions,
  ImportSummary,
} from "@/lib/imports/types";

type PreviewData = ImportPreview & { presentColumns: string[]; filename: string };

const ACTION_STYLES: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-800",
  update: "bg-amber-100 text-amber-800",
  entry: "bg-blue-100 text-blue-800",
  skip: "bg-gray-100 text-gray-600",
  error: "bg-red-100 text-red-800",
  blocked: "bg-orange-100 text-orange-800",
  unmatched: "bg-orange-100 text-orange-800",
};

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase ${ACTION_STYLES[action] ?? "bg-gray-100 text-gray-600"}`}
    >
      {action}
    </span>
  );
}

function IssueList({ items, kind }: { items: string[]; kind: "error" | "warning" }) {
  if (items.length === 0) return null;
  const color = kind === "error" ? "text-red-700" : "text-amber-700";
  return (
    <ul className={`text-xs ${color} space-y-0.5 mt-1`}>
      {items.map((m, i) => (
        <li key={i}>
          {kind === "error" ? "✕ " : "⚠ "}{m}
        </li>
      ))}
    </ul>
  );
}

export default function ImportsClient({ tournamentId }: { tournamentId: string }) {
  const [tab, setTab] = useState<"categories" | "athletes" | "history">("categories");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  // Organiser resolutions collected in the preview UI.
  const [eventTypeOverrides, setEventTypeOverrides] = useState<Record<number, CategoryPreviewRow["eventType"]>>({});
  const [categoryResolutions, setCategoryResolutions] = useState<Record<number, string>>({});
  const [unlockIds, setUnlockIds] = useState<string[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);

  const kind: ImportKind = tab === "athletes" ? "athletes" : "categories";

  const refreshBatches = useCallback(async () => {
    try {
      setBatches(await getImportBatchesAction(tournamentId));
    } catch {
      /* non-fatal */
    }
  }, [tournamentId]);

  useEffect(() => {
    refreshBatches();
  }, [refreshBatches]);

  const resetFlow = () => {
    setPreview(null);
    setSummary(null);
    setError(null);
    setEventTypeOverrides({});
    setCategoryResolutions({});
    setUnlockIds([]);
  };

  const switchTab = (t: "categories" | "athletes" | "history") => {
    setTab(t);
    resetFlow();
    if (t === "history") refreshBatches();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    resetFlow();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", file);
      const data = await previewImportAction(tournamentId, fd);
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse the file");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const resolutions: ImportResolutions = {
        eventTypeOverrides,
        categoryResolutions,
        unlockCategoryIds: unlockIds,
      };
      const result = await confirmImportAction(tournamentId, {
        kind,
        filename: preview.filename,
        rows: preview.rows.map((r) => ({ rowNumber: r.row, fields: r.fields })),
        presentColumns: preview.presentColumns,
        resolutions,
      });
      setSummary(result);
      setPreview(null);
      refreshBatches();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async (batchId: string) => {
    if (!window.confirm("Roll back this import batch? Created rows will be deleted and updated rows restored.")) return;
    setRollingBack(batchId);
    try {
      await rollbackImportAction(tournamentId, batchId);
      refreshBatches();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rollback failed");
    } finally {
      setRollingBack(null);
    }
  };

  const toggleUnlock = (id: string) =>
    setUnlockIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const templateUrl = `/api/imports/template?kind=${kind}&tournamentId=${tournamentId}`;

  return (
    <div className="p-4 sm:p-6 md:p-margin-desktop space-y-6 bg-surface pb-24 w-full">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-primary">Data Imports</h2>
          <p className="text-body-sm text-on-surface-variant">
            Import categories and athletes from CSV or Excel. Every import is previewed first,
            recorded as a batch, and can be rolled back.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-outline-variant">
        {(["categories", "athletes", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`px-4 py-2 font-label-caps text-label-caps uppercase ${
              tab === t
                ? "text-primary border-b-2 border-primary -mb-px"
                : "text-on-surface-variant hover:text-primary"
            }`}
          >
            {t === "history" ? `History (${batches.length})` : t}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{error}</div>
      )}

      {tab === "history" ? (
        <HistoryTab batches={batches} rollingBack={rollingBack} onRollback={handleRollback} />
      ) : (
        <>
          {/* Step 1: template + upload */}
          <div className="flex flex-wrap gap-3 items-center">
            <a
              href={templateUrl}
              className="px-4 py-2 border border-outline text-primary font-label-caps text-label-caps rounded flex items-center gap-2 hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Download {kind} template
            </a>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-4 py-2 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-label-caps text-label-caps rounded flex items-center gap-2 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">upload</span>
              {busy ? "Working…" : "Upload CSV / Excel"}
            </button>
            {preview && (
              <button
                onClick={resetFlow}
                className="px-4 py-2 border border-outline text-on-surface-variant font-label-caps text-label-caps rounded"
              >
                Choose different file
              </button>
            )}
          </div>

          {/* Step 2: preview */}
          {preview && (
            <PreviewSection
              preview={preview}
              eventTypeOverrides={eventTypeOverrides}
              setEventTypeOverrides={setEventTypeOverrides}
              categoryResolutions={categoryResolutions}
              setCategoryResolutions={setCategoryResolutions}
              unlockIds={unlockIds}
              toggleUnlock={toggleUnlock}
              busy={busy}
              onConfirm={handleConfirm}
            />
          )}

          {/* Step 3: result */}
          {summary && <SummarySection summary={summary} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PreviewSection(props: {
  preview: PreviewData;
  eventTypeOverrides: Record<number, CategoryPreviewRow["eventType"]>;
  setEventTypeOverrides: React.Dispatch<React.SetStateAction<Record<number, CategoryPreviewRow["eventType"]>>>;
  categoryResolutions: Record<number, string>;
  setCategoryResolutions: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  unlockIds: string[];
  toggleUnlock: (id: string) => void;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { preview } = props;
  const counts = { create: 0, update: 0, entry: 0, skip: 0, error: 0, blocked: 0, unmatched: 0 };
  for (const r of preview.rows) {
    const a = r.action as keyof typeof counts;
    if (a in counts) counts[a]++;
  }
  // Unmatched rows the organiser already resolved (picked a category or chose
  // to skip) no longer block the confirm.
  const unresolvedUnmatched =
    preview.kind === "athletes"
      ? preview.rows.filter(
          (r) => r.action === "unmatched" && !props.categoryResolutions[r.row]
        ).length
      : 0;
  const hasBlockingErrors = counts.error > 0 || unresolvedUnmatched > 0;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded border border-outline-variant bg-surface-container-lowest">
        <h3 className="font-semibold text-primary">Preview — {preview.filename}</h3>
        <p className="text-sm text-on-surface-variant mt-1">
          {preview.rows.length} rows:{" "}
          {Object.entries(counts)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${v} ${k}`)
            .join(" · ")}
        </p>
        {preview.lockedCategoryIds.length > 0 && (
          <div className="mt-3 p-3 rounded bg-orange-50 border border-orange-200">
            <p className="text-sm font-semibold text-orange-800">
              {preview.lockedCategoryIds.length} categor{preview.lockedCategoryIds.length === 1 ? "y has" : "ies have"} a locked draw
            </p>
            {preview.lockedCategoryIds.map((id) => (
              <label key={id} className="flex items-center gap-2 mt-2 text-sm text-orange-900">
                <input
                  type="checkbox"
                  checked={props.unlockIds.includes(id)}
                  onChange={() => props.toggleUnlock(id)}
                />
                Void the draw for “{preview.lockedCategoryNames[id]}” and unlock it for this import
              </label>
            ))}
            <p className="text-xs text-orange-700 mt-2">
              Voiding returns the draw to draft and records the old bracket in the draw history.
              The draw must be regenerated afterwards.
            </p>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-outline-variant">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-container-low text-left">
              <th className="p-2">Row</th>
              <th className="p-2">Details</th>
              <th className="p-2">Match</th>
              <th className="p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {preview.kind === "categories"
              ? preview.rows.map((r) => (
                  <CategoryRowView
                    key={r.row}
                    row={r as CategoryPreviewRow}
                    override={props.eventTypeOverrides[r.row]}
                    setOverride={(v) =>
                      props.setEventTypeOverrides((prev) => ({ ...prev, [r.row]: v }))
                    }
                  />
                ))
              : preview.rows.map((r) => (
                  <AthleteRowView
                    key={r.row}
                    row={r as AthletePreviewRow}
                    resolution={props.categoryResolutions[r.row]}
                    setResolution={(v) =>
                      props.setCategoryResolutions((prev) => ({ ...prev, [r.row]: v }))
                    }
                  />
                ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={props.onConfirm}
          disabled={props.busy || hasBlockingErrors}
          className="px-6 py-2 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-label-caps text-label-caps rounded disabled:opacity-50"
        >
          {props.busy ? "Importing…" : "Confirm & import"}
        </button>
        {hasBlockingErrors && (
          <p className="text-sm text-red-700">
            Resolve the unmatched rows above (pick a category or skip them) and fix rows with
            errors before confirming — valid rows are never blocked by invalid ones.
          </p>
        )}
      </div>
    </div>
  );
}

function CategoryRowView({
  row,
  override,
  setOverride,
}: {
  row: CategoryPreviewRow;
  override?: CategoryPreviewRow["eventType"];
  setOverride: (v: CategoryPreviewRow["eventType"]) => void;
}) {
  const f = row.fields;
  return (
    <tr className="border-t border-outline-variant align-top">
      <td className="p-2 text-on-surface-variant">{row.row}</td>
      <td className="p-2">
        <div className="font-medium">{f.name || <em className="text-red-600">(no name)</em>}</div>
        <div className="text-xs text-on-surface-variant">
          {[f.code && `code ${f.code}`, f.sex || "any sex", f.age_min && f.age_max ? `${f.age_min}–${f.age_max}` : "", f.weight_class, f.belt, f.day]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-on-surface-variant">
            Event: {override ?? row.eventType}
            {row.eventTypeInferred && !override && " (inferred)"}
          </span>
          <select
            value={override ?? ""}
            onChange={(e) => e.target.value && setOverride(e.target.value as CategoryPreviewRow["eventType"])}
            className="border border-outline rounded px-1 py-0.5 text-xs bg-surface"
            aria-label={`Override event type for row ${row.row}`}
          >
            <option value="">Override…</option>
            {(["kata", "kumite", "team_kata", "team_kumite"] as const).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <IssueList items={row.errors} kind="error" />
        <IssueList items={row.warnings} kind="warning" />
      </td>
      <td className="p-2 text-xs text-on-surface-variant">
        {row.matchedCategoryName ? `Matches “${row.matchedCategoryName}”` : "New category"}
        {row.drawLocked && <div className="text-orange-700 font-semibold">Draw locked</div>}
      </td>
      <td className="p-2"><ActionBadge action={row.action} /></td>
    </tr>
  );
}

function AthleteRowView({
  row,
  resolution,
  setResolution,
}: {
  row: AthletePreviewRow;
  resolution?: string;
  setResolution: (v: string) => void;
}) {
  const f = row.fields;
  const needsResolution = row.action === "unmatched";
  const resolvedName =
    resolution && resolution !== SKIP_SENTINEL
      ? row.suggestions.find((s) => s.id === resolution)?.name ?? "chosen category"
      : null;
  return (
    <tr className="border-t border-outline-variant align-top">
      <td className="p-2 text-on-surface-variant">{row.row}</td>
      <td className="p-2">
        <div className="font-medium">{f.name || <em className="text-red-600">(no name)</em>}</div>
        <div className="text-xs text-on-surface-variant">
          {[f.sports_id && `sports_id ${f.sports_id}`,
            row.chestNumber && `chest #${row.chestNumber}${row.chestNumberAuto ? " (auto)" : ""}`,
            f.sex, f.age && `${f.age}y`, f.weight && `${f.weight}kg`, f.belt, f.school]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {needsResolution && (
          <div className="mt-2">
            <label className="text-xs text-on-surface-variant">
              {row.suggestions.length > 0 ? "Did you mean…?" : "No close match —"}
            </label>
            <select
              value={resolution ?? ""}
              onChange={(e) => setResolution(e.target.value)}
              className="ml-2 border border-outline rounded px-1 py-0.5 text-xs bg-surface max-w-[220px]"
            >
              <option value="">Choose…</option>
              {row.suggestions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.code ? ` (${s.code})` : ""}
                </option>
              ))}
              <option value={SKIP_SENTINEL}>Leave unmatched (skip row)</option>
            </select>
          </div>
        )}
        <IssueList items={row.errors} kind="error" />
        <IssueList items={row.warnings} kind="warning" />
      </td>
      <td className="p-2 text-xs text-on-surface-variant">
        {row.matchedCategoryName ? (
          <>
            “{row.matchedCategoryName}”
            <div>via {row.categoryMatch}</div>
          </>
        ) : resolution === SKIP_SENTINEL ? (
          "Skipped by organiser"
        ) : resolvedName ? (
          <>“{resolvedName}”<div>via organiser choice</div></>
        ) : (
          "No category"
        )}
        {row.drawLocked && <div className="text-orange-700 font-semibold">Draw locked</div>}
      </td>
      <td className="p-2"><ActionBadge action={row.action} /></td>
    </tr>
  );
}

function SummarySection({ summary }: { summary: ImportSummary }) {
  return (
    <div className="p-4 rounded border border-emerald-200 bg-emerald-50 space-y-2">
      <h3 className="font-semibold text-emerald-900">Import complete</h3>
      <p className="text-sm text-emerald-800">
        Created {summary.created} · Updated {summary.updated} · Skipped {summary.skipped}
        {summary.errors.length > 0 && ` · ${summary.errors.length} row errors (not imported)`}
      </p>
      {summary.voidedDraws.length > 0 && (
        <p className="text-sm text-orange-800">
          ⚠ {summary.voidedDraws.length} locked draw{summary.voidedDraws.length === 1 ? " was" : "s were"} voided — regenerate {summary.voidedDraws.length === 1 ? "it" : "them"} before the event.
        </p>
      )}
      {summary.errors.length > 0 && (
        <ul className="text-xs text-red-700 space-y-0.5">
          {summary.errors.map((e, i) => (
            <li key={i}>Row {e.row}: {e.message}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-emerald-700">Batch {summary.batchId} — reversible from the History tab.</p>
    </div>
  );
}

function HistoryTab({
  batches,
  rollingBack,
  onRollback,
}: {
  batches: ImportBatchSummary[];
  rollingBack: string | null;
  onRollback: (id: string) => void;
}) {
  if (batches.length === 0) {
    return <p className="text-on-surface-variant text-sm">No import batches yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded border border-outline-variant">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-container-low text-left">
            <th className="p-2">When</th>
            <th className="p-2">Kind</th>
            <th className="p-2">File</th>
            <th className="p-2">Created / Updated / Skipped / Errors</th>
            <th className="p-2">By</th>
            <th className="p-2">Status</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} className="border-t border-outline-variant">
              <td className="p-2 text-xs">{new Date(b.createdAt).toLocaleString()}</td>
              <td className="p-2">{b.kind}</td>
              <td className="p-2 text-xs">{b.filename ?? "—"}</td>
              <td className="p-2 text-xs">
                {b.rowCounts.created} / {b.rowCounts.updated} / {b.rowCounts.skipped} / {b.rowCounts.errors}
              </td>
              <td className="p-2 text-xs">{b.createdBy ?? "—"}</td>
              <td className="p-2">
                {b.rolledBackAt ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase bg-gray-200 text-gray-700">
                    Rolled back
                  </span>
                ) : (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase bg-emerald-100 text-emerald-800">
                    Active
                  </span>
                )}
              </td>
              <td className="p-2">
                {!b.rolledBackAt && (
                  <button
                    onClick={() => onRollback(b.id)}
                    disabled={rollingBack === b.id}
                    className="px-3 py-1 border border-red-300 text-red-700 text-xs rounded hover:bg-red-50 disabled:opacity-50"
                  >
                    {rollingBack === b.id ? "Rolling back…" : "Roll back"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
