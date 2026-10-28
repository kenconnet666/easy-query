/**
 * @internationalized/date 的列类型：日期、无时区日期时间、带时区的时刻、一天里的时刻。
 * 核心不依赖这个库；这个包只提供列定义，并用声明合并让 `year() / month() / day()` 认得这些类型。
 *
 * ```ts
 * import { calendarDate, calendarDateTime, zonedDateTime, timeOfDay } from '@zerodep-dev/easy-query-ts-date'
 *
 * const Event = entity('t_event', {
 *   id: col.bigint().primaryKey().generated(),
 *   day: calendarDate(),                         // CalendarDate，库里是 DATE
 *   startsAt: calendarDateTime(),                // CalendarDateTime，库里是无时区的日期时间（墙上时间）
 *   createdAt: zonedDateTime('Asia/Shanghai'),   // ZonedDateTime，库里按 UTC 存时刻，读出时换算到指定时区
 *   opensAt: timeOfDay(),                        // Time，库里是 TIME
 * })
 * await db.queryable(Event).where(e => e.day.ge(parseDate('2026-01-01'))).toList()
 * ```
 */
import { CalendarDate, CalendarDateTime, fromDate, parseDate, Time, type ZonedDateTime } from '@internationalized/date'
import { col, toDate, toDateText, utcText } from '@zerodep-dev/easy-query-ts'

declare module '@zerodep-dev/easy-query-ts' {
  /** 让 year() / month() / day() 可以用在这些类型的列上 */
  interface TemporalExtensions {
    calendarDate: CalendarDate
    calendarDateTime: CalendarDateTime
    zonedDateTime: ZonedDateTime
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** 日期：库里的 DATE。读出不经过时区，写入是 'YYYY-MM-DD' */
export function calendarDate() {
  return col.custom<CalendarDate>('date', (raw) => parseDate(toDateText(raw)), (v) => v.toString())
}

/**
 * 无时区的日期时间（墙上时间）：库里的 DATETIME / TIMESTAMP 原样存取，不做任何时区换算。
 * 适合"每天 9 点开会"这类与时区无关的时间；要表示同一个时刻请用 zonedDateTime。
 */
export function calendarDateTime() {
  return col.custom<CalendarDateTime>(
    'datetime',
    (raw) => {
      // 驱动给的文字按"UTC 读出的各个分量"取，就是原样存进去的墙上时间
      const d = toDate(raw)
      return new CalendarDateTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
    },
    (v) => `${pad(v.year, 4)}-${pad(v.month)}-${pad(v.day)} ${pad(v.hour)}:${pad(v.minute)}:${pad(v.second)}.${pad(v.millisecond, 3)}`,
  )
}

/**
 * 带时区的时刻：库里按 UTC 存"时刻"，读出时换算到 timeZone（IANA 名，如 'Asia/Shanghai'）。
 * 同一个时刻在不同机器、不同会话时区下读出的结果一致。
 */
export function zonedDateTime(timeZone: string) {
  return col.custom<ZonedDateTime>('datetime', (raw) => fromDate(toDate(raw), timeZone), (v) => utcText(v.toDate()))
}

/** 一天里的时刻：库里的 TIME，读出 Time（时分秒毫秒） */
export function timeOfDay() {
  return col.custom<Time>(
    'time',
    (raw) => {
      // 'HH:MM:SS' 或 'HH:MM:SS.fff'
      const [hms = '', fraction = ''] = String(raw).split('.')
      const [h = 0, m = 0, s = 0] = hms.split(':').map(Number)
      return new Time(h, m, s, fraction === '' ? 0 : Math.round(Number(`0.${fraction}`) * 1000))
    },
    (v) => `${pad(v.hour)}:${pad(v.minute)}:${pad(v.second)}`,
  )
}
