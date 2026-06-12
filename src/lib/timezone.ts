import { useCallback, useEffect, useState } from 'react';

/**
 * Per-viewer timezone. Friends are scattered across the globe, so kick-off
 * times are rendered in whatever zone the viewer picks (defaulting to the one
 * their browser reports). The choice is stored locally — it's a display
 * preference, nothing leaves the device.
 */

const STORAGE_KEY = 'wc.timezone';

/** The IANA zone the browser thinks we're in (e.g. "America/New_York"). */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A short, friendly options list spanning the kind of places friends live. */
export const TIMEZONE_OPTIONS: { id: string; label: string }[] = [
  { id: 'UTC', label: 'UTC' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Denver', label: 'Denver' },
  { id: 'America/Chicago', label: 'Chicago / Mexico City' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Sao_Paulo', label: 'São Paulo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Paris', label: 'Paris / Berlin / Madrid' },
  { id: 'Europe/Moscow', label: 'Moscow' },
  { id: 'Africa/Lagos', label: 'Lagos' },
  { id: 'Africa/Johannesburg', label: 'Johannesburg' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Kolkata', label: 'India' },
  { id: 'Asia/Shanghai', label: 'China' },
  { id: 'Asia/Tokyo', label: 'Tokyo / Seoul' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'Pacific/Auckland', label: 'Auckland' },
];

/** True if the given IANA zone id is actually supported by the runtime. */
function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Options list guaranteed to contain the viewer's detected zone. */
export function timezoneOptions(detected: string): { id: string; label: string }[] {
  if (TIMEZONE_OPTIONS.some((o) => o.id === detected)) return TIMEZONE_OPTIONS;
  // City part of "Area/City" makes a decent label for an unlisted zone.
  const label = detected.split('/').pop()?.replace(/_/g, ' ') ?? detected;
  return [{ id: detected, label: `${label} (yours)` }, ...TIMEZONE_OPTIONS];
}

/**
 * Format a kick-off epoch in the given zone, e.g. "21:00 CEST" or "3:00 PM
 * GMT-4". Falls back to the raw string when the epoch is unknown.
 */
export function formatKickoff(ms: number | null, tz: string, raw: string): string {
  if (ms == null) return raw;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date(ms));
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
    const zone = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return `${hour}:${minute} ${zone}`.trim();
  } catch {
    return raw;
  }
}

/** YYYY-MM-DD for an epoch in the given zone (for "is this match today?"). */
export function ymdInZone(ms: number, tz: string): string {
  try {
    // en-CA renders as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * The viewer's chosen timezone, persisted to localStorage and shared across
 * tabs/components. Defaults to the browser-detected zone on first visit.
 */
export function useTimezone(): [string, (tz: string) => void] {
  const [tz, setTzState] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    return saved && isValidZone(saved) ? saved : detectTimezone();
  });

  const setTz = useCallback((next: string) => {
    setTzState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode etc. — fine, just won't persist */
    }
    window.dispatchEvent(new CustomEvent('wc-tz', { detail: next }));
  }, []);

  // Keep every mounted picker/board in sync within and across tabs.
  useEffect(() => {
    const onLocal = (e: Event) => setTzState((e as CustomEvent<string>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && isValidZone(e.newValue)) setTzState(e.newValue);
    };
    window.addEventListener('wc-tz', onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('wc-tz', onLocal);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return [tz, setTz];
}
