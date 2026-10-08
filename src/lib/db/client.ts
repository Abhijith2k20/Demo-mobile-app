import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

// enableChangeListener powers drizzle's useLiveQuery: screens re-render when tables change.
export const sqlite = openDatabaseSync('siteline.db', { enableChangeListener: true });
export const db = drizzle(sqlite, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;
