/**
 * Talks to the event server.
 *
 * The API address is derived from the page's own hostname at runtime rather
 * than baked in at build time: the same build has to work on a venue box whose
 * IP nobody knows until the morning of the event (blueprint §13.3).
 */

const API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? '4000';
const TOKEN_KEY = 'event-suite.token';

export function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured !== undefined && configured.length > 0) return configured;

  if (typeof window === 'undefined') return `http://127.0.0.1:${API_PORT}`;

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${API_PORT}`;
}

export function wsUrl(channel: string): string {
  const base = apiBase().replace(/^http/, 'ws');
  return `${base}/ws?channel=${encodeURIComponent(channel)}`;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const token = getToken();

  const response = await fetch(`${apiBase()}/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();

  if (!response.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      message = Array.isArray(parsed.message) ? parsed.message.join('; ') : String(parsed.message ?? text);
    } catch {
      // Keep the raw body.
    }
    throw new ApiError(response.status, message || `${response.status} ${response.statusText}`);
  }

  return (text.length === 0 ? null : JSON.parse(text)) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};

export async function login(email: string, password: string): Promise<string> {
  const result = await api.post<{ token: string }>('/auth/login', { email, password });
  setToken(result.token);
  return result.token;
}

export async function registerFirstOperator(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await api.post('/auth/register', { name, email, password });
}

export interface RingStatus {
  tatami: { id: string; number: number; name: string };
  assignedCount: number;
  currentMatchId: string | null;
  readyCount: number;
  completed: number;
}

export function saveTatamiSelection(tatamiId: string): void {
  window.localStorage.setItem('event-suite.tatami', tatamiId);
}

export function loadTatamiSelection(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('event-suite.tatami');
}

/** A random UUID v4 for command ids, for browsers without crypto.randomUUID. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
