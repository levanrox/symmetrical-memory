'use client';

import { useEffect, useRef, useState } from 'react';
import { wsUrl } from './api';

/**
 * Subscribes to a realtime channel, reconnecting on its own.
 *
 * A scoreboard that silently stops updating is worse than one showing nothing,
 * so connection state is returned and displayed. The handler is held in a ref so
 * that a changing callback does not tear down and rebuild the socket.
 */
export function useChannel<T>(
  channel: string | null,
  onMessage: (message: T) => void,
): { connected: boolean; lastSeq: number | null } {
  const [connected, setConnected] = useState(false);
  const [lastSeq, setLastSeq] = useState<number | null>(null);

  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    if (channel === null) return;

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      if (closed) return;

      socket = new WebSocket(wsUrl(channel));

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as T & { seq?: number };
          if (typeof message.seq === 'number') setLastSeq(message.seq);
          handler.current(message);
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      closed = true;
      if (retry !== null) clearTimeout(retry);
      socket?.close();
    };
  }, [channel]);

  return { connected, lastSeq };
}
