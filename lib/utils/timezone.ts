// Utilities for timezone-aware parsing without external deps
// Converts a local wall time in a specific IANA timezone into a UTC Date.

export function localTimeInZoneToDate(
  year: number,
  month: number, // 1-12
  day: number,   // 1-31
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = 'Australia/Melbourne'
): Date {
  // First guess: interpret the local clock components as if they were UTC
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);

  // Compute the timezone offset (in ms) at that instant for the requested zone
  const offsetMs = getTimezoneOffsetMs(new Date(utcGuess), timeZone);

  // Adjust the UTC guess by the zone offset to get the true UTC epoch for that wall time
  const exactUtc = utcGuess - offsetMs;

  // Some DST transitions may still be off by an hour; recompute once to converge
  const offsetMs2 = getTimezoneOffsetMs(new Date(exactUtc), timeZone);
  if (offsetMs !== offsetMs2) {
    return new Date(utcGuess - offsetMs2);
  }
  return new Date(exactUtc);
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  // This follows the approach used by date-fns-tz: format parts in the zone,
  // then build a UTC timestamp from those parts and compare to the input UTC time.
  const dtf = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const zoneAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return zoneAsUtc - date.getTime();
}

