/** ---------- 统计工具 ---------- */

/** 升序数组的分位数（线性插值），q ∈ [0,1] */
export function quantile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (!n) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** value 在 sortedAsc 中的百分位排名 0~100 */
export function percentileRank(sortedAsc, value) {
  const n = sortedAsc.length;
  if (!n || value == null) return null;
  let below = 0;
  for (const v of sortedAsc) {
    if (v < value) below++;
    else break;
  }
  let equal = 0;
  for (const v of sortedAsc) if (v === value) equal++;
  return ((below + equal / 2) / n) * 100;
}

export function mean(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function median(arr) {
  const v = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? quantile(v, 0.5) : null;
}

export function sma(values, n) {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

function round(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return null;
  const m = 10 ** d;
  return Math.round(v * m) / m;
}

/** ---------- 估值分位与价格区间 ---------- */

/** PB 比 PE 稳（游戏股盈利周期波动大），所以权重给得更高 */
const METRIC_WEIGHTS = { pe: 0.4, pb: 0.4, ps: 0.2 };

/** 2%/98% 截尾，防止历史盈利低谷期的极端 PE 把分位带歪 */
function winsorize(sorted, lo = 0.02, hi = 0.98) {
  const loV = quantile(sorted, lo);
  const hiV = quantile(sorted, hi);
  return sorted.map((v) => Math.min(Math.max(v, loV), hiV));
}

/**
 * 护栏：反推出来的区间如果离谱（减仓价高于现价 2.2 倍，或加仓价低于现价 0.45 倍），
 * 说明这个估值口径在当前不适用，直接弃用，让其余口径重新分配权重。
 */
const SANITY = { maxTrimRatio: 2.2, minAddRatio: 0.45 };

/**
 * 用「历史估值分位」反推价格区间。
 *
 * 原理：PE = 价格 / EPS。假设盈利预期不变，则
 *   目标价 = 现价 × (历史 PE 分位值 / 当前 PE)
 * PB、PS 同理。三个口径加权，避免单一指标被盈利周期扭曲。
 */
function deriveBands(snapshot, history, bandsCfg) {
  const cfg = bandsCfg;
  const metrics = [
    { key: "pe", field: "peTtm", now: snapshot.peTtm, w: METRIC_WEIGHTS.pe },
    { key: "pb", field: "pb", now: snapshot.pb, w: METRIC_WEIGHTS.pb },
    { key: "ps", field: "ps", now: snapshot.ps, w: METRIC_WEIGHTS.ps },
  ];

  const price = snapshot.price;
  const parts = {};
  const active = [];

  for (const m of metrics) {
    const raw = history
      .map((h) => h[m.field])
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    const series = raw.length >= 120 ? winsorize(raw) : raw;
    // 亏损股的 PE 无意义；样本太少也不可信
    if (m.now == null || m.now <= 0 || series.length < 120 || price == null) {
      parts[m.key] = { pct: null, used: false };
      continue;
    }
    const pq = (q) => quantile(series, q);
    const toPrice = (q) => (price * pq(q)) / m.now;
    const trimRef = toPrice(cfg.trimLow / 100);
    const addRef = toPrice(cfg.addHigh / 100);
    if (
      trimRef > price * SANITY.maxTrimRatio ||
      addRef < price * SANITY.minAddRatio
    ) {
      parts[m.key] = { pct: null, used: false, skipped: "区间不合理" };
      continue;
    }
    parts[m.key] = {
      used: true,
      pct: percentileRank(series, m.now),
      median: pq(0.5),
      samples: series.length,
      price: {
        addLow: toPrice(cfg.addLow / 100),
        addHigh: toPrice(cfg.addHigh / 100),
        trimLow: toPrice(cfg.trimLow / 100),
        trimHigh: toPrice(cfg.trimHigh / 100),
      },
    };
    active.push(m);
  }

  if (!active.length) {
    return { ok: false, reason: "估值数据不足（可能是亏损股或上市时间太短）", parts };
  }

  const weightSum = active.reduce((a, m) => a + m.w, 0);
  const blend = (path) => {
    const items = active
      .map((m) => ({ v: parts[m.key].price[path], w: m.w }))
      .filter((x) => Number.isFinite(x.v));
    if (!items.length) return null;
    const ws = items.reduce((a, x) => a + x.w, 0);
    return items.reduce((a, x) => a + (x.v * x.w) / ws, 0);
  };

  const pctBlend =
    active.reduce((a, m) => a + (parts[m.key].pct * m.w) / weightSum, 0) || 0;

  return {
    ok: true,
    compositePct: round(pctBlend, 1),
    metrics: parts,
    addPrice: round(blend("addHigh")),
    trimPrice: round(blend("trimLow")),
    addLow: round(blend("addLow")),
    addHigh: round(blend("addHigh")),
    trimLow: round(blend("trimLow")),
    trimHigh: round(blend("trimHigh")),
  };
}

/** 价格自身的分位与关键均线，用来和估值口径交叉验证 */
export function priceContext(closes, price) {
  const c = closes.filter((v) => Number.isFinite(v) && v > 0);
  if (c.length < 60) return null;
  const w = c.slice(-750); // 约 3 年
  const sorted = [...w].sort((a, b) => a - b);
  return {
    pricePct: round(percentileRank(sorted, price ?? c.at(-1)), 1),
    ma60: round(sma(c, 60)),
    ma250: c.length >= 250 ? round(sma(c, 250)) : null,
    low250: round(Math.min(...c.slice(-250))),
    high250: round(Math.max(...c.slice(-250))),
    low750: round(Math.min(...w)),
    high750: round(Math.max(...w)),
    bars: c.length,
  };
}

/**
 * 用成分股的收盘价合成等权板块指数（以起点归一化到 1000）。
 * 用于东财板块指数 K 线拉不到时兜底。
 */
export function synthesizeIndex(histories) {
  const N = histories.length;
  if (N < 5) return [];
  const byDate = new Map(); // date -> Map(stockIdx -> close)
  histories.forEach((rows, idx) => {
    for (const r of rows) {
      if (!Number.isFinite(r.close) || r.close <= 0) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, new Map());
      byDate.get(r.date).set(idx, r.close);
    }
  });
  const dates = [...byDate.keys()].sort();
  const covered = dates.filter((d) => byDate.get(d).size >= N * 0.8);
  if (covered.length < 60) return [];

  const startDate = covered[0];
  const base = new Map();
  for (const [idx, close] of byDate.get(startDate)) base.set(idx, close);

  return covered.map((date) => {
    const ratios = [];
    for (const [idx, close] of byDate.get(date)) {
      const b = base.get(idx);
      if (b) ratios.push(close / b);
    }
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    return { date, close: round(avg * 1000, 2), coverage: ratios.length };
  });
}

function statusOf(pct, cfg) {
  if (pct == null) return { label: "数据不足", tone: "na" };
  if (pct < cfg.addLow) return { label: "深度低估", tone: "buy" };
  if (pct < cfg.addHigh) return { label: "加仓区", tone: "buy" };
  if (pct < cfg.trimLow) return { label: "持有区", tone: "hold" };
  if (pct < cfg.trimHigh) return { label: "减仓区", tone: "trim" };
  return { label: "高估区", tone: "trim" };
}

/** 生成单只个股的完整分析结果 */
export function analyzeStock({ snapshot, history, kline, bandsCfg, consensus }) {
  const b = deriveBands(snapshot, history, bandsCfg);
  const closes = [...(history || [])]
    .sort((x, y) => (x.date < y.date ? -1 : 1))
    .map((h) => h.close);
  const pc = priceContext(closes, snapshot.price);
  const pct = b.ok ? b.compositePct : null;
  const status = statusOf(pct, bandsCfg);

  const toBand = (target) => {
    if (target == null || !snapshot.price) return null;
    return round(((target - snapshot.price) / snapshot.price) * 100, 1);
  };

  // 失效条件：满足任意一条，价格区间就不再适用，应重新评估逻辑
  const invalidations = [];
  if (snapshot.peTtm != null && snapshot.peTtm <= 0)
    invalidations.push("PE(TTM) 为负，公司处于亏损，估值分位失效");
  if (pc?.ma250 && snapshot.price && snapshot.price < pc.ma250)
    invalidations.push("股价跌破年线，中期趋势转弱");
  const revTrend = history.length >= 60
    ? consensus?.revTrend
    : null;
  if (revTrend === "down")
    invalidations.push("机构近 3 个月下调盈利预测，区间需按新预期重算");

  return {
    code: snapshot.code,
    name: snapshot.name,
    price: snapshot.price,
    chgPct: snapshot.chgPct,
    turnover: snapshot.turnover,
    totalCap: snapshot.totalCap,
    peTtm: snapshot.peTtm,
    pb: snapshot.pb,
    ps: snapshot.ps ?? null,
    peDyn: snapshot.peDyn,
    mainInflowPct: snapshot.mainInflowPct,
    consensus: consensus || null,
    valuation: {
      ok: b.ok,
      reason: b.reason || null,
      compositePct: pct,
      pePct: b.metrics?.pe?.pct != null ? round(b.metrics.pe.pct, 1) : null,
      pbPct: b.metrics?.pb?.pct != null ? round(b.metrics.pb.pct, 1) : null,
      psPct: b.metrics?.ps?.pct != null ? round(b.metrics.ps.pct, 1) : null,
      peMedian: b.metrics?.pe?.median != null ? round(b.metrics.pe.median) : null,
    },
    bands: b.ok
      ? {
          /** 低于 addPrice 即进入加仓区 */
          addPrice: b.addPrice,
          /** 高于 trimPrice 即进入减仓区 */
          trimPrice: b.trimPrice,
          addLow: b.addLow,
          addHigh: b.addHigh,
          trimLow: b.trimLow,
          trimHigh: b.trimHigh,
          /** 现价距加仓价还有多少空间（负数表示已经在加仓区内） */
          toAddPricePct: toBand(b.addPrice),
          /** 现价距减仓价还有多少空间 */
          toTrimPricePct: toBand(b.trimPrice),
        }
      : null,
    status,
    priceContext: pc,
    invalidations,
  };
}

/** 机构一致预期：近半年研报的今年/明年 EPS 均值 */
export function buildConsensus(reports, price) {
  const recent = reports.filter(
    (r) => Date.now() - new Date(r.date + "T00:00:00+08:00").getTime() < 183 * 86400000
  );
  const thisYear = recent.map((r) => r.epsThisYear).filter(Number.isFinite);
  const nextYear = recent.map((r) => r.epsNextYear).filter(Number.isFinite);
  const eps1 = mean(thisYear);
  const eps2 = mean(nextYear);

  // 用半年前那批研报做对比，判断预测是在上调还是下调
  const older = reports.filter((r) => {
    const age = Date.now() - new Date(r.date + "T00:00:00+08:00").getTime();
    return age >= 92 * 86400000 && age < 275 * 86400000;
  });
  const olderEps2 = mean(older.map((r) => r.epsNextYear).filter(Number.isFinite));
  let revTrend = null;
  if (eps2 != null && olderEps2 != null && olderEps2 > 0) {
    const delta = (eps2 - olderEps2) / olderEps2;
    revTrend = delta > 0.03 ? "up" : delta < -0.03 ? "down" : "flat";
  }

  return {
    count: recent.length,
    epsThisYear: eps1 != null ? round(eps1, 2) : null,
    epsNextYear: eps2 != null ? round(eps2, 2) : null,
    peOnThisYear: eps1 > 0 ? round(price / eps1, 1) : null,
    peOnNextYear: eps2 > 0 ? round(price / eps2, 1) : null,
    revTrend,
  };
}

/** 板块温度：指数位置、量能、涨跌宽度 */
export function analyzeSector(snapshot, indexSeries, stocks, { synthesized = false } = {}) {
  const closes = indexSeries.map((k) => k.close);
  const vols = indexSeries.map((k) => k.volume).filter(Number.isFinite);
  const recent5 = closes.slice(-5);
  const chg5 =
    recent5.length > 1
      ? round(((recent5.at(-1) - recent5[0]) / recent5[0]) * 100, 1)
      : null;
  const recent20 = closes.slice(-20);
  const chg20 =
    recent20.length > 1
      ? round(((recent20.at(-1) - recent20[0]) / recent20[0]) * 100, 1)
      : null;
  const ma20 = closes.length >= 20 ? round(sma(closes, 20)) : null;
  const ma60 = closes.length >= 60 ? round(sma(closes, 60)) : null;
  const ma250 = closes.length >= 250 ? round(sma(closes, 250)) : null;
  const last = closes.at(-1) ?? snapshot.price;
  // 距离均线的百分比是尺度无关的，合成指数和真实指数都能用
  const distPct = (ma) => (ma ? round(((last - ma) / ma) * 100, 1) : null);

  const up = stocks.filter((s) => s.chgPct > 0).length;
  const down = stocks.filter((s) => s.chgPct < 0).length;
  const sorted = [...stocks].sort((a, b) => b.chgPct - a.chgPct);
  const withVal = stocks.filter((s) => s.valuation?.ok);
  const cheap = [...withVal].sort(
    (a, b) => a.valuation.compositePct - b.valuation.compositePct
  );

  // 趋势宽度：多少比例的成分股站在中期/长期均线之上
  const withMa = stocks.filter((s) => s.priceContext?.ma60 != null);
  const aboveMa60 = withMa.filter((s) => s.price > s.priceContext.ma60).length;
  const withMa250 = stocks.filter((s) => s.priceContext?.ma250 != null);
  const aboveMa250 = withMa250.filter((s) => s.price > s.priceContext.ma250).length;

  return {
    index: snapshot,
    series: indexSeries,
    synthesized,
    ma20,
    ma60,
    ma250,
    chg5,
    chg20,
    aboveMa250: ma250 != null ? last > ma250 : null,
    distToMa20Pct: distPct(ma20),
    distToMa60Pct: distPct(ma60),
    distToMa250Pct: distPct(ma250),
    volumeRatio:
      vols.length >= 21 ? round(vols.at(-1) / mean(vols.slice(-21, -1)), 2) : null,
    breadth: { up, down, flat: stocks.length - up - down, total: stocks.length },
    trendBreadth: {
      aboveMa60,
      ma60Total: withMa.length,
      aboveMa250,
      ma250Total: withMa250.length,
    },
    leaders: sorted.slice(0, 3).map((s) => ({ code: s.code, name: s.name, chgPct: s.chgPct })),
    laggards: sorted.slice(-3).map((s) => ({ code: s.code, name: s.name, chgPct: s.chgPct })),
    cheapest: cheap.slice(0, 5).map((s) => ({
      code: s.code,
      name: s.name,
      pct: s.valuation.compositePct,
    })),
  };
}
