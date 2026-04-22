// ======================================
// DATABASE MODULE — DUAL MODE
// ☁️ TURSO CLOUD: Khi deploy lên hosting (set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
// 💻 SQL.JS LOCAL: Khi chạy local dev (không cần config gì)
// ======================================
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SALT = 'aishop_salt_2026';
const DB_PATH = path.join(__dirname, 'data.db');
const DB_BACKUP_PATH = path.join(__dirname, 'data.db.backup');

// ======================================
// DETECT MODE: Turso Cloud hoặc Local
// ======================================
const USE_TURSO = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let tursoClient = null;   // @libsql/client (cloud)
let localDb = null;        // sql.js (local)
let isDirty = false;
let saveTimer = null;
let saveCount = 0;
const AUTO_SAVE_INTERVAL = 10000;

// ======================================
// KHỞI TẠO DATABASE
// ======================================
async function initDatabase() {
    if (USE_TURSO) {
        // ☁️ TURSO CLOUD MODE
        const { createClient } = require('@libsql/client');
        tursoClient = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        // Test kết nối
        try {
            await tursoClient.execute('SELECT 1');
            console.log('☁️ Kết nối Turso Cloud Database thành công!');
            console.log(`📡 URL: ${process.env.TURSO_DATABASE_URL}`);
        } catch (err) {
            console.error('❌ Không thể kết nối Turso:', err.message);
            throw err;
        }
    } else {
        // 💻 LOCAL MODE (sql.js)
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();

        if (fs.existsSync(DB_PATH)) {
            try {
                const fileBuffer = fs.readFileSync(DB_PATH);
                localDb = new SQL.Database(fileBuffer);
                console.log(`📁 Database loaded: ${DB_PATH} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);
            } catch (err) {
                console.error('⚠️ File database chính bị lỗi, thử khôi phục từ backup...');
                if (fs.existsSync(DB_BACKUP_PATH)) {
                    try {
                        const backupBuffer = fs.readFileSync(DB_BACKUP_PATH);
                        localDb = new SQL.Database(backupBuffer);
                        console.log('✅ Khôi phục thành công từ backup!');
                        saveToFile();
                    } catch (backupErr) {
                        console.error('❌ Backup cũng bị lỗi. Tạo database mới...');
                        localDb = new SQL.Database();
                    }
                } else {
                    console.error('❌ Không có backup. Tạo database mới...');
                    localDb = new SQL.Database();
                }
            }
        } else {
            localDb = new SQL.Database();
            console.log('📁 Tạo database mới (local)...');
        }
    }

    // Tạo bảng
    await createTables();

    // Local: lưu file & bắt đầu auto-save
    if (!USE_TURSO) {
        saveToFile();
        startAutoSave();
    }

    await initSettings();
    await migrateDatabase();
    await seedIfEmpty();

    return true;
}

// ======================================
// TẠO BẢNG
// ======================================
async function createTables() {
    const tableStatements = [
        `CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT DEFAULT '',
            service TEXT DEFAULT '',
            adminId TEXT DEFAULT '',
            email TEXT DEFAULT '',
            password TEXT DEFAULT '',
            startDate TEXT DEFAULT '',
            endDate TEXT DEFAULT '',
            isEmailSent INTEGER DEFAULT 0,
            isNotifGenerated INTEGER DEFAULT 0,
            ownerId TEXT DEFAULT '',
            price TEXT DEFAULT '0'
        )`,
        `CREATE TABLE IF NOT EXISTS admins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT DEFAULT ''
        )`,
        `CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'ph-cube',
            color TEXT DEFAULT '#6366f1',
            ownerId TEXT DEFAULT ''
        )`,
        `CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            custId TEXT DEFAULT '',
            title TEXT DEFAULT '',
            body TEXT DEFAULT '',
            time TEXT DEFAULT '',
            isRead INTEGER DEFAULT 0,
            ownerId TEXT DEFAULT ''
        )`,
        `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            fullName TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            passwordHash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            createdAt TEXT DEFAULT '',
            createdBy TEXT DEFAULT ''
        )`,
        `CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            createdAt TEXT DEFAULT ''
        )`,
        `CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS renewal_requests (
            id TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            fullName TEXT,
            email TEXT,
            amount TEXT,
            proofImage TEXT,
            status TEXT DEFAULT 'pending',
            createdAt TEXT DEFAULT '',
            transactionRef TEXT DEFAULT ''
        )`
    ];

    if (USE_TURSO) {
        // Turso: batch execute cho hiệu năng
        await tursoClient.batch(tableStatements.map(sql => ({ sql, args: [] })));
    } else {
        // Local: chạy từng câu
        for (const sql of tableStatements) {
            localDb.run(sql);
        }
    }
}

// ======================================
// MIGRATION — Thêm cột mới cho database cũ
// ======================================
async function migrateDatabase() {
    const migrations = [
        "ALTER TABLE customers ADD COLUMN ownerId TEXT DEFAULT ''",
        "ALTER TABLE users ADD COLUMN createdBy TEXT DEFAULT ''",
        "ALTER TABLE services ADD COLUMN ownerId TEXT DEFAULT ''",
        "ALTER TABLE notifications ADD COLUMN ownerId TEXT DEFAULT ''",
        "ALTER TABLE customers ADD COLUMN price TEXT DEFAULT '0'",
        "ALTER TABLE users ADD COLUMN accountExpiry TEXT DEFAULT ''",
        "ALTER TABLE renewal_requests ADD COLUMN transactionRef TEXT DEFAULT ''"
    ];
    for (const sql of migrations) {
        try { await execute(sql); console.log('✅ Migration:', sql); }
        catch (e) { /* Column already exists, skip */ }
    }

    // Gán khách hàng cũ (chưa có ownerId) cho superadmin
    const superAdmin = await queryOne("SELECT id FROM users WHERE role = 'superadmin'");
    if (superAdmin) {
        await execute(
            "UPDATE customers SET ownerId = ? WHERE ownerId = '' OR ownerId IS NULL",
            [superAdmin.id]
        );
    }

    // Gán accountExpiry cho admin/staff chưa có (30 ngày từ hiện tại)
    const adminsNoExpiry = await queryAll(
        "SELECT id FROM users WHERE role IN ('admin', 'staff') AND (accountExpiry = '' OR accountExpiry IS NULL)"
    );
    if (adminsNoExpiry.length > 0) {
        const freshExpiry = new Date();
        freshExpiry.setDate(freshExpiry.getDate() + 30);
        const expiryStr = freshExpiry.toISOString();
        for (const u of adminsNoExpiry) {
            await execute('UPDATE users SET accountExpiry = ? WHERE id = ?', [expiryStr, u.id]);
        }
        console.log(`✅ Đã gán hạn sử dụng 30 ngày cho ${adminsNoExpiry.length} tài khoản.`);
    }
}

// ======================================
// LOCAL PERSISTENCE — Lưu trữ bền bỉ (chỉ cho local mode)
// ======================================
function saveToFile() {
    if (!localDb) return;
    try {
        const data = localDb.export();
        const buffer = Buffer.from(data);
        if (fs.existsSync(DB_PATH)) {
            try { fs.copyFileSync(DB_PATH, DB_BACKUP_PATH); } catch (e) {}
        }
        fs.writeFileSync(DB_PATH, buffer);
        isDirty = false;
        saveCount++;
        if (saveCount % 10 === 0) {
            console.log(`💾 Auto-save #${saveCount} (${(buffer.length / 1024).toFixed(1)} KB)`);
        }
    } catch (err) {
        console.error('❌ Lỗi khi lưu database:', err.message);
    }
}

