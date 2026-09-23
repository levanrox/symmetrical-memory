"use server";

import { ensureAdmin } from "@/actions/admin";
import { getInstanceId } from "@/lib/instanceId";
import {
  JUDGE_LAST_TEST_SETTING_KEY,
  JUDGE_SETTING_KEY,
  evaluateJudgeUrlTest,
  getAppSetting,
  getJudgeBaseUrl,
  normaliseBaseUrl,
  probeJudgeHealth,
  resolveEnvBaseUrl,
  setAppSetting,
  type JudgeUrlLastTest,
  type JudgeUrlSource,
  type JudgeUrlTestResult,
} from "@/lib/judgeAccess";

export interface JudgeAccessConfig {
  /** The base URL actually used for judge join links ("" = unset). */
  effectiveBaseUrl: string;
  /** Where the effective value came from. */
  source: JudgeUrlSource;
  /** The DB-stored value (for prefilling the field). */
  dbValue: string;
  /** True when the JUDGE_BASE_URL env var is set (it wins over the DB). */
  envSet: boolean;
  /** Last test outcome, if the admin has ever run one. */
  lastTest: JudgeUrlLastTest | null;
}

/** Parse the persisted last-test record; null on anything unexpected. */
function parseLastTest(raw: string | null): JudgeUrlLastTest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<JudgeUrlLastTest>;
    if (typeof parsed.at !== "string" || typeof parsed.url !== "string") return null;
    return {
      at: parsed.at,
      url: parsed.url,
      ok: parsed.ok === true,
      reachable: parsed.reachable === true,
      instanceMatch: parsed.instanceMatch === true,
      latencyMs: typeof parsed.latencyMs === "number" ? parsed.latencyMs : 0,
      localInstanceId: typeof parsed.localInstanceId === "string" ? parsed.localInstanceId : "",
      remoteInstanceId:
        typeof parsed.remoteInstanceId === "string" ? parsed.remoteInstanceId : null,
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    };
  } catch {
    return null;
  }
}

/** Admin view-model for the Judge Access settings section. */
export async function getJudgeAccessConfig(): Promise<JudgeAccessConfig> {
  await ensureAdmin();
  const fromEnv = resolveEnvBaseUrl();
  const dbValue = normaliseBaseUrl(await getAppSetting(JUDGE_SETTING_KEY));
  const effectiveBaseUrl = fromEnv || dbValue;
  return {
    effectiveBaseUrl,
    source: fromEnv ? "env" : dbValue ? "db" : "unset",
    dbValue,
    envSet: !!fromEnv,
    lastTest: parseLastTest(await getAppSetting(JUDGE_LAST_TEST_SETTING_KEY)),
  };
}

/**
 * Save the admin-pasted judge base URL to app_settings.
 *
 * Refuses to save while JUDGE_BASE_URL is set in the environment, since
 * the env var wins the resolution order and the DB value would be ignored.
 */
export async function saveJudgeBaseUrl(rawUrl: string): Promise<{ saved: string }> {
  await ensureAdmin();
  if (resolveEnvBaseUrl()) {
    throw new Error(
      "JUDGE_BASE_URL is set in the environment; it takes precedence over the saved value. Unset it to manage the URL here.",
    );
  }
  const value = normaliseBaseUrl(rawUrl);
  await setAppSetting(JUDGE_SETTING_KEY, value);
  return { saved: value };
}

/**
 * Test whether a judge base URL reaches THIS server.
 *
 * Fetches `<url>/api/health` (8s server-side timeout), extracts its
 * `instanceId`, and compares it with this process's own ID (read from
 * @/lib/instanceId — never hardcoded). The outcome is persisted to
 * app_settings so the settings page can show the last test + timestamp.
 *
 * Returns `{ ok, reachable, instanceMatch, localInstanceId,
 * remoteInstanceId, latencyMs, error? }`:
 *   ok === true  → "Live — this URL reaches this server"
 *   ok === false → "URL does not reach this server (stale URL? tunnel
 *                   down? typo?)"
 */
export async function testJudgeAccessUrl(url: string): Promise<JudgeUrlTestResult> {
  await ensureAdmin();
  const baseUrl = normaliseBaseUrl(url) || (await getJudgeBaseUrl());
  if (!baseUrl) {
    throw new Error("No judge access URL to test — paste one first, or test the effective URL.");
  }

  const probe = await probeJudgeHealth(baseUrl);
  const result = evaluateJudgeUrlTest(probe, getInstanceId());

  const record: JudgeUrlLastTest = {
    at: new Date().toISOString(),
    url: baseUrl,
    ok: result.ok,
    reachable: result.reachable,
    instanceMatch: result.instanceMatch,
    latencyMs: result.latencyMs,
    localInstanceId: result.localInstanceId,
    remoteInstanceId: result.remoteInstanceId,
    ...(result.error ? { error: result.error } : {}),
  };
  await setAppSetting(JUDGE_LAST_TEST_SETTING_KEY, JSON.stringify(record));

  return result;
}
