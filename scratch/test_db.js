const db = require('../server/database');

async function test() {
    try {
        await db.initDatabase();
        console.log('Database mode:', db.mode);
        console.log('Is deleteReadNotifications a function?', typeof db.deleteReadNotifications);
        
        const ownerId = 'test-owner';
        const res = await db.deleteReadNotifications(ownerId);
        console.log('Result of deleteReadNotifications:', res);
        
        process.exit(0);
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    }
}

test();
