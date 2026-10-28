/**
 * 实体与列的定义。列的 TS 类型、是否可空、是否由库生成都记在类型参数里，查询与插入的类型由它推导，不需要代码生成。
 *
 * ```ts
 * export const User = entity('t_user', {
 *   id: col.bigint().primaryKey().generated(),
 *   name: col.string(),
 *   age: col.int().nullable(),
 * })
 * type UserRow = Row<typeof User>   // { id: number; name: string; age: number | null }
 * ```
 */

/** 值在库与 JS 之间怎么转换：drivers 读出的原始值 → JS 值，JS 值 → 绑定参数 */
export interface Codec<T> {
  readonly kind: ColumnKind
  decode(raw: unknown): T
  encode(value: T): unknown
}

export type ColumnKind = 'string' | 'int' | 'bigint' | 'decimal' | 'double' | 'boolean' | 'date' | 'time' | 'datetime' | 'json'

export interface ColumnOptions {
  readonly nullable: boolean
  readonly primaryKey: boolean
  readonly generated: boolean
  readonly hasDefault: boolean
  readonly name?: string
}

/** 一列：T 是 JS 类型，N 是否可空，O 插入时是否可省（自增、有默认值、可空） */
export class Column<T, N extends boolean = false, O extends boolean = false> {
  declare readonly __type: T
  declare readonly __nullable: N
  declare readonly __optional: O
  readonly codec: Codec<T>
  readonly options: ColumnOptions

  constructor(codec: Codec<T>, options: ColumnOptions) {
    this.codec = codec
    this.options = options
  }

  /** 可为 NULL：读出的类型带上 null，插入时可省 */
  nullable(): Column<T, true, true> {
    return new Column(this.codec, { ...this.options, nullable: true })
  }

  primaryKey(): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, primaryKey: true })
  }

  /** 由库生成（自增、IDENTITY）：插入时可省 */
  generated(): Column<T, N, true> {
    return new Column(this.codec, { ...this.options, generated: true })
  }

  /** 库里有默认值：插入时可省 */
  defaulted(): Column<T, N, true> {
    return new Column(this.codec, { ...this.options, hasDefault: true })
  }

  /** 库里的列名（默认是属性名转下划线） */
  named(name: string): Column<T, N, O> {
    return new Column(this.codec, { ...this.options, name })
  }
}

/**
 * 十进制数文字：decimal 列在 JS 里的类型。用模板字面量类型而不是 string，
 * 一是让 `'10.50'` 这样的字面量可以直接写入，二是让算术方法能区分"数值文字"和普通字符串。
 */
export type DecimalText = `${number}`

const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER)

function codec<T>(kind: ColumnKind, decode: (raw: unknown) => T, encode: (value: T) => unknown = (v) => v): Codec<T> {
  return { kind, decode, encode }
}

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'bigint') {
    if (raw > SAFE_MAX || raw < -SAFE_MAX) throw new RangeError(`bigint ${raw} does not fit a JS number; use col.bigint({ mode: 'bigint' })`)
    return Number(raw)
  }
  const n = Number(raw)
  if (!Number.isSafeInteger(n) && Number.isInteger(n)) throw new RangeError(`integer ${String(raw)} does not fit a JS number exactly`)
  return n
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** Date → 'YYYY-MM-DD HH:MM:SS.mmm'（UTC），各库都认 */
export function utcText(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
}

/**
 * 驱动读出的日期时间 → Date（无时区的文字按 UTC 读）。
 * 导出给 @eqts/date 等扩展列类型复用，保证各种日期类型"驱动值怎么读"的口径一致。
 */
export function toDate(raw: unknown): Date {
  if (raw instanceof Date) return raw
  const text = String(raw)
  // 'YYYY-MM-DD HH:MM:SS[.fff]' 按 UTC 读；带偏移的（PG timestamptz 的 '+00'、'+08:00'）按偏移读
  const iso = text.replace(' ', 'T')
  if (/[zZ]$/.test(iso)) return new Date(iso)
  const offset = /([+-]\d\d)(?::?(\d\d))?$/.exec(iso)
  if (offset && offset.index > 10) return new Date(`${iso.slice(0, offset.index)}${offset[1]}:${offset[2] ?? '00'}`)
  return new Date(iso + 'Z')
}

/** 驱动读出的日期 → 'YYYY-MM-DD'（按 UTC 取年月日，不经过本地时区） */
export function toDateText(raw: unknown): string {
  if (raw instanceof Date) return `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`
  return String(raw).slice(0, 10)
}

