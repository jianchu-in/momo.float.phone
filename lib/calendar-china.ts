// 国务院办公厅年度放假调休通知，按公历日期保存，未公布年份不推算。
// 2025: https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm
// 2026: https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
// 2027: https://www.gov.cn/zhengce/content/202611/content_7085101.htm
const holidays: Record<number, { rest: Array<[string, string, string]>; work: string[] }> = {
  2025: {
    rest: [
      ["01-01", "01-01", "元旦"], ["01-28", "02-04", "春节"], ["04-04", "04-06", "清明节"],
      ["05-01", "05-05", "劳动节"], ["05-31", "06-02", "端午节"], ["10-01", "10-08", "国庆节、中秋节"],
    ],
    work: ["01-26", "02-08", "04-27", "09-28", "10-11"],
  },
  2026: {
    rest: [
      ["01-01", "01-03", "元旦"], ["02-15", "02-23", "春节"], ["04-04", "04-06", "清明节"],
      ["05-01", "05-05", "劳动节"], ["06-19", "06-21", "端午节"], ["09-25", "09-27", "中秋节"],
      ["10-01", "10-07", "国庆节"],
    ],
    work: ["01-04", "02-14", "02-28", "05-09", "09-20", "10-10"],
  },
  2027: {
    rest: [
      ["01-01", "01-03", "元旦"], ["02-05", "02-13", "春节"], ["04-03", "04-05", "清明节"],
      ["05-01", "05-05", "劳动节"], ["06-09", "06-09", "端午节"], ["09-15", "09-15", "中秋节"],
      ["10-01", "10-07", "国庆节"],
    ],
    work: ["01-31", "02-14", "05-08", "09-26", "10-09"],
  },
};

// 香港天文台公历与农历日期对照表（UTC+8），每月依次列出两个节气。
// https://www.hko.gov.hk/en/gts/time/conversion.htm
const terms = [
  "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨", "立夏", "小满", "芒种", "夏至",
  "小暑", "大暑", "立秋", "处暑", "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至",
];
const termDays: Record<number, number[]> = {
  2025: [5, 20, 3, 18, 5, 20, 4, 20, 5, 21, 5, 21, 7, 22, 7, 23, 7, 23, 8, 23, 7, 22, 7, 21],
  2026: [5, 20, 4, 18, 5, 20, 5, 20, 5, 21, 5, 21, 7, 23, 7, 23, 7, 23, 8, 23, 7, 22, 7, 22],
  2027: [5, 20, 4, 19, 6, 21, 5, 20, 6, 21, 6, 21, 7, 23, 8, 23, 8, 23, 8, 23, 7, 22, 7, 22],
};

export function getChinaCalendarMark(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const monthDay = iso.slice(5);
  const schedule = holidays[year];
  const holiday = schedule?.rest.find(([from, to]) => from <= monthDay && monthDay <= to)?.[2];
  const work = schedule?.work.includes(monthDay);
  const first = (month - 1) * 2;
  const days = termDays[year];
  const solarTerm = days?.[first] === day ? terms[first] : days?.[first + 1] === day ? terms[first + 1] : undefined;
  return {
    badge: holiday ? "休" : work ? "班" : undefined,
    label: solarTerm || (holiday === "国庆节、中秋节" ? (day === 6 ? "中秋节" : "国庆节") : holiday),
    description: [holiday && `${holiday}放假`, work && "调休补班", solarTerm].filter(Boolean).join(" · "),
  };
}
