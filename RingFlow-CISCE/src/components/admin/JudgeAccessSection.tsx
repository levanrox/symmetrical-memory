"use client";

import React, { useState } from "react";
import {
  getJudgeAccessConfig,
  saveJudgeBaseUrl,
  testJudgeAccessUrl,
  type JudgeAccessConfig,
} from "@/actions/judgeAccess";
import type { JudgeUrlTestResult } from "@/lib/judgeAccess";

interface Props {
  initial: JudgeAccessConfig;
}

function truncateId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatTestTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

const SOURCE_LABELS: Record<JudgeAccessConfig["source"], { text: string; className: string }> = {
  env: {
    text: "ENV VAR",
    className: "bg-tertiary-fixed text-on-tertiary-fixed",
  },
  db: {
    text: "SAVED",
    className: "bg-green-500/10 text-green-700 border border-green-500/30",
  },
  unset: {
    text: "NOT SET",
    className: "bg-surface-container-highest text-on-surface-variant",
  },
};

export default function JudgeAccessSection({ initial }: Props) {
  const [config, setConfig] = useState(initial);
  const [value, setValue] = useState(initial.dbValue);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<JudgeUrlTestResult | null>(null);

  const refresh = async () => {
    try {
      const fresh = await getJudgeAccessConfig();
      setConfig(fresh);
      setValue(fresh.dbValue);
    } catch (err) {
      console.error("[judge-access] refresh failed:", err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { saved } = await saveJudgeBaseUrl(value);
      setValue(saved);
      await refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to save judge access URL.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setResult(null);
    try {
      const res = await testJudgeAccessUrl(value);
      setResult(res);
      await refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to test judge access URL.");
    } finally {
      setIsTesting(false);
    }
  };

  const source = SOURCE_LABELS[config.source];

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-sm space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-label-caps text-label-caps text-secondary mb-1">Judge Access</h3>
          <p className="text-body-sm text-on-surface-variant max-w-2xl">
            Judges open scoring links on their own phones — either over venue WiFi
            (server offline) or over their own mobile data via a public tunnel.
            Paste the tunnel&apos;s public URL below and press <strong>Test</strong>;
            the test proves the URL reaches <em>this</em> server before judges scan
            any QR code. This is a server-wide setting, shared by all events.
          </p>
        </div>
        <span className="material-symbols-outlined text-secondary text-2xl">qr_code_2</span>
      </div>

      {/* Effective URL + source */}
      <div className="p-4 bg-surface-container-low border border-outline-variant rounded-xl flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-label-caps text-on-surface-variant uppercase tracking-wider">
            Effective judge URL
          </span>
          <span className={`px-2 py-0.5 rounded font-label-caps text-[10px] font-bold ${source.className}`}>
            {source.text}
          </span>
        </div>
        {config.effectiveBaseUrl ? (
          <p className="font-data-mono text-sm text-primary break-all select-all">
            {config.effectiveBaseUrl}
          </p>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            Venue WiFi / same-origin mode — judge links are relative
            (<span className="font-data-mono">/j/…</span>) and only work on the event network.
          </p>
        )}
      </div>

      {/* Edit field */}
      <div className="flex flex-col gap-2">
        <label className="font-label-caps text-[10px] text-on-surface-variant">
          JUDGE ACCESS URL (PUBLIC BASE URL)
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            inputMode="url"
            placeholder="https://your-tunnel.trycloudflare.com"
            value={value}
            disabled={config.envSet}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !config.envSet) handleSave();
            }}
            className="flex-1 p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-body-md font-data-mono disabled:bg-surface-container-low disabled:text-on-surface-variant"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={config.envSet || isSaving}
              className="px-5 py-2.5 bg-primary text-white font-label-caps text-label-caps rounded hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              {isSaving ? "SAVING…" : "SAVE"}
            </button>
            <button
              onClick={handleTest}
              disabled={isTesting || (!value.trim() && !config.effectiveBaseUrl)}
              className="px-5 py-2.5 bg-secondary text-white font-label-caps text-label-caps rounded hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              title="Fetch <url>/api/health and verify it reaches this server"
            >
              <span className="material-symbols-outlined text-[16px]">cell_tower</span>
              {isTesting ? "TESTING…" : "TEST"}
            </button>
          </div>
        </div>
        {config.envSet ? (
          <p className="text-body-xs text-amber-800 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <span className="font-bold">Managed by the environment:</span> the{" "}
            <span className="font-data-mono">JUDGE_BASE_URL</span> env var is set, so it takes
            precedence and the field above is read-only. Unset the env var (and restart) to
            manage the URL here instead.
          </p>
        ) : (
          <p className="text-body-xs text-on-surface-variant">
            Paste the URL printed by <span className="font-data-mono">./scripts/start-judge-tunnel.sh</span>.
            Leave empty to stay in venue WiFi / same-origin mode.
          </p>
        )}
      </div>

      {/* Test result */}
      {result && (
        <div
          className={`p-4 rounded-xl border ${
            result.ok
              ? "bg-green-500/10 border-green-500/40"
              : "bg-error/5 border-error/30"
          }`}
          role="status"
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`material-symbols-outlined text-[20px] ${
                result.ok ? "text-green-700" : "text-error"
              }`}
            >
              {result.ok ? "check_circle" : "error"}
            </span>
            <span
              className={`font-bold text-sm ${
                result.ok ? "text-green-800" : "text-error"
              }`}
            >
              {result.ok
                ? "Live — this URL reaches this server"
                : "URL does not reach this server (stale URL? tunnel down? typo?)"}
            </span>
          </div>
          {!result.reachable && result.error && (
            <p className="text-body-xs text-on-surface-variant mb-2">{result.error}</p>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-body-xs text-on-surface-variant mt-2">
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider">This server</dt>
              <dd className="font-data-mono">{truncateId(result.localInstanceId)}</dd>
            </div>
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider">Remote URL</dt>
              <dd className="font-data-mono">{truncateId(result.remoteInstanceId)}</dd>
            </div>
            <div>
              <dt className="font-label-caps text-[10px] uppercase tracking-wider">Latency</dt>
              <dd className="font-data-mono">{result.latencyMs} ms</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Last test */}
      {config.lastTest && !result && (
        <div className="flex items-center gap-2 text-body-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px]">history</span>
          <span suppressHydrationWarning>
            Last test:{" "}
            <strong className={config.lastTest.ok ? "text-green-700" : "text-error"}>
              {config.lastTest.ok ? "passed" : "failed"}
            </strong>{" "}
            · {formatTestTime(config.lastTest.at)} · {config.lastTest.latencyMs} ms
          </span>
        </div>
      )}
    </section>
  );
}
