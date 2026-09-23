/**
 * Unit tests for the judge-access plumbing (src/lib/judgeAccess.ts).
 *
 * These cover the pure functions used by src/proxy.ts (IP gating) and the
 * QR-link URL builder. DB-backed getJudgeBaseUrl()/getAppSetting() are not
 * exercised here (they need a live database); env-var resolution is covered
 * via JUDGE_BASE_URL.
 */

import { describe, expect, it, afterEach } from "vitest";
import {
  getClientIp,
  isPrivateIp,
  isRestrictedPath,
  normaliseBaseUrl,
  resolveEnvBaseUrl,
  buildJudgeJoinUrl,
} from "./judgeAccess";

describe("isPrivateIp", () => {
  const privateIps = [
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.0.1",
    "192.168.255.255",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::aabb:ccff:fedd:eeff",
    "::ffff:10.0.0.5",
    "::ffff:192.168.1.10",
    "::ffff:127.0.0.1",
    "  192.168.1.2  ",
    "192.168.1.2:3000",
    "[::1]:3000",
  ];
  it.each(privateIps)("treats %s as private", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  const publicIps = [
    "8.8.8.8",
    "1.1.1.1",
    "203.0.113.10",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.1.1",
    "11.0.0.1",
    "2001:db8::1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "",
    "not-an-ip",
    "999.999.999.999",
  ];
  it.each(publicIps)("treats %s as public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe("getClientIp", () => {
  const headersOf = (init: Record<string, string>) => new Headers(init);

  it("takes the first x-forwarded-for entry", () => {
    expect(
      getClientIp(headersOf({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.4" })),
    ).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(getClientIp(headersOf({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("returns empty string when no IP headers are present", () => {
    expect(getClientIp(headersOf({}))).toBe("");
  });
});

describe("isRestrictedPath", () => {
  it("matches staff areas and their subpaths", () => {
    for (const p of ["/admin", "/admin/login", "/moderator", "/moderator/x", "/organiser", "/stager/y"]) {
      expect(isRestrictedPath(p)).toBe(true);
    }
  });

  it("leaves judge, health, api and public paths alone", () => {
    for (const p of ["/", "/j", "/j/AB12CD", "/api/health", "/api/live", "/tournament", "/administrator", "/adminx"]) {
      expect(isRestrictedPath(p)).toBe(false);
    }
  });
});

describe("normaliseBaseUrl", () => {
  it("strips trailing slashes and keeps path", () => {
    expect(normaliseBaseUrl("https://abc.trycloudflare.com///")).toBe("https://abc.trycloudflare.com");
    expect(normaliseBaseUrl("https://abc.trycloudflare.com/t/")).toBe("https://abc.trycloudflare.com/t");
  });

  it("rejects empty, relative and non-http values", () => {
    expect(normaliseBaseUrl("")).toBe("");
    expect(normaliseBaseUrl(null)).toBe("");
    expect(normaliseBaseUrl("/j/AB12")).toBe("");
    expect(normaliseBaseUrl("ftp://x.example")).toBe("");
    expect(normaliseBaseUrl("not a url")).toBe("");
  });
});

describe("buildJudgeJoinUrl", () => {
  afterEach(() => {
    delete process.env.JUDGE_BASE_URL;
  });

  it("builds a full URL when a base is given", () => {
    expect(buildJudgeJoinUrl("AB12CD", "https://abc.trycloudflare.com")).toBe(
      "https://abc.trycloudflare.com/j/AB12CD",
    );
    expect(buildJudgeJoinUrl("AB12CD", "https://abc.trycloudflare.com/")).toBe(
      "https://abc.trycloudflare.com/j/AB12CD",
    );
  });

  it("falls back to a relative URL when no base is configured", () => {
    expect(buildJudgeJoinUrl("AB12CD")).toBe("/j/AB12CD");
    expect(buildJudgeJoinUrl("AB12CD", "")).toBe("/j/AB12CD");
  });

  it("URL-encodes the join code", () => {
    expect(buildJudgeJoinUrl("AB 12/CD", "https://abc.trycloudflare.com")).toBe(
      "https://abc.trycloudflare.com/j/AB%2012%2FCD",
    );
  });

  it("reads the base from JUDGE_BASE_URL when not passed explicitly", () => {
    process.env.JUDGE_BASE_URL = "https://tunnel.example.com";
    expect(resolveEnvBaseUrl()).toBe("https://tunnel.example.com");
    expect(buildJudgeJoinUrl("ZZ99")).toBe("https://tunnel.example.com/j/ZZ99");
  });
});
