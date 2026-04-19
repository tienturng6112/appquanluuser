// ======================================
// EXPRESS SERVER — AISHOP DASHBOARD
// Hỗ trợ: Turso Cloud + SQL.js Local
// ======================================
require('dotenv').config(); // Load biến môi trường từ .env

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS) từ thư mục gốc
app.use(express.static(path.join(__dirname, '..')));

// ======================================
// SSE (Server-Sent Events) — Real-time
// ======================================
const sseClients = new Set();

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Gửi heartbeat mỗi 30s để giữ kết nối
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    sseClients.add(res);
    console.log(`📡 SSE client connected (total: ${sseClients.size})`);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        console.log(`📡 SSE client disconnected (total: ${sseClients.size})`);
    });
});

function broadcast(eventType) {
    const data = JSON.stringify({ type: eventType, time: Date.now() });
    for (const client of sseClients) {
        client.write(`data: ${data}\n\n`);
    }
}

// ======================================
// AUTH MIDDLEWARE (async — hỗ trợ Turso)
// ======================================
async function authMiddleware(req, res, next) {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Chưa đăng nhập' });
        }
        const token = auth.split(' ')[1];
        const user = await db.getSession(token);
        if (!user) {
            return res.status(401).json({ error: 'Phiên đăng nhập hết hạn' });
        }
        req.user = user;
        req.token = token;
        next();
    } catch (e) {
        res.status(500).json({ error: 'Lỗi xác thực: ' + e.message });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Không có quyền truy cập' });
        }
        next();
    };
}

