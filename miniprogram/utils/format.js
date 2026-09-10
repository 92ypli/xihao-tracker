function sign(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const s = Number(v).toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

function tone(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "flat";
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "flat";
}

function price(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number(v).toFixed(2);
}

/** 港股低价股需要 3 位小数 */
function priceOf(v, market) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (market === "HK") return Math.abs(v) < 10 ? Number(v).toFixed(3) : Number(v).toFixed(2);
  return Number(v).toFixed(2);
}

function cap(v) {
  if (!v) return "-";
  return `${(v / 1e8).toFixed(1)}亿`;
}

function pct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${Number(v).toFixed(digits)}%`;
}

/** 把云函数返回的个股数据补上展示字段 */
function decorateStock(s) {
  if (s.error) {
    return Object.assign({}, s, { failed: true });
  }
  const b = s.bands;
  const mk = s.market || "A";
  const pe = s.peTtm !== null && s.peTtm !== undefined ? s.peTtm : s.peDyn;
  return Object.assign({}, s, {
    market: mk,
    chgClass: tone(s.chgPct),
    chgText: sign(s.chgPct),
    priceText: priceOf(s.price, mk),
    peText: pe === null || pe === undefined ? "-" : Number(pe).toFixed(1),
    pbText: s.pb === null || s.pb === undefined ? "-" : Number(s.pb).toFixed(2),
    capText: cap(s.totalCap),
    pctText: s.valuation && s.valuation.ok ? pct(s.valuation.compositePct) : "-",
    pePctText: pct(s.valuation && s.valuation.pePct),
    pbPctText: pct(s.valuation && s.valuation.pbPct),
    psPctText: pct(s.valuation && s.valuation.psPct),
    addText: b ? priceOf(b.addPrice, mk) : "-",
    trimText: b ? priceOf(b.trimPrice, mk) : "-",
    toAddText: b && b.toAddPricePct !== null ? sign(b.toAddPricePct) : "-",
    toTrimText: b && b.toTrimPricePct !== null ? sign(b.toTrimPricePct) : "-",
    addZoneText: b ? `${priceOf(b.addLow, mk)} ~ ${priceOf(b.addHigh, mk)}` : "-",
    trimZoneText: b ? `${priceOf(b.trimLow, mk)} ~ ${priceOf(b.trimHigh, mk)}` : "-",
    methodLabel: s.valuation && s.valuation.method === "price" ? "价格分位" : "估值分位",
    statusLabel: (s.status && s.status.label) || "-",
    statusTone: (s.status && s.status.tone) || "na",
    hasBands: !!b,
  });
}

module.exports = { sign, tone, price, priceOf, cap, pct, decorateStock };
