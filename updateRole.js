require('dotenv').config();
const db = require('./server/database.js');

async function run() {
    await db.initDatabase();
    
    // Check all users
    const users = await db.getAllUsers();
    console.log("USERS:", users);
    
    // Cập nhật tientrung6112@gmail.com thành superadmin
    const targetEmail = 'tientrung6112@gmail.com';
    const requireClient = require('@libsql/client');
    const dbClient = requireClient.createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });
    
    await dbClient.execute(`UPDATE users SET role='superadmin' WHERE email='${targetEmail}'`);
    console.log(`✅ Đã cập nhật ${targetEmail} thành superadmin!`);
    
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