// ======================================
// API: AUTH
// ======================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { fullName, email, password, inviteCode } = req.body;
        if (!fullName || !email || !password || !inviteCode) {
            return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin và mã bảo mật' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
        }
        const currentInviteCode = await db.getSetting('admin_invite_code');
        if (inviteCode !== currentInviteCode) {
            return res.status(403).json({ error: 'Mã xác nhận bảo mật không đúng' });
        }

        const result = await db.createUser({ fullName, email, password, role: 'admin' });
        if (result.error) return res.status(400).json({ error: result.error });
        res.status(201).json({ success: true, message: 'Đăng ký Quản Trị Viên thành công!' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Vui lòng nhập email và mật khẩu' });
        }
        const user = await db.verifyPassword(email, password);
        if (!user) {
            return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
        }
        const token = await db.createSession(user.id);
        res.json({ token, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    try {
        await db.deleteSession(req.token);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    res.json(req.user);
});

// ======================================
// API: USERS / PERSONNEL (Quản lý Nhân Sự)
// ======================================
app.get('/api/users', authMiddleware, requireRole('superadmin', 'admin'), async (req, res) => {
    try {
        if (req.user.role === 'superadmin') {
            // Superadmin xem tất cả (trừ chính mình)
            const allUsers = await db.getAllUsers();
            res.json(allUsers.filter(u => u.id !== req.user.id));
        } else {
            // Admin chỉ xem nhân sự mình tạo
            const users = await db.getAllUsers(req.user.id);
            res.json(users);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/users', authMiddleware, requireRole('superadmin', 'admin'), async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        const targetRole = (req.user.role === 'admin') ? 'staff' : (role || 'staff');
        const result = await db.createUser({
            fullName, email,
            password: password || '123456',
            role: targetRole,
            createdBy: req.user.id
        });
        if (result.error) return res.status(400).json({ error: result.error });
        broadcast('users_changed');
        res.status(201).json({ id: result.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/users/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req, res) => {
    try {
        // Cập nhật profile (fullName, role, password)
        const okProfile = await db.updateUserProfile(req.params.id, req.body);
        if (req.body.role && req.user.role === 'superadmin') {
             await db.updateUserRole(req.params.id, req.body.role);
        }
        if (!okProfile) return res.status(404).json({ error: 'Không tìm thấy' });
        broadcast('users_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/users/:id', authMiddleware, requireRole('superadmin', 'admin'), async (req, res) => {
    try {
        // Không cho phép admin xóa một admin khác.
        const targetUser = await db.getUserById(req.params.id);
        if (req.user.role === 'admin' && targetUser && targetUser.role === 'admin') {
            return res.status(403).json({ error: 'Không thể xóa Quản Trị Viên khác' });
        }
        const ok = await db.deleteUser(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Không thể xóa' });
        broadcast('users_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ======================================
// API: CUSTOMERS (yêu cầu đăng nhập + phân tách dữ liệu)
// ======================================
app.get('/api/customers', authMiddleware, async (req, res) => {
    try {
        if (req.user.role === 'superadmin') {
            // Superadmin: xem tất cả hoặc filter theo ownerId
            const ownerId = req.query.ownerId || null;
            res.json(await db.getAllCustomers(ownerId));
        } else {
            // Admin/Staff: chỉ xem khách hàng của mình
            res.json(await db.getAllCustomers(req.user.id));
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/customers', authMiddleware, async (req, res) => {
    try {
        // Tự động gán ownerId = người đang đăng nhập
        req.body.ownerId = req.user.id;
        const id = await db.addCustomer(req.body);
        broadcast('customers_changed');
        res.status(201).json({ id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/customers/:id', authMiddleware, async (req, res) => {
    try {
        // Kiểm tra quyền sở hữu
        const customer = await db.getCustomer(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Not found' });
        if (req.user.role !== 'superadmin' && customer.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Không có quyền chỉnh sửa' });
        }
        const ok = await db.updateCustomer(req.params.id, req.body);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        broadcast('customers_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/customers/:id', authMiddleware, async (req, res) => {
    try {
        const customer = await db.getCustomer(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Not found' });
        if (req.user.role !== 'superadmin' && customer.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Không có quyền xóa' });
        }
        const ok = await db.deleteCustomer(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        broadcast('customers_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ======================================
// API: CÀI ĐẶT (SETTINGS)
// ======================================
app.get('/api/settings/invite-code', authMiddleware, requireRole('superadmin'), async (req, res) => {
    res.json({ code: await db.getSetting('admin_invite_code') });
});

app.post('/api/settings/invite-code', authMiddleware, requireRole('superadmin'), async (req, res) => {
    const code = await db.generateInviteCode();
    res.json({ code });
});

// API: Database Info (chỉ superadmin)
app.get('/api/db-info', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        res.json(await db.getDatabaseInfo());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ======================================
// API: SERVICES
// ======================================
app.get('/api/services', authMiddleware, async (req, res) => {
    try {
        if (req.user.role === 'superadmin') {
            const ownerId = req.query.ownerId || null;
            res.json(await db.getAllServices(ownerId));
        } else {
            res.json(await db.getAllServices(req.user.id));
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/services', authMiddleware, async (req, res) => {
    try {
        req.body.ownerId = req.user.id;
        const id = await db.addService(req.body);
        broadcast('services_changed');
        res.status(201).json({ id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/services/:id', authMiddleware, async (req, res) => {
    try {
        // Có thể thêm kiểm tra quyền sở hữu detail ở đây nếu cần, tạm thời pass db update
        const ok = await db.updateService(req.params.id, req.body);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        broadcast('services_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/services/:id', authMiddleware, async (req, res) => {
    try {
        const ok = await db.deleteService(req.params.id);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        broadcast('services_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ======================================
// API: NOTIFICATIONS
// ======================================
app.get('/api/notifications', async (req, res) => {
    try {
        res.json(await db.getAllNotifications());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/notifications', async (req, res) => {
    try {
        const id = await db.addNotification(req.body);
        broadcast('notifications_changed');
        res.status(201).json({ id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/notifications/:id', async (req, res) => {
    try {
        const ok = await db.updateNotification(req.params.id, req.body);
        if (!ok) return res.status(404).json({ error: 'Not found' });
        broadcast('notifications_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ======================================
// KHỞI ĐỘNG SERVER (async vì database cần init)
// ======================================
async function startServer() {
    try {
        // Khởi tạo database (auto-detect Turso hoặc Local)
        await db.initDatabase();
        console.log('✅ Database đã sẵn sàng!');

        // Start Express
        app.listen(PORT, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════╗');
            console.log('║   🚀 AISHOP Dashboard Server Started!   ║');
            console.log('╠══════════════════════════════════════════╣');
            console.log(`║   🌐 http://localhost:${PORT}              ║`);
            if (db.mode === 'turso') {
                console.log('║   ☁️  Database: Turso Cloud              ║');
            } else {
                console.log('║   📁 Database: server/data.db (local)    ║');
            }
            console.log('║   🔄 SSE Real-time: Enabled              ║');
            console.log('╚══════════════════════════════════════════╝');
            console.log('');
        });
    } catch (err) {
        console.error('❌ Lỗi khởi động:', err);
        process.exit(1);
    }
}

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Đang tắt server...');
    db.close();
    process.exit(0);
});
