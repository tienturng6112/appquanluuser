// ======================================
// DATABASE MODULE — SQLite (sql.js — pure JS)
// ======================================
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const SALT = 'aishop_salt_2026';

const DB_PATH = path.join(__dirname, 'data.db');

let db = null;

// ======================================
// KHỞI TẠO DATABASE (async vì sql.js cần init WASM)
// ======================================
async function initDatabase() {
    const SQL = await initSqlJs();

    // Nếu đã có file database, đọc vào
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Tạo bảng
    db.run(`
        CREATE TABLE IF NOT EXISTS customers (
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
            isNotifGenerated INTEGER DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT DEFAULT 'ph-cube',
            color TEXT DEFAULT '#6366f1'
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            custId TEXT DEFAULT '',
            title TEXT DEFAULT '',
            body TEXT DEFAULT '',
            time TEXT DEFAULT '',
            isRead INTEGER DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            fullName TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            passwordHash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            createdAt TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            userId TEXT NOT NULL,
            createdAt TEXT DEFAULT ''
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    saveToFile();
    initSettings();
    seedIfEmpty();

    return db;
}

// ======================================
// CẤU HÌNH HỆ THỐNG
// ======================================
function getSetting(k) {
    const row = queryOne('SELECT value FROM settings WHERE key = ?', [k]);
    return row ? row.value : null;
}

function setSetting(k, v) {
    execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, v]);
}

function generateInviteCode() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setSetting('admin_invite_code', code);
    return code;
}

function initSettings() {
    if (!getSetting('admin_invite_code')) {
        generateInviteCode();
    }
}

// Lưu database ra file
function saveToFile() {
    if (!db) return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Helper: chạy query SELECT trả về mảng objects
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// Helper: chạy query SELECT trả về 1 row
function queryOne(sql, params = []) {
    const rows = queryAll(sql, params);
    return rows.length > 0 ? rows[0] : null;
}

// Helper: chạy INSERT/UPDATE/DELETE
function execute(sql, params = []) {
    db.run(sql, params);
    saveToFile();
}

// ======================================
// CUSTOMERS
// ======================================
function getAllCustomers() {
    return queryAll('SELECT * FROM customers').map(formatCustomer);
}

function getCustomer(id) {
    const row = queryOne('SELECT * FROM customers WHERE id = ?', [id]);
    return row ? formatCustomer(row) : null;
}

function addCustomer(data) {
    const id = uuidv4();
    execute(
        `INSERT INTO customers (id, name, phone, service, adminId, email, password, startDate, endDate, isEmailSent, isNotifGenerated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.name || '', data.phone || '', data.service || '', data.adminId || '',
         data.email || '', data.password || '', data.startDate || '', data.endDate || '',
         data.isEmailSent ? 1 : 0, data.isNotifGenerated ? 1 : 0]
    );
    return id;
}

