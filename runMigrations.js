require('dotenv').config();
const db = require('./server/database.js');

async function run() {
    console.log("Running migrations...");
    await db.initDatabase();
    console.log("Migrations applied on Turso!");
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
