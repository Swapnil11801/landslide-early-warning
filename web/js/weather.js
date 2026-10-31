// Daily precipitation from Open-Meteo: the past 40 days and the next 7 days.
// 40 past days lets us score the last week too (each score needs a 30-day window).

export const PAST_DAYS = 40;
export const FORECAST_DAYS = 7;

function buildUrl(lats, lons) {
  const q = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    daily: "precipitation_sum",
    past_days: PAST_DAYS,
    forecast_days: FORECAST_DAYS,
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** @returns {{dates: string[], precip: number[], todayIndex: number}} */
export async function rainSeries(lat, lon) {
  const [one] = await rainSeriesMany([lat], [lon]);
  return one;
}

export async function rainSeriesMany(lats, lons) {
  const res = await fetch(buildUrl(lats, lons));
  if (!res.ok) throw new Error(`Weather service error (${res.status})`);
  let js = await res.json();
  if (!Array.isArray(js)) js = [js];
  return js.map((j) => ({
    dates: j.daily.time,
    precip: j.daily.precipitation_sum,
    todayIndex: PAST_DAYS,
  }));
}

export async function geocode(name) {
  const q = new URLSearchParams({ name, count: 6, language: "en", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`);
  if (!res.ok) return [];
  return (await res.json()).results ?? [];
}
