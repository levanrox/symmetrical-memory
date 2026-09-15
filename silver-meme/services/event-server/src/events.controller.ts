import {
  createAthlete,
  createCategory,
  createEvent,
  createRegistration,
  createTatami,
  listAthletes,
  listAssignmentsForEvent,
  listCategories,
  listEvents,
  listRegistrations,
  listTatamis,
  setCategoryState,
  type Pool,
} from '@event-suite/db';
import { getRuleset, listRulesets, matchDurationSeconds } from '@event-suite/rules-engine';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { DATABASE_POOL } from './database';

const createEventSchema = z.object({
  name: z.string().min(1),
  rulesetId: z.string().min(1).default('WKF_KUMITE_2026'),
  venue: z.string().min(1).nullish(),
  startsOn: z.string().min(1).nullish(),
  endsOn: z.string().min(1).nullish(),
});

const createTatamiSchema = z.object({
  number: z.int().positive(),
  name: z.string().min(1).optional(),
});

const createCategorySchema = z.object({
  name: z.string().min(1),
  ageGroup: z.string().min(1),
  gender: z.enum(['MALE', 'FEMALE', 'MIXED']),
  discipline: z.string().min(1).optional(),
  minWeightKg: z.number().nonnegative().nullish(),
  maxWeightKg: z.number().nonnegative().nullish(),
});

const createAthleteSchema = z.object({
  displayName: z.string().min(1),
  dateOfBirth: z.string().min(1).nullish(),
  gender: z.enum(['MALE', 'FEMALE']).nullish(),
  clubName: z.string().min(1).nullish(),
});

const createRegistrationSchema = z.object({
  athleteId: z.string().min(1),
  clubName: z.string().min(1).nullish(),
  seed: z.int().positive().nullish(),
});

/** Parses a body, turning a schema failure into a 400 with the field named. */
function parseOrThrow<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new BadRequestException(
      result.error.issues.map((issue) => `${issue.path.join('.') || '<body>'}: ${issue.message}`),
    );
  }

  return result.data;
}

@Controller()
export class EventsController {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  @Get('rulesets')
  rulesets() {
    return listRulesets().map((ruleset) => ({
      id: ruleset.id,
      version: ruleset.version,
      source: ruleset.source,
      formats: ruleset.formats,
      defaultFormat: ruleset.defaultFormat,
      durations: ruleset.durationSeconds,
      scoreValues: ruleset.scoring,
      superiorityMargin: ruleset.superiorityMargin,
      weighInToleranceKg: ruleset.weighInToleranceKg,
    }));
  }

  @Get('events')
  events() {
    return listEvents(this.pool);
  }

  @Post('events')
  async createEvent(@Body() body: unknown) {
    const input = parseOrThrow(createEventSchema, body);

    // Fail fast on an unknown ruleset rather than at draw time.
    getRuleset(input.rulesetId);

    return createEvent(this.pool, {
      name: input.name,
      rulesetId: input.rulesetId,
      venue: input.venue ?? null,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
    });
  }

  @Get('events/:id')
  async event(@Param('id') id: string) {
    const events = await listEvents(this.pool);
    const event = events.find((candidate) => candidate.id === id);

    if (event === undefined) {
      throw new NotFoundException(`unknown event "${id}"`);
    }

    const [tatamis, categories, assignments] = await Promise.all([
      listTatamis(this.pool, id),
      listCategories(this.pool, id),
      listAssignmentsForEvent(this.pool, id),
    ]);

    // Read the draw from the draw itself rather than trusting the category's
    // cached state string. Anything that writes a draw — the API, the seed
    // script, a future import — is then reflected in the list without having to
    // remember to update a second field.
    const draws = await this.pool.query<{ category_id: string; state: string; version: number }>(
      `SELECT d.category_id, d.state, d.version
         FROM draws d
         JOIN categories c ON c.id = d.category_id
        WHERE c.event_id = $1`,
      [id],
    );
    const drawByCategory = new Map(draws.rows.map((row) => [row.category_id, row]));

    const ruleset = getRuleset(event.rulesetId);

    return {
      event,
      tatamis,
      assignments,
      categories: await Promise.all(
        categories.map(async (category) => {
          const draw = drawByCategory.get(category.id);

          return {
            ...category,
            entrantCount: (await listRegistrations(this.pool, category.id)).length,
            durationSeconds: matchDurationSeconds(ruleset, category.ageGroup),
            draw: draw === undefined ? null : { state: draw.state, version: draw.version },
          };
        }),
      ),
    };
  }

  @Post('events/:id/tatamis')
  async addTatami(@Param('id') eventId: string, @Body() body: unknown) {
    const input = parseOrThrow(createTatamiSchema, body);

    return createTatami(this.pool, {
      eventId,
      number: input.number,
      name: input.name ?? `Tatami ${input.number}`,
    });
  }

  @Post('events/:id/categories')
  async addCategory(@Param('id') eventId: string, @Body() body: unknown) {
    const input = parseOrThrow(createCategorySchema, body);

    return createCategory(this.pool, {
      eventId,
      name: input.name,
      ageGroup: input.ageGroup,
      gender: input.gender,
      discipline: input.discipline ?? 'KUMITE',
      minWeightKg: input.minWeightKg ?? null,
      maxWeightKg: input.maxWeightKg ?? null,
    });
  }

  @Get('categories/:id')
  async category(@Param('id') id: string) {
    const registrations = await listRegistrations(this.pool, id);

    return {
      categoryId: id,
      registrations,
      entrantCount: registrations.length,
    };
  }

  @Post('categories/:id/registrations')
  async addRegistration(@Param('id') categoryId: string, @Body() body: unknown) {
    const input = parseOrThrow(createRegistrationSchema, body);

    const categories = await this.pool.query<{ event_id: string }>(
      'SELECT event_id FROM categories WHERE id = $1',
      [categoryId],
    );

    const eventId = categories.rows[0]?.event_id;
    if (eventId === undefined) {
      throw new NotFoundException(`unknown category "${categoryId}"`);
    }

    const id = await createRegistration(this.pool, {
      eventId,
      categoryId,
      athleteId: input.athleteId,
      clubName: input.clubName ?? null,
      seed: input.seed ?? null,
    });

    return { id };
  }

  @Get('athletes')
  athletes() {
    return listAthletes(this.pool);
  }

  @Post('athletes')
  async addAthlete(@Body() body: unknown) {
    const input = parseOrThrow(createAthleteSchema, body);

    return createAthlete(this.pool, {
      displayName: input.displayName,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      clubName: input.clubName ?? null,
    });
  }

  @Post('categories/:id/entries/close')
  async closeEntries(@Param('id') id: string) {
    await setCategoryState(this.pool, id, 'ENTRIES_LOCKED');
    return { categoryId: id, state: 'ENTRIES_LOCKED' };
  }
}
