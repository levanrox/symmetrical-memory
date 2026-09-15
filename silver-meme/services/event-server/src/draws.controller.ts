import {
  assignCategoryToTatami,
  getDraw,
  getDrawGraph,
  listParticipantsForCategory,
  lockDraw,
  saveDraw,
  setCategoryState,
  writeAudit,
  type Pool,
} from '@event-suite/db';
import { DrawInputError, generateDraw, type DrawFormat, type SeedingOptions } from '@event-suite/draw-engine';
import { getRuleset } from '@event-suite/rules-engine';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CompetitionService } from './competition';
import { DATABASE_POOL } from './database';
// NOTE: `RealtimeHub` must be a value import. Nest resolves constructor
// dependencies from runtime metadata, so `import type` erases the class and
// dependency injection fails with "argument at index [n] is undefined".
import { RealtimeHub, adminChannel, tatamiChannelFor } from './realtime';

const generateSchema = z.object({
  format: z.string().min(1).optional(),
  seeding: z
    .object({
      mode: z.enum(['NONE', 'MANUAL', 'RANKING', 'RANDOM_SEEDED']),
      seeds: z
        .array(z.object({ registrationId: z.string().min(1), seed: z.int().positive() }))
        .optional(),
      randomSeed: z.int().optional(),
    })
    .optional(),
  separation: z
    .object({
      by: z.enum(['CLUB', 'DISTRICT']),
      rule: z.enum(['FIRST_ROUND', 'SAME_HALF_BLOCKED']),
    })
    .optional(),
  // Decided before the draw, never after: how many bronze medals the category
  // awards. Two is the WKF default for elimination with repechage.
  bronzeMedals: z.union([z.literal(1), z.literal(2)]).optional(),
});

const assignSchema = z.object({
  eventId: z.string().min(1),
  tatamiId: z.string().min(1),
  categoryId: z.string().min(1),
  sequence: z.int().nonnegative().optional(),
});

