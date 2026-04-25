// ======================================
// EXPRESS SERVER — AISHOP DASHBOARD
// Hỗ trợ: Turso Cloud + SQL.js Local
// ======================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ====== EMAIL SERVICE ======
function createMailTransporter() {
    if (!process.env.MAIL_USER || process.env.MAIL_USER === 'your_gmail@gmail.com') return null;
    return nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
    });
}

async function sendInviteCodeEmail({ toEmail, toName, inviteCode, plan }) {
    const transporter = createMailTransporter();
    if (!transporter) {
        console.warn('⚠️ Email chưa cấu hình (MAIL_USER chưa được set trong .env)');
        return false;
    }
    const fromName = process.env.MAIL_FROM_NAME || 'AISHOP Dashboard';
    const mailOptions = {
        from: `"${fromName}" <${process.env.MAIL_USER}>`,
        to: toEmail,
        subject: '✅ Mã mời đăng ký tài khoản AISHOP',
        html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f7f9fc;padding:32px;border-radius:16px;">
            <div style="text-align:center;margin-bottom:24px;">
                <div style="font-size:2.5rem;">🎉</div>
                <h2 style="color:#1a1a2e;margin:8px 0;">Thanh toán đã được xác nhận!</h2>
                <p style="color:#718096;">Xin chào <strong>${toName}</strong>, yêu cầu đăng ký của bạn đã được phê duyệt.</p>
            </div>
            <div style="background:#fff;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
                <p style="color:#718096;font-size:0.9rem;margin-bottom:8px;">Mã mời đăng ký của bạn:</p>
                <div style="font-size:2.5rem;font-weight:900;letter-spacing:8px;color:#3B4FBF;background:#f0f4ff;padding:16px;border-radius:10px;">${inviteCode}</div>
                <p style="color:#718096;font-size:0.8rem;margin-top:8px;">Đây là gói: <strong>${plan || 'AISHOP'}</strong></p>
            </div>
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:20px;">
                <p style="color:#1a1a2e;font-weight:600;margin-bottom:8px;">Hướng dẫn đăng ký:</p>
                <ol style="color:#4a5568;font-size:0.9rem;padding-left:20px;line-height:1.8;">
                    <li>Truy cập trang đăng nhập của AISHOP</li>
                    <li>Chọn <strong>"Tạo tài khoản mới"</li>
                    <li>Nhập mã mời: <strong style="color:#3B4FBF">${inviteCode}</strong></li>
                    <li>Điền thông tin và hoàn thành đăng ký</li>
                </ol>
            </div>
            <p style="text-align:center;color:#a0aec0;font-size:0.8rem;">— Đội ngũ AISHOP —</p>
        </div>`
    };
    await transporter.sendMail(mailOptions);
    return true;
}

// ====== NOTIFICATION HELPERS (Telegram & Gmail) ======
async function sendTelegramNotification(ownerId, message) {
    try {
        const botToken = await db.getSetting(`tg_bot_token_${ownerId}`);
        const chatId = await db.getSetting(`tg_chat_id_${ownerId}`);
        const enabled = await db.getSetting(`tg_enabled_${ownerId}`);

        if (!botToken || !chatId || enabled !== 'true') return;

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
        });
        console.log(`📡 Telegram notification sent to owner ${ownerId}`);
    } catch (e) {
        console.error('❌ Lỗi gửi Telegram:', e.message);
    }
}

async function sendEmailNotification(ownerId, title, body) {
    try {
        const enabled = await db.getSetting(`email_notif_enabled_${ownerId}`);
        if (enabled !== 'true') return;

        const owner = await db.getUserById(ownerId);
        if (!owner || !owner.email) return;

        const transporter = createMailTransporter();
        if (!transporter) return;

        const fromName = process.env.MAIL_FROM_NAME || 'AISHOP Notifier';
        await transporter.sendMail({
            from: `"${fromName}" <${process.env.MAIL_USER}>`,
            to: owner.email,
            subject: `🔔 [AISHOP] ${title}`,
            text: body,
            html: `<div style="font-family:sans-serif;padding:20px;background:#f4f7f6;border-radius:10px;">
                <h2 style="color:#3B4FBF;">${title}</h2>
                <p style="color:#333;font-size:1.1rem;">${body}</p>
                <hr style="border:0;border-top:1px solid #ddd;margin:20px 0;">
                <p style="color:#999;font-size:0.8rem;">Thông báo tự động từ hệ thống AISHOP.</p>
            </div>`
        });
        console.log(`📧 Email notification sent to owner ${ownerId} (${owner.email})`);
    } catch (e) {
        console.error('❌ Lỗi gửi Email:', e.message);
    }
}

// ====== TELEGRAM INTERACTIVE POLLING ======
let tgPollOffsets = {}; // track offset per bot token

async function startTelegramPolling() {
    console.log('🤖 Telegram Interactive Polling started...');
    setInterval(async () => {
        try {
            // Lấy tất cả bot tokens đang active (chỉ superadmin cho đơn giản)
            const allUsers = await db.getAllUsers();
            const superAdmins = allUsers.filter(u => u.role === 'superadmin');
            
            for (const admin of superAdmins) {
                const token = await db.getSetting(`tg_bot_token_${admin.id}`);
                const enabled = await db.getSetting(`tg_enabled_${admin.id}`);
                if (!token || enabled !== 'true') continue;

                await pollBot(token, admin.id);
            }
        } catch (e) { /* ignore */ }
    }, 5000);
}

async function pollBot(token, adminId) {
    const offset = tgPollOffsets[token] || 0;
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0`);
        const data = await res.json();
        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                tgPollOffsets[token] = update.update_id + 1;
                if (update.callback_query) {
                    await handleTelegramCallback(token, adminId, update.callback_query);
                }
            }
        }
    } catch (e) { console.error('TG Poll Error:', e.message); }
}