function base<T>(c: Codec<T>): Column<T, false, false> {
  return new Column(c, { nullable: false, primaryKey: false, generated: false, hasDefault: false })
}

/** 列的类型 */
export const col = {
  string: () => base(codec<string>('string', (r) => String(r))),
  int: () => base(codec<number>('int', toNumber)),
  /** 64 位整数；mode 'number'（默认，超出安全整数时报错）、'bigint'、'string' */
  bigint: <M extends 'number' | 'bigint' | 'string' = 'number'>(opts?: { mode?: M }) => {
    const mode = opts?.mode ?? 'number'
    type V = M extends 'bigint' ? bigint : M extends 'string' ? string : number
    const decode = (r: unknown): V => (mode === 'bigint' ? BigInt(r as string) : mode === 'string' ? String(r) : toNumber(r)) as V
    return base(codec<V>('bigint', decode))
  },
  /** 精确小数：JS 里是数值文字（DecimalText），不经过浮点；要对象形式可用 @eqts/decimal 的 decimalJs() */
  decimal: (_precision?: number, _scale?: number) => base(codec<DecimalText>('decimal', (r) => String(r) as DecimalText)),
  double: () => base(codec<number>('double', (r) => Number(r))),
  /** 绑定时交给方言转换（SQLite / MySQL 写 1 / 0，PG 原样传布尔） */
  boolean: () => base(codec<boolean>('boolean', (r) => r === true || r === 1 || r === '1' || r === 1n || r === 't')),
  /** 日历日期 'YYYY-MM-DD'，不经过时区 */
  date: () => base(codec<string>('date', toDateText)),
  /** 一天里的时刻 'HH:MM:SS' */
  time: () => base(codec<string>('time', (r) => String(r).slice(0, 8))),
  /** 时刻：JS 的 Date，库里按 UTC 存 */
  datetime: () => base(codec<Date>('datetime', toDate, (v) => utcText(v))),
  json: <T>() => base(codec<T>('json', (r) => (typeof r === 'string' ? JSON.parse(r) : r) as T, (v) => JSON.stringify(v))),
  /** 自定义的读写 */
  custom: <T>(kind: ColumnKind, decode: (raw: unknown) => T, encode: (value: T) => unknown) => base(codec<T>(kind, decode, encode)),
}

export type AnyColumn = Column<any, boolean, boolean>
export type Columns = Record<string, AnyColumn>

/** 一个实体：名字、表名、列 */
export interface Entity<Name extends string = string, C extends Columns = Columns> {
  readonly kind: 'entity'
  readonly name: Name
  readonly table: string
  readonly columns: C
  /** 属性名 → 库里的列名 */
  readonly columnNames: { readonly [K in keyof C]: string }
  readonly primaryKey: readonly (keyof C & string)[]
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

/** 定义实体；name 默认用表名 */
export function entity<const Table extends string, C extends Columns>(table: Table, columns: C): Entity<Table, C>
export function entity<const Name extends string, C extends Columns>(table: string, columns: C, options: { name: Name }): Entity<Name, C>
export function entity(table: string, columns: Columns, options?: { name: string }): Entity {
  const columnNames: Record<string, string> = {}
  const primaryKey: string[] = []
  for (const [key, c] of Object.entries(columns)) {
    columnNames[key] = c.options.name ?? snake(key)
    if (c.options.primaryKey) primaryKey.push(key)
  }
  return { kind: 'entity', name: options?.name ?? table, table, columns, columnNames, primaryKey }
}

export type ValueOf<C> = C extends Column<infer T, infer N, any> ? (N extends true ? T | null : T) : never

/** 读出的整行 */
export type Row<E extends Entity> = { [K in keyof E['columns']]: ValueOf<E['columns'][K]> }

type OptionalKeys<C extends Columns> = { [K in keyof C]: C[K] extends Column<any, any, true> ? K : never }[keyof C]
type RequiredKeys<C extends Columns> = Exclude<keyof C, OptionalKeys<C>>

/** 插入时的形状：自增、有默认值、可空的列可省 */
export type Insert<E extends Entity> = { [K in RequiredKeys<E['columns']>]: ValueOf<E['columns'][K]> } & {
  [K in OptionalKeys<E['columns']>]?: ValueOf<E['columns'][K]>
}

/** 更新时的形状：都可选 */
export type Update<E extends Entity> = { [K in keyof E['columns']]?: ValueOf<E['columns'][K]> }
