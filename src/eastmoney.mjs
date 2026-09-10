import { quoteJson, histJson, dataJson } from "./http.mjs";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 东方财富 secid：沪市=1，深市/北交所=0 */
export function secid(code) {
  return `${/^6/.test(code) ? 1 : 0}.${code}`;
}

/** 东财行业板块代码，例如 BK1046 = 游戏Ⅱ */
export function boardSecid(boardCode) {
  return `90.${boardCode}`;
}

/** 板块成分股实时快照 */
export async function fetchBoardStocks(boardCode) {
  const fields =
    "f12,f14,f2,f3,f4,f5,f6,f8,f9,f20,f21,f23,f115,f62,f184";
  const j = await quoteJson(
    `/api/qt/clist/get?ut=bd1d9ddb04089700cf9c27f6f7426281&pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b%3A${boardCode}&fields=${fields}`
  );
  const diff = j?.data?.diff;
  if (!Array.isArray(diff)) throw new Error("板块成分股返回为空");
  return diff.map((d) => ({
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
    mainInflow: num(d.f62),
    mainInflowPct: num(d.f184),
  }));
}

/** 板块指数快照 */
export async function fetchBoardSnapshot(boardCode) {
  const j = await quoteJson(
    `/api/qt/stock/get?secid=${boardSecid(boardCode)}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f169,f170`
  );
  const d = j?.data;
  if (!d) throw new Error("板块快照为空");
  // stock/get 返回的是放大 100 倍的原始值，需要还原
  return {
    code: d.f57,
    name: d.f58,
    price: scale100(d.f43),
    high: scale100(d.f44),
    low: scale100(d.f45),
    open: scale100(d.f46),
    volume: num(d.f47),
    amount: num(d.f48),
    preClose: scale100(d.f60),
    chg: scale100(d.f169),
    chgPct: scale100(d.f170),
  };
}

/** 板块指数日线 */
export async function fetchBoardKline(boardCode, beginDate) {
  const j = await histJson(
    `/api/qt/stock/kline/get?secid=${boardSecid(boardCode)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=${beginDate}&end=20500101`
  );
  const klines = j?.data?.klines;
  if (!Array.isArray(klines)) throw new Error("板块K线为空");
  return klines.map((s) => {
    const [date, open, close, high, low, volume] = s.split(",");
    return { date, open: +open, close: +close, high: +high, low: +low, volume: +volume };
  });
}

/** 腾讯行情代码：sh600633 / sz002555 / bj430047 */
export function tencentSymbol(code) {
  if (/^6/.test(code)) return `sh${code}`;
  if (/^[48]/.test(code)) return `bj${code}`;
  return `sz${code}`;
}

/**
 * 个股日线（前复权）。
 * 东财 push2his 在部分网络会断连，依次回退到腾讯、新浪。
 */
export async function fetchStockKline(code, beginDate, bars = 1000) {
  try {
    const j = await histJson(
      `/api/qt/stock/kline/get?secid=${secid(code)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1&beg=${beginDate}&end=20500101`
    );
    const klines = j?.data?.klines;
    if (Array.isArray(klines) && klines.length > 0) {
      return klines.map((s) => {
        const [date, open, close, high, low, volume] = s.split(",");
        return { date, open: +open, close: +close, high: +high, low: +low, volume: +volume };
      });
    }
  } catch {
    /* 走下面的备用源 */
  }
  return fetchTencentKline(code, bars).catch(() => fetchSinaKline(code, bars).catch(() => []));
}

