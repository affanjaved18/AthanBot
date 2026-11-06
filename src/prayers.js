// Vendored from Batoul Apps' Adhan JS 4.4.3 under MIT.
// https://github.com/batoulapps/adhan-js
import {
  CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PolarCircleResolution, PrayerTimes,
} from '../vendor/adhan/adhan.mjs';
import { prayers } from './settings.js';

const calendars = new Map();
export function localDay(timestamp, timeZone) {
  if (!calendars.has(timeZone)) {
    calendars.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }));
  }
  const parts = Object.fromEntries(calendars.get(timeZone).formatToParts(timestamp)
    .map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function calculateDay(day, settings) {
  const [year, month, date] = day.split('-').map(Number);
  // The engine reads host-local calendar fields and returns absolute timestamps.
  const calendarDate = new Date(year, month - 1, date, 12);
  const parameters = CalculationMethod[settings.method]();
  parameters.madhab = settings.asr === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  if (settings.highLatitude !== 'MethodDefault') {
    parameters.highLatitudeRule = HighLatitudeRule[settings.highLatitude];
  }
  parameters.polarCircleResolution = PolarCircleResolution[settings.polar];
  Object.assign(parameters.adjustments, settings.offsets);
  const times = new PrayerTimes(new Coordinates(settings.latitude, settings.longitude), calendarDate, parameters);
  return prayers.map(prayer => {
    const instant = times[prayer]?.getTime();
    return { id: `${day}-${prayer}`, day, prayer, at: Number.isFinite(instant) ? instant : null };
  });
}

export function upcomingDays(settings, now, count) {
  const today = localDay(now, settings.timeZone);
  return Array.from({ length: count }, (_, index) => calculateDay(addDays(today, index), settings));
}
