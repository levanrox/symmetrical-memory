/** Formats a Postgres `date` as `YYYY-MM-DD` without timezone drift. */
export function toDateString(value: Date | null): string | null {
  if (value === null) return null;

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/** Postgres returns `numeric` as a string to avoid precision loss; undo that. */
export function toNumberOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}