async function handleTelegramCallback(token, adminId, query) {
    const { data, id: queryId, message } = query;
    const chatId = message.chat.id;
    const msgId = message.message_id;

    const answer = async (text) => {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: queryId, text })
        });
    };

    const updateMsg = async (newText) => {
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: msgId, text: newText, parse_mode: 'HTML' })
        });
    };

    try {
        if (data.startsWith('approve_reg:')) {
            const reqId = data.split(':')[1];
            // Mocking req.user for approval logic
            const admin = await db.getUserById(adminId);
            
            // Logic phê duyệt
            const req_data = await db.getRegRequests();
            const regReq = req_data.find(r => r.id === reqId);
            if (!regReq) return await answer('❌ Yêu cầu không còn tồn tại');
            if (regReq.status !== 'pending') return await answer('⚠️ Yêu cầu đã được xử lý trước đó');

            const inviteCode = 'AI-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            await db.updateRegRequestInviteCode(reqId, inviteCode);
            broadcast('reg_requests_changed');
            
            await answer('✅ Đã phê duyệt thành công!');
            await updateMsg(`${message.text}\n\n✅ <b>TRẠNG THÁI: ĐÃ PHÊ DUYỆT</b>\n🔑 Mã mời: <code>${inviteCode}</code>`);
        } 
        else if (data.startsWith('reject_reg:')) {
            const reqId = data.split(':')[1];
            await db.updateRegRequestStatus(reqId, 'rejected');
            broadcast('reg_requests_changed');
            await answer('❌ Đã từ chối yêu cầu');
            await updateMsg(`${message.text}\n\n❌ <b>TRẠNG THÁI: ĐÃ TỪ CHỐI</b>`);
        }
    } catch (e) {
        await answer('❌ Lỗi hệ thống: ' + e.message);
    }
}

