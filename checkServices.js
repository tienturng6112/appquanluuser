require('dotenv').config();
const requireClient = require('@libsql/client');

async function run() {
    const dbClient = requireClient.createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });
    
    try {
        const res = await dbClient.execute(`SELECT id, name, ownerId FROM services`);
        console.log("SERVICES:", res.rows);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
