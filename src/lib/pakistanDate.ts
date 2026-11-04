// Today's date in Pakistan as "YYYY-MM-DD". Pakistan is UTC+5 with no
// daylight saving, so `toISOString()` (UTC) is a day behind from 00:00 to
// 04:59 PKT. Same rule as pakistanDate() in lib/booking/schedule.ts.

export function pakistanToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