function updateCustomer(id, data) {
    const existing = getCustomer(id);
    if (!existing) return false;

    const fields = [];
    const values = [];
    for (const key of ['name', 'phone', 'service', 'adminId', 'email', 'password', 'startDate', 'endDate']) {
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
    execute(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

function deleteCustomer(id) {
    const before = queryAll('SELECT COUNT(*) as cnt FROM customers WHERE id = ?', [id]);
    if (before[0].cnt === 0) return false;
    execute('DELETE FROM customers WHERE id = ?', [id]);
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
function getAllAdmins() {
    return queryAll('SELECT * FROM admins');
}

function addAdmin(data) {
    const id = uuidv4();
    execute('INSERT INTO admins (id, name, email) VALUES (?, ?, ?)',
        [id, data.name || '', data.email || '']);
    return id;
}

function updateAdmin(id, data) {
    const existing = queryOne('SELECT * FROM admins WHERE id = ?', [id]);
    if (!existing) return false;

    const fields = [];
    const values = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email); }
    if (fields.length === 0) return true;

    values.push(id);
    execute(`UPDATE admins SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

function deleteAdmin(id) {
    const before = queryAll('SELECT COUNT(*) as cnt FROM admins WHERE id = ?', [id]);
    if (before[0].cnt === 0) return false;
    execute('DELETE FROM admins WHERE id = ?', [id]);
    return true;
}

// ======================================
// SERVICES
// ======================================
function getAllServices() {
    return queryAll('SELECT * FROM services');
}

function addService(data) {
    const id = uuidv4();
    execute('INSERT INTO services (id, name, icon, color) VALUES (?, ?, ?, ?)',
        [id, data.name || '', data.icon || 'ph-cube', data.color || '#6366f1']);
    return id;
}

function updateService(id, data) {
    const existing = queryOne('SELECT * FROM services WHERE id = ?', [id]);
    if (!existing) return false;

    const fields = [];
    const values = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.icon !== undefined) { fields.push('icon = ?'); values.push(data.icon); }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
    if (fields.length === 0) return true;

    values.push(id);
    execute(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

function deleteService(id) {
    const before = queryAll('SELECT COUNT(*) as cnt FROM services WHERE id = ?', [id]);
    if (before[0].cnt === 0) return false;
    execute('DELETE FROM services WHERE id = ?', [id]);
    return true;
}

// ======================================
// NOTIFICATIONS
// ======================================
function getAllNotifications() {
    return queryAll('SELECT * FROM notifications ORDER BY time DESC')
        .map(n => ({ ...n, isRead: !!n.isRead }));
}

function addNotification(data) {
    const id = uuidv4();
    execute(
        'INSERT INTO notifications (id, custId, title, body, time, isRead) VALUES (?, ?, ?, ?, ?, ?)',
        [id, data.custId || '', data.title || '', data.body || '',
         data.time || new Date().toISOString(), data.isRead ? 1 : 0]
    );
    return id;
}

function updateNotification(id, data) {
    const fields = [];
    const values = [];
    if (data.isRead !== undefined) { fields.push('isRead = ?'); values.push(data.isRead ? 1 : 0); }
    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title); }
    if (data.body !== undefined) { fields.push('body = ?'); values.push(data.body); }
    if (fields.length === 0) return true;

    values.push(id);
    execute(`UPDATE notifications SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

// ======================================
// AUTH: USERS & SESSIONS
// ======================================
function hashPassword(password) {
    return crypto.createHash('sha256').update(SALT + password).digest('hex');
}

function createUser(data) {
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [data.email]);
    if (existing) return { error: 'Email đã tồn tại' };
    const id = uuidv4();
    execute(
        'INSERT INTO users (id, fullName, email, passwordHash, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [id, data.fullName || '', data.email, hashPassword(data.password), data.role || 'user', new Date().toISOString()]
    );
    return { id };
}

function getUserByEmail(email) {
    return queryOne('SELECT * FROM users WHERE email = ?', [email]);
}

function getUserById(id) {
    const u = queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (u) delete u.passwordHash;
    return u;
}

function getAllUsers() {
    return queryAll('SELECT id, fullName, email, role, createdAt FROM users');
}

function updateUserRole(id, role) {
    const existing = queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return false;
    if (existing.role === 'superadmin') return false; // Không thể thay đổi superadmin
    execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    return true;
}

function updateUserProfile(id, data) {
    const existing = queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return false;
    const fields = [];
    const values = [];
    if (data.fullName !== undefined) { fields.push('fullName = ?'); values.push(data.fullName); }
    if (data.password !== undefined) { fields.push('passwordHash = ?'); values.push(hashPassword(data.password)); }
    if (fields.length === 0) return true;
    values.push(id);
    execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    return true;
}

function deleteUser(id) {
    const existing = queryOne('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing || existing.role === 'superadmin') return false;
    execute('DELETE FROM sessions WHERE userId = ?', [id]);
    execute('DELETE FROM users WHERE id = ?', [id]);
    return true;
}

function verifyPassword(email, password) {
    const user = queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) return null;
    if (user.passwordHash !== hashPassword(password)) return null;
    const { passwordHash, ...safe } = user;
    return safe;
}

function createSession(userId) {
    const token = uuidv4();
    execute('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)',
        [token, userId, new Date().toISOString()]);
    return token;
}

function getSession(token) {
    if (!token) return null;
    const session = queryOne('SELECT * FROM sessions WHERE token = ?', [token]);
    if (!session) return null;
    const user = queryOne('SELECT id, fullName, email, role, createdAt FROM users WHERE id = ?', [session.userId]);
    return user || null;
}

function deleteSession(token) {
    execute('DELETE FROM sessions WHERE token = ?', [token]);
}

// ======================================
// SEED DATA (nếu database trống)
// ======================================
function seedIfEmpty() {
    // Seed SuperAdmin nếu chưa có
    const superAdmin = queryOne("SELECT id FROM users WHERE role = 'superadmin'");
    if (!superAdmin) {
        console.log('🔐 Tạo tài khoản Admin Minh mặc định...');
        createUser({ fullName: 'Admin Minh', email: 'admin@aishop.com', password: 'admin123', role: 'superadmin' });
        console.log('✅ Admin Minh: admin@aishop.com / admin123');
    }

    // Seed services nếu chưa có
    const svcCount = queryOne('SELECT COUNT(*) as cnt FROM services');
    if (svcCount.cnt === 0) {
        console.log('📦 Đang tạo dữ liệu dịch vụ mẫu...');
        addService({ name: 'ChatGPT Plus', icon: 'ph-robot', color: '#10a37f' });
        addService({ name: 'Canva Pro', icon: 'ph-paint-brush-broad', color: '#00c4cc' });
        addService({ name: 'Adobe Creative Cloud', icon: 'ph-swatches', color: '#ff0000' });
        addService({ name: 'Netflix Premium', icon: 'ph-video-camera', color: '#e50914' });
        addService({ name: 'Midjourney', icon: 'ph-sailboat', color: '#7c3aed' });
        addService({ name: 'Khác', icon: 'ph-atom', color: '#6366f1' });
        console.log('✅ Dữ liệu dịch vụ mẫu đã tạo xong!');
    }

    const count = queryOne('SELECT COUNT(*) as cnt FROM customers');
    if (count.cnt === 0) {
        console.log('ℹ️ Chưa có dữ liệu khách hàng. Hệ thống đã tắt tính năng tự động tạo dữ liệu mẫu.');
        // Dữ liệu mẫu đã được vô hiệu hóa để chuẩn bị cho môi trường thật
    }
}

// ======================================
// EXPORT
// ======================================
module.exports = {
    initDatabase, execute,
    getAllCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer,
    getAllAdmins, addAdmin, updateAdmin, deleteAdmin,
    getAllServices, addService, updateService, deleteService,
    getAllNotifications, addNotification, updateNotification,
    getSetting, setSetting, generateInviteCode,
    // Auth
    createUser, getUserByEmail, getUserById, getAllUsers,
    updateUserRole, updateUserProfile, deleteUser,
    verifyPassword, hashPassword,
    createSession, getSession, deleteSession,
    close: () => { if (db) { saveToFile(); db.close(); } }
};
