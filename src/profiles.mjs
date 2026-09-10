import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchTapTapMany, parseTapTapId } from "./taptap.mjs";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function profilePath() {
  const candidates = [
    path.resolve(moduleDir, "..", "config", "profiles.json"),
    path.resolve(moduleDir, "config", "profiles.json"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

export function loadProfiles() {
  const p = profilePath();
  if (!p) return { companies: {} };
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { companies: j.companies || {} };
  } catch {
    return { companies: {} };
  }
}

function parseYm(s) {
  return /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(s || "").trim());
}

function daysUntil(s) {
  const m = parseYm(s);
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return Math.round(
    (target - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000
  );
}

function monthsSince(s) {
  const m = parseYm(s);
  if (!m) return null;
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return (now.getUTCFullYear() - +m[1]) * 12 + (now.getUTCMonth() + 1 - +m[2]);
}

const UPCOMING = new Set(["测试中", "已定档", "研发中"]);

/**
 * 读取产品档案，并为填了 taptap 的产品抓评分。
 * 单个产品抓失败不会中断整条流程，只在该产品上标记 tapError。
 */
export async function buildProfiles() {
  const { companies } = loadProfiles();
  const codes = Object.keys(companies);
  if (!codes.length) return { companies: {}, taptapFetched: 0 };

  const ids = [];
  for (const c of Object.values(companies)) {
    for (const p of c.products || []) {
      const id = parseTapTapId(p.taptap);
      if (id) ids.push(id);
    }
  }
  const uniq = [...new Set(ids)];
  const taptap = uniq.length ? await fetchTapTapMany(uniq, 4) : {};

  const out = {};
  for (const [code, c] of Object.entries(companies)) {
    const products = (c.products || []).map((p) => {
      const id = parseTapTapId(p.taptap);
      const t = id ? taptap[id] : null;
      const d = daysUntil(p.expectedDate);
      return {
        ...p,
        taptapId: id,
        daysAway: d,
        monthsLive: monthsSince(p.launchDate),
        upcoming: UPCOMING.has(p.status),
        soonDays: d != null && d >= 0 && d <= 90 ? d : null,
        tap: t && !t.error ? t : null,
        tapError: t && t.error ? t.error : null,
      };
    });
    // 在测、待上线的排前面，其余按上线时间排
    const rank = (x) => (x.status === "测试中" ? 0 : x.status === "已定档" ? 1 : x.status === "研发中" ? 2 : 3);
    products.sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (a.daysAway ?? 9999) - (b.daysAway ?? 9999);
    });
    out[code] = { name: c.name || "", note: c.note || "", products };
  }

  return { companies: out, taptapFetched: uniq.length };
}

/** 临近的在测 / 待上线产品，用于推送和日报 */
export function upcomingFromProfiles(profiles) {
  const out = [];
  for (const [code, c] of Object.entries(profiles.companies || {})) {
    for (const p of c.products || []) {
      if (p.soonDays != null) out.push({ code, companyName: c.name, ...p });
    }
  }
  return out.sort((a, b) => a.soonDays - b.soonDays);
}
