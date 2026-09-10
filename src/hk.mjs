import { quoteJson } from "./http.mjs";
import { num } from "./eastmoney.mjs";

/**
 * 港股数据源。
 *
 * 东财的港股实时行情可以批量取，但拿不到历史估值（PE/PB 分位）和公告、报告。
 * 所以港股的区间改用「价格分位」口径，见 analyze.mjs。
 */

/** 一次性批量取多只港股的快照 */
export async function fetchHkSnapshots(codes) {
  const secids = codes.map((c) => `116.${c}`).join(",");
  const fields = "f12,f13,f14,f2,f3,f4,f5,f6,f8,f9,f20,f21,f23,f115,f169,f170";
  const j = await quoteJson(
    `/api/qt/ulist.np/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fields=${fields}&secids=${secids}`
  );
  const diff = j?.data?.diff;
  if (!Array.isArray(diff)) throw new Error("港股快照返回为空");
  return diff.map((d) => ({
    market: "HK",
    code: d.f12,
    name: d.f14,
    price: num(d.f2),
    chgPct: num(d.f3),
    chg: num(d.f4),
    volume: num(d.f5),
    amount: num(d.f6),
    turnover: num(d.f8),
    peDyn: num(d.f9),
    totalCap: num(d.f20),
    floatCap: num(d.f21),
    pb: num(d.f23),
    peTtm: num(d.f115),
  }));
}

/** 港股日线（腾讯前复权） */
export async function fetchHkKline(code, bars = 1400) {
  const sym = `hk${code}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${bars},qfq`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const d = j?.data?.[sym];
  const rows = d?.qfqday || d?.day;
  if (!Array.isArray(rows) || !rows.length) throw new Error("港股日线为空");
  // 腾讯格式: [日期, 开, 收, 高, 低, 成交量]
  return rows.map((r) => ({
    date: r[0],
    open: +r[1],
    close: +r[2],
    high: +r[3],
    low: +r[4],
    volume: +r[5],
  }));
}
