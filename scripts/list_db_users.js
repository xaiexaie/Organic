require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';

async function listUsers() {
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  try {
    console.log('Connecting to', MONGODB_URI);
    await client.connect();

    const adminDb = client.db('admin');
    // usersInfo with forAllDBs can be used, but list from admin is fine
    const result = await adminDb.command({ usersInfo: { forAllDBs: true } });
    const users = result.users || [];
    if (users.length === 0) {
      console.log('No users found.');
    } else {
      console.log('Users:');
      users.forEach(u => {
        console.log('- username:', u.user, '| db:', u.db, '| roles:', JSON.stringify(u.roles));
      });
    }
  } finally {
    await client.close();
  }
}

listUsers().catch(err => {
  console.error('Failed to list users:', err);
  process.exit(1);
});
