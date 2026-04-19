require('dotenv').config();
const db = require('./server/database.js');

async function run() {
    await db.initDatabase();
    
    // Test with tientrung's ID
    const tientrungId = 'e03295ae-637e-4656-afb4-a29fe314425d';
    const services = await db.getAllServices(tientrungId);
    console.log("TIENTRUNG'S SERVICES:", services);
    
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