/** 腾讯前复权日线 */
export async function fetchTencentKline(code, bars = 1000) {
  const sym = tencentSymbol(code);
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${bars},qfq`;
  const res = await fetch(url, {
    headers: { "User-Agent": DEFAULT_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const d = j?.data?.[sym];
  const rows = d?.qfqday || d?.day;
  if (!Array.isArray(rows) || !rows.length) throw new Error("腾讯日线为空");
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

/** 新浪日线（最后兜底，不复权） */
export async function fetchSinaKline(code, bars = 1000) {
  const sym = tencentSymbol(code);
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${sym}&scale=240&ma=no&datalen=${bars}`;
  const res = await fetch(url, {
    headers: { "User-Agent": DEFAULT_UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j) || !j.length) throw new Error("新浪日线为空");
  return j.map((r) => ({
    date: r.day,
    open: +r.open,
    close: +r.close,
    high: +r.high,
    low: +r.low,
    volume: +r.volume,
  }));
}

/**
 * 估值历史：PE(TTM)、PE(静态)、PB、PS、PEG。
 * 这是算「估值分位」和反推「加减仓价格区间」的数据基础。
 */
export async function fetchValuationHistory(code, beginDate) {
  const filter = `(SECURITY_CODE="${code}")(TRADE_DATE>='${beginDate}')`;
  const path =
    `/api/data/v1/get?reportName=RPT_VALUEANALYSIS_DET&columns=ALL` +
    `&filter=${encodeURIComponent(filter)}` +
    `&pageNumber=1&pageSize=1600&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB`;
  const j = await dataJson(path, 25000);
  const rows = j?.result?.data;
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r) => ({
    date: String(r.TRADE_DATE).slice(0, 10),
    close: num(r.CLOSE_PRICE),
    peTtm: num(r.PE_TTM),
    peLar: num(r.PE_LAR),
    pb: num(r.PB_MRQ),
    ps: num(r.PS_TTM),
    peg: num(r.PEG_CAR),
    totalCap: num(r.TOTAL_MARKET_CAP),
  }));
}

/** 个股公告 */
export async function fetchAnnouncements(code, days = 10) {
  const path =
    `/api/security/ann?sr=-1&page_size=60&page_index=1&ann_type=A&client_source=web&stock_list=${code}`;
  const res = await fetch(
    "https://np-anotice-stock.eastmoney.com" + path,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Referer: "https://data.eastmoney.com/notices/",
      },
      signal: AbortSignal.timeout(20000),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const list = j?.data?.list;
  if (!Array.isArray(list)) return [];
  const cutoff = Date.now() - days * 86400000;
  return list
    .map((a) => ({
      date: String(a.notice_date).slice(0, 10),
      title: a.title,
      url: `https://data.eastmoney.com/notices/detail/${code}/${a.art_code}.html`,
    }))
    .filter((a) => new Date(a.date + "T00:00:00+08:00").getTime() >= cutoff);
}

/** 个股研报（含机构盈利预测，用来算一致预期） */
export async function fetchStockReports(code, beginDate) {
  const path =
    `/report/list?industryCode=*&pageSize=60&industry=*&rating=&ratingChange=` +
    `&beginTime=${beginDate}&endTime=2099-12-31&pageNo=1&fields=&qType=0&orgCode=&code=${code}` +
    `&rcode=&p=1&pageNum=1&pageNumber=1`;
  const res = await fetch("https://reportapi.eastmoney.com" + path, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Referer: "https://data.eastmoney.com/report/",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const rows = j?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    date: String(r.publishDate).slice(0, 10),
    title: r.title,
    org: r.orgSName || r.orgName,
    rating: r.emRatingName || "",
    epsThisYear: num(r.predictThisYearEps),
    epsNextYear: num(r.predictNextYearEps),
    peThisYear: num(r.predictThisYearPe),
    peNextYear: num(r.predictNextYearPe),
    url: `https://data.eastmoney.com/report/info/${r.infoCode}.html`,
  }));
}

/** 行业研报（游戏行业整体） */
export async function fetchIndustryReports(industryCode, beginDate) {
  const path =
    `/report/list?industryCode=${industryCode}&pageSize=40&industry=*&rating=&ratingChange=` +
    `&beginTime=${beginDate}&endTime=2099-12-31&pageNo=1&fields=&qType=1&orgCode=&code=` +
    `&rcode=&p=1&pageNum=1&pageNumber=1`;
  const res = await fetch("https://reportapi.eastmoney.com" + path, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Referer: "https://data.eastmoney.com/report/",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const rows = j?.data;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    date: String(r.publishDate).slice(0, 10),
    title: r.title,
    org: r.orgSName || r.orgName,
    url: `https://data.eastmoney.com/report/info/${r.infoCode}.html`,
  }));
}

/** 个股在板块内的行业归属（用于校验） */
export function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** stock/get 系列接口的数值需要除以 100 */
function scale100(v) {
  const n = num(v);
  return n == null ? null : n / 100;
}
