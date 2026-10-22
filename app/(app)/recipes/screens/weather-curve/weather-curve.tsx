import { z } from "zod";
import type { RecipeDefinition } from "@/lib/recipes/types";
import {
  createScreenProfile,
  type ScreenProfile,
} from "@/lib/trmnl/screen-profile";
import { PreSatori } from "@/utils/pre-satori";

const daySchema = z.object({
  date: z.string(),
  code: z.number(),
  max: z.number(),
  min: z.number(),
  rain: z.number(),
});

const SAMPLE_DAYS = [
  { date: "2026-10-21", code: 3, max: 58, min: 47, rain: 20 },
  { date: "2026-10-22", code: 61, max: 55, min: 46, rain: 70 },
  { date: "2026-10-23", code: 2, max: 60, min: 45, rain: 10 },
  { date: "2026-10-24", code: 0, max: 64, min: 49, rain: 0 },
  { date: "2026-10-25", code: 3, max: 62, min: 50, rain: 30 },
  { date: "2026-10-26", code: 63, max: 57, min: 48, rain: 80 },
  { date: "2026-10-27", code: 1, max: 59, min: 44, rain: 5 },
];

export const paramsSchema = z.object({
  locationName: z.string().default("New York").describe("Name shown in the header").meta({ title: "Location name" }),
  latitude: z.number().default(40.7769).describe("Latitude (ZIP 10023)").meta({ title: "Latitude" }),
  longitude: z.number().default(-73.9813).describe("Longitude (ZIP 10023)").meta({ title: "Longitude" }),
  unit: z.enum(["fahrenheit", "celsius"]).default("fahrenheit").describe("Temperature unit").meta({ title: "Unit" }),
  timezone: z.string().default("America/New_York").describe("IANA timezone").meta({ title: "Timezone" }),
});

export const dataSchema = z.object({
  locationName: z.string().default("New York"),
  unit: z.enum(["fahrenheit", "celsius"]).default("fahrenheit"),
  current: z.object({ temp: z.number(), code: z.number() }).default({ temp: 54, code: 3 }),
  days: z.array(daySchema).default(SAMPLE_DAYS),
});

type Data = z.infer<typeof dataSchema>;
type Params = z.infer<typeof paramsSchema>;

async function fetchWeather(params: Params): Promise<Data> {
  const q = new URLSearchParams({
    latitude: String(params.latitude),
    longitude: String(params.longitude),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    temperature_unit: params.unit,
    timezone: params.timezone,
    forecast_days: "7",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`);
  const json = await res.json();
  const days = (json.daily.time as string[]).map((date, i) => ({
    date,
    code: json.daily.weather_code[i] ?? 0,
    max: json.daily.temperature_2m_max[i],
    min: json.daily.temperature_2m_min[i],
    rain: json.daily.precipitation_probability_max[i] ?? 0,
  }));
  return {
    locationName: params.locationName,
    unit: params.unit,
    current: { temp: json.current.temperature_2m, code: json.current.weather_code },
    days,
  };
}

type IconKind = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

function iconFor(code: number): IconKind {
  if (code === 0 || code === 1) return "sun";
  if (code === 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloud";
}

function describe(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Thunderstorm";
  return "Cloudy";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${date}T12:00:00`);
  return WEEKDAYS[d.getDay()] ?? "";
}

type Pt = { x: number; y: number };

function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

const CLOUD = "M15 34 a7 7 0 0 1 -1 -14 a10 10 0 0 1 19 -2 a8 8 0 0 1 2 16 z";

function Icon({ kind }: { kind: IconKind }) {
  const stroke = { stroke: "#000", strokeWidth: 3, strokeLinecap: "round" as const };
  switch (kind) {
    case "sun":
      return (
        <g>
          <circle cx="24" cy="24" r="8" fill="none" {...stroke} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={a} x1={24 + Math.cos(r) * 13} y1={24 + Math.sin(r) * 13} x2={24 + Math.cos(r) * 19} y2={24 + Math.sin(r) * 19} {...stroke} />
            );
          })}
        </g>
      );
    case "partly":
      return (
        <g>
          <circle cx="17" cy="15" r="6" fill="none" {...stroke} />
          {[200, 250, 300, 340].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={a} x1={17 + Math.cos(r) * 10} y1={15 + Math.sin(r) * 10} x2={17 + Math.cos(r) * 14} y2={15 + Math.sin(r) * 14} {...stroke} />
            );
          })}
          <g transform="translate(6 8) scale(0.85)">
            <path d={CLOUD} fill="#fff" {...stroke} />
          </g>
        </g>
      );
    case "cloud":
      return (
        <g transform="translate(0 4)">
          <path d={CLOUD} fill="#fff" {...stroke} />
        </g>
      );
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
          <g transform="translate(0 -4)">
            <path d={CLOUD} fill="#fff" {...stroke} />
          </g>
          <line x1="16" y1="36" x2="13" y2="44" {...stroke} />
          <line x1="25" y1="36" x2="22" y2="44" {...stroke} />
          <line x1="34" y1="36" x2="31" y2="44" {...stroke} />
        </g>
      );
    case "snow":
      return (
        <g>
          <g transform="translate(0 -4)">
            <path d={CLOUD} fill="#fff" {...stroke} />
          </g>
          <circle cx="16" cy="39" r="2.5" fill="#000" />
          <circle cx="25" cy="42" r="2.5" fill="#000" />
          <circle cx="34" cy="39" r="2.5" fill="#000" />
        </g>
      );
    case "storm":
      return (
        <g>
          <g transform="translate(0 -4)">
            <path d={CLOUD} fill="#fff" {...stroke} />
          </g>
          <polygon points="27,32 19,41 25,41 21,48" fill="#000" stroke="#000" strokeWidth="1.5" />
        </g>
      );
  }
}

