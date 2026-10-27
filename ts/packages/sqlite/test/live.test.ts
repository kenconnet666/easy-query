import { liveSuite } from '../../core/test/suite.ts'
import { memoryDb } from './env.ts'

liveSuite('sqlite', memoryDb)
