import mongoose from 'mongoose';

// Once per test run: start from an empty, isolated *_test database.
export default async function globalSetup() {
  const uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
  const dbName = process.env.MONGODB_DB_NAME_TEST ?? 'logistics_eta_test';
  if (!/_test$/.test(dbName)) throw new Error(`Refusing to reset non-test database ${dbName}`);
  const conn = await mongoose
    .createConnection(uri, { dbName, serverSelectionTimeoutMS: 5000 })
    .asPromise();
  await conn.dropDatabase();
  await conn.close();
}
