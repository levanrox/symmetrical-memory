import { listEvents, type Pool } from '@event-suite/db';
import { Controller, Get, Inject } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import { Public } from './auth';
import { connectionInfo, DATABASE_POOL } from './database';
import { RealtimeHub } from './realtime';

/**
 * Preflight, per blueprint §11.2.
 *
 * Run before the first bout and again before day two. A check that cannot be
 * seen failing is not a check, so each one reports its own value rather than a
 * bare pass.
 */
@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly hub: RealtimeHub,
  ) {}

  @Get('status')
  async status() {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

    checks.push(await this.checkDatabase());
    checks.push(await this.checkMigrations());
    checks.push(await this.checkDisk());
    checks.push(await this.checkClock());

    return {
      ok: checks.every((check) => check.ok),
      service: 'event-server',
      database: connectionInfo(),
      websocketClients: this.hub.connectionCount(),
      events: await this.describeEvents(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      checks,
    };
  }

  private async describeEvents(): Promise<string> {
    try {
      const events = await listEvents(this.pool);

      return events.length === 0
        ? 'no events loaded'
        : `${events.length} event(s), latest: ${events[0]?.name ?? '?'}`;
    } catch {
      return 'unavailable';
    }
  }

  private async checkDatabase(): Promise<{ name: string; ok: boolean; detail: string }> {
    try {
      const started = Date.now();
      await this.pool.query('SELECT 1');
      return { name: 'database', ok: true, detail: `reachable in ${Date.now() - started}ms` };
    } catch (error) {
      return { name: 'database', ok: false, detail: (error as Error).message };
    }
  }

  private async checkMigrations(): Promise<{ name: string; ok: boolean; detail: string }> {
    try {
      const result = await this.pool.query<{ id: string }>(
        'SELECT id FROM schema_migrations ORDER BY id',
      );
      const applied = result.rows.map((row) => row.id);
      return {
        name: 'migrations',
        ok: applied.length > 0,
        detail: applied.length === 0 ? 'none applied' : applied.join(', '),
      };
    } catch (error) {
      return { name: 'migrations', ok: false, detail: (error as Error).message };
    }
  }

  private async checkDisk(): Promise<{ name: string; ok: boolean; detail: string }> {
    try {
      const stats = await statfs(process.cwd());
      const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
      return {
        name: 'disk',
        ok: freeGb > 1,
        detail: `${freeGb.toFixed(1)} GB free`,
      };
    } catch (error) {
      return { name: 'disk', ok: false, detail: (error as Error).message };
    }
  }

  private async checkClock(): Promise<{ name: string; ok: boolean; detail: string }> {
    // Without internet there is no NTP, so an obviously wrong clock is worth
    // catching before it timestamps a whole event (blueprint §11.3).
    const now = new Date();
    const year = now.getFullYear();
    const plausible = year >= 2024 && year <= 2100;

    return {
      name: 'clock',
      ok: plausible,
      detail: `${now.toISOString()} (set manually; no NTP without an uplink)`,
    };
  }
}
