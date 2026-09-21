/**
 * Unit tests for mapToWsScheme (src/lib/realtime/client.ts) — CRIT-1 fix.
 *
 * `new WebSocket()` requires a ws:// or wss:// URL. The socket URL was
 * previously built with an http(s):// scheme, which browsers reject,
 * silently breaking every realtime connection.
 */
import { describe, expect, it } from "vitest";
import { mapToWsScheme } from "./client";

describe("mapToWsScheme", () => {
  it("maps http to ws", () => {
    expect(mapToWsScheme("http://192.168.1.10:4000/socket")).toBe(
      "ws://192.168.1.10:4000/socket"
    );
  });

  it("maps https to wss", () => {
    expect(mapToWsScheme("https://example.com/socket")).toBe(
      "wss://example.com/socket"
    );
  });

  it("leaves ws/wss URLs untouched", () => {
    expect(mapToWsScheme("ws://192.168.1.10:4000/socket")).toBe(
      "ws://192.168.1.10:4000/socket"
    );
    expect(mapToWsScheme("wss://example.com/socket")).toBe(
      "wss://example.com/socket"
    );
  });

  it("is case-insensitive on the scheme", () => {
    expect(mapToWsScheme("HTTP://host/socket")).toBe("ws://host/socket");
  });

  it("leaves non-http(s) URLs untouched", () => {
    expect(mapToWsScheme("ftp://host/socket")).toBe("ftp://host/socket");
  });
});