function markDirty() { isDirty = true; }

function startAutoSave() {
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = setInterval(() => {
        if (isDirty) saveToFile();
    }, AUTO_SAVE_INTERVAL);
    if (saveTimer.unref) saveTimer.unref();
}

function stopAutoSave() {
    if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
}

// ======================================
// CORE QUERY HELPERS — Hoạt động cả 2 chế độ
// ======================================

// SELECT trả về mảng objects
async function queryAll(sql, params = []) {
    if (USE_TURSO) {
        const result = await tursoClient.execute({ sql, args: params });
        return result.rows;
    } else {
        const stmt = localDb.prepare(sql);
        if (params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
    }
}

// SELECT trả về 1 row
async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

// INSERT/UPDATE/DELETE
async function execute(sql, params = []) {
    if (USE_TURSO) {
        return await tursoClient.execute({ sql, args: params });
    } else {
        localDb.run(sql, params);
        markDirty();
        saveToFile();
    }
}

// ======================================
// CẤU HÌNH HỆ THỐNG
// ======================================
async function getSetting(k) {
    const row = await queryOne('SELECT value FROM settings WHERE key = ?', [k]);
    return row ? row.value : null;
}

async function setSetting(k, v) {
    await execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, v]);
}

async function generateInviteCode() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await setSetting('admin_invite_code', code);
    return code;
}

