/**
 * 隔夜外盘与风险背景。
 *
 * 这里只做「描述现在处在什么环境」，不做「预测明天涨跌」。
 * 原因写在 README 里：日频收益接近随机游走，任何预测模型的可信度都不足以支撑交易决策。
 * 但这些指标和游戏股的关系是有实证基础的：
 *   - 港股游戏股跟着恒生科技走，恒生科技跟着隔夜纳指走
 *   - 人民币走贬时外资对港股态度转弱
 *   - VIX 和黄金反映避险情绪
 *
 * 判定规则全部写死在下面，你可以看见、可以改、可以事后验证对错。
 */
import { quoteJson } from "./http.mjs";

/** 东财全球指数：secid -> 我们用的字段名 */
const INDEXES = [
  ["100.NDX", "NDX", "纳斯达克"],
  ["100.SPX", "SPX", "标普500"],
  ["100.DJIA", "DJIA", "道琼斯"],
  ["124.HSTECH", "HSTECH", "恒生科技"],
  ["100.HSI", "HSI", "恒生指数"],
  ["100.N225", "N225", "日经225"],
  ["100.GDAXI", "GDAXI", "德国DAX"],
  ["100.UDI", "UDI", "美元指数"],
  ["133.USDCNH", "USDCNH", "美元兑离岸人民币"],
  ["101.GC00Y", "GOLD", "COMEX黄金"],
];

async function fetchEastmoneyIndexes() {
  const secids = INDEXES.map(([s]) => s).join(",");
  const j = await quoteJson(
    `/api/qt/ulist.np/get?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
      `&fields=f12,f13,f14,f2,f3,f4&secids=${secids}`
  );
  const diff = j?.data?.diff;
  if (!Array.isArray(diff)) return [];
  const byCode = new Map(diff.map((d) => [d.f12, d]));
  return INDEXES.map(([secid, key, label]) => {
    const d = byCode.get(secid.split(".")[1]);
    if (!d) return null;
    return {
      key,
      label,
      price: typeof d.f2 === "number" ? d.f2 : null,
      chgPct: typeof d.f3 === "number" ? d.f3 : null,
      secid,
    };
  }).filter(Boolean);
}

/** VIX 东财没有，走腾讯。返回的是 GBK，要手动解码 */
async function fetchVix() {
  try {
    const res = await fetch("https://qt.gtimg.cn/q=usVIX", {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://gu.qq.com/" },
      signal: AbortSignal.timeout(15000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let text;
    try {
      text = new TextDecoder("gbk").decode(buf);
    } catch {
      text = buf.toString("latin1");
    }
    const m = text.match(/="([^"]*)"/);
    if (!m || !m[1]) return null;
    const f = m[1].split("~");
    const price = parseFloat(f[3]);
    if (!Number.isFinite(price)) return null;
    return { key: "VIX", label: "VIX 恐慌指数", price, chgPct: null };
  } catch {
    return null;
  }
}

/** 判断现在处在什么环境。规则是显式的，不是黑箱。 */
export function assessBackground(items) {
  const get = (k) => items.find((x) => x.key === k);
  const sig = [];

  const ndx = get("NDX");
  if (ndx?.chgPct != null) {
    if (ndx.chgPct <= -1) sig.push({ level: "warn", text: `隔夜纳斯达克跌 ${ndx.chgPct}%，科技情绪偏弱` });
    else if (ndx.chgPct >= 1) sig.push({ level: "good", text: `隔夜纳斯达克涨 ${ndx.chgPct}%，科技情绪偏暖` });
  }

  const hk = get("HSTECH");
  if (hk?.chgPct != null) {
    if (hk.chgPct <= -1.5) sig.push({ level: "warn", text: `恒生科技跌 ${hk.chgPct}%，港股科技已先行走弱` });
    else if (hk.chgPct >= 1.5) sig.push({ level: "good", text: `恒生科技涨 ${hk.chgPct}%，港股科技走强` });
  }

  const vix = get("VIX");
  if (vix?.price != null) {
    if (vix.price >= 25) sig.push({ level: "warn", text: `VIX ${vix.price}，避险情绪偏高` });
    else if (vix.price <= 15) sig.push({ level: "good", text: `VIX ${vix.price}，市场情绪平稳` });
    else sig.push({ level: "flat", text: `VIX ${vix.price}，避险情绪中性` });
  }

  const cnh = get("USDCNH");
  if (cnh?.chgPct != null) {
    if (cnh.chgPct >= 0.3) sig.push({ level: "warn", text: `离岸人民币走贬 ${cnh.chgPct}%，外资对港股态度易转弱` });
    else if (cnh.chgPct <= -0.3) sig.push({ level: "good", text: `离岸人民币走强 ${Math.abs(cnh.chgPct)}%，利好港股资金面` });
  }

  const gold = get("GOLD");
  if (gold?.chgPct != null && gold.chgPct >= 1.5)
    sig.push({ level: "warn", text: `黄金涨 ${gold.chgPct}%，避险资金在流入` });

  const warns = sig.filter((s) => s.level === "warn").length;
  const goods = sig.filter((s) => s.level === "good").length;
  const tone = warns >= 2 ? "偏谨慎" : goods >= 2 ? "偏暖" : "中性";
  const toneLevel = warns >= 2 ? "warn" : goods >= 2 ? "good" : "flat";

  return { signals: sig, tone, toneLevel, warns, goods };
}

export async function fetchMacro() {
  const [east, vix] = await Promise.all([
    fetchEastmoneyIndexes().catch(() => []),
    fetchVix(),
  ]);
  const items = vix ? [...east, vix] : east;
  if (!items.length) return { ok: false, reason: "没有取到任何外盘数据", items: [] };
  return { ok: true, items, background: assessBackground(items) };
}
