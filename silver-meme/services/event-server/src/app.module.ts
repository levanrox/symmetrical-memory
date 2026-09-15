import { Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController, AuthGuard, AuthService } from './auth';
import { CompetitionService } from './competition';
import { databaseProvider } from './database';
import { DrawsController } from './draws.controller';
import { EventsController } from './events.controller';
import { HealthController } from './health.controller';
import { MatchesController } from './matches.controller';
import { RealtimeHub } from './realtime';
import { ResultsController } from './results.controller';

@Module({
  controllers: [
    HealthController,
    AuthController,
    EventsController,
    DrawsController,
    MatchesController,
    ResultsController,
  ],
  providers: [
    databaseProvider,
    RealtimeHub,
    CompetitionService,
    AuthService,
    // Deny by default: a route is only reachable without a token if it says so.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}

/**
 * Shared HTTP setup, so a test bootstraps the same application that ships —
 * same prefix, same behaviour — instead of a subtly different one.
 *
 * Deliberately no `ValidationPipe`: it exists to validate DTO classes and
 * requires class-validator and class-transformer. Every request body here is
 * parsed with zod at the controller, which already fails with a 400 naming the
 * offending field, so the pipe would only add two dependencies.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  /**
   * Live match data must never be cached.
   *
   * Express sends an ETag on JSON responses and no `Cache-Control`, which lets
   * a browser serve a revalidated copy. On a scoreboard that means a stale
   * score, and on a ring console it means a scorer acting on a state the server
   * has already moved past.
   */
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.enableCors();
}
