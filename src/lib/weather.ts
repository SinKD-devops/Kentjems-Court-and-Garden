import "server-only";

/**
 * Hourly rain forecast for the venue.
 *
 * Both spaces are outdoors and the refund policy is built around rain, so a
 * forecast shown at booking time prevents more refunds than any policy does.
 *
 * Open-Meteo is used rather than OpenWeather because it needs no API key —
 * one fewer credential to hold, rotate, and leak.
 *
 * The forecast is advisory only. It never blocks a booking: people play in
 * light rain, and a court that is dry on the day should not have been
 * unbookable three days earlier because a model said 60%.
 */

export interface HourForecast {
  /** ISO instant for the start of the hour. */
  at: string;
  rainChance: number;
  temperature: number;
}

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    precipitation_probability?: (number | null)[];
    temperature_2m?: (number | null)[];
  };
}

export async function getForecast(
  latitude: number,
  longitude: number,
  date: string,
): Promise<Map<string, HourForecast>> {
  const url =
    `${OPEN_METEO}?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=precipitation_probability,temperature_2m` +
    `&timezone=Asia%2FManila&start_date=${date}&end_date=${date}`;

  try {
    const response = await fetch(url, {
      // Forecasts move slowly; refetching per request would be wasteful and
      // would put an outside service on the critical path of every page load.
      next: { revalidate: 1800 },
    });
    if (!response.ok) return new Map();

    const body = (await response.json()) as OpenMeteoResponse;
    const times = body.hourly?.time ?? [];
    const rain = body.hourly?.precipitation_probability ?? [];
    const temps = body.hourly?.temperature_2m ?? [];

    const map = new Map<string, HourForecast>();
    times.forEach((local, index) => {
      // Open-Meteo returns local wall-clock times without an offset when a
      // timezone is requested. Manila is permanently +08:00.
      const at = new Date(`${local}:00+08:00`).toISOString();
      map.set(at, {
        at,
        rainChance: rain[index] ?? 0,
        temperature: temps[index] ?? 0,
      });
    });
    return map;
  } catch {
    // A forecast outage must never stop someone booking a court.
    return new Map();
  }
}
