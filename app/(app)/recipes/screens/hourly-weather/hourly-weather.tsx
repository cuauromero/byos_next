/**
 * Hourly Weather — hourly forecast recipe for byos_next.
 *
 * Layout inspired by the TRMNL recipe "Open-Meteo Hourly Weather Forecast"
 * (andi4000). This is an independent React implementation with its own icons.
 * Data: Open-Meteo (https://open-meteo.com, CC BY 4.0, no API key).
 *
 * Sections: current conditions, today (next 7 hours), tomorrow (every 2 hours).
 * Designed on an 800x480 canvas and scaled to the screen it is rendered on.
 */
import type { ReactNode } from "react";
import { z } from "zod";
import type { RecipeDefinition } from "@/lib/recipes/types";
import {
  createScreenProfile,
  type ScreenProfile,
} from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";

const hourSchema = z.object({
  hour: z.number(),
  temp: z.number(),
  code: z.number(),
  day: z.boolean(),
});

const summarySchema = z.object({
  date: z.string(),
  max: z.number(),
  min: z.number(),
  code: z.number(),
});

const SAMPLE_NOW = { time: "13:45", temp: 54, code: 3, day: true };
const SAMPLE_TODAY = { date: "2026-10-22", max: 56, min: 47, code: 61 };
const SAMPLE_TOMORROW = { date: "2026-10-23", max: 58, min: 45, code: 2 };
const SAMPLE_NEXT = [
  { hour: 14, temp: 55, code: 3, day: true },
  { hour: 15, temp: 56, code: 3, day: true },
  { hour: 16, temp: 56, code: 61, day: true },
  { hour: 17, temp: 54, code: 61, day: true },
  { hour: 18, temp: 52, code: 3, day: false },
  { hour: 19, temp: 51, code: 2, day: false },
  { hour: 20, temp: 50, code: 0, day: false },
];
const SAMPLE_TOMORROW_HOURS = [
  { hour: 7, temp: 46, code: 2, day: true },
  { hour: 9, temp: 50, code: 2, day: true },
  { hour: 11, temp: 55, code: 1, day: true },
  { hour: 13, temp: 58, code: 0, day: true },
  { hour: 15, temp: 57, code: 1, day: true },
  { hour: 17, temp: 53, code: 3, day: true },
  { hour: 19, temp: 49, code: 3, day: false },
];

export const paramsSchema = z.object({
  latitude: z
    .number()
    .default(40.7769)
    .describe("Latitude (default: ZIP 10023, Manhattan)")
    .meta({ title: "Latitude" }),
  longitude: z
    .number()
    .default(-73.9813)
    .describe("Longitude (default: ZIP 10023, Manhattan)")
    .meta({ title: "Longitude" }),
  unit: z
    .enum(["fahrenheit", "celsius"])
    .default("fahrenheit")
    .describe("Temperature unit")
    .meta({ title: "Unit" }),
  timezone: z
    .string()
    .default("America/New_York")
    .describe("IANA timezone, e.g. America/New_York")
    .meta({ title: "Timezone" }),
  clock: z
    .enum(["12h", "24h"])
    .default("12h")
    .describe("Clock style for hour labels")
    .meta({ title: "Clock" }),
});

export const dataSchema = z.object({
  clock: z.enum(["12h", "24h"]).default("12h"),
  now: z
    .object({
      time: z.string(),
      temp: z.number(),
      code: z.number(),
      day: z.boolean(),
    })
    .default(SAMPLE_NOW),
  today: summarySchema.default(SAMPLE_TODAY),
  tomorrow: summarySchema.default(SAMPLE_TOMORROW),
  nextHours: z.array(hourSchema).default(SAMPLE_NEXT),
  tomorrowHours: z.array(hourSchema).default(SAMPLE_TOMORROW_HOURS),
});

type Data = z.infer<typeof dataSchema>;
type Params = z.infer<typeof paramsSchema>;

