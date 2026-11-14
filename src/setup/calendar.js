const hijri = new Intl.DateTimeFormat(undefined, {
  calendar: 'islamic-umalqura', timeZone: 'UTC',
  day: 'numeric', month: 'long', year: 'numeric',
});

// The input is already a civil date in the configured prayer time zone.
export function hijriDate(day) {
  return hijri.format(new Date(day + 'T12:00:00Z'));
}
