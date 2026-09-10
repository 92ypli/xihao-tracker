/**
 * 催化剂日历。
 *
 * 这里只放「规则确定的日期」——A 股定期报告披露截止日和版号公示的经验规律。
 * 具体的新游定档、上线时间需要人工维护，建议后续在云数据库里加一张 events 表。
 */

const REPORT_WINDOWS = [
  { label: "年报披露截止", month: 4, day: 30 },
  { label: "一季报披露截止", month: 4, day: 30 },
  { label: "半年报披露截止", month: 8, day: 31 },
  { label: "三季报披露截止", month: 10, day: 31 },
];

/** 版号通常在每月中下旬公示，取 22 日作为经验锚点 */
const LICENSE_DAY = 22;

function daysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

function fmt(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function buildCatalysts(today = new Date(), horizonDays = 60) {
  const items = [];

  for (const w of REPORT_WINDOWS) {
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const d = new Date(year, w.month - 1, w.day);
      const away = daysBetween(today, d);
      if (away >= 0 && away <= horizonDays) {
        items.push({
          date: fmt(d),
          daysAway: away,
          title: w.label,
          kind: "report",
          note: "业绩窗口前后波动通常放大",
        });
      }
    }
  }

  // 未来两个月的版号公示锚点
  for (let i = 0; i < 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, LICENSE_DAY);
    const away = daysBetween(today, d);
    if (away >= 0 && away <= horizonDays) {
      items.push({
        date: fmt(d),
        daysAway: away,
        title: "游戏版号公示（经验规律）",
        kind: "license",
        note: "实际日期以国家新闻出版署公告为准，通常在中下旬",
      });
    }
  }

  return items.sort((a, b) => a.daysAway - b.daysAway);
}