// ====== FACEBOOK MESSENGER WEBHOOK ======
async function handleFacebookMessage(senderId, pageId, messageText) {
    try {
        console.log(`💬 FB Message from ${senderId}: ${messageText}`);
        
        // Lấy thông tin admin để gửi thông báo (mặc định gửi cho superadmin hoặc admin sở hữu page)
        const allUsers = await db.getAllUsers();
        const superAdmin = allUsers.find(u => u.role === 'superadmin');
        if (!superAdmin) return;

        const ownerId = superAdmin.id;
        const dateStr = new Date().toLocaleString('vi-VN');
        
        // Gửi thông báo qua Telegram
        const botToken = (await db.getSetting(`tg_bot_token_${ownerId}`))?.toString().trim();
        const chatId = (await db.getSetting(`tg_chat_id_${ownerId}`))?.toString().trim();
        const enabled = await db.getSetting(`tg_enabled_${ownerId}`);

        if (botToken && chatId && (enabled === 'true' || enabled === true)) {
            const tgMsg = `<b>💬 TIN NHẮN MỚI TỪ FANPAGE</b>\n` +
                          `──────────────────\n` +
                          `<b>👤 Người gửi (ID):</b> <code>${senderId}</code>\n` +
                          `<b>📝 Nội dung:</b> ${messageText}\n` +
                          `──────────────────\n` +
                          `<b>🕒 Thời gian:</b> <code>${dateStr}</code>`;
            
            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: tgMsg, parse_mode: 'HTML' })
            });
        }

        // Tạo thông báo trong hệ thống Dashboard
        await createNotification({
            ownerId: ownerId,
            title: '💬 Tin nhắn Facebook mới',
            body: `ID: ${senderId} vừa nhắn: "${messageText}"`
        });

    } catch (e) {
        console.error('❌ Lỗi xử lý tin nhắn FB:', e.message);
    }
}

