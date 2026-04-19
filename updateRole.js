require('dotenv').config();
const requireClient = require('@libsql/client');

async function run() {
    const targetEmail = 'tientrung6112@gmail.com';
    const dbClient = requireClient.createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
    });
    
    await dbClient.execute(`UPDATE users SET role='admin' WHERE email='${targetEmail}'`);
    console.log(`✅ Đã cập nhật ${targetEmail} thành admin (thường)!`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
