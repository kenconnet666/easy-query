import { liveSuite } from '../src/suite.ts'
import { memoryDb } from '../src/sqlite-env.ts'

liveSuite('sqlite', memoryDb)