app.get('/api/webhook/facebook', async (req, res) => {
    const verifyToken = await db.getSetting('fb_verify_token') || 'aishop_verify_token';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('✅ Facebook Webhook Verified!');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

app.post('/api/webhook/facebook', async (req, res) => {
    const body = req.body;
    console.log('--- FB Webhook Event Received ---');
    if (body.object === 'page') {
        body.entry.forEach(entry => {
            if (entry.messaging && entry.messaging[0]) {
                const webhook_event = entry.messaging[0];
                if (webhook_event.message && webhook_event.message.text) {
                    handleFacebookMessage(
                        webhook_event.sender.id, 
                        entry.id, 
                        webhook_event.message.text
                    ).catch(err => console.error('Handle FB Message Error:', err));
                }
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve landing.html as the default homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

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

function broadcast(eventType, payload = null) {
    const data = JSON.stringify({ type: eventType, payload, time: Date.now() });
    for (const client of sseClients) {
        client.write(`data: ${data}\n\n`);
    }
}

// Central function to create notification + send external alerts
async function createNotification({ ownerId, title, body, custId = '', type = '' }) {
    try {
        const id = await db.addNotification({ ownerId, title, body, custId, time: new Date().toISOString() });
        broadcast('notifications_changed');

        // External alerts (Telegram with Interactive Buttons)
        const botToken = (await db.getSetting(`tg_bot_token_${ownerId}`))?.toString().trim();
        const chatId = (await db.getSetting(`tg_chat_id_${ownerId}`))?.toString().trim();
        const enabled = await db.getSetting(`tg_enabled_${ownerId}`);

        if (botToken && chatId && (enabled === 'true' || enabled === true)) {
            const dateStr = new Date().toLocaleString('vi-VN', { 
                day: '2-digit', month: '2-digit', year: 'numeric', 
                hour: '2-digit', minute: '2-digit', second: '2-digit' 
            });

            const tgMsg = `<b>🚀 AISHOP SYSTEM ALERT</b>\n` +
                          `──────────────────\n` +
                          `<b>📌 Tiêu đề:</b> ${title}\n` +
                          `<b>📝 Nội dung:</b> ${body}\n` +
                          `──────────────────\n` +
                          `<b>🕒 Thời gian:</b> <code>${dateStr}</code>`;
            
            let reply_markup = null;
            // Nếu là yêu cầu đăng ký
            if (custId && title.includes('đăng ký')) {
                reply_markup = {
                    inline_keyboard: [[
                        { text: '✅ Phê duyệt', callback_data: `approve_reg:${custId}` },
                        { text: '❌ Từ chối', callback_data: `reject_reg:${custId}` }
                    ]]
                };
            } 
            // Nếu là yêu cầu gia hạn
            else if (title.includes('gia hạn')) {
                // Chúng ta cần ID của renewal request. 
                // Ở đây createNotification được gọi sau khi createRenewalRequest, id ở trên chính là notification id.
                // Tuy nhiên logic verifyRenewal cần ID của renewal_request. 
                // Giải pháp: tìm renewal_request mới nhất của user hoặc truyền ID vào.
                // Tạm thời chỉ hỗ trợ đăng ký vì nó có custId link sẵn.
            }

            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            const payload = { 
                chat_id: chatId, 
                text: tgMsg, 
                parse_mode: 'HTML'
            };
            if (reply_markup) {
                payload.reply_markup = reply_markup;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const tgData = await response.json();
            if (response.ok) {
                console.log(`📡 Telegram notification sent successfully to owner ${ownerId}`);
            } else {
                console.error(`❌ Telegram API Error:`, tgData);
            }
        }

        sendEmailNotification(ownerId, title, body);
        return id;
    } catch (e) {
        console.error('❌ Lỗi tạo thông báo:', e.message);
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
// API: ĐĂNG KÝ MỚI TỪ LANDING PAGE (public + admin mgmt)
// ======================================
app.post('/api/register-request', async (req, res) => {
    try {
        const { plan, transactionCode } = req.body;
        if (!transactionCode) {
            return res.status(400).json({ error: 'Thiếu mã giao dịch' });
        }
        // Lưu vào DB (dùng transactionCode làm name, email/phone để trống '-').
        const reqId = await db.createRegRequest({ name: transactionCode, email: '-', phone: '-', plan });
        
        // Gửi thông báo cho superadmin
        const allUsers = await db.getAllUsers();
        const superAdmin = allUsers.find(u => u.role === 'superadmin');
        if (superAdmin) {
            await createNotification({
                ownerId: superAdmin.id,
                custId: reqId,
                title: '🆕 Yêu cầu đăng ký tài khoản mới',
                body: `Mã GD: ${transactionCode}\n📦 ${plan || 'Chưa chọn gói'}\n→ Bấm "Phê duyệt" để cấp mã.`
            });
        }
        broadcast('reg_requests_changed');
        res.json({ success: true, transactionCode });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Khách hàng: Kiểm tra trạng thái yêu cầu
app.get('/api/register-request/status/:transactionCode', async (req, res) => {
    try {
        const req_data = await db.getRegRequests();
        const regReq = req_data.find(r => r.name === req.params.transactionCode);
        if (!regReq) return res.status(404).json({ error: 'Không tìm thấy' });
        
        if (regReq.status === 'sent') {
            return res.json({ status: 'sent', inviteCode: regReq.inviteCode || '' });
        } else if (regReq.status === 'rejected') {
            return res.json({ status: 'rejected' });
        }
        return res.json({ status: 'pending' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Lấy danh sách yêu cầu đăng ký
app.get('/api/register-request', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const status = req.query.status || null;
        res.json(await db.getRegRequests(status));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Phê duyệt và tự động gửi email mã mời
app.post('/api/register-request/:id/approve', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const req_data = await db.getRegRequests();
        const regReq = req_data.find(r => r.id === req.params.id);
        if (!regReq) return res.status(404).json({ error: 'Không tìm thấy yêu cầu' });
        if (regReq.status !== 'pending') return res.status(400).json({ error: 'Yêu cầu đã được xử lý' });

        // Tạo mã mời duy nhất
        const inviteCode = 'AI-' + Math.random().toString(36).substring(2, 8).toUpperCase();

        // Gửi email cho khách (chỉ nếu có email)
        let emailSent = false;
        if (regReq.email && regReq.email !== '-') {
            try {
                emailSent = await sendInviteCodeEmail({
                    toEmail: regReq.email,
                    toName: regReq.name,
                    inviteCode,
                    plan: regReq.plan
                });
            } catch (mailErr) {
                console.error('❌ Lỗi gửi email:', mailErr.message);
            }
        }

        // Cập nhật trạng thái và lưu mã mời vào yêu cầu
        await db.updateRegRequestInviteCode(req.params.id, inviteCode);
        broadcast('reg_requests_changed');

        res.json({
            success: true,
            emailSent,
            inviteCode,
            message: emailSent
                ? `✅ Đã phê duyệt và gửi mã mời tới ${regReq.email}`
                : `✅ Đã phê duyệt mã giao dịch ${regReq.name}. Khách sẽ nhận mã trên màn hình đăng ký.`
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Cập nhật trạng thái (sent / rejected) — dùng cho từ chối
app.patch('/api/register-request/:id', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const result = await db.updateRegRequestStatus(req.params.id, req.body.status);
        if (!result) return res.status(404).json({ error: 'Không tìm thấy' });
        broadcast('reg_requests_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Xóa yêu cầu
app.delete('/api/register-request/:id', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        await db.deleteRegRequest(req.params.id);
        broadcast('reg_requests_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

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
        // Tìm yêu cầu đăng ký bằng mã mời
        const regReq = await db.getRegRequestByInviteCode(inviteCode);
        if (!regReq || regReq.status !== 'sent') {
            return res.status(403).json({ error: 'Mã xác nhận bảo mật không hợp lệ hoặc đã được sử dụng' });
        }

        const result = await db.createUser({ fullName, email, password, role: 'admin', plan: regReq.plan });
        if (result.error) return res.status(400).json({ error: result.error });

        // Đánh dấu mã đã sử dụng
        await db.updateRegRequestStatus(regReq.id, 'used');
        broadcast('invite_code_changed');

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
// API: ACCOUNT STATUS & RENEWAL (Gia Hạn)
// ======================================
app.get('/api/account/status', authMiddleware, async (req, res) => {
    try {
        const status = await db.getAccountStatus(req.user.id);
        if (!status) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
        res.json(status);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
        
        // Kích người dùng bị xóa ra khỏi hệ thống ngay lập tức
        broadcast('force_logout', { userId: req.params.id });
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
            // Superadmin: mặc định xem của mình, hoặc xem của người khác nếu có ownerId
            const ownerId = req.query.ownerId || req.user.id;
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
        // Kiểm tra giới hạn khách hàng theo gói (Gói cơ bản: max 200)
        if (req.user.plan && req.user.plan.includes('cơ bản')) {
            const currentCustomers = await db.getAllCustomers(req.user.id);
            if (currentCustomers.length >= 200) {
                return res.status(403).json({ error: 'Gói Cơ bản chỉ cho phép quản lý tối đa 200 khách hàng. Vui lòng nâng cấp lên Gói Pro để sử dụng không giới hạn!' });
            }
        }

        // Kiểm tra trùng email cho cùng một chủ sở hữu
        if (req.body.email) {
            const existing = await db.getCustomerByEmail(req.body.email.trim(), req.user.id);
            if (existing) {
                return res.status(400).json({ error: `Email "${req.body.email}" đã tồn tại trong hệ thống của bạn. Vui lòng kiểm tra lại!` });
            }
        }

        // Tự động gán ownerId = người đang đăng nhập
        req.body.ownerId = req.user.id;
        const id = await db.addCustomer(req.body);
        
        // Gửi thông báo
        await createNotification({
            ownerId: req.user.id,
            title: '👤 Thêm khách hàng mới',
            body: `Tên: ${req.body.name}\nEmail: ${req.body.email || '-'}\nDịch vụ: ${req.body.service || '-'}`
        });

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

        // Kiểm tra trùng email nếu email thay đổi
        if (req.body.email && req.body.email.trim().toLowerCase() !== (customer.email || '').toLowerCase()) {
            const existing = await db.getCustomerByEmail(req.body.email.trim(), req.user.id);
            if (existing && existing.id !== req.params.id) {
                return res.status(400).json({ error: `Email "${req.body.email}" đã được sử dụng bởi một khách hàng khác trong danh sách của bạn!` });
            }
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

app.get('/api/settings/voice', authMiddleware, async (req, res) => {
    let enabled = await db.getSetting('voice_enabled');
    if (enabled === null) enabled = 'false'; // Mặc định tắt để đảm bảo ổn định
    res.json({ enabled: enabled === 'true' });
});

app.post('/api/settings/voice', authMiddleware, requireRole('superadmin', 'admin'), async (req, res) => {
    await db.setSetting('voice_enabled', req.body.enabled ? 'true' : 'false');
    broadcast('voice_settings_changed', { enabled: !!req.body.enabled });
    res.json({ success: true });
});

app.get('/api/settings/voice/custom', authMiddleware, async (req, res) => {
    let audioData = await db.getSetting('voice_custom_audio');
    res.json({ audioData: audioData || null });
});

app.post('/api/settings/voice/custom', authMiddleware, requireRole('superadmin', 'admin'), async (req, res) => {
    await db.setSetting('voice_custom_audio', req.body.audioData || ''); // empty string effectively removes it
    broadcast('voice_settings_changed');
    res.json({ success: true });
});

// API: System Announcement
app.get('/api/settings/announcement', async (req, res) => {
    try {
        res.json({
            content: await db.getSetting('system_announcement') || 'Chào mừng bạn đến với hệ thống quản lý AISHOP!',
            updatedAt: await db.getSetting('system_announcement_time') || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/announcement', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const { content } = req.body;
        await db.setSetting('system_announcement', content || '');
        await db.setSetting('system_announcement_time', new Date().toLocaleString('vi-VN'));
        broadcast('announcement_changed');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Database Info (chỉ superadmin)

// ======================================
// API: RENEWAL SETTINGS (Cấu hình thanh toán)
// ======================================
app.get('/api/settings/renewal', async (req, res) => {
    try {
        res.json({
            bankName: await db.getSetting('renewal_bank_name') || '',
            accountNumber: await db.getSetting('renewal_account_number') || '',
            accountHolder: await db.getSetting('renewal_account_holder') || '',
            amount: await db.getSetting('renewal_amount') || '',
            transferNote: await db.getSetting('renewal_transfer_note') || '',
            qrImage: await db.getSetting('renewal_qr_image') || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/renewal', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const { bankName, accountNumber, accountHolder, amount, transferNote, qrImage } = req.body;
        await db.setSetting('renewal_bank_name', bankName || '');
        await db.setSetting('renewal_account_number', accountNumber || '');
        await db.setSetting('renewal_account_holder', accountHolder || '');
        await db.setSetting('renewal_amount', amount || '');
        await db.setSetting('renewal_transfer_note', transferNote || '');
        if (qrImage !== undefined) await db.setSetting('renewal_qr_image', qrImage || '');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Facebook Webhook Settings
app.get('/api/settings/facebook', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        res.json({
            verifyToken: await db.getSetting('fb_verify_token') || '',
            accessToken: await db.getSetting('fb_access_token') || ''
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/facebook', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const { verifyToken, accessToken } = req.body;
        if (verifyToken !== undefined) await db.setSetting('fb_verify_token', verifyToken);
        if (accessToken !== undefined) await db.setSetting('fb_access_token', accessToken);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Telegram & Email Settings Management
app.get('/api/settings/notifications', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        res.json({
            tgBotToken: await db.getSetting(`tg_bot_token_${userId}`) || '',
            tgChatId: await db.getSetting(`tg_chat_id_${userId}`) || '',
            tgEnabled: (await db.getSetting(`tg_enabled_${userId}`)) === 'true',
            emailEnabled: (await db.getSetting(`email_notif_enabled_${userId}`)) === 'true'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings/notifications', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const { tgBotToken, tgChatId, tgEnabled, emailEnabled } = req.body;
        
        if (tgBotToken !== undefined) await db.setSetting(`tg_bot_token_${userId}`, tgBotToken);
        if (tgChatId !== undefined) await db.setSetting(`tg_chat_id_${userId}`, tgChatId);
        if (tgEnabled !== undefined) await db.setSetting(`tg_enabled_${userId}`, tgEnabled ? 'true' : 'false');
        if (emailEnabled !== undefined) await db.setSetting(`email_notif_enabled_${userId}`, emailEnabled ? 'true' : 'false');
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ======================================
// API: PHÊ DUYỆT GIA HẠN
// ======================================
app.post('/api/renewal/request', authMiddleware, async (req, res) => {
    try {
        const { amount, proofImage, transactionRef } = req.body;
        const payload = {
            userId: req.user.id,
            fullName: req.user.fullName,
            email: req.user.email,
            amount,
            proofImage,
            transactionRef: transactionRef || ''
        };
        const id = await db.createRenewalRequest(payload);
        
        // Tạo thông báo cho SuperAdmin
        const superAdmins = await db.getAllUsers();
        const mainAdmin = superAdmins.find(u => u.role === 'superadmin');
        if (mainAdmin) {
            await createNotification({
                ownerId: mainAdmin.id,
                title: '📌 Yêu cầu gia hạn mới',
                body: `Quản trị viên ${req.user.fullName} vừa gửi yêu cầu gia hạn tài khoản.`
            });
        }
        res.status(201).json({ id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Kiểm tra trạng thái yêu cầu gia hạn của chính user
app.get('/api/renewal/my-status', authMiddleware, async (req, res) => {
    try {
        const latest = await db.getUserLatestRenewal(req.user.id);
        res.json(latest || null);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/renewal/pending', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        res.json(await db.getPendingRenewalRequests());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/renewal/history', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        res.json(await db.getRenewalRequestHistory());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/renewal/verify', authMiddleware, requireRole('superadmin'), async (req, res) => {
    try {
        const { id, status } = req.body; // status: 'approved' hoặc 'rejected'
        const reqData = await db.updateRenewalRequestStatus(id, status);
        if (!reqData) return res.status(404).json({ error: 'Không tìm thấy yêu cầu' });
        
        // Thông báo lại cho QTV (reqData chứa đầy đủ thông tin)
        if (reqData) {
            await createNotification({
                ownerId: reqData.userId,
                title: status === 'approved' ? '✅ Gia hạn thành công' : '❌ Gia hạn bị từ chối',
                body: status === 'approved' ? 'Yêu cầu gia hạn của bạn đã được Admin phê duyệt.' : 'Yêu cầu gia hạn của bạn đã bị từ chối. Vui lòng liên hệ Admin.'
            });
        }
        broadcast('users_changed'); // Để cập nhật lại ngày hết hạn trên UI
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
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
            // Superadmin: xem dịch vụ của mình hoặc của người khác
            const ownerId = req.query.ownerId || req.user.id;
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

        // Gửi thông báo
        await createNotification({
            ownerId: req.user.id,
            title: '🛠️ Thêm dịch vụ mới',
            body: `Dịch vụ: ${req.body.name}\nGiá: ${req.body.price} VNĐ`
        });

        broadcast('services_changed');
        res.status(201).json({ id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/services/:id', authMiddleware, async (req, res) => {
    try {
        const service = await db.getService(req.params.id);
        if (!service) return res.status(404).json({ error: 'Not found' });
        if (req.user.role !== 'superadmin' && service.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Không có quyền chỉnh sửa' });
        }
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
        const service = await db.getService(req.params.id);
        if (!service) return res.status(404).json({ error: 'Not found' });
        if (req.user.role !== 'superadmin' && service.ownerId !== req.user.id) {
            return res.status(403).json({ error: 'Không có quyền xóa' });
        }
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
app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const queryOwner = req.user.id;
        res.json(await db.getAllNotifications(queryOwner));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const id = await createNotification({
            ownerId: req.user.id,
            title: req.body.title,
            body: req.body.body,
            custId: req.body.custId
        });
        res.status(201).json({ id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/notifications/read', authMiddleware, async (req, res) => {
    try {
        const queryOwner = req.user.id;
        await db.deleteReadNotifications(queryOwner);
        broadcast('notifications_changed');
        res.json({ success: true });
    } catch (e) {
        console.error('Lỗi khi xoá thông báo:', e);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/notifications/:id', authMiddleware, async (req, res) => {
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

        // Start Telegram Polling
        startTelegramPolling();

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
