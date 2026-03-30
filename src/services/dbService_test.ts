import * as SQLite from 'expo-sqlite';
export const getDb = async () => { return null; };
export const initDB = async () => { 
  const createTables = [
    `CREATE TABLE partners (id INTEGER)`,
    `CREATE TABLE products (id INTEGER)`
  ];
  return createTables;
};
