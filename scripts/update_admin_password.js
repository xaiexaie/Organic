require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const NEW_PWD = process.env.NEW_ADMIN_PWD || 'A$dM1n#7vYz!q9R';

async function updatePassword() {
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  try {
    console.log('Connecting to', MONGODB_URI);
    await client.connect();
    const adminDb = client.db('admin');
    console.log("Updating password for user 'siteAdmin' in 'admin' DB...");
    await adminDb.command({ updateUser: 'siteAdmin', pwd: NEW_PWD });
    console.log('Password updated successfully.');
    console.log('New admin credentials:');
    console.log('- username: siteAdmin');
    console.log('- password:', NEW_PWD);
  } catch (err) {
    console.error('Failed to update admin password:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

updatePassword();
