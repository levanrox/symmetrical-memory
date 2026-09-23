import { ensureAdmin } from "@/actions/admin";
import {
  JUDGE_LAST_TEST_SETTING_KEY,
  getAppSetting,
  getJudgeBaseUrl,
  type JudgeUrlLastTest,
} from "@/lib/judgeAccess";

/**
 * GET /api/judge-access/status — judge-link status for staff consoles.
 *
 * Admin-only (the value reveals infra topology; consoles poll it on the
 * LAN). Returns:
 *   { mode: "wifi" | "tunnel", baseUrl, lastTest }
 * where `mode` is "wifi" when no public base URL is configured (judges use
 * venue WiFi / same-origin links) and "tunnel" otherwise. `lastTest` is the
 * persisted outcome of the admin's "Test" button, with instance IDs
 * truncated for diagnosis.
 */
export async function GET() {
  await ensureAdmin();
  const baseUrl = await getJudgeBaseUrl();

  let lastTest: (Omit<JudgeUrlLastTest, "localInstanceId" | "remoteInstanceId"> & {
    localInstanceId: string | null;
    remoteInstanceId: string | null;
  }) | null = null;
  const raw = await getAppSetting(JUDGE_LAST_TEST_SETTING_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as JudgeUrlLastTest;
      lastTest = {
        ...parsed,
        localInstanceId: truncateId(parsed.localInstanceId),
        remoteInstanceId: truncateId(parsed.remoteInstanceId),
      };
    } catch {
      lastTest = null;
    }
  }

  return Response.json({
    mode: baseUrl ? "tunnel" : "wifi",
    baseUrl,
    lastTest,
  });
}

function truncateId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
