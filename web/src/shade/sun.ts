// Solar position (NOAA "Solar Calculator" equations, the same ones astral
// implements in the pipeline; agrees within ~0.1°). Azimuth in degrees
// clockwise from north, elevation in degrees above the horizon (no
// refraction — the DSM shadow sweep does not want it either).
//
// Observer = the selected city's centre and time zone (2026-09-02). Until
// then Frankfurt's were hardcoded here — over another city that is German
// sun angles on foreign geometry, the same silent bug 10_sun_shade had.
export type Observer = { lat: number; lng: number; timeZone: string };
export const FFM_LAT = 50.1109;
export const FFM_LNG = 8.6821;
export const FRANKFURT: Observer = { lat: FFM_LAT, lng: FFM_LNG, timeZone: "Europe/Berlin" };

const rad = Math.PI / 180;

/** UTC offset of an IANA zone at a UTC instant, in minutes, from Intl —
 *  DST rules for any zone, not a hand-rolled EU calendar. */
function utcOffsetMinutes(timeZone: string, utc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(utc);
  const g = (t: string) => Number(parts.find((x) => x.type === t)!.value);
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"));
  return Math.round((wall - utc.getTime()) / 60_000);
}

/** Sun azimuth/elevation for a calendar day (yyyy-mm-dd) and local minutes
 *  of day, at the observer (default Frankfurt). */
export function sunPosition(day: string, minutesLocal: number, obs: Observer = FRANKFURT): { az: number; el: number } {
  const [Y, M, D] = day.split("-").map(Number);
  // local minutes -> UTC: the zone's offset at noon that day
  const noonUtc = new Date(Date.UTC(Y, M - 1, D, 12));
  const off = utcOffsetMinutes(obs.timeZone, noonUtc);
  const utc = new Date(Date.UTC(Y, M - 1, D, 0, 0) + (minutesLocal - off) * 60_000);
  const jd = utc.getTime() / 86_400_000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const Mm = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C =
    Math.sin(Mm * rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * Mm * rad) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * Mm * rad) * 0.000289;
  const trueLng = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = trueLng - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime =
    4 *
    (y * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(Mm * rad) +
      4 * e * y * Math.sin(Mm * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * Mm * rad)) /
    rad; // minutes
  const utcMinutes = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60;
  const trueSolarMin = (((utcMinutes + eqTime + 4 * obs.lng) % 1440) + 1440) % 1440;
  const ha = (trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180) * rad;
  const lat = obs.lat * rad;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let az =
    Math.acos(
      Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zen))))
    ) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { az, el: 90 - zen / rad };
}

/** Today's date as yyyy-mm-dd in local time. */
export function todayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
