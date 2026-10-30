/*
 * How long ago something happened, in the same words in every app and in the menu bar theme's samples: "just now",
 * "5m ago", "3h ago", "yesterday", "4d ago", then the date. No React, so a server's text can use it too
 * (app-kit/web/age). The words are written here rather than by Intl.RelativeTimeFormat, whose words change with the
 * locale and the browser's ICU (en-GB writes "2 min ago").
 */

export type AgeOptions = {
  /** The reader's time zone, which decides where a day ends; the machine's own when left out. */
  timeZone?: string;
  /** The locale the date is written in past a week; the machine's own when left out. */
  locale?: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * "just now" under a minute (and up to a minute ahead, as a clock a little ahead of the reader's gives), "Nm ago"
 * under an hour, "Nh ago" on the same calendar day, "yesterday" on the calendar day before, "Nd ago" under a week of
 * calendar days, and past that, or more than a minute ahead, the date ("Oct 9", with the year when it is another).
 * Days are the reader's: eleven at night read at one in the morning two days on is "2d ago", though 26 hours passed.
 * A date that is no date, as `new Date(undefined)` makes, or a number past the times a date can hold, writes
 * "unknown" rather than crashing the screen.
 */
export function age(when: Date | number, now: Date | number = Date.now(), { timeZone, locale }: AgeOptions = {}): string {
  // Through Date, so a number past the times a date can hold (Infinity included) is no date, as NaN is.
  const then = new Date(when).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(at)) return 'unknown';
  const elapsed = at - then;
  if (elapsed < -MINUTE) return date(then, at, timeZone, locale);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  const days = dayNumber(at, timeZone) - dayNumber(then, timeZone);
  if (days === 0) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date(then, at, timeZone, locale);
}

/** The calendar day `ms` falls on in `timeZone`, counted in days since 1970, so two days subtract. */
function dayNumber(ms: number, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / (24 * HOUR);
}

function date(then: number, at: number, timeZone: string | undefined, locale: string | undefined): string {
  const year = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(ms);
  const sameYear = year(then) === year(at);
  return new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(then);
}