async function initSettings() {
    const code = await getSetting('admin_invite_code');
    if (!code) {
        await generateInviteCode();
    }
}

// ======================================
// CUSTOMERS
// ======================================
async function getAllCustomers(ownerId = null) {
    if (ownerId) {
        return (await queryAll('SELECT * FROM customers WHERE ownerId = ?', [ownerId])).map(formatCustomer);
    }
    return (await queryAll('SELECT * FROM customers')).map(formatCustomer);
}

async function getCustomer(id) {
    const row = await queryOne('SELECT * FROM customers WHERE id = ?', [id]);
    return row ? formatCustomer(row) : null;
}

async function addCustomer(data) {
    const id = uuidv4();
    await execute(
        `INSERT INTO customers (id, name, phone, service, adminId, email, password, startDate, endDate, isEmailSent, isNotifGenerated, ownerId, price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.name || '', data.phone || '', data.service || '', data.adminId || '',
         data.email || '', data.password || '', data.startDate || '', data.endDate || '',
         data.isEmailSent ? 1 : 0, data.isNotifGenerated ? 1 : 0, data.ownerId || '', data.price || '0']
    );
    return id;
}

async function updateCustomer(id, data) {
    const existing = await getCustomer(id);
    if (!existing) return false;

    const fields = [];
    const values = [];
    for (const key of ['name', 'phone', 'service', 'adminId', 'email', 'password', 'startDate', 'endDate', 'price']) {
        if (data[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(data[key]);
        }
    }
    for (const key of ['isEmailSent', 'isNotifGenerated']) {
        if (data[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(data[key] ? 1 : 0);
        }
    }
    if (fields.length === 0) return true;

    values.push(id);
    await execute(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

async function deleteCustomer(id) {
    const before = await queryOne('SELECT COUNT(*) as cnt FROM customers WHERE id = ?', [id]);
    if (before.cnt === 0) return false;
    await execute('DELETE FROM customers WHERE id = ?', [id]);
    return true;
}

function formatCustomer(row) {
    return {
        ...row,
        isEmailSent: !!row.isEmailSent,
        isNotifGenerated: !!row.isNotifGenerated
    };
}

// ======================================
// ADMINS
// ======================================
async function getAllAdmins() {
    return await queryAll('SELECT * FROM admins');
}

async function addAdmin(data) {
    const id = uuidv4();
    await execute('INSERT INTO admins (id, name, email) VALUES (?, ?, ?)',
        [id, data.name || '', data.email || '']);
    return id;
}

async function updateAdmin(id, data) {
    const existing = await queryOne('SELECT * FROM admins WHERE id = ?', [id]);
    if (!existing) return false;

    const fields = [];
    const values = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email); }
    if (fields.length === 0) return true;

    values.push(id);
    await execute(`UPDATE admins SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

async function deleteAdmin(id) {
    const before = await queryOne('SELECT COUNT(*) as cnt FROM admins WHERE id = ?', [id]);
    if (before.cnt === 0) return false;
    await execute('DELETE FROM admins WHERE id = ?', [id]);
    return true;
}

// ======================================
// SERVICES
// ======================================
async function getAllServices(ownerId = null) {
    if (ownerId) {
        return await queryAll('SELECT * FROM services WHERE ownerId = ?', [ownerId]);
    }
    return await queryAll('SELECT * FROM services');
}

async function getService(id) {
    const row = await queryOne('SELECT * FROM services WHERE id = ?', [id]);
    return row ? row : null;
}

async function addService(data) {
    const id = uuidv4();
    await execute('INSERT INTO services (id, name, icon, color, ownerId) VALUES (?, ?, ?, ?, ?)',
        [id, data.name || '', data.icon || 'ph-cube', data.color || '#6366f1', data.ownerId || '']);
    return id;
}

async function updateService(id, data) {
    const existing = await queryOne('SELECT * FROM services WHERE id = ?', [id]);
    if (!existing) return false;

    const fields = [];
    const values = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.icon !== undefined) { fields.push('icon = ?'); values.push(data.icon); }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
    if (fields.length === 0) return true;

    values.push(id);
    await execute(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

async function deleteService(id) {
    const before = await queryOne('SELECT COUNT(*) as cnt FROM services WHERE id = ?', [id]);
    if (before.cnt === 0) return false;
    await execute('DELETE FROM services WHERE id = ?', [id]);
    return true;
}

// ======================================
// NOTIFICATIONS
// ======================================
async function getAllNotifications(ownerId = null) {
    if (ownerId && ownerId !== '') {
        return (await queryAll('SELECT * FROM notifications WHERE ownerId = ? ORDER BY time DESC', [ownerId]))
            .map(n => ({ ...n, isRead: !!n.isRead }));
    }
    return (await queryAll('SELECT * FROM notifications ORDER BY time DESC'))
        .map(n => ({ ...n, isRead: !!n.isRead }));
}

async function addNotification(data) {
    const id = uuidv4();
    await execute(
        'INSERT INTO notifications (id, custId, title, body, time, isRead, ownerId) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, data.custId || '', data.title || '', data.body || '',
         data.time || new Date().toISOString(), data.isRead ? 1 : 0, data.ownerId || '']
    );
    return id;
}

async function deleteReadNotifications(ownerId = null) {
    if (ownerId && ownerId !== '') {
        await execute('DELETE FROM notifications WHERE isRead = 1 AND ownerId = ?', [ownerId]);
    } else {
        await execute('DELETE FROM notifications WHERE isRead = 1');
    }
    return true;
}

async function updateNotification(id, data) {
    const fields = [];
    const values = [];
    if (data.isRead !== undefined) { fields.push('isRead = ?'); values.push(data.isRead ? 1 : 0); }
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.body !== undefined) { fields.push('body = ?'); values.push(data.body); }
    if (fields.length === 0) return true;

    values.push(id);
    await execute(`UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

// ======================================
// AUTH: USERS & SESSIONS
// ======================================
function hashPassword(password) {
    return crypto.createHash('sha256').update(SALT + password).digest('hex');
}

async function createUser(data) {
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [data.email]);
    if (existing) return { error: 'Email đã tồn tại' };
    const id = uuidv4();
    const now = new Date();
    const createdAt = now.toISOString();

    // Tính ngày hết hạn tài khoản (30 ngày cho admin/staff, không giới hạn cho superadmin)
    let accountExpiry = '';
    if (data.role !== 'superadmin') {
        const expiry = new Date(now);
        expiry.setDate(expiry.getDate() + 30);
        accountExpiry = expiry.toISOString();
    }

    await execute(
        'INSERT INTO users (id, fullName, email, passwordHash, role, createdAt, createdBy, accountExpiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, data.fullName || '', data.email, hashPassword(data.password), data.role || 'user', createdAt, data.createdBy || '', accountExpiry]
    );
    return { id };
}

async function getUserByEmail(email) {
    return await queryOne('SELECT * FROM users WHERE email = ?', [email]);
}

async function getUserById(id) {
    const u = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (u) delete u.passwordHash;
    return u;
}

async function getAllUsers(createdBy = null) {
    if (createdBy) {
        return await queryAll('SELECT id, fullName, email, role, createdAt, createdBy, accountExpiry FROM users WHERE createdBy = ?', [createdBy]);
    }
    return await queryAll('SELECT id, fullName, email, role, createdAt, createdBy, accountExpiry FROM users');
}

async function updateUserRole(id, role) {
    const existing = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return false;
    if (existing.role === 'superadmin') return false; // Không thể thay đổi superadmin
    await execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    return true;
}

async function updateUserProfile(id, data) {
    const existing = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return false;
    const fields = [];
    const values = [];
    if (data.fullName !== undefined) { fields.push('fullName = ?'); values.push(data.fullName); }
    if (data.password !== undefined) { fields.push('passwordHash = ?'); values.push(hashPassword(data.password)); }
    if (fields.length === 0) return true;
    values.push(id);
    await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

async function deleteUser(id) {
    const existing = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing || existing.role === 'superadmin') return false;
    await execute('DELETE FROM sessions WHERE userId = ?', [id]);
    await execute('DELETE FROM users WHERE id = ?', [id]);
    return true;
}

async function verifyPassword(email, password) {
    const user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return null;
    if (user.passwordHash !== hashPassword(password)) return null;
    const { passwordHash, ...safe } = user;
    return safe;
}

async function createSession(userId) {
    const token = uuidv4();
    await execute('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)',
        [token, userId, new Date().toISOString()]);
    return token;
}

async function getSession(token) {
    if (!token) return null;
    const session = await queryOne('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!session) return null;
    const user = await queryOne('SELECT id, fullName, email, role, createdAt, accountExpiry FROM users WHERE id = ?', [session.userId]);
    return user || null;
}

async function deleteSession(token) {
    await execute('DELETE FROM sessions WHERE token = ?', [token]);
}

// ======================================
// ACCOUNT RENEWAL (Gia Hạn Tài Khoản)
// ======================================
async function getAccountStatus(userId) {
    const user = await queryOne('SELECT id, fullName, email, role, createdAt, accountExpiry FROM users WHERE id = ?', [userId]);
    if (!user) return null;

    if (user.role === 'superadmin') {
        return { ...user, daysLeft: 999, isExpired: false, isExpiring: false };
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const expiry = user.accountExpiry ? new Date(user.accountExpiry) : null;
    if (expiry) expiry.setHours(0, 0, 0, 0);
    const daysLeft = expiry ? Math.ceil((expiry - now) / 86400000) : 0;

    return {
        ...user,
        daysLeft,
        isExpired: daysLeft <= 0,
        isExpiring: daysLeft > 0 && daysLeft <= 3
    };
}

async function renewAccount(userId, days = 30) {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return false;
    if (user.role === 'superadmin') return false;

    const now = new Date();
    const currentExpiry = user.accountExpiry ? new Date(user.accountExpiry) : now;
    const baseDate = currentExpiry > now ? currentExpiry : now;
    baseDate.setDate(baseDate.getDate() + days);

    await execute('UPDATE users SET accountExpiry = ? WHERE id = ?', [baseDate.toISOString(), userId]);
    return true;
}

// ======================================
// RENEWAL REQUESTS (Yêu cầu gia hạn)
// ======================================
async function createRenewalRequest(data) {
    const id = uuidv4();
    await execute(
        'INSERT INTO renewal_requests (id, userId, fullName, email, amount, proofImage, status, createdAt, transactionRef) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, data.userId, data.fullName, data.email, data.amount, data.proofImage || '', 'pending', new Date().toISOString(), data.transactionRef || '']
    );
    return id;
}

async function getPendingRenewalRequests() {
    return await queryAll("SELECT * FROM renewal_requests WHERE status = 'pending' ORDER BY createdAt DESC");
}

async function getRenewalRequestHistory() {
    return await queryAll("SELECT * FROM renewal_requests WHERE status != 'pending' ORDER BY createdAt DESC LIMIT 50");
}

async function updateRenewalRequestStatus(id, status) {
    const req = await queryOne('SELECT * FROM renewal_requests WHERE id = ?', [id]);
    if (!req) return null;

    await execute('UPDATE renewal_requests SET status = ? WHERE id = ?', [status, id]);
    
    if (status === 'approved') {
        // Nếu duyệt, tự động cộng 30 ngày cho user
        await renewAccount(req.userId, 30);
    }
    return req;
}

async function getUserLatestRenewal(userId) {
    return await queryOne(
        'SELECT * FROM renewal_requests WHERE userId = ? ORDER BY createdAt DESC LIMIT 1',
        [userId]
    );
}

// ======================================
// SEED DATA (nếu database trống)
// ======================================
async function seedIfEmpty() {
    // Seed SuperAdmin nếu chưa có
    const superAdmin = await queryOne("SELECT id FROM users WHERE role = 'superadmin'");
    if (!superAdmin) {
        console.log('🔐 Tạo tài khoản Admin Minh mặc định...');
        await createUser({ fullName: 'Admin Minh', email: 'admin@aishop.com', password: 'admin123', role: 'superadmin' });
        console.log('✅ Admin Minh: admin@aishop.com / admin123');
    }

    // Gán ownerId cho các services cũ
    if (superAdmin) {
        await execute(
            "UPDATE services SET ownerId = ? WHERE ownerId = '' OR ownerId IS NULL",
            [superAdmin.id]
        );
    }

    // Seed services nếu chưa có (gán cho superadmin)
    const svcCount = await queryOne('SELECT COUNT(*) as cnt FROM services');
    if (svcCount.cnt === 0 && superAdmin) {
        console.log('📦 Đang tạo dữ liệu dịch vụ mẫu...');
        await addService({ name: 'ChatGPT Plus', icon: 'ph-robot', color: '#10a37f', ownerId: superAdmin.id });
        await addService({ name: 'Canva Pro', icon: 'ph-paint-brush-broad', color: '#00c4cc', ownerId: superAdmin.id });
        await addService({ name: 'Adobe Creative Cloud', icon: 'ph-swatches', color: '#ff0000', ownerId: superAdmin.id });
        await addService({ name: 'Netflix Premium', icon: 'ph-video-camera', color: '#e50914', ownerId: superAdmin.id });
        await addService({ name: 'Midjourney', icon: 'ph-sailboat', color: '#7c3aed', ownerId: superAdmin.id });
        await addService({ name: 'Khác', icon: 'ph-atom', color: '#6366f1', ownerId: superAdmin.id });
        console.log('✅ Dữ liệu dịch vụ mẫu đã tạo xong!');
    }

    const count = await queryOne('SELECT COUNT(*) as cnt FROM customers');
    if (count.cnt === 0) {
        console.log('ℹ️ Chưa có dữ liệu khách hàng. Hệ thống đã tắt tính năng tự động tạo dữ liệu mẫu.');
    }
}

// ======================================
// DATABASE INFO
// ======================================
async function getDatabaseInfo() {
    try {
        const tables = await queryAll("SELECT name FROM sqlite_master WHERE type='table'");
        if (USE_TURSO) {
            return {
                mode: 'turso_cloud',
                url: process.env.TURSO_DATABASE_URL,
                tables: tables.map(t => t.name),
                persistent: true,
                description: 'Dữ liệu lưu trên Turso Cloud, không bị mất khi restart/deploy'
            };
        } else {
            const stats = fs.statSync(DB_PATH);
            return {
                mode: 'local_sqljs',
                path: DB_PATH,
                sizeBytes: stats.size,
                sizeKB: (stats.size / 1024).toFixed(1),
                sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
                tables: tables.map(t => t.name),
                saveCount: saveCount,
                hasBackup: fs.existsSync(DB_BACKUP_PATH),
                persistent: true,
                description: 'Dữ liệu lưu trong file data.db trên ổ đĩa local'
            };
        }
    } catch (e) {
        return { error: e.message };
    }
}

// ======================================
// EXPORT
// ======================================
module.exports = {
    initDatabase, execute, queryOne, queryAll,
    getAllCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer,
    getAllAdmins, addAdmin, updateAdmin, deleteAdmin,
    getAllServices, getService, addService, updateService, deleteService,
    getAllNotifications, addNotification, updateNotification, deleteReadNotifications,
    getSetting, setSetting, generateInviteCode,
    getDatabaseInfo,
    // Auth
    createUser, getUserByEmail, getUserById, getAllUsers,
    updateUserRole, updateUserProfile, deleteUser,
    verifyPassword, hashPassword,
    createSession, getSession, deleteSession,
    // Account Renewal
    getAccountStatus, renewAccount,
    createRenewalRequest, getPendingRenewalRequests, updateRenewalRequestStatus, getRenewalRequestHistory, getUserLatestRenewal,
    // Info
    get mode() { return USE_TURSO ? 'turso' : 'local'; },
    close: () => {
        stopAutoSave();
        if (localDb) {
            if (isDirty) saveToFile();
            localDb.close();
            console.log('💾 Database đã được lưu và đóng an toàn.');
        }
        if (tursoClient) {
            tursoClient.close();
            console.log('☁️ Turso connection đã đóng.');
        }
    }
};
