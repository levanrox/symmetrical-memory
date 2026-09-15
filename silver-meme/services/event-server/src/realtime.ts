import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { uuidv7 } from '@event-suite/db';
import { PROTOCOL_VERSION, type Channel, type ServerMessage } from '@event-suite/protocol';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

/**
 * Pushes state to connected browsers over one raw WebSocket per client.
 *
 * No socket.io and no framework gateway: the protocol package already defines
 * the envelope, so a plain `ws` server is the whole transport. Browsers
 * reconnect on their own, and a reconnecting client asks for a fresh snapshot
 * rather than expecting us to replay what it missed.
 */
@Injectable()
export class RealtimeHub implements OnApplicationBootstrap, OnApplicationShutdown {
  private server: WebSocketServer | null = null;
  private readonly subscribers = new Map<Channel, Set<WebSocket>>();
  private sequence = 0;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onApplicationBootstrap(): void {
    const httpServer = this.adapterHost.httpAdapter?.getHttpServer();

    if (httpServer === undefined) {
      console.warn('[ws] no HTTP server available; realtime updates are disabled');
      return;
    }

    this.server = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.server.on('connection', (socket, request) => this.onConnection(socket, request));
  }

  onApplicationShutdown(): void {
    this.server?.close();
  }

  /** Number of live subscribers, for the preflight page. */
  connectionCount(): number {
    let total = 0;
    for (const sockets of this.subscribers.values()) total += sockets.size;
    return total;
  }

  broadcast(channel: Channel, type: ServerMessage['type'], payload: unknown): void {
    const sockets = this.subscribers.get(channel);
    if (sockets === undefined || sockets.size === 0) return;

    const message = {
      v: PROTOCOL_VERSION,
      id: uuidv7(),
      seq: this.sequence,
      ts: Date.now(),
      channel,
      type,
      payload,
    };

    this.sequence += 1;
    const encoded = JSON.stringify(message);

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(encoded);
      }
    }
  }

  private onConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const channel = url.searchParams.get('channel');

    if (channel === null || channel.length === 0) {
      socket.close(1008, 'a channel query parameter is required');
      return;
    }

    this.addSubscriber(channel as Channel, socket);

    socket.on('close', () => this.removeSubscriber(channel as Channel, socket));
    socket.on('error', () => this.removeSubscriber(channel as Channel, socket));

    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: uuidv7(),
        seq: this.sequence,
        ts: Date.now(),
        channel,
        type: 'ALERT',
        payload: {
          id: uuidv7(),
          severity: 'INFO',
          code: 'CONNECTED',
          message: `subscribed to ${channel}`,
          tatamiId: null,
          matchId: null,
          ts: Date.now(),
        },
      }),
    );

    this.sequence += 1;
  }

  private addSubscriber(channel: Channel, socket: WebSocket): void {
    const existing = this.subscribers.get(channel) ?? new Set<WebSocket>();
    existing.add(socket);
    this.subscribers.set(channel, existing);
  }

  private removeSubscriber(channel: Channel, socket: WebSocket): void {
    const existing = this.subscribers.get(channel);
    if (existing === undefined) return;

    existing.delete(socket);

    if (existing.size === 0) {
      this.subscribers.delete(channel);
    }
  }
}

/** Channel helpers kept here so callers cannot mistype the prefix. */
export function adminChannel(): Channel {
  return 'admin';
}

export function tatamiChannelFor(tatamiId: string): Channel {
  return `tatami:${tatamiId}`;
}

export function displayChannelFor(tatamiId: string): Channel {
  return `display:${tatamiId}`;
}