async function fetchWeather(p: Params): Promise<Data> {
  const q = new URLSearchParams({
    latitude: String(p.latitude),
    longitude: String(p.longitude),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset",
    temperature_unit: p.unit,
    timezone: p.timezone,
    forecast_days: "3",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`);
  const json = await res.json();

  const hTimes: string[] = json.hourly.time;
  const dTimes: string[] = json.daily.time;

  const isDay = (t: string) => {
    const i = dTimes.indexOf(t.slice(0, 10));
    if (i < 0) return true;
    return t >= json.daily.sunrise[i] && t < json.daily.sunset[i];
  };

  const hourAt = (i: number) => ({
    hour: Number(hTimes[i].slice(11, 13)),
    temp: json.hourly.temperature_2m[i] as number,
    code: (json.hourly.weather_code[i] ?? 0) as number,
    day: isDay(hTimes[i]),
  });

  const summary = (i: number) => ({
    date: dTimes[i],
    max: json.daily.temperature_2m_max[i] as number,
    min: json.daily.temperature_2m_min[i] as number,
    code: (json.daily.weather_code[i] ?? 0) as number,
  });

  const nowT: string = json.current.time;
  const nowIdx = hTimes.indexOf(`${nowT.slice(0, 13)}:00`);
  const start = nowIdx >= 0 ? nowIdx + 1 : 0;
  const nextHours = [];
  for (let k = 0; k < 7 && start + k < hTimes.length; k++) {
    nextHours.push(hourAt(start + k));
  }

  const tomorrowDate = dTimes[1];
  const tomorrowHours = [7, 9, 11, 13, 15, 17, 19]
    .map((h) => hTimes.indexOf(`${tomorrowDate}T${String(h).padStart(2, "0")}:00`))
    .filter((i) => i >= 0)
    .map(hourAt);

  return {
    clock: p.clock,
    now: {
      time: nowT.slice(11, 16),
      temp: json.current.temperature_2m,
      code: json.current.weather_code ?? 0,
      day: isDay(nowT),
    },
    today: summary(0),
    tomorrow: summary(1),
    nextHours,
    tomorrowHours,
  };
}

// ---- weather helpers -------------------------------------------------------

type IconKind =
  | "sun"
  | "moon"
  | "partly"
  | "partlyNight"
  | "cloud"
  | "fog"
  | "rain"
  | "snow"
  | "storm";

function iconFor(code: number, day: boolean): IconKind {
  if (code === 0 || code === 1) return day ? "sun" : "moon";
  if (code === 2) return day ? "partly" : "partlyNight";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloud";
}

const DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Slight snow fall",
  73: "Snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Slight snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm, hail",
  99: "Heavy thunderstorm",
};

function describe(code: number): string {
  return DESCRIPTIONS[code] ?? "Cloudy";
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dateParts(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()] ?? "",
    month: MONTHS[d.getUTCMonth()] ?? "",
    day: d.getUTCDate(),
  };
}

function fmtHour(h: number, clock: "12h" | "24h"): string {
  if (clock === "24h") return String(h).padStart(2, "0");
  return `${h % 12 || 12}${h < 12 ? "AM" : "PM"}`;
}

function fmtClock(time: string, clock: "12h" | "24h"): string {
  const [hh, mm] = time.split(":");
  const h = Number(hh);
  if (clock === "24h") return `${hh}:${mm}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

const deg = (t: number) => `${Math.round(t)}°`;

// ---- icons (48x48 box, black strokes for e-ink) ---------------------------

const CLOUD = "M15 34 a7 7 0 0 1 -1 -14 a10 10 0 0 1 19 -2 a8 8 0 0 1 2 16 z";
const MOON = "M32 8 A16 16 0 1 0 40 30 A12 12 0 0 1 32 8 Z";

function Icon({ kind }: { kind: IconKind }) {
  const stroke = {
    stroke: "#000",
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const cloud = (dy = 0) => (
    <g transform={`translate(0 ${dy})`}>
      <path d={CLOUD} fill="#fff" {...stroke} />
    </g>
  );
  switch (kind) {
    case "sun":
      return (
        <g>
          <circle cx="24" cy="24" r="8" fill="none" {...stroke} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={24 + Math.cos(r) * 13}
                y1={24 + Math.sin(r) * 13}
                x2={24 + Math.cos(r) * 19}
                y2={24 + Math.sin(r) * 19}
                {...stroke}
              />
            );
          })}
        </g>
      );
    case "moon":
      return <path d={MOON} fill="none" {...stroke} />;
    case "partly":
      return (
        <g>
          <circle cx="17" cy="15" r="6" fill="none" {...stroke} />
          {[200, 250, 300, 340].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line
                key={a}
                x1={17 + Math.cos(r) * 10}
                y1={15 + Math.sin(r) * 10}
                x2={17 + Math.cos(r) * 14}
                y2={15 + Math.sin(r) * 14}
                {...stroke}
              />
            );
          })}
          <g transform="translate(6 8) scale(0.85)">
            <path d={CLOUD} fill="#fff" {...stroke} />
          </g>
        </g>
      );
    case "partlyNight":
      return (
        <g>
          <g transform="translate(-4 -2) scale(0.6)">
            <path d={MOON} fill="none" {...stroke} strokeWidth={4} />
          </g>
          <g transform="translate(6 8) scale(0.85)">
            <path d={CLOUD} fill="#fff" {...stroke} />
          </g>
        </g>
      );
    case "cloud":
      return cloud(4);
    case "fog":
      return (
        <g>
          <line x1="8" y1="14" x2="40" y2="14" {...stroke} />
          <line x1="12" y1="23" x2="36" y2="23" {...stroke} />
          <line x1="8" y1="32" x2="40" y2="32" {...stroke} />
          <line x1="14" y1="41" x2="34" y2="41" {...stroke} />
        </g>
      );
    case "rain":
      return (
        <g>
          {cloud(-4)}
          <line x1="16" y1="36" x2="13" y2="44" {...stroke} />
          <line x1="25" y1="36" x2="22" y2="44" {...stroke} />
          <line x1="34" y1="36" x2="31" y2="44" {...stroke} />
        </g>
      );
    case "snow":
      return (
        <g>
          {cloud(-4)}
          <circle cx="16" cy="39" r="2.5" fill="#000" />
          <circle cx="25" cy="42" r="2.5" fill="#000" />
          <circle cx="34" cy="39" r="2.5" fill="#000" />
        </g>
      );
    case "storm":
      return (
        <g>
          {cloud(-4)}
          <polygon
            points="27,32 19,41 25,41 21,48"
            fill="#000"
            stroke="#000"
            strokeWidth="1.5"
          />
        </g>
      );
  }
}

