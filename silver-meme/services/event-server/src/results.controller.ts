import { getEvent, listCategories, listRegistrations, type Pool } from '@event-suite/db';
import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import { CompetitionService, type CategoryView } from './competition';
import { DATABASE_POOL } from './database';

/**
 * The slice of the response object this controller uses.
 *
 * Typed narrowly rather than pulling in `@types/express` for two methods; the
 * runtime value is the framework's own response either way.
 */
interface CsvResponse {
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

export interface CategoryResult {
  categoryId: string;
  categoryName: string;
  completed: boolean;
  gold: AthleteRef | null;
  silver: AthleteRef | null;
  bronze: AthleteRef[];
}

export interface AthleteRef {
  registrationId: string;
  name: string;
  club: string | null;
}

export interface MedalTallyRow {
  club: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export interface EventResults {
  eventId: string;
  eventName: string;
  venue: string | null;
  categories: CategoryResult[];
  medalsByClub: MedalTallyRow[];
  totals: { categories: number; completed: number; athletes: number };
}

/**
 * Post-event output (blueprint §15).
 *
 * Everything here is derived from the same resolution the live bracket uses, so
 * a printed result cannot disagree with what the hall saw.
 */
@Controller()
export class ResultsController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly competition: CompetitionService,
  ) {}

  @Get('events/:id/results')
  async results(@Param('id') eventId: string): Promise<EventResults> {
    return this.build(eventId);
  }

  @Get('events/:id/results.csv')
  async resultsCsv(@Param('id') eventId: string, @Res() response: CsvResponse): Promise<void> {
    const results = await this.build(eventId);

    const rows: string[][] = [
      ['Category', 'Place', 'Athlete', 'Club'],
      ...results.categories.flatMap((category) => [
        ...(category.gold === null ? [] : [[category.categoryName, '1', category.gold.name, category.gold.club ?? '']]),
        ...(category.silver === null ? [] : [[category.categoryName, '2', category.silver.name, category.silver.club ?? '']]),
        ...category.bronze.map((athlete) => [category.categoryName, '3', athlete.name, athlete.club ?? '']),
      ]),
    ];

    // Quote every field: athlete and club names routinely contain commas.
    const csv = rows.map((row) => row.map((field) => `"${field.replace(/"/g, '""')}"`).join(',')).join('\n');

    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader(
      'content-disposition',
      `attachment; filename="results-${eventId}.csv"`,
    );
    response.send(csv);
  }

  private async build(eventId: string): Promise<EventResults> {
    const event = await getEvent(this.pool, eventId);

    if (event === null) {
      throw new NotFoundException(`unknown event "${eventId}"`);
    }

    const categories = await listCategories(this.pool, eventId);
    const results: CategoryResult[] = [];
    let athleteCount = 0;

    for (const category of categories) {
      const view: CategoryView | null = await this.competition.categoryView(category.id);
      if (view === null) continue;

      const registrations = await listRegistrations(this.pool, category.id);
      athleteCount += registrations.length;

      const byId = new Map(
        registrations.map((registration) => [
          registration.id,
          {
            registrationId: registration.id,
            name: registration.displayName,
            club: registration.clubName,
          } satisfies AthleteRef,
        ]),
      );

      const podium = view.podium;

      const silverId = podium?.silverRegistrationId ?? null;

      results.push({
        categoryId: category.id,
        categoryName: category.name,
        completed: podium !== null,
        gold: podium === null ? null : (byId.get(podium.goldRegistrationId) ?? null),
        silver: silverId === null ? null : (byId.get(silverId) ?? null),
        bronze: (podium?.bronzeRegistrationIds ?? [])
          .map((id) => byId.get(id))
          .filter((athlete): athlete is AthleteRef => athlete !== undefined),
      });
    }

    return {
      eventId: event.id,
      eventName: event.name,
      venue: event.venue,
      categories: results,
      medalsByClub: tallyMedals(results),
      totals: {
        categories: results.length,
        completed: results.filter((category) => category.completed).length,
        athletes: athleteCount,
      },
    };
  }
}

/** Club standings, ordered by golds then silvers then bronzes then name. */
function tallyMedals(results: readonly CategoryResult[]): MedalTallyRow[] {
  const byClub = new Map<string, MedalTallyRow>();

  const rowFor = (club: string): MedalTallyRow => {
    const existing = byClub.get(club);
    if (existing !== undefined) return existing;

    const created: MedalTallyRow = { club, gold: 0, silver: 0, bronze: 0, total: 0 };
    byClub.set(club, created);
    return created;
  };

  const award = (athlete: AthleteRef | null, medal: 'gold' | 'silver' | 'bronze'): void => {
    if (athlete === null) return;

    const row = rowFor(athlete.club ?? 'Independent');
    row[medal] += 1;
    row.total += 1;
  };

  for (const category of results) {
    award(category.gold, 'gold');
    award(category.silver, 'silver');
    for (const athlete of category.bronze) award(athlete, 'bronze');
  }

  return [...byClub.values()].sort(
    (a, b) =>
      b.gold - a.gold ||
      b.silver - a.silver ||
      b.bronze - a.bronze ||
      a.club.localeCompare(b.club),
  );
}
