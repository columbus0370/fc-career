/**
 * API-Football の取得可否を確認するスクリプト。
 * 合計リクエスト数は10回以内に抑え、応答は .cache/api-football/ に保存して再実行時に再利用する。
 * 実行: npx tsx scripts/check-api-football.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local が無い場合はそのまま進み、下の未設定チェックに任せる。
}

const API_BASE = "https://v3.football.api-sports.io";
const CACHE_DIR = path.join(process.cwd(), ".cache", "api-football");
const SEASON = 2026;
const TARGET_LEAGUE_NAMES = [
  "Premier League",
  "Championship",
  "League One",
  "League Two",
] as const;

const MAX_REQUESTS = 10;
let requestCount = 0;

function mask(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return value.slice(0, 4) + "*".repeat(value.length - 4);
}

function cacheFileFor(cacheKey: string): string {
  const safeName = cacheKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(CACHE_DIR, `${safeName}.json`);
}

async function readCache(cacheKey: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(cacheFileFor(cacheKey), "utf-8");
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function writeCache(cacheKey: string, data: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cacheFileFor(cacheKey), JSON.stringify(data, null, 2), "utf-8");
}

type ApiResult =
  | { ok: true; data: { response?: unknown; errors?: unknown } }
  | { ok: false; error: string };

interface LeagueApiItem {
  league: { id: number; name: string; type: string };
  seasons?: { year: number; coverage?: unknown }[];
}

interface TeamApiItem {
  team: { id: number; name?: string };
}

interface SquadApiItem {
  players?: unknown[];
}

async function callApi(
  cacheKey: string,
  endpoint: string,
  apiKey: string,
): Promise<ApiResult> {
  const cached = await readCache(cacheKey);
  if (cached !== undefined) {
    console.log(`[cache] ${endpoint} -> ${cacheFileFor(cacheKey)}`);
    return cached as ApiResult;
  }

  if (requestCount >= MAX_REQUESTS) {
    const msg = `リクエスト上限(${MAX_REQUESTS}回)に達したため停止します: ${endpoint}`;
    console.error(msg);
    return { ok: false, error: msg };
  }

  requestCount += 1;
  console.log(`[request ${requestCount}/${MAX_REQUESTS}] GET ${endpoint}`);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { "x-apisports-key": apiKey },
    });
    const body = await res.json();

    if (!res.ok) {
      const result: ApiResult = {
        ok: false,
        error: `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`,
      };
      await writeCache(cacheKey, result);
      return result;
    }

    if (Array.isArray(body?.errors) ? body.errors.length > 0 : body?.errors && Object.keys(body.errors).length > 0) {
      const result: ApiResult = {
        ok: false,
        error: `API エラー応答: ${JSON.stringify(body.errors).slice(0, 500)}`,
      };
      await writeCache(cacheKey, result);
      return result;
    }

    const result: ApiResult = { ok: true, data: body };
    await writeCache(cacheKey, result);
    return result;
  } catch (err) {
    const result: ApiResult = {
      ok: false,
      error: `リクエスト失敗: ${err instanceof Error ? err.message : String(err)}`,
    };
    return result;
  }
}

async function main() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    console.error("API_FOOTBALL_KEY が .env.local に設定されていません。");
    process.exitCode = 1;
    return;
  }

  console.log(`API_FOOTBALL_KEY: ${mask(apiKey)}`);
  console.log(`確認対象シーズン: ${SEASON}`);
  console.log("");

  const summary: Record<string, unknown> = {};

  // 1. /status で残りリクエスト数とプランを確認する
  const statusResult = await callApi("status", "/status", apiKey);
  summary.status = statusResult;
  if (statusResult.ok) {
    console.log("--- /status ---");
    console.log(JSON.stringify(statusResult.data?.response, null, 2));
  } else {
    console.error("/status の取得に失敗:", statusResult.error);
  }
  console.log("");

  // 2. /leagues?country=England&season=2026 で4リーグのIDを名前から特定する
  const leaguesResult = await callApi(
    `leagues_England_${SEASON}`,
    `/leagues?country=England&season=${SEASON}`,
    apiKey,
  );
  summary.leagues = leaguesResult;

  const leagueInfo: Record<
    string,
    { id: number; found: boolean; seasonAvailable: boolean; coverage?: unknown } | { found: false }
  > = {};

  if (leaguesResult.ok) {
    const response = (leaguesResult.data?.response ?? []) as LeagueApiItem[];
    for (const targetName of TARGET_LEAGUE_NAMES) {
      const match = response.find(
        (item) => item?.league?.name === targetName && item?.league?.type === "League",
      );
      if (!match) {
        leagueInfo[targetName] = { found: false };
        continue;
      }
      const seasonEntry = (match.seasons ?? []).find((s) => s.year === SEASON);
      leagueInfo[targetName] = {
        id: match.league.id,
        found: true,
        seasonAvailable: Boolean(seasonEntry),
        coverage: seasonEntry?.coverage,
      };
    }
    console.log("--- /leagues (対象4リーグ) ---");
    console.log(JSON.stringify(leagueInfo, null, 2));
  } else {
    console.error("/leagues の取得に失敗:", leaguesResult.error);
  }
  summary.leagueInfo = leagueInfo;
  console.log("");

  // 3. (2の応答に含まれる coverage 情報で代替。/leagues のレスポンスに season ごとの coverage が含まれるため追加リクエストは行わない)

  // 4. League Two の /teams?league=<ID>&season=2026 でクラブ一覧が取れるか確認する
  const leagueTwo = leagueInfo["League Two"];
  let teamsResult: ApiResult | undefined;
  let leagueTwoTeamCount: number | undefined;
  let firstTeamId: number | undefined;

  if (leagueTwo && "found" in leagueTwo && leagueTwo.found && "id" in leagueTwo) {
    teamsResult = await callApi(
      `teams_league${leagueTwo.id}_${SEASON}`,
      `/teams?league=${leagueTwo.id}&season=${SEASON}`,
      apiKey,
    );
    summary.teams = teamsResult;
    if (teamsResult.ok) {
      const teams = (teamsResult.data?.response ?? []) as TeamApiItem[];
      leagueTwoTeamCount = teams.length;
      firstTeamId = teams[0]?.team?.id;
      console.log(`--- /teams (League Two, id=${leagueTwo.id}) ---`);
      console.log(`取得クラブ数: ${leagueTwoTeamCount}`);
    } else {
      console.error("/teams の取得に失敗:", teamsResult.error);
    }
  } else {
    console.error("League Two の ID が特定できなかったため /teams を呼びません。");
  }
  console.log("");

  // 5. League Two の1クラブで /players/squads?team=<ID> を呼び、所属選手が取れるか確認する
  let squadResult: ApiResult | undefined;
  let squadPlayerCount: number | undefined;

  if (firstTeamId !== undefined) {
    squadResult = await callApi(
      `squad_team${firstTeamId}`,
      `/players/squads?team=${firstTeamId}`,
      apiKey,
    );
    summary.squad = squadResult;
    if (squadResult.ok) {
      const squads = (squadResult.data?.response ?? []) as SquadApiItem[];
      const players = squads[0]?.players ?? [];
      squadPlayerCount = players.length;
      console.log(`--- /players/squads (team=${firstTeamId}) ---`);
      console.log(`取得選手数: ${squadPlayerCount}`);
    } else {
      console.error("/players/squads の取得に失敗:", squadResult.error);
    }
  } else {
    console.error("対象クラブの ID が特定できなかったため /players/squads を呼びません。");
  }
  console.log("");

  console.log("========================================");
  console.log(`合計リクエスト数(このセッション): ${requestCount} / ${MAX_REQUESTS}`);
  console.log("========================================");

  await writeCache("summary_latest", {
    season: SEASON,
    requestCountThisRun: requestCount,
    leagueInfo,
    leagueTwoTeamCount,
    firstTeamId,
    squadPlayerCount,
    generatedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error("予期しないエラー:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