// ---- component -------------------------------------------------------------

function HourlyWeather({
  width,
  height,
  screen,
  data,
}: {
  width?: number;
  height?: number;
  screen?: ScreenProfile;
  data: Data;
}) {
  const profile =
    screen ??
    createScreenProfile({ width: width ?? 800, height: height ?? 480 });
  const W = profile.logicalWidth;
  const H = profile.logicalHeight;
  // Layout is authored on an 800x480 canvas.
  const sx = W / 800;
  const sy = H / 480;
  const f = Math.min(sx, sy);
  const X = (x: number) => x * sx;
  const Y = (y: number) => y * sy;
  const S = (s: number) => s * f;

  const L = 20; // left margin
  const SEP = 296; // vertical separator
  const R = 312; // right panel start
  const RW = 468; // right panel width
  const colW = RW / 7;
  const clock = data.clock;

  const text = (
    key: string,
    x: number,
    y: number,
    str: string,
    size: number,
    o: {
      bold?: boolean;
      w?: number;
      align?: "left" | "center" | "right";
      wrap?: boolean;
    } = {},
  ) => {
    const align = o.align ?? "left";
    return (
      <div
        key={key}
        style={{
          position: "absolute",
          left: X(x),
          top: Y(y),
          width: o.w !== undefined ? X(o.w) : undefined,
          display: "flex",
          justifyContent:
            align === "center"
              ? "center"
              : align === "right"
                ? "flex-end"
                : "flex-start",
          textAlign: align,
          fontSize: S(size),
          fontWeight: o.bold ? 700 : 400,
          lineHeight: 1.1,
          whiteSpace: o.wrap ? "normal" : "nowrap",
          overflow: "hidden",
        }}
      >
        {str}
      </div>
    );
  };

  const icon = (key: string, x: number, y: number, scale: number, kind: IconKind) => (
    <g key={key} transform={`translate(${X(x)} ${Y(y)}) scale(${f * scale})`}>
      <Icon kind={kind} />
    </g>
  );

  const dotted = (key: string, x1: number, y1: number, x2: number, y2: number) => (
    <line
      key={key}
      x1={X(x1)}
      y1={Y(y1)}
      x2={X(x2)}
      y2={Y(y2)}
      stroke="#000"
      strokeWidth={2 * f}
      strokeDasharray={`${2 * f} ${5 * f}`}
      strokeLinecap="round"
    />
  );

  const { now, today, tomorrow, nextHours, tomorrowHours } = data;
  const tomorrowParts = dateParts(tomorrow.date);
  const todayParts = dateParts(today.date);

  const texts: ReactNode[] = [];
  const icons: ReactNode[] = [];

  // Current
  texts.push(
    text("cur-label", L, 18, `Current (${fmtClock(now.time, clock)})`, 18, { w: 270 }),
    text("cur-temp", L + 120, 72, deg(now.temp), 78, { bold: true, w: 150 }),
    text("cur-desc", L, 196, describe(now.code), 34, { w: 270 }),
  );
  icons.push(icon("cur-icon", L + 2, 62, 2.2, iconFor(now.code, now.day)));

  // Today
  texts.push(
    text(
      "today-label",
      R,
      18,
      `Today — ${todayParts.weekday}, ${todayParts.month} ${todayParts.day}`,
      18,
      { w: RW },
    ),
    text("today-hi", R + 66, 50, deg(today.max), 22, { bold: true, w: 60 }),
    text("today-lo", R + 66, 76, deg(today.min), 22, { w: 60 }),
    text("today-desc", R + 130, 56, describe(today.code), 32, {
      bold: true,
      w: RW - 130,
    }),
  );
  icons.push(icon("today-icon", R, 50, 1.15, iconFor(today.code, true)));

  nextHours.forEach((h, i) => {
    const x = R + colW * i;
    texts.push(
      text(`nh-l-${i}`, x, 140, fmtHour(h.hour, clock), 16, { w: colW, align: "center" }),
      text(`nh-t-${i}`, x, 208, deg(h.temp), 20, { bold: true, w: colW, align: "center" }),
    );
    icons.push(icon(`nh-i-${i}`, x + colW / 2 - 24 * 0.85, 162, 0.85, iconFor(h.code, h.day)));
  });

  // Tomorrow
  texts.push(
    text("tom-label", L, 276, `Tomorrow — ${tomorrowParts.weekday}`, 18, { w: 270 }),
    text("tom-hi", L + 70, 308, deg(tomorrow.max), 22, { bold: true, w: 60 }),
    text("tom-lo", L + 70, 334, deg(tomorrow.min), 22, { w: 60 }),
    text("tom-desc", L, 378, describe(tomorrow.code), 24, { w: 262, wrap: true }),
  );
  icons.push(icon("tom-icon", L + 2, 306, 1.15, iconFor(tomorrow.code, true)));

  tomorrowHours.forEach((h, i) => {
    const x = R + colW * i;
    texts.push(
      text(`th-l-${i}`, x, 310, fmtHour(h.hour, clock), 16, { w: colW, align: "center" }),
      text(`th-t-${i}`, x, 380, deg(h.temp), 20, { bold: true, w: colW, align: "center" }),
    );
    icons.push(icon(`th-i-${i}`, x + colW / 2 - 24 * 0.85, 332, 0.85, iconFor(h.code, h.day)));
  });

  return (
    <PreSatori width={W} height={H}>
      <div
        style={{
          display: "flex",
          position: "relative",
          width: W,
          height: H,
          backgroundColor: "#fff",
          color: "#000",
        }}
      >
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          {dotted("v-top", SEP, 18, SEP, 244)}
          {dotted("h-today", R, 130, 780, 130)}
          {dotted("h-mid", L, 262, 780, 262)}
          {dotted("v-bot", SEP, 290, SEP, 440)}
          {icons}
        </svg>
        {texts}
      </div>
    </PreSatori>
  );
}

export default HourlyWeather;

export const definition: RecipeDefinition<
  typeof paramsSchema,
  typeof dataSchema
> = {
  meta: {
    slug: "hourly-weather",
    title: "Hourly Weather",
    description:
      "Current conditions, the next 7 hours, and tomorrow every 2 hours (Open-Meteo).",
    published: true,
    tags: ["weather", "forecast"],
    category: "display-components",
    version: "0.1.0",
  },
  paramsSchema,
  dataSchema,
  getData: async (params) => fetchWeather(params),
  Component: ({ width, height, screen, data }) => (
    <HourlyWeather width={width} height={height} screen={screen} data={data} />
  ),
};
