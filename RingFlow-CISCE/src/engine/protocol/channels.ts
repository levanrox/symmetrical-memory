import { z } from 'zod';

/**
 * Realtime channels (blueprint §8).
 *
 * Per-tatami channels exist so a six-ring event does not broadcast every ring's
 * traffic to every screen. The admin and display channels are per-event.
 */
export const ADMIN_CHANNEL = 'admin' as const;
export const TATAMI_PREFIX = 'tatami:' as const;
export const DISPLAY_PREFIX = 'display:' as const;

export type Channel = 'admin' | `tatami:${string}` | `display:${string}`;

export const channelSchema = z.union([
  z.literal(ADMIN_CHANNEL),
  z.templateLiteral([TATAMI_PREFIX, z.string().min(1)]),
  z.templateLiteral([DISPLAY_PREFIX, z.string().min(1)]),
]);

export type ChannelKind = 'admin' | 'tatami' | 'display';

export function tatamiChannel(tatamiId: string): Channel {
  return `${TATAMI_PREFIX}${tatamiId}`;
}

export function displayChannel(displayId: string): Channel {
  return `${DISPLAY_PREFIX}${displayId}`;
}

/** Classifies a channel without parsing the id out of it. */
export function channelKind(channel: Channel): ChannelKind {
  if (channel === ADMIN_CHANNEL) return 'admin';
  return channel.startsWith(TATAMI_PREFIX) ? 'tatami' : 'display';
}

/** Extracts the tatami id from a tatami channel, or undefined for other kinds. */
export function channelTatamiId(channel: Channel): string | undefined {
  return channel.startsWith(TATAMI_PREFIX) ? channel.slice(TATAMI_PREFIX.length) : undefined;
}

/** Extracts the display id from a display channel, or undefined for other kinds. */
export function channelDisplayId(channel: Channel): string | undefined {
  return channel.startsWith(DISPLAY_PREFIX) ? channel.slice(DISPLAY_PREFIX.length) : undefined;
}