function WeatherCurve({
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
  const profile = screen ?? createScreenProfile({ width: width ?? 800, height: height ?? 600 });
  const W = profile.logicalWidth;
  const H = profile.logicalHeight;
  const v = H / 600;
  const f = Math.min(W / 800, H / 600);
  const pad = 24 * (W / 800);

  const days = data.days.slice(0, 7);
  const n = Math.max(days.length, 1);
  const colW = (W - pad * 2) / n;
  const cx = (i: number) => pad + colW * (i + 0.5);

  const zoneTop = 290 * v;
  const zoneBottom = 450 * v;
  const tMax = Math.max(...days.map((d) => d.max));
  const tMin = Math.min(...days.map((d) => d.min));
  const span = Math.max(tMax - tMin, 1);
  const yOf = (t: number) => zoneTop + ((tMax - t) / span) * (zoneBottom - zoneTop);

  const highs: Pt[] = days.map((d, i) => ({ x: cx(i), y: yOf(d.max) }));
  const lows: Pt[] = days.map((d, i) => ({ x: cx(i), y: yOf(d.min) }));

  const rainBase = 556 * v;
  const rainMax = 60 * v;

  const today = days[0];
  const deg = (t: number) => `${Math.round(t)}°`;

  const label = (key: string, x: number, top: number, text: string, size: number, bold = false) => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: x - colW / 2,
        top,
        width: colW,
        display: "flex",
        justifyContent: "center",
        fontSize: size,
        fontWeight: bold ? 700 : 400,
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );

  const labels = days.flatMap((d, i) => [
    label(`day-${i}`, cx(i), 172 * v, dayLabel(d.date, i), 22 * f, i === 0),
    label(`hi-${i}`, cx(i), highs[i].y - 34 * f, deg(d.max), 24 * f, true),
    label(`lo-${i}`, cx(i), lows[i].y + 12 * f, deg(d.min), 22 * f),
    label(`rain-${i}`, cx(i), 566 * v, `${Math.round(d.rain)}%`, 20 * f),
  ]);

  return (
    <PreSatori width={W} height={H}>
      <div style={{ display: "flex", position: "relative", width: W, height: H, backgroundColor: "#fff", color: "#000" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", left: 0, top: 0 }}>
          <line x1={pad} y1={158 * v} x2={W - pad} y2={158 * v} stroke="#000" strokeWidth={2} />
          {days.map((d, i) => (
            <g key={`icon-${d.date}`} transform={`translate(${cx(i) - 24 * f} ${204 * v}) scale(${f})`}>
              <Icon kind={iconFor(d.code)} />
            </g>
          ))}
          <path d={smoothPath(lows)} fill="none" stroke="#000" strokeWidth={2.5 * f} strokeDasharray={`${8 * f} ${6 * f}`} />
          <path d={smoothPath(highs)} fill="none" stroke="#000" strokeWidth={4 * f} />
          {highs.map((p, i) => (
            <circle key={`h-${i}`} cx={p.x} cy={p.y} r={5.5 * f} fill="#000" />
          ))}
          {lows.map((p, i) => (
            <circle key={`l-${i}`} cx={p.x} cy={p.y} r={4.5 * f} fill="#fff" stroke="#000" strokeWidth={2.5 * f} />
          ))}
          <line x1={pad} y1={rainBase} x2={W - pad} y2={rainBase} stroke="#000" strokeWidth={2} />
          {days.map((d, i) => {
            const h = (Math.max(0, Math.min(100, d.rain)) / 100) * rainMax;
            return <rect key={`bar-${d.date}`} x={cx(i) - 10 * f} y={rainBase - h} width={20 * f} height={h} fill="#000" />;
          })}
        </svg>

        <div style={{ position: "absolute", left: pad, top: 16 * v, display: "flex", fontSize: 26 * f, lineHeight: 1 }}>
          {data.locationName}
        </div>
        <div style={{ position: "absolute", left: pad, top: 46 * v, display: "flex", fontSize: 96 * f, fontWeight: 700, lineHeight: 1 }}>
          {deg(data.current.temp)}
        </div>
        <div style={{ position: "absolute", right: pad, top: 30 * v, display: "flex", fontSize: 34 * f, fontWeight: 700, lineHeight: 1 }}>
          {describe(data.current.code)}
        </div>
        {today && (
          <div style={{ position: "absolute", right: pad, top: 78 * v, display: "flex", fontSize: 26 * f, lineHeight: 1 }}>
            {`High ${deg(today.max)}  ·  Low ${deg(today.min)}`}
          </div>
        )}
        {today && (
          <div style={{ position: "absolute", right: pad, top: 114 * v, display: "flex", fontSize: 24 * f, lineHeight: 1 }}>
            {`Rain today ${Math.round(today.rain)}%`}
          </div>
        )}
        {labels}
      </div>
    </PreSatori>
  );
}

export default WeatherCurve;

export const definition: RecipeDefinition<typeof paramsSchema, typeof dataSchema> = {
  meta: {
    slug: "weather-curve",
    title: "Weather Curve",
    description: "7-day forecast with a high/low temperature curve, icons and chance of rain (Open-Meteo).",
    published: true,
    tags: ["weather", "forecast"],
    category: "display-components",
    version: "0.1.0",
  },
  paramsSchema,
  dataSchema,
  getData: async (params) => fetchWeather(params),
  Component: ({ width, height, screen, data }) => (
    <WeatherCurve width={width} height={height} screen={screen} data={data} />
  ),
};

