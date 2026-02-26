/*
Create MongoDB users script
Usage:
  - Edit .env in backend or set env vars before running
  - Recommended defaults are embedded below but change them!

Run:
  cd backend
  node scripts/create_db_users.js

This will create:
  - admin user in `admin` DB with role `root`
  - app user in `fruit-market` DB with role `readWrite`
*/

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';

// Default credentials (change before running if you want secure passwords)
const ADMIN_USER = process.env.MONGO_ADMIN_USER || 'siteAdmin';
const ADMIN_PWD = process.env.MONGO_ADMIN_PWD || 'ChangeThisToAStrongPassword!';

const APP_DB = process.env.APP_DB || 'fruit-market';
const APP_USER = process.env.MONGO_APP_USER || 'fm_app';
const APP_PWD = process.env.MONGO_APP_PWD || 'fm_app_password';

async function createUsers() {
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  try {
    console.log('Connecting to', MONGODB_URI);
    await client.connect();

    // Optionally create admin user in admin DB with root role
    if (process.env.CREATE_ADMIN === 'true') {
      const adminDb = client.db('admin');
      try {
        console.log(`Creating admin user '${ADMIN_USER}' in 'admin' db...`);
        await adminDb.command({
          createUser: ADMIN_USER,
          pwd: ADMIN_PWD,
          roles: [{ role: 'root', db: 'admin' }]
        });
        console.log('Admin user created.');
      } catch (err) {
        if (err.codeName === 'DuplicateKey' || /already exists/.test(err.message)) {
          console.log('Admin user already exists — skipping creation.');
        } else {
          console.warn('Admin user creation returned error:', err.message);
        }
      }
    } else {
      console.log('Skipping admin user creation (set CREATE_ADMIN=true to enable).');
    }

    // Create application user in APP_DB with readWrite role
    const appDb = client.db(APP_DB);
    try {
      console.log(`Creating app user '${APP_USER}' in '${APP_DB}' db...`);
      await appDb.command({
        createUser: APP_USER,
        pwd: APP_PWD,
        roles: [{ role: 'readWrite', db: APP_DB }]
      });
      console.log('App user created.');
    } catch (err) {
      if (err.codeName === 'DuplicateKey' || /already exists/.test(err.message)) {
        console.log('App user already exists — skipping creation.');
      } else {
        console.warn('App user creation returned error:', err.message);
      }
    }

    console.log('\nDone. Next steps:');
    console.log('- If you plan to enable MongoDB authorization, edit mongod config and restart the service.');
    console.log('- Update backend/.env to use the new app credentials:');
    console.log(`  MONGODB_URI=mongodb://${APP_USER}:${APP_PWD}@localhost:27017/${APP_DB}?authSource=${APP_DB}`);

  } finally {
    await client.close();
  }
}

createUsers().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