@Controller()
export class DrawsController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly competition: CompetitionService,
    private readonly hub: RealtimeHub,
  ) {}

  @Post('categories/:id/draw')
  async generate(@Param('id') categoryId: string, @Body() body: unknown) {
    const parsed = generateSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
    }

    const category = await this.competition.categoryView(categoryId);
    if (category === null) {
      throw new NotFoundException(`unknown category "${categoryId}"`);
    }

    // A locked draw is immutable; changing it needs an explicit amendment, not
    // an accidental regenerate from a stale browser tab.
    if (category.draw?.state === 'LOCKED') {
      throw new ConflictException(
        'this draw is locked; generate an amendment instead of regenerating it',
      );
    }

    const categories = await this.pool.query<{ event_id: string }>(
      'SELECT event_id FROM categories WHERE id = $1',
      [categoryId],
    );
    const eventId = categories.rows[0]?.event_id;
    if (eventId === undefined) {
      throw new NotFoundException(`unknown category "${categoryId}"`);
    }

    const event = await this.pool.query<{ ruleset_id: string }>(
      'SELECT ruleset_id FROM events WHERE id = $1',
      [eventId],
    );
    const rulesetId = event.rows[0]?.ruleset_id ?? 'WKF_KUMITE_2026';
    const ruleset = getRuleset(rulesetId);

    const participants = await listParticipantsForCategory(this.pool, categoryId);
    const format = (parsed.data.format ?? ruleset.defaultFormat) as DrawFormat;

    // Built field by field because `exactOptionalPropertyTypes` distinguishes
    // "absent" from "present and undefined".
    const requested = parsed.data.seeding;
    const seeding: SeedingOptions =
      requested === undefined
        ? { mode: 'NONE' }
        : {
            mode: requested.mode,
            ...(requested.seeds === undefined ? {} : { seeds: requested.seeds }),
            ...(requested.randomSeed === undefined ? {} : { randomSeed: requested.randomSeed }),
          };

    try {
      const graph = generateDraw(
        {
          categoryId,
          format,
          participants,
          seeding,
          options: { bronzeMedals: parsed.data.bronzeMedals ?? 2 },
          ...(parsed.data.separation === undefined ? {} : { separation: parsed.data.separation }),
        },
        ruleset,
      );

      await saveDraw(this.pool, categoryId, graph);
      await setCategoryState(this.pool, categoryId, 'DRAW_GENERATED');
      await writeAudit(this.pool, {
        eventId,
        action: 'DRAW_GENERATED',
        entityType: 'category',
        entityId: categoryId,
        detail: {
          checksum: graph.checksum,
          format,
          tournamentSize: graph.tournamentSize,
          byeCount: graph.byeCount,
          warnings: graph.warnings.map((warning) => warning.code),
        },
      });

      this.hub.broadcast(adminChannel(), 'QUEUE_UPDATE', { categoryId, regenerated: true });

      return {
        categoryId,
        checksum: graph.checksum,
        tournamentSize: graph.tournamentSize,
        byeCount: graph.byeCount,
        warnings: graph.warnings,
        matchCount: graph.matches.length,
        bronzeMedals: parsed.data.bronzeMedals ?? 2,
      };
    } catch (error) {
      if (error instanceof DrawInputError) {
        throw new BadRequestException(error.issues);
      }
      throw error;
    }
  }

  @Get('categories/:id/draw')
  async get(@Param('id') categoryId: string) {
    const [graph, record] = await Promise.all([
      getDrawGraph(this.pool, categoryId),
      getDraw(this.pool, categoryId),
    ]);

    if (graph === null || record === null) {
      throw new NotFoundException('this category has no draw yet');
    }

    return { draw: record, graph };
  }

  @Post('categories/:id/draw/lock')
  async lock(@Param('id') categoryId: string) {
    const locked = await lockDraw(this.pool, categoryId);

    if (!locked) {
      const existing = await getDraw(this.pool, categoryId);
      if (existing === null) {
        throw new NotFoundException('this category has no draw to lock');
      }
      throw new ConflictException('this draw is already locked');
    }

    await setCategoryState(this.pool, categoryId, 'LOCKED');
    await writeAudit(this.pool, {
      action: 'DRAW_LOCKED',
      entityType: 'category',
      entityId: categoryId,
    });

    return { categoryId, state: 'LOCKED' };
  }

  @Get('categories/:id/matches')
  async matches(@Param('id') categoryId: string) {
    const view = await this.competition.categoryView(categoryId);

    if (view === null) {
      throw new NotFoundException(`unknown category "${categoryId}"`);
    }

    return view;
  }

  @Post('assignments')
  async assign(@Body() body: unknown) {
    const parsed = assignSchema.safeParse(body);

    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
    }

    const { eventId, tatamiId, categoryId, sequence } = parsed.data;

    const draw = await getDraw(this.pool, categoryId);

    if (draw === null) {
      throw new ConflictException('generate a draw before assigning this category to a ring');
    }

    if (draw.state !== 'LOCKED') {
      throw new ConflictException('only a locked draw can be assigned to a ring');
    }

    const assignment = await assignCategoryToTatami(this.pool, {
      eventId,
      tatamiId,
      categoryId,
      ...(sequence === undefined ? {} : { sequence }),
    });

    await setCategoryState(this.pool, categoryId, 'ASSIGNED');
    await writeAudit(this.pool, {
      eventId,
      action: 'CATEGORY_ASSIGNED',
      entityType: 'category',
      entityId: categoryId,
      detail: { tatamiId, sequence: assignment.sequence },
    });

    // The ring should not have to poll to discover it has work.
    this.hub.broadcast(tatamiChannelFor(tatamiId), 'QUEUE_UPDATE', { categoryId, assigned: true });
    this.hub.broadcast(adminChannel(), 'QUEUE_UPDATE', { categoryId, assigned: true });

    return assignment;
  }
}
