#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 10_000;

const WEATHER_CODES: Record<number, string> = {
  0: "晴朗",
  1: "基本晴朗",
  2: "多云",
  3: "阴天",
  45: "雾",
  48: "雾凇",
  51: "小毛毛雨",
  53: "中等毛毛雨",
  55: "大毛毛雨",
  56: "冻毛毛雨（小）",
  57: "冻毛毛雨（大）",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  66: "冻雨（小）",
  67: "冻雨（大）",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  77: "米雪",
  80: "小阵雨",
  81: "中阵雨",
  82: "强阵雨",
  85: "小阵雪",
  86: "大阵雪",
  95: "雷暴",
  96: "雷暴伴小冰雹",
  99: "雷暴伴大冰雹",
};

function describeWeatherCode(code: number): string {
  return WEATHER_CODES[code] ?? `未知天气状况（代码 ${code}）`;
}

async function fetchJson<T>(url: URL): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

interface GeocodingResult {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

interface ForecastResponse {
  timezone: string;
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

const server = new McpServer({
  name: "hello-world-mcp-server",
  version: "0.2.0",
});

server.registerTool(
  "search_location",
  {
    title: "Search Location",
    description:
      "根据地名搜索经纬度坐标，支持中英文城市/地区名称。返回的坐标可直接传给 get_weather 使用。",
    inputSchema: {
      query: z.string().min(1).describe("地名，例如 '北京' 或 'Tokyo'"),
    },
  },
  async ({ query }) => {
    try {
      const url = new URL(GEOCODING_URL);
      url.searchParams.set("name", query);
      url.searchParams.set("count", "5");
      url.searchParams.set("language", "zh");
      url.searchParams.set("format", "json");

      const data = await fetchJson<GeocodingResponse>(url);
      const results = data.results ?? [];

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `没有找到与「${query}」匹配的地点，换个名称试试。` }],
          isError: true,
        };
      }

      const lines = results.map((r, i) => {
        const parts = [r.name, r.admin1, r.country].filter(Boolean);
        return `${i + 1}. ${parts.join(", ")} — lat: ${r.latitude}, lon: ${r.longitude}`;
      });

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (error) {
      return {
        content: [
          { type: "text" as const, text: `搜索地点失败：${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_weather",
  {
    title: "Get Weather",
    description:
      "根据经纬度查询当前天气和未来 3 天预报（数据来自 Open-Meteo）。经纬度可先用 search_location 查到。",
    inputSchema: {
      latitude: z.number().min(-90).max(90).describe("纬度"),
      longitude: z.number().min(-180).max(180).describe("经度"),
    },
  },
  async ({ latitude, longitude }) => {
    try {
      const url = new URL(FORECAST_URL);
      url.searchParams.set("latitude", String(latitude));
      url.searchParams.set("longitude", String(longitude));
      url.searchParams.set(
        "current",
        "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
      );
      url.searchParams.set(
        "daily",
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
      );
      url.searchParams.set("timezone", "auto");
      url.searchParams.set("forecast_days", "3");

      const data = await fetchJson<ForecastResponse>(url);
      const { current, daily } = data;

      const currentText = [
        `当前天气（时区 ${data.timezone}）：`,
        `- 状况：${describeWeatherCode(current.weather_code)}`,
        `- 温度：${current.temperature_2m}°C（体感 ${current.apparent_temperature}°C）`,
        `- 湿度：${current.relative_humidity_2m}%`,
        `- 降水：${current.precipitation} mm`,
        `- 风速：${current.wind_speed_10m} km/h`,
      ].join("\n");

      const dailyText = daily.time
        .map((date, i) => {
          const desc = describeWeatherCode(daily.weather_code[i]);
          return `- ${date}：${desc}，${daily.temperature_2m_min[i]}~${daily.temperature_2m_max[i]}°C，降水概率 ${daily.precipitation_probability_max[i]}%`;
        })
        .join("\n");

      return {
        content: [{ type: "text" as const, text: `${currentText}\n\n未来 3 天预报：\n${dailyText}` }],
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "请求超时"
          : error instanceof Error
            ? error.message
            : String(error);
      return {
        content: [{ type: "text" as const, text: `获取天气失败：${message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("hello-world-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
