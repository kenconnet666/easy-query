import { liveSuite } from '../src/suite.ts'
import { memoryDb } from '../src/sqlite-env.ts'

liveSuite('sqlite', memoryDb, { extensionTypes: true, extraTables: true, rollup: false, cube: false, rowLocks: false, returning: true })
