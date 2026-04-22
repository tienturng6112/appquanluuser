// ======================================
// CẤU HÌNH API (Node.js Backend)
// ======================================
let API_BASE = window.location.origin + '/api';
if (window.location.protocol === 'file:' || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000') {
    API_BASE = 'http://localhost:3000/api';
}

// ======================================
// CẤU HÌNH EMAILJS
// ======================================
const EMAILJS_PUBLIC_KEY = "YOUR_PUBLIC_KEY_HERE"; // Thay bằng Public Key của bạn
const EMAILJS_SERVICE_ID = "YOUR_SERVICE_ID_HERE"; // Thay bằng Service ID của bạn
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID_HERE"; // Thay bằng Template ID của bạn

// ======================================
// USER STATE
// ======================================
let currentUser = null;
try {
    const userStr = localStorage.getItem('aishop_user');
    if (userStr) currentUser = JSON.parse(userStr);
} catch (e) {
    console.error("Không thể đọc thông tin người dùng", e);
}

// Nếu chưa có user thì chuyển về trang đăng nhập
if (!currentUser) {
    window.location.href = 'login.html';
} else {
    let globalCustomVoiceStr = null;

    window.loadVoiceSettings = async function() {
        try {
            const res = await apiGet('/settings/voice');
            if (res.enabled !== undefined) {
                document.getElementById('voiceToggleCheckbox').checked = res.enabled;
            }
            const customRes = await apiGet('/settings/voice/custom');
            globalCustomVoiceStr = customRes.audioData;
            
            const rmBtn = document.getElementById('removeVoiceBtn');
            if (rmBtn) {
                if (globalCustomVoiceStr) rmBtn.style.display = 'inline-flex';
                else rmBtn.style.display = 'none';
            }
        } catch (e) {
            console.warn("Could not load voice settings", e);
        }
    };

    // THIẾT LẬP GIỌNG CHÀO MỪNG
    window.greetUser = async function(force = false) {
        await window.loadVoiceSettings();
        
        if (!force && sessionStorage.getItem('greeted') === 'true') return;
        
        const isEnabled = document.getElementById('voiceToggleCheckbox').checked;
        if (!isEnabled && !force) {
            sessionStorage.setItem('greeted', 'true');
            return;
        }

        if (globalCustomVoiceStr) {
            const audio = new Audio(globalCustomVoiceStr);
            audio.onplay = () => { sessionStorage.setItem('greeted', 'true'); };
            audio.onerror = (e) => { console.warn("Custom Audio Error", e); };
            audio.play().catch(e => {
                console.warn("Autoplay blocked for custom audio:", e);
            });
            return;
        }

        // Câu chào mặc định
        window._currentUtterance = new SpeechSynthesisUtterance(`Chào mừng quản trị viên đã trở lại`);
        window._currentUtterance.lang = 'vi-VN';
        window._currentUtterance.rate = 1.0;
        
        window._currentUtterance.onstart = () => {
            sessionStorage.setItem('greeted', 'true');
        };
        
        window._currentUtterance.onerror = (e) => {
            console.warn("Speech Synthesis Error:", e);
        };

        window.speechSynthesis.speak(window._currentUtterance);
    }

    window.toggleVoiceSetting = async function() {
        const isChecked = document.getElementById('voiceToggleCheckbox').checked;
        try {
            await apiPost('/settings/voice', { enabled: isChecked });
            showToast('✅ Đã cập nhật cài đặt đồng bộ giọng nói toàn hệ thống');
        } catch (e) {
            showToast('❌ Lỗi: ' + e.message);
            document.getElementById('voiceToggleCheckbox').checked = !isChecked; // Restore
        }
    };

    window.uploadCustomVoice = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
             showToast('❌ Lỗi: File quá lớn, vui lòng chọn file dưới 5MB');
             return;
        }

        const reader = new FileReader();
        reader.onload = async function() {
            showToast('⏳ Đang tải lên hệ thống...');
            try {
                await apiPost('/settings/voice/custom', { audioData: reader.result });
                globalCustomVoiceStr = reader.result;
                document.getElementById('removeVoiceBtn').style.display = 'inline-flex';
                showToast('✅ Tải lên giọng nói thành công!');
                document.getElementById('voiceUploadInput').value = '';
                window.greetUser(true);
            } catch (e) {
                showToast('❌ Lỗi tải lên, payload quá lớn? ' + e.message);
            }
        };
        reader.readAsDataURL(file);
    };

    window.removeCustomVoice = async function() {
        if (!await showConfirm("Xóa giọng nói riêng và quay về mặc định của AI?", "Xóa Giọng Nói Riêng", "🗑️", "Xóa Ngay")) return;
        try {
            await apiPost('/settings/voice/custom', { audioData: '' });
            globalCustomVoiceStr = null;
            document.getElementById('removeVoiceBtn').style.display = 'none';
            showToast('✅ Đã xóa giọng nói riêng thành công');
            window.greetUser(true); // Phát AI mặc định
        } catch(e) {
            showToast('❌ Lỗi: ' + e.message);
        }
    };

    // Thử chào ngay khi load
    setTimeout(() => greetUser(false), 800);

    // Xử lý policy của Chrome: bắt buộc phải có thao tác click từ người dùng
    document.addEventListener('click', () => {
        if (sessionStorage.getItem('greeted') !== 'true') {
            greetUser(false);
        }
    });
}

// ======================================
// MOBILE NAVIGATION
// ======================================
window.toggleMobileMenu = function() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if(sidebar) sidebar.classList.toggle('active');
    if(overlay) overlay.classList.toggle('active');
}

if (typeof emailjs !== 'undefined') emailjs.init(EMAILJS_PUBLIC_KEY);

// ======================================
// HỆ THỐNG ÂM THANH
// ======================================
let audioContext = null, bellBuffer = null, audioUnlocked = false, alarmInterval = null, isAlarmSilenced = false;

function createBellBuffer(ctx) {
    const sr = ctx.sampleRate, dur = 1.2, len = sr * dur;
    const buffer = ctx.createBuffer(1, len, sr);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
        const t = i / sr, env = Math.exp(-2.5 * t);
        data[i] = Math.max(-1, Math.min(1, env * (
            0.6 * Math.sin(2 * Math.PI * 830 * t) + 0.35 * Math.sin(2 * Math.PI * 1660 * t) +
            0.2 * Math.sin(2 * Math.PI * 2490 * t) + 0.1 * Math.sin(2 * Math.PI * 3320 * t)
        )));
    }
    return buffer;
}

function initAudioContext() {
    if (audioContext) return;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioContext = new AC();
        bellBuffer = createBellBuffer(audioContext);
        audioUnlocked = true;
    } catch (e) { console.error(e); }
}

function playBellOnce() {
    if (!audioContext || !bellBuffer || !audioUnlocked) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    const src = audioContext.createBufferSource(), g = audioContext.createGain();
    src.buffer = bellBuffer; g.gain.value = 0.8;
    src.connect(g); g.connect(audioContext.destination); src.start(0);
}

function startAlarmLoop() {
    if (alarmInterval) return;
    playBellOnce();
    alarmInterval = setInterval(() => { if (!isAlarmSilenced) playBellOnce(); else stopAlarmLoop(); }, 2500);
}

function stopAlarmLoop() { if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null; } }

document.addEventListener('click', function unlockAudio() {
    initAudioContext();
    if (cachedNotifications.filter(n => !n.isRead).length > 0 && !isAlarmSilenced) startAlarmLoop();
    document.removeEventListener('click', unlockAudio);
}, { once: true });

// ======================================
// CACHE (API → RAM → render nhanh)
// ======================================
let cachedCustomers = [], cachedPersonnel = [], cachedNotifications = [], cachedServices = [];
let currentFilterService = '', currentView = 'home';

// Multi-tenant: đang xem khách hàng của ai
let viewingOwnerId = null; // null = xem của mình, string = xem của admin khác
let viewingOwnerName = '';

// DOM
const tableBody = document.getElementById('tableBody');
const adminTableBody = document.getElementById('adminTableBody');
const searchInput = document.getElementById('searchInput');
const emptyState = document.getElementById('emptyState');
const emptyAdminState = document.getElementById('emptyAdminState');
const customerTable = document.getElementById('customerTable');
const adminTable = document.getElementById('adminTable');
const expiringBadge = document.getElementById('expiringBadge');
const mainTitle = document.getElementById('mainTitle');
const customModal = document.getElementById('customModal');
const adminModal = document.getElementById('adminModal');
const serviceModal = document.getElementById('serviceModal');
const serviceTableBody = document.getElementById('serviceTableBody');
const serviceTable = document.getElementById('serviceTable');
const emptyServiceState = document.getElementById('emptyServiceState');

const serviceIcons = {
    "ChatGPT Plus": '<i class="ph ph-robot" style="color:#10a37f"></i>',
    "Adobe Creative Cloud": '<i class="ph ph-swatches" style="color:#ff0000"></i>',
    "Canva Pro": '<i class="ph ph-paint-brush-broad" style="color:#00c4cc"></i>',
    "Netflix Premium": '<i class="ph ph-video-camera" style="color:#e50914"></i>',
    "Midjourney": '<i class="ph ph-sailboat" style="color:#ffffff"></i>',
    "Khác": '<i class="ph ph-atom" style="color:var(--text-muted)"></i>'
};

// ======================================
// API HELPERS (thay thế Firestore CRUD)
// ======================================
function getHeaders() {
    const token = localStorage.getItem('aishop_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers: getHeaders() });
    if (!res.ok) {
        let msg = res.status;
        try { const data = await res.json(); if (data.error) msg = data.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

async function apiPost(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        let msg = res.status;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

async function apiPut(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) {
        let msg = res.status;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(`${API_BASE}${path}`, { 
        method: 'DELETE',
        headers: getHeaders()
    });
    if (!res.ok) {
        let msg = res.status;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

// ======================================
// CRUD WRAPPERS (giữ nguyên tên hàm cũ)
// ======================================
async function fsAddCustomer(data, isSilent = false) {
    try { const r = await apiPost('/customers', data); if(!isSilent) showToast('✅ Đã lưu khách hàng!'); return r.id; }
    catch (e) { if(!isSilent) showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsUpdateCustomer(id, data) {
    try { await apiPut(`/customers/${id}`, data); }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsDeleteCustomer(id) {
    try { await apiDelete(`/customers/${id}`); showToast('🗑️ Đã xóa khách hàng.'); }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsAddUser(data) {
    try { const r = await apiPost('/users', data); showToast('✅ Đã lưu Nhân Sự!'); return r.id; }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsUpdateUser(id, data) {
    try { await apiPut(`/users/${id}`, data); showToast('✅ Đã cập nhật Nhân Sự!'); }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsDeleteUser(id) {
    try { await apiDelete(`/users/${id}`); showToast('🗑️ Đã xóa Nhân Sự.'); }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsAddNotification(data) {
    try { await apiPost('/notifications', data); }
    catch (e) { console.error(e); }
}
async function fsUpdateNotification(id, data) {
    try { await apiPut(`/notifications/${id}`, data); }
    catch (e) { console.error(e); }
}
async function fsDeleteReadNotifications() {
    try { 
        await apiDelete('/notifications/read'); 
        showToast('🗑️ Đã xoá các thông báo đã đọc.');
    }
    catch (e) { 
        showToast('❌ Lỗi xoá thông báo: ' + e.message); 
        console.error(e); 
        throw e;
    }
}
async function fsAddService(data) {
    try { const r = await apiPost('/services', data); showToast('✅ Đã lưu Dịch Vụ!'); return r.id; }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsUpdateService(id, data) {
    try { await apiPut(`/services/${id}`, data); showToast('✅ Đã cập nhật Dịch Vụ!'); }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}
async function fsDeleteService(id) {
    try { await apiDelete(`/services/${id}`); showToast('🗑️ Đã xóa Dịch Vụ.'); }
    catch (e) { showToast('❌ Lỗi: ' + e.message); console.error(e); throw e; }
}

// ======================================
// SSE REAL-TIME (thay thế onSnapshot)
// Smart reconnect cho Render free tier
// ======================================
let sseInstance = null;
let sseRetryDelay = 1000; // Bắt đầu 1s
const SSE_MAX_DELAY = 30000; // Tối đa 30s
const SSE_RESET_DELAY = 1000; // Reset về 1s khi kết nối thành công

function setupSSE() {
    if (sseInstance) {
        sseInstance.close();
        sseInstance = null;
    }

    try {
        sseInstance = new EventSource(`${API_BASE}/events`);
    } catch (e) {
        console.warn('SSE không khả dụng, dùng polling thay thế');
        startPolling();
        return;
    }

    sseInstance.onopen = () => {
        console.log('✅ SSE connected');
        sseRetryDelay = SSE_RESET_DELAY; // Reset delay khi kết nối thành công
    };

    sseInstance.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'voice_settings_changed') {
                if (window.loadVoiceSettings) window.loadVoiceSettings();
            }
            if (msg.type === 'invite_code_changed') {
                if (typeof fetchInviteCode === 'function') fetchInviteCode();
            }
            if (msg.type === 'customers_changed') {
                await reloadCustomers();
                if (currentView !== 'admins' && currentView !== 'services') renderTable(searchInput.value);
                if (currentView === 'services') renderServices();
                updateExpiringBadge();
            }
            if (msg.type === 'users_changed') {
                cachedPersonnel = await apiGet('/users');
                updateAdminSelects();
                if (currentView === 'admins') renderPersonnel();
                updateStatCards();
            }
            if (msg.type === 'services_changed') {
                await reloadServices();
                buildServiceSidebar();
                updateServiceSelects();
                if (currentView === 'services') renderServices();
                updateStatCards();
            }
            if (msg.type === 'notifications_changed') {
                cachedNotifications = await apiGet('/notifications');
                renderNotifications();
            }
            if (msg.type === 'reg_requests_changed') {
                if (currentView === 'settings') loadRegRequests();
            }
        } catch (e) { console.error('SSE message error:', e); }
    };

    sseInstance.onerror = () => {
        // Đóng kết nối lỗi, tự reconnect sau delay (exponential backoff)
        if (sseInstance) sseInstance.close();
        sseInstance = null;
        console.warn(`⚠ SSE mất kết nối, thử lại sau ${sseRetryDelay / 1000}s...`);
        setTimeout(() => setupSSE(), sseRetryDelay);
        sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_MAX_DELAY);
    };
}

// Fallback polling khi SSE không hoạt động (mỗi 30s)
let pollingTimer = null;
function startPolling() {
    if (pollingTimer) return;
    pollingTimer = setInterval(async () => {
        try {
            cachedCustomers = await apiGet('/customers');
            cachedPersonnel = await apiGet('/users');
            cachedServices = await apiGet('/services');
            cachedNotifications = await apiGet('/notifications');
            renderTable(searchInput.value);
            updateStatCards();
            renderNotifications();
        } catch (e) { /* Server đang ngủ, bỏ qua */ }
    }, 30000);
}

// ======================================
// MULTI-TENANT: Xem khách hàng theo chủ sở hữu
// ======================================
async function reloadCustomers() {
    const params = viewingOwnerId ? `?ownerId=${viewingOwnerId}` : '';
    cachedCustomers = await apiGet(`/customers${params}`);
}

async function reloadServices() {
    const params = viewingOwnerId ? `?ownerId=${viewingOwnerId}` : '';
    cachedServices = await apiGet(`/services${params}`);
}

// Superadmin click vào QTV để xem khách hàng của họ
window.viewAdminCustomers = async function(adminId, adminName) {
    viewingOwnerId = adminId;
    viewingOwnerName = adminName;
    
    showToast(`⏳ Đang tải dữ liệu của ${adminName}...`);
    await reloadCustomers();
    await reloadServices();
    
    // Chuyển sang view khách hàng
    currentView = 'home';
    currentFilterService = '';
    document.getElementById('viewCustomers').classList.add('active');
    document.getElementById('viewAdmins').classList.remove('active');
    document.getElementById('viewServices').classList.remove('active');
    
    mainTitle.innerHTML = `<i class="ph ph-arrow-left" style="cursor:pointer;margin-right:8px;" onclick="backToMyCustomers()" title="Quay lại"></i> Khách hàng của: <span style="color:var(--primary)">${adminName}</span>`;
    
    renderTable(searchInput.value);
    updateExpiringBadge();
    updateStatCards();
    showToast(`✅ Đang xem ${cachedCustomers.length} khách hàng của ${adminName}`);
}

// Quay về xem khách hàng của mình
window.backToMyCustomers = async function() {
    viewingOwnerId = null;
    viewingOwnerName = '';
    
    await reloadCustomers();
    await reloadServices();
    mainTitle.textContent = 'Tất Cả Khách Hàng';
    renderTable(searchInput.value);
    updateExpiringBadge();
    updateStatCards();
    showToast('✅ Đã quay về khách hàng của bạn');
}

// ======================================
// HELPERS
// ======================================
function calculateDaysLeft(endDateStr) {
    const today = new Date(); today.setHours(0,0,0,0);
    const end = new Date(endDateStr); end.setHours(0,0,0,0);
    return Math.ceil((end - today) / 86400000);
}

function formatDate(s) {
    if (!s) return '';
    const p = s.split('-');
    if (p.length < 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}`;
}

function formatCurrency(v) {
    if (!v) return '0';
    let val = v.toString().replace(/\D/g, "");
    return val.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ======================================
// VIEW & NAV
// ======================================
window.switchView = function (view, el) {
    document.querySelectorAll('.nav-links > li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.submenu li').forEach(li => li.classList.remove('active'));
    if (el) el.classList.add('active');
    
    // Auto-close mobile menu
    if (window.innerWidth <= 1024) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar.classList.contains('active')) {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        }
    }
    document.getElementById('viewCustomers').classList.remove('active');
    document.getElementById('viewAdmins').classList.remove('active');
    document.getElementById('viewServices').classList.remove('active');
    document.getElementById('viewRevenue').classList.remove('active');
    
    // Add viewSettings removal check safely
    const viewSettingsNode = document.getElementById('viewSettings');
    if (viewSettingsNode) viewSettingsNode.classList.remove('active');

    currentView = view;
    if (view === 'admins') { document.getElementById('viewAdmins').classList.add('active'); renderPersonnel(); }
    else if (view === 'services') { document.getElementById('viewServices').classList.add('active'); renderServices(); }
    else if (view === 'revenue') { document.getElementById('viewRevenue').classList.add('active'); renderRevenue(); }
    else if (view === 'settings') { if (viewSettingsNode) viewSettingsNode.classList.add('active'); loadRegRequests(); loadRenewalSettingsForm(); }
    else {
        document.getElementById('viewCustomers').classList.add('active');
        currentFilterService = '';
        // Reset về khách hàng của mình khi chuyển view
        if (viewingOwnerId) backToMyCustomers();
        if (view === 'home') mainTitle.textContent = "Tất Cả Khách Hàng";
        if (view === 'expiring') mainTitle.textContent = "Tài Khoản Gần Hết Hạn (<5 Ngày)";
        renderTable(searchInput.value);
    }
}

window.toggleSubmenu = function (id) {
    const m = document.getElementById(id), li = m.previousElementSibling;
    m.classList.toggle('open'); li.classList.toggle('open');
}

window.filterByService = function (svc, el) {
    document.querySelectorAll('.nav-links > li').forEach(li => li.classList.remove('active'));
    document.querySelectorAll('.submenu li').forEach(li => li.classList.remove('active'));
    el.parentElement.previousElementSibling.classList.add('active');
    el.classList.add('active');
    switchView('home', null);
    currentFilterService = svc;
    mainTitle.textContent = svc === '' ? "Tất Cả Khách Hàng" : `Dịch Vụ: ${svc}`;
    renderTable(searchInput.value);
}

// ======================================
// RENDERING (từ cache)
// ======================================
function renderTable(searchTerm = '') {
    tableBody.innerHTML = '';
    let filtered = cachedCustomers.filter(c =>
        c.phone.includes(searchTerm) || c.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    if (currentFilterService) filtered = filtered.filter(c => c.service === currentFilterService);
    if (currentView === 'expiring') filtered = filtered.filter(c => calculateDaysLeft(c.endDate) <= 5);

    if (!filtered.length) { customerTable.style.display = 'none'; emptyState.style.display = 'flex'; return; }
    customerTable.style.display = 'table'; emptyState.style.display = 'none';

    filtered.forEach(c => {
        const dl = calculateDaysLeft(c.endDate), exp = dl <= 5;
        const admin = cachedPersonnel.find(a => a.id == c.adminId);
        const aName = admin ? admin.fullName : "N/A", aEmail = admin ? admin.email : "";
        const svcIcon = getServiceIcon(c.service);

        let badge = '';
        if (dl < 0) badge = `<span class="badge danger">Đã hết hạn (${Math.abs(dl)} ngày trước)</span>`;
        else if (dl <= 5) badge = `<span class="badge warning">Sắp hết hạn (Còn ${dl} ngày)</span>`;
        else badge = `<span class="badge safe">Đang hoạt động (Còn ${dl} ngày)</span>`;

        const tr = document.createElement('tr');
        if (exp) tr.className = 'expiring-soon';

        let mailBtn = '';
        if (exp && aEmail) {
            const subj = encodeURIComponent(`[Cảnh Báo] Khách hàng ${c.name} sắp hết hạn dịch vụ`);
            const body = encodeURIComponent(`Chào ${aName},\n\nKhách hàng ${c.name} (SĐT: ${c.phone}) (Dịch vụ ${c.service}) đang còn <= 5 ngày.\n\nVui lòng hỗ trợ!`);
            mailBtn = `<a href="mailto:${aEmail}?subject=${subj}&body=${body}" target="_blank" class="btn-icon mail" title="Gửi mail"><i class="ph ph-envelope-simple"></i></a>`;
        }

        let actionBtns = '';
        actionBtns += `<button class="btn-icon" onclick="editCustomer('${c.id}')" title="Sửa"><i class="ph ph-pencil-simple"></i></button>
                       <button class="btn-icon delete" onclick="deleteCustomer('${c.id}')" title="Xoá"><i class="ph ph-trash"></i></button>`;

        tr.innerHTML = `
            <td title="${c.name} — ${c.service}"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;">${c.name}</div><div style="font-size:0.75rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;">${svcIcon} ${c.service}</div></td>
            <td title="${c.phone}">${c.phone}</td>
            ${currentUser && currentUser.role === 'superadmin' ? `<td title="${aName}"><div style="display:flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;"><i class="ph ph-identification-card"></i>${aName}</div></td>` : ''}
            <td style="font-weight: bold; color: var(--primary-lighter);">${formatCurrency(c.price)}</td>
            <td title="${c.email}" style="overflow:hidden;text-overflow:ellipsis;">${c.email}</td>
            <td><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:0.85rem;">••••••</span><i class="ph ph-copy btn-icon" title="Sao chép" onclick="copyText('${c.password}')" style="font-size:1rem;"></i></div></td>
            <td>${formatDate(c.startDate)}</td>
            <td>${formatDate(c.endDate)}</td>
            <td style="white-space:normal;">${badge}</td>
            <td class="action-btns">${mailBtn}
                ${actionBtns}
            </td>`;
        tableBody.appendChild(tr);
    });
}

function renderPersonnel() {
    adminTableBody.innerHTML = '';
    if (!cachedPersonnel.length) { adminTable.style.display = 'none'; emptyAdminState.style.display = 'flex'; return; }
    adminTable.style.display = 'table'; emptyAdminState.style.display = 'none';
    cachedPersonnel.forEach(a => {
        const tr = document.createElement('tr');
        let roleLabel = '';
        if (a.role === 'superadmin') roleLabel = '<span class="badge" style="background:var(--primary); color:white;">Admin (Tổng)</span>';
        else if (a.role === 'admin') roleLabel = '<span class="badge warning">Quản Trị Viên</span>';
        else roleLabel = '<span class="badge safe">Nhân Viên</span>';
        // Tính toán hạn sử dụng
        let expiryDisplay = '<span style="color:var(--text-muted)">-</span>';
        if (a.role !== 'superadmin' && a.accountExpiry) {
            const today = new Date(); today.setHours(0,0,0,0);
            const exp = new Date(a.accountExpiry); exp.setHours(0,0,0,0);
            const dl = Math.ceil((exp - today) / 86400000);
            
            if (dl < 0) expiryDisplay = `<span class="badge danger">Hết hạn (${Math.abs(dl)} ngày)</span>`;
            else if (dl === 0) expiryDisplay = `<span class="badge danger">Hết hạn hôm nay</span>`;
            else if (dl <= 5) expiryDisplay = `<span class="badge warning">Còn ${dl} ngày</span>`;
            else expiryDisplay = `<span class="badge safe">Còn ${dl} ngày</span>`;
        } else if (a.role === 'superadmin') {
            expiryDisplay = '<span class="badge" style="background:rgba(255,255,255,0.05); color:var(--text-muted);">Vô thời hạn</span>';
        }

        const viewCustBtn = (currentUser && currentUser.role === 'superadmin') ? `<button class="btn-icon" onclick="viewAdminCustomers('${a.id}', '${a.fullName}')" title="Xem khách hàng"><i class="ph ph-eye"></i></button>` : '';

        tr.innerHTML = `
            <td>${roleLabel}</td>
            <td><strong>${a.fullName}</strong></td>
            <td>${a.email}</td>
            <td>${expiryDisplay}</td>
            <td class="action-btns">
                ${viewCustBtn}
                <button class="btn-icon" onclick="editUser('${a.id}')" title="Sửa"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" onclick="deleteUser('${a.id}')" title="Xoá"><i class="ph ph-trash"></i></button>
            </td>`;
        adminTableBody.appendChild(tr);
    });
}

function updateAdminSelects() {
    document.getElementById('custAdmin').innerHTML = cachedPersonnel.map(a => `<option value="${a.id}">${a.fullName} (${a.role === 'admin' ? 'QTV' : 'NV'})</option>`).join('');
}

function updateServiceSelects() {
    document.getElementById('custService').innerHTML = cachedServices.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
}

function getServiceIcon(serviceName) {
    const svc = cachedServices.find(s => s.name === serviceName);
    if (svc) return `<i class="ph ${svc.icon}" style="color:${svc.color}"></i>`;
    return `<i class="ph ph-cube" style="color:var(--text-muted)"></i>`;
}

function buildServiceSidebar() {
    const submenu = document.getElementById('serviceSubmenu');
    if (!submenu) return;
    let html = `<li onclick="filterByService('', this)"><i class="ph ph-list-bullets"></i> Mọi Dịch Vụ</li>`;
    cachedServices.forEach(s => {
        html += `<li onclick="filterByService('${s.name}', this)"><i class="ph ${s.icon}" style="color:${s.color}"></i> ${s.name}</li>`;
    });
    submenu.innerHTML = html;
}

function renderServices() {
    serviceTableBody.innerHTML = '';
    if (!cachedServices.length) { serviceTable.style.display = 'none'; emptyServiceState.style.display = 'flex'; return; }
    serviceTable.style.display = 'table'; emptyServiceState.style.display = 'none';
    cachedServices.forEach(s => {
        const cnt = cachedCustomers.filter(c => c.service === s.name).length;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="service-icon-preview"><i class="ph ${s.icon}" style="color:${s.color}; font-size:1.5rem;"></i></div></td>
            <td><strong>${s.name}</strong></td>
            <td><div style="display:flex;align-items:center;gap:8px;"><span class="service-color-swatch" style="background:${s.color};"></span><span style="color:var(--text-muted);font-size:0.85rem;">${s.color}</span></div></td>
            <td>${cnt} khách hàng</td>
            <td class="action-btns">
                <button class="btn-icon" onclick="editService('${s.id}')" title="Sửa"><i class="ph ph-pencil-simple"></i></button>
                <button class="btn-icon delete" onclick="deleteService('${s.id}')" title="Xoá"><i class="ph ph-trash"></i></button>
            </td>`;
        serviceTableBody.appendChild(tr);
    });
}

window.copyText = function (t) { navigator.clipboard.writeText(t).then(() => alert("Đã sao chép: " + t)); }

// ======================================
// CUSTOM CONFIRM DIALOG
// ======================================
function showConfirm(message, title = 'Xác nhận', icon = '⚠️', btnText = 'Xác nhận') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const okBtn = document.getElementById('confirmOkBtn');
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmIcon').textContent = icon;
        okBtn.textContent = btnText;
        modal.classList.add('active');

        const cancelBtn = document.getElementById('confirmCancelBtn');

        function cleanup() {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        }

        function onOk() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

// ======================================
// NOTIFICATION CENTER
// ======================================
function processAutomatedEmails() {
    cachedCustomers.forEach(async c => {
        const dl = calculateDaysLeft(c.endDate);
        if (dl <= 5 && !c.isEmailSent) {
            const admin = cachedPersonnel.find(a => a.id == c.adminId);
            if (admin && admin.email && EMAILJS_PUBLIC_KEY !== "YOUR_PUBLIC_KEY_HERE" && EMAILJS_PUBLIC_KEY !== "admin") {
                try {
                    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                        to_email: admin.email, admin_name: admin.fullName,
                        customer_name: c.name, customer_service: c.service, days_left: dl
                    });
                } catch (e) { console.error(e); }
            }
            await fsUpdateCustomer(c.id, { isEmailSent: true });
        }
    });
}

window.toggleNotifDropdown = function () {
    document.getElementById('notifDropdown').classList.toggle('show');
    isAlarmSilenced = true; stopAlarmLoop();
}

window.markNotifAsRead = async function (docId) { await fsUpdateNotification(docId, { isRead: true }); }
window.clearReadNotifications = async function () {
    const hasRead = cachedNotifications.some(n => n.isRead);
    if (!hasRead) {
        showToast('ℹ️ Không có thông báo nào đã đọc để xoá.');
        return;
    }
    await fsDeleteReadNotifications();
}

document.addEventListener('click', e => {
    const w = document.querySelector('.notif-wrapper'), d = document.getElementById('notifDropdown');
    if (w && d && !w.contains(e.target)) d.classList.remove('show');
});

function renderNotifications() {
    const badge = document.getElementById('bellBadge'), list = document.getElementById('notifList');
    const unread = cachedNotifications.filter(n => !n.isRead).length;
    if (unread > 0) { badge.style.display = 'inline-block'; badge.textContent = unread; badge.classList.add('pulse'); }
    else { badge.style.display = 'none'; badge.classList.remove('pulse'); stopAlarmLoop(); }

    if (!cachedNotifications.length) {
        list.innerHTML = `<div class="notif-empty"><i class="ph ph-bell-slash" style="font-size:2rem;margin-bottom:8px;"></i><br>Chưa có thông báo</div>`;
    } else {
        list.innerHTML = cachedNotifications.sort((a, b) => new Date(b.time) - new Date(a.time)).map(n => {
            const isRegRequest = n.title && n.title.includes('Yêu cầu đăng ký');
            const approveBtn = (isRegRequest && n.custId && currentUser?.role === 'superadmin')
                ? `<button onclick="event.stopPropagation(); quickApproveReg('${n.custId}','${n.id}',this)" style="margin-top:8px;font-size:0.75rem;padding:6px 14px;border-radius:8px;background:linear-gradient(135deg,#3B4FBF,#5B6FDF);color:#fff;border:none;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;gap:5px;"><i class='ph ph-check-circle'></i> Phê duyệt ngay</button>`
                : '';
            return `
            <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="markNotifAsRead('${n.id}')">
                <div class="notif-title">${n.title}</div>
                <div class="notif-body">${n.body}</div>
                <div class="notif-time">${new Date(n.time).toLocaleString('vi-VN')}</div>
                ${approveBtn}
            </div>`;
        }).join('');
    }
}

function updateExpiringBadge() {
    const c = cachedCustomers.filter(x => calculateDaysLeft(x.endDate) <= 5).length;
    if (c > 0) { expiringBadge.style.display = 'inline-block'; expiringBadge.textContent = c; }
    else expiringBadge.style.display = 'none';
    updateStatCards();
}

function updateStatCards() {
    const total = cachedCustomers.length;
    const expiring = cachedCustomers.filter(x => calculateDaysLeft(x.endDate) <= 5).length;
    const active = total - expiring;
    const admins = cachedPersonnel.length;
    const services = cachedServices.length;
    
    animateValue('statTotal', total);
    animateValue('statExpiring', expiring);
    animateValue('statActive', active);
    animateValue('statAdmins', admins);
    animateValue('statServices', services);
}

function animateValue(id, end) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.textContent) || 0;
    if (current === end) return;
    const duration = 400;
    const startTime = performance.now();
    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        el.textContent = Math.round(current + (end - current) * progress);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

async function checkAndGenerateNotifications() {
    let hasNew = false;
    for (const c of cachedCustomers) {
        const dl = calculateDaysLeft(c.endDate);
        if (dl <= 5 && !c.isNotifGenerated) {
            await fsAddNotification({
                custId: c.id, title: `⚠ Cảnh báo: ${c.name}`,
                body: `Dịch vụ ${c.service} ${dl <= 0 ? 'đã hết hạn' : 'chỉ còn ' + dl + ' ngày'}.`,
                time: new Date().toISOString(), isRead: false
            });
            await fsUpdateCustomer(c.id, { isNotifGenerated: true });
            hasNew = true;
        }
    }
    if (hasNew) { isAlarmSilenced = false; if (audioUnlocked) startAlarmLoop(); }
}

window.showToast = function (msg) {
    const c = document.getElementById('toastContainer'), t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="ph ph-bell-ringing" style="font-size:24px;"></i> <div>${msg}</div>`;
    c.appendChild(t);
    setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 5000);
}

// ======================================
// FORMS: CUSTOMER
// ======================================
// Export Excel (Khách hàng)
document.getElementById('exportExcelBtn').addEventListener('click', () => {
    if (!cachedCustomers.length) return showToast("⚠️ Không có dữ liệu để xuất");
    
    // Lấy dữ liệu đang hiển thị trên bảng
    const searchTerm = searchInput.value.toLowerCase();
    let filtered = cachedCustomers.filter(c =>
        c.phone.includes(searchTerm) || c.name.toLowerCase().includes(searchTerm)
    );
    if (currentFilterService) filtered = filtered.filter(c => c.service === currentFilterService);
    if (currentView === 'expiring') filtered = filtered.filter(c => calculateDaysLeft(c.endDate) <= 5);

    const data = filtered.map(c => {
        const adminName = cachedPersonnel.find(a => a.id == c.adminId)?.fullName || "N/A";
        const dl = calculateDaysLeft(c.endDate);
        const status = dl < 0 ? "Đã hết hạn" : (dl <= 5 ? "Sắp hết hạn" : "Đang hoạt động");
        
        return {
            "Tên Khách Hàng": c.name,
            "Số Điện Thoại": c.phone,
            "Quản Lý Bởi": adminName,
            "Giá Tiền": formatCurrency(c.price || 0),
            "Dịch Vụ": c.service,
            "Tài Khoản (Email)": c.email,
            "Mật Khẩu": c.password,
            "Ngày Bắt Đầu": formatDate(c.startDate),
            "Ngày Hết Hạn": formatDate(c.endDate),
            "Trạng Thái": status
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    
    // Auto fit columns
    const wscols = [
        {wch: 25}, // Tên
        {wch: 15}, // SĐT
        {wch: 20}, // Quản lý bở
        {wch: 20}, // Dịch vụ
        {wch: 30}, // Email
        {wch: 15}, // Pass
        {wch: 15}, // Start
        {wch: 15}, // End
        {wch: 20}  // Status
    ];
    worksheet['!cols'] = wscols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KhachHang");
    
    const ownerSuffix = viewingOwnerName ? `_${viewingOwnerName}` : '';
    const dateStr = new Date().toISOString().slice(0,10);
    XLSX.writeFile(workbook, `Danh_Sach_Khach_Hang${ownerSuffix}_${dateStr}.xlsx`);
    
    showToast(`✅ Đã xuất ${filtered.length} khách hàng!`);
});

document.getElementById('addBtn').addEventListener('click', () => {
    updateAdminSelects();
    if (currentUser) document.getElementById('custAdmin').value = viewingOwnerId || currentUser.id;
    document.getElementById('modalTitle').textContent = "Thêm Khách Hàng";
    document.getElementById('custStart').value = new Date().toISOString().split('T')[0];
    const nm = new Date(); nm.setMonth(nm.getMonth() + 1);
    document.getElementById('custEnd').value = nm.toISOString().split('T')[0];
    customModal.classList.add('active');
});

document.getElementById('closeModal').addEventListener('click', () => { customModal.classList.remove('active'); document.getElementById('customerForm').reset(); document.getElementById('custId').value = ''; });
document.getElementById('cancelBtn').addEventListener('click', () => { customModal.classList.remove('active'); document.getElementById('customerForm').reset(); document.getElementById('custId').value = ''; });

document.getElementById('customerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('custId').value;
    const data = {
        name: document.getElementById('custName').value,
        phone: document.getElementById('custPhone').value,
        service: document.getElementById('custService').value,
        adminId: document.getElementById('custAdmin').value,
        email: document.getElementById('custEmail').value,
        password: document.getElementById('custPwd').value,
        startDate: document.getElementById('custStart').value,
        endDate: document.getElementById('custEnd').value,
        price: document.getElementById('custPrice').value.replace(/\D/g, ""),
        isEmailSent: false, isNotifGenerated: false
    };
    try {
        if (id) await fsUpdateCustomer(id, data);
        else await fsAddCustomer(data);
        customModal.classList.remove('active');
        document.getElementById('customerForm').reset();
        document.getElementById('custId').value = '';
        setTimeout(() => checkAndGenerateNotifications(), 500);
    } catch (e) { console.error(e); }
});

window.editCustomer = function (docId) {
    updateAdminSelects();
    const c = cachedCustomers.find(x => x.id === docId);
    if (!c) return;
    document.getElementById('custId').value = c.id;
    document.getElementById('custName').value = c.name;
    document.getElementById('custPhone').value = c.phone;
    document.getElementById('custService').value = c.service;
    document.getElementById('custAdmin').value = c.adminId;
    document.getElementById('custEmail').value = c.email;
    document.getElementById('custPwd').value = c.password;
    document.getElementById('custStart').value = c.startDate;
    document.getElementById('custEnd').value = c.endDate;
    document.getElementById('custPrice').value = formatCurrency(c.price || 0);
    document.getElementById('modalTitle').textContent = "Chỉnh Sửa Khách Hàng";
    customModal.classList.add('active');
}

window.deleteCustomer = async function (docId) {
    const ok = await showConfirm('Bạn có chắc muốn xóa khách hàng này?', 'Xóa Khách Hàng', '🗑️', 'Xóa Ngay');
    if (ok) await fsDeleteCustomer(docId);
}

// ======================================
// FORMS: PERSONNEL (Nhân Sự)
// ======================================
document.getElementById('addAdminBtn').addEventListener('click', () => {
    document.getElementById('adminModalTitle').textContent = "Thêm Nhân Sự";
    if (currentUser && currentUser.role === 'superadmin') {
        document.getElementById('roleSelectorCol').style.display = 'block';
    } else {
        document.getElementById('roleSelectorCol').style.display = 'none';
        document.getElementById('adminRole').value = 'staff'; // admin chỉ có thể tạo staff
    }
    adminModal.classList.add('active');
});
document.getElementById('closeAdminModal').addEventListener('click', () => { adminModal.classList.remove('active'); document.getElementById('adminForm').reset(); document.getElementById('adminId').value = ''; });
document.getElementById('cancelAdminBtn').addEventListener('click', () => { adminModal.classList.remove('active'); document.getElementById('adminForm').reset(); document.getElementById('adminId').value = ''; });

document.getElementById('adminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('adminId').value;
    const data = { 
        fullName: document.getElementById('adminName').value, 
        email: document.getElementById('adminEmail').value,
        password: document.getElementById('adminPwd').value,
        role: document.getElementById('adminRole').value
    };
    try {
        if (id) await fsUpdateUser(id, data);
        else await fsAddUser(data);
        adminModal.classList.remove('active');
        document.getElementById('adminForm').reset();
        document.getElementById('adminId').value = '';
    } catch (e) { console.error(e); }
});

window.editUser = function (docId) {
    const a = cachedPersonnel.find(x => x.id === docId);
    if (!a) return;
    document.getElementById('adminId').value = a.id;
    document.getElementById('adminName').value = a.fullName;
    document.getElementById('adminEmail').value = a.email;
    document.getElementById('adminRole').value = a.role || 'staff';
    document.getElementById('adminPwd').value = '';
    
    if (currentUser && currentUser.role === 'superadmin') {
        document.getElementById('roleSelectorCol').style.display = 'block';
    } else {
        document.getElementById('roleSelectorCol').style.display = 'none';
    }
    
    document.getElementById('adminModalTitle').textContent = "Chỉnh Sửa Nhân Sự";
    adminModal.classList.add('active');
}

window.deleteUser = async function (docId) {
    const ok = await showConfirm('Bạn có chắc muốn xóa nhân sự này?', 'Xóa Nhân Sự', '🗑️', 'Xóa Ngay');
    if (ok) await fsDeleteUser(docId);
}

// ======================================
// FORMS: SERVICE
// ======================================
document.getElementById('addServiceBtn').addEventListener('click', () => {
    document.getElementById('serviceModalTitle').textContent = "Thêm Dịch Vụ";
    document.getElementById('serviceForm').reset();
    document.getElementById('serviceId').value = '';
    document.getElementById('serviceColor').value = '#6366f1';
    document.getElementById('serviceColorLabel').textContent = '#6366f1';
    serviceModal.classList.add('active');
});

document.getElementById('closeServiceModal').addEventListener('click', () => {
    serviceModal.classList.remove('active');
    document.getElementById('serviceForm').reset();
    document.getElementById('serviceId').value = '';
});

document.getElementById('cancelServiceBtn').addEventListener('click', () => {
    serviceModal.classList.remove('active');
    document.getElementById('serviceForm').reset();
    document.getElementById('serviceId').value = '';
});

document.getElementById('serviceColor').addEventListener('input', (e) => {
    document.getElementById('serviceColorLabel').textContent = e.target.value;
});

document.getElementById('serviceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('serviceId').value;
    const data = {
        name: document.getElementById('serviceName').value,
        icon: document.getElementById('serviceIcon').value,
        color: document.getElementById('serviceColor').value
    };
    try {
        if (id) await fsUpdateService(id, data);
        else await fsAddService(data);
        serviceModal.classList.remove('active');
        document.getElementById('serviceForm').reset();
        document.getElementById('serviceId').value = '';
    } catch (e) { console.error(e); }
});

window.editService = function (docId) {
    const s = cachedServices.find(x => x.id === docId);
    if (!s) return;
    document.getElementById('serviceId').value = s.id;
    document.getElementById('serviceName').value = s.name;
    document.getElementById('serviceIcon').value = s.icon;
    document.getElementById('serviceColor').value = s.color;
    document.getElementById('serviceColorLabel').textContent = s.color;
    document.getElementById('serviceModalTitle').textContent = "Chỉnh Sửa Dịch Vụ";
    serviceModal.classList.add('active');
}

window.deleteService = async function (docId) {
    const svc = cachedServices.find(x => x.id === docId);
    const custCount = cachedCustomers.filter(c => c.service === (svc ? svc.name : '')).length;
    let msg = 'Bạn có chắc muốn xóa Dịch Vụ này?';
    if (custCount > 0) {
        msg = `Dịch vụ "${svc.name}" đang có ${custCount} khách hàng sử dụng. Bạn có chắc muốn xóa?`;
    }
    const ok = await showConfirm(msg, 'Xóa Dịch Vụ', '🗑️', 'Xóa Ngay');
    if (ok) await fsDeleteService(docId);
}

searchInput.addEventListener('input', (e) => { if (currentView !== 'admins') renderTable(e.target.value); });

// Format giá tiền khi nhập
const priceInput = document.getElementById('custPrice');
if (priceInput) {
    priceInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, "");
        e.target.value = formatCurrency(val);
    });
}
const renewalAmountInput = document.getElementById('renewalAmount');
if (renewalAmountInput) {
    renewalAmountInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, "");
        e.target.value = formatCurrency(val);
    });
}

// ======================================
// PHÂN QUYỀN GIAO DIỆN LUN (UI TRIM)
// ======================================
function applyRolePermissions() {
    if (!currentUser) return;
    
    // Đổi tên tài khoản trên header
    const userNameEl = document.getElementById('userNameHeader');
    if (userNameEl) {
        userNameEl.textContent = currentUser.fullName || 'Người Dùng';
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = async () => {
            const ok = await showConfirm('Bạn có chắc muốn đăng xuất?', 'Đăng Xuất', '🚪', 'Đăng xuất');
            if (ok) {
                const token = localStorage.getItem('aishop_token');
                if (token) {
                    await fetch(`${API_BASE}/auth/logout`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => {});
                }
                localStorage.removeItem('aishop_token');
                localStorage.removeItem('aishop_user');
                sessionStorage.removeItem('greeted');
                window.location.href = 'login.html';
            }
        };
    }
    
    // Ẩn Sidebar Quản lý Nhân sự đối với tất cả trừ superadmin
    if (currentUser.role !== 'superadmin') {
        const navItems = document.querySelectorAll('.nav-links > li');
        navItems.forEach(li => {
            if (li.getAttribute('onclick') === "switchView('admins', this)") li.style.display = 'none';
        });
    }

    if (currentUser.role === 'superadmin') {
        const navSettings = document.getElementById('navSettings');
        if (navSettings) navSettings.style.display = 'block';

        // Hiển thị Mã Mời (ID mới)
        const inviteDiv = document.getElementById('inviteCodeSection');
        if (inviteDiv) inviteDiv.setAttribute('style', 'display: flex !important');
        fetchInviteCode();

        // Hiển thị Cấu hình Thanh toán
        const renewalDiv = document.getElementById('renewalPaymentSettings');
        if (renewalDiv) renewalDiv.setAttribute('style', 'display: flex !important');
        loadRenewalSettingsForm();

        // Hiển thị Yêu Cầu Đăng Ký
        const regReqDiv = document.getElementById('regRequestsSection');
        if (regReqDiv) regReqDiv.setAttribute('style', 'display: flex !important; flex-direction: column;');
        loadRegRequests();
    } else {
        // Quản trị viên (admin) hoặc Nhân viên (staff): ẩn hoàn toàn
        const navSettings = document.getElementById('navSettings');
        if (navSettings) navSettings.style.display = 'none';
        
        const inviteDiv = document.getElementById('inviteCodeSection');
        if (inviteDiv) inviteDiv.style.display = 'none';

        if (currentUser.role === 'admin') {
            // Ẩn các phần nhân sự/số liệu admin cấp trên cho tài khoản quản trị viên
            const adminBtn = document.getElementById('addAdminBtn');
            if (adminBtn) adminBtn.style.display = 'none';
            const statAdmins = document.getElementById('statAdmins');
            if (statAdmins) {
                const card = statAdmins.closest('.stat-card');
                if (card) card.style.display = 'none';
            }
            // const thAdmin = document.getElementById('thAdminColumn');
            // if (thAdmin) thAdmin.style.display = 'none';
        }
    }
}

async function fetchInviteCode() {
    try {
        const token = localStorage.getItem('aishop_token');
        const res = await fetch(`${API_BASE}/settings/invite-code`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data && data.code) document.getElementById('inviteCodeDisplay').textContent = data.code;
    } catch (e) { console.error(e); }
}

window.regenerateInviteCode = async function() {
    if(confirm("Bạn có chắc muốn đổi mã bảo mật? Mã cũ sẽ không còn hiệu lực.")) {
        try {
            const token = localStorage.getItem('aishop_token');
            const res = await fetch(`${API_BASE}/settings/invite-code`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data && data.code) document.getElementById('inviteCodeDisplay').textContent = data.code;
            showToast("✅ Đã đổi mã bảo mật thành công!");
        } catch (e) { console.error(e); }
    }
}

// ======================================
// PROFILE MANAGEMENT
// ======================================
window.openProfileModal = function() {
    if (!currentUser) return;
    document.getElementById('profName').value = currentUser.fullName;
    document.getElementById('profEmail').value = currentUser.email;
    document.getElementById('profPwd').value = '';
    document.getElementById('profileModal').classList.add('active');
}

window.closeProfileModal = function() {
    document.getElementById('profileModal').classList.remove('active');
}

document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    
    const newName = document.getElementById('profName').value;
    const newPwd = document.getElementById('profPwd').value;
    const data = { fullName: newName };
    if (newPwd) data.password = newPwd;
    
    try {
        await apiPut(`/users/${currentUser.id}`, data);
        
        // Update local state
        currentUser.fullName = newName;
        localStorage.setItem('aishop_user', JSON.stringify(currentUser));
        document.getElementById('userNameHeader').textContent = newName;
        
        showToast("✅ Đã cập nhật hồ sơ thành công!");
        closeProfileModal();
    } catch (err) {
        showToast("❌ Lỗi: " + err.message);
    }
});

// ======================================
// EXCEL IMPORT & EXPORT
// ======================================
const templateHeaders = ['Tên khách hàng', 'Số điện thoại', 'Loại Dịch Vụ', 'Email tài khoản', 'Mật khẩu', 'Ngày bắt đầu (YYYY-MM-DD)', 'Ngày hết hạn (YYYY-MM-DD)'];

if (document.getElementById('downloadTemplateBtn')) {
    document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
        const wb = XLSX.utils.book_new();
        const wsData = [
            templateHeaders,
            ['Nguyễn Văn A', '0901234567', 'ChatGPT Plus', 'nguyenvana@gmail.com', '123456', '2026-01-01', '2026-02-01']
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        // Tự động set chiều rộng cột cho đẹp
        ws['!cols'] = [{wch: 20}, {wch: 15}, {wch: 20}, {wch: 25}, {wch: 15}, {wch: 25}, {wch: 25}];
        XLSX.utils.book_append_sheet(wb, ws, "Mau_Nhap");
        XLSX.writeFile(wb, "Mau_Nhap_Khach_Hang.xlsx");
    });
}

if (document.getElementById('importExcelBtn')) {
    document.getElementById('importExcelBtn').addEventListener('click', () => {
        document.getElementById('importExcelInput').click();
    });
}

if (document.getElementById('importExcelInput')) {
    document.getElementById('importExcelInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = evt.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheet = workbook.SheetNames[0];
                const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 });
                
                if (rows.length < 2) {
                    showToast("❌ File Excel trống hoặc thiếu dữ liệu");
                    return;
                }

                showToast(`⏳ Đang xử lý nhập ${rows.length - 1} khách hàng...`);
                let successCount = 0;
                
                for (let i = 1; i < rows.length; i++) {
                    const r = rows[i];
                    if (!r || r.length === 0 || !r[0]) continue; // skip dòng trống
                    
                    const newCustomer = {
                        name: r[0] ? String(r[0]).trim() : '',
                        phone: r[1] ? String(r[1]).trim() : '',
                        service: r[2] ? String(r[2]).trim() : 'Khác',
                        email: r[3] ? String(r[3]).trim() : '',
                        password: r[4] ? String(r[4]).trim() : '',
                        startDate: r[5] ? String(r[5]).trim() : new Date().toISOString().split('T')[0],
                        endDate: r[6] ? String(r[6]).trim() : new Date().toISOString().split('T')[0],
                        adminId: viewingOwnerId || currentUser.id
                    };
                    
                    try {
                        await fsAddCustomer(newCustomer, true); // true: silent/no toast
                        successCount++;
                    } catch (err) {
                        console.error('Lỗi dòng', i, err);
                    }
                }
                
                document.getElementById('importExcelInput').value = '';
                showToast(`✅ Đã nhập thành công ${successCount} khách hàng!`);
                
            } catch (err) {
                console.error(err);
                showToast("❌ Lỗi khi đọc file Excel");
            }
        };
        reader.readAsBinaryString(file);
    });
}



// ======================================
// KHỞI ĐỘNG — có retry cho Render cold start
// ======================================
let initRetries = 0;
const MAX_INIT_RETRIES = 5;

async function init() {
    try {
        if (initRetries === 0) {
            showToast("⏳ Đang kết nối Server...");
        } else {
            showToast(`⏳ Server đang khởi động... (lần ${initRetries})`);
        }

        // Cập nhật lại role và thông tin mới nhất từ server
        try {
            const serverUser = await apiGet('/auth/me');
            if (serverUser && !serverUser.error) {
                currentUser = serverUser;
                localStorage.setItem('aishop_user', JSON.stringify(currentUser));
            }
        } catch (e) { console.warn("Lấy auth/me thất bại", e); }
        
        // Phân quyền sau khi đã cập nhật bộ nhớ
        applyRolePermissions();

        // Kiểm tra trạng thái gia hạn tài khoản (Admin only)
        await checkAccountStatus();

        // Tải dữ liệu ban đầu (auto-filter theo ownership)
        await reloadCustomers();
        await reloadServices();
        cachedPersonnel = await apiGet('/users');
        cachedNotifications = await apiGet('/notifications');

        // Render
        buildServiceSidebar();
        renderTable();
        updateAdminSelects();
        updateServiceSelects();
        initRevenueFilters();
        updateExpiringBadge();
        renderNotifications();
        updateStatCards();
        
        // Cập nhật lại tên nếu DB đã đổi nhưng local chưa đổi
        if (currentUser && currentUser.id) {
            const fresh = cachedPersonnel.find(p => p.id === currentUser.id);
            if (fresh && fresh.fullName !== currentUser.fullName) {
                currentUser.fullName = fresh.fullName;
                localStorage.setItem('aishop_user', JSON.stringify(currentUser));
                document.getElementById('userNameHeader').textContent = fresh.fullName;
            }
        }

        // Kết nối SSE real-time
        setupSSE();

        // Kiểm tra thông báo & email
        setTimeout(() => {
            checkAndGenerateNotifications();
            processAutomatedEmails();
        }, 500);

        initRetries = 0;
        showToast("✅ Kết nối Server thành công!");
    } catch (err) {
        console.error("❌ Lỗi:", err);
        
        // Kiểm tra nếu lỗi 401 (token hết hạn) → chuyển về login
        if (err.message && err.message.includes('401')) {
            localStorage.removeItem('aishop_token');
            localStorage.removeItem('aishop_user');
            window.location.href = 'login.html';
            return;
        }
        
        // Server đang ngủ (Render cold start) → retry
        initRetries++;
        if (initRetries <= MAX_INIT_RETRIES) {
            const delay = Math.min(initRetries * 3000, 15000); // 3s, 6s, 9s, 12s, 15s
            showToast(`⏳ Server đang khởi động... tự thử lại sau ${delay/1000}s`);
            setTimeout(() => init(), delay);
        } else {
            showToast("❌ Không thể kết nối Server. Hãy tải lại trang.");
        }
    }
}

// ======================================
// ACCOUNT RENEWAL SYSTEM (Gia Hạn Tài Khoản)
// ======================================
let accountStatus = null;

async function checkAccountStatus() {
    if (!currentUser) return;
    
    // Nếu là superadmin, cho phép xem danh sách chờ duyệt & lịch sử
    if (currentUser.role === 'superadmin') {
        loadPendingRenewals();
        loadRenewalHistory();
        return;
    }

    try {
        accountStatus = await apiGet('/account/status');
        const renewWrapper = document.getElementById('renewWrapper');
        const renewBtn = document.getElementById('renewBtn');
        const renewDaysEl = document.getElementById('renewDaysText');

        if (renewWrapper) renewWrapper.style.display = 'flex';

        if (accountStatus && accountStatus.daysLeft !== undefined) {
            if (renewDaysEl) {
                renewDaysEl.textContent = accountStatus.daysLeft > 0
                    ? `${accountStatus.daysLeft} ngày`
                    : 'Hết hạn';
            }

            if (accountStatus.isExpired) {
                if (renewBtn) renewBtn.classList.add('urgent');
                const overlay = document.getElementById('expiredOverlay');
                if (overlay) overlay.style.display = 'flex';
            } else if (accountStatus.isExpiring) {
                if (renewBtn) renewBtn.classList.add('urgent');
                showToast(`⚠️ Tài khoản của bạn sắp hết hạn trong ${accountStatus.daysLeft} ngày! Hãy gia hạn sớm.`);
            } else {
                if (renewBtn) renewBtn.classList.remove('urgent');
            }
        }
    } catch (e) {
        console.warn('Không thể kiểm tra trạng thái tài khoản:', e);
    }
}

window.loadPendingRenewals = async function() {
    const list = document.getElementById('renewalRequestList');
    const section = document.getElementById('approvalSection');
    const empty = document.getElementById('emptyApprovalState');
    if (!list || !section) return;

    try {
        const reqs = await apiGet('/renewal/pending');
        section.style.display = 'block';
        
        if (!reqs.length) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        list.innerHTML = reqs.map(r => `
            <div class="glass-panel" style="padding: 16px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <div style="font-weight: 600; font-size: 1.1rem; color: var(--primary-light);">${r.fullName}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">${r.email}</div>
                    </div>
                    <div style="background: var(--warning-bg); color: var(--warning); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">đ ${r.amount}</div>
                </div>
                
                ${r.transactionRef ? `<div style="font-size: 0.85rem; color: var(--primary-lighter);"><strong>Mã GD:</strong> ${r.transactionRef}</div>` : '<div style="font-size: 0.85rem; color: var(--text-muted);">Mã GD: Không có</div>'}
                
                ${r.proofImage ? `<img src="${r.proofImage}" style="width: 100%; border-radius: 8px; cursor: pointer; border: 1px solid rgba(255,255,255,0.1);" onclick="window.open('${r.proofImage}')">` : '<div style="text-align:center; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 8px; font-size: 0.8rem; color: var(--text-muted);">Không có hình ảnh</div>'}
                
                <div style="font-size: 0.75rem; color: var(--text-muted);">Gửi lúc: ${new Date(r.createdAt).toLocaleString('vi-VN')}</div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 5px;">
                    <button class="btn-secondary" onclick="verifyRenewal('${r.id}', 'rejected')" style="padding: 8px; font-size: 0.85rem; color: #f44336; border-color: rgba(244, 67, 54, 0.2);">Từ chối</button>
                    <button class="btn-primary" onclick="verifyRenewal('${r.id}', 'approved')" style="padding: 8px; font-size: 0.85rem;">Phê Duyệt</button>
                </div>
            </div>
        `).join('');
    } catch (e) { console.warn(e); }
}

window.loadRenewalHistory = async function() {
    const list = document.getElementById('renewalHistoryList');
    const section = document.getElementById('approvalHistorySection');
    const empty = document.getElementById('emptyHistoryState');
    const btn = document.getElementById('btnRefreshHistory');
    if (!list || !section) return;

    // Bắt đầu animation quay
    if (btn) {
        btn.classList.add('refreshing');
        btn.disabled = true;
    }

    try {
        const history = await apiGet('/renewal/history');
        section.style.display = 'block';
        
        if (!history || !history.length) {
            list.innerHTML = '';
            empty.style.display = 'block';
        } else {
            empty.style.display = 'none';
            list.innerHTML = history.map(r => {
                const statusLabel = r.status === 'approved' 
                    ? '<span class="badge safe" style="font-size:0.7rem;">Thành công</span>' 
                    : '<span class="badge danger" style="font-size:0.7rem;">Từ chối</span>';
                
                return `
                    <tr>
                        <td style="color:var(--text-muted);">${new Date(r.createdAt).toLocaleString('vi-VN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'})}</td>
                        <td><strong>${r.fullName}</strong></td>
                        <td style="color:var(--warning); font-weight:600;">${r.amount}</td>
                        <td style="font-family:monospace; font-size:0.75rem;">${r.transactionRef || '-'}</td>
                        <td>${statusLabel}</td>
                    </tr>
                `;
            }).join('');
        }

        // Hiển thị trạng thái thành công
        if (btn) {
            btn.classList.remove('refreshing');
            btn.classList.add('refreshed');
            const icon = btn.querySelector('i');
            const label = btn.querySelector('span');
            if (icon) icon.className = 'ph ph-check-circle';
            if (label) label.textContent = 'Đã cập nhật';
            
            setTimeout(() => {
                btn.classList.remove('refreshed');
                if (icon) icon.className = 'ph ph-arrows-clockwise';
                if (label) label.textContent = 'Làm mới';
                btn.disabled = false;
            }, 1800);
        }
    } catch (e) {
        console.warn(e);
        // Trạng thái lỗi
        if (btn) {
            btn.classList.remove('refreshing');
            btn.classList.add('refresh-error');
            const icon = btn.querySelector('i');
            const label = btn.querySelector('span');
            if (icon) icon.className = 'ph ph-warning-circle';
            if (label) label.textContent = 'Thất bại';
            
            setTimeout(() => {
                btn.classList.remove('refresh-error');
                if (icon) icon.className = 'ph ph-arrows-clockwise';
                if (label) label.textContent = 'Làm mới';
                btn.disabled = false;
            }, 2000);
        }
    }
}

window.verifyRenewal = async function(id, status) {
    const actionText = status === 'approved' ? 'Phê duyệt' : 'Từ chối';
    if (!await showConfirm(`Bạn có chắc muốn ${actionText} yêu cầu gia hạn này?`, `${actionText} Gia Hạn`, status === 'approved' ? '✅' : '❌', 'Xác Nhận')) return;
    
    try {
        await apiPost('/renewal/verify', { id, status });
        showToast(`✅ Đã ${actionText} yêu cầu thành công!`);
        loadPendingRenewals();
        loadRenewalHistory();
    } catch (e) { showToast('❌ Lỗi: ' + e.message); }
}

// Tạo mã giao dịch duy nhất (2 chữ cái + 5 số, ví dụ: ZW17837)
function generateTransCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Bỏ I, O để tránh nhầm lẫn
    const l1 = letters[Math.floor(Math.random() * letters.length)];
    const l2 = letters[Math.floor(Math.random() * letters.length)];
    const num = Math.floor(10000 + Math.random() * 90000); // 5 chữ số
    return l1 + l2 + num;
}

// Copy mã giao dịch
window.copyTransCode = function() {
    const codeEl = document.getElementById('renewTransCode');
    if (!codeEl) return;
    const code = codeEl.textContent;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.trans-code-copy');
        if (btn) {
            const icon = btn.querySelector('i');
            btn.classList.add('copied');
            if (icon) icon.className = 'ph ph-check';
            setTimeout(() => {
                btn.classList.remove('copied');
                if (icon) icon.className = 'ph ph-copy';
            }, 1500);
        }
        showToast('✅ Đã sao chép mã: ' + code);
    });
}

window.openRenewModal = async function() {
    const modal = document.getElementById('renewModal');
    if (!modal) return;

    // Tạo mã giao dịch mới mỗi lần mở
    const transCode = generateTransCode();
    const codeEl = document.getElementById('renewTransCode');
    const refInput = document.getElementById('renewTransRef');
    if (codeEl) codeEl.textContent = transCode;
    if (refInput) refInput.value = transCode;

    // Điền thông tin người dùng
    if (currentUser) {
        const nameEl = document.getElementById('renewUserName');
        if (nameEl) nameEl.textContent = currentUser.fullName;
    }

    // Tải cấu hình thanh toán từ server
    try {
        const settings = await apiGet('/settings/renewal');
        
        // Map bank code to display name
        const bankDisplayNames = {
            'ACB': 'ACB', 'BIDV': 'BIDV', 'VCB': 'Vietcombank', 'TCB': 'Techcombank',
            'MB': 'MB Bank', 'VPB': 'VPBank', 'TPB': 'TPBank', 'STB': 'Sacombank',
            'VIB': 'VIB', 'SHB': 'SHB', 'MSB': 'MSB', 'EIB': 'Eximbank',
            'OCB': 'OCB', 'HDBank': 'HDBank', 'LPB': 'LienVietPostBank',
            'ABB': 'ABBank', 'NAB': 'Nam A Bank', 'SCB': 'SCB',
            'CAKE': 'CAKE', 'Ubank': 'Ubank'
        };
        const bankCode = settings.bankName || '';
        const bankDisplay = bankDisplayNames[bankCode] || bankCode;
        
        if (bankDisplay) { const el = document.getElementById('renewBankName'); if (el) el.textContent = bankDisplay; }
        if (settings.accountNumber) { const el = document.getElementById('renewAccountNumber'); if (el) el.textContent = settings.accountNumber; }
        if (settings.accountHolder) { const el = document.getElementById('renewAccountHolder'); if (el) el.textContent = settings.accountHolder; }
        
        // Tính tiền gia hạn tự động theo Gói
        let calculatedAmount = settings.amount || '';
        if (currentUser && currentUser.plan) {
            const p = currentUser.plan.toLowerCase();
            if (p.includes('cơ bản')) calculatedAmount = '88000';
            else if (p.includes('pro')) calculatedAmount = '148000';
        }
        
        if (calculatedAmount) { const el = document.getElementById('renewAmountDisplay'); if (el) el.textContent = formatCurrency(calculatedAmount.replace(/\D/g, '')) + ' VNĐ'; }

        // Tạo QR động qua VietQR API (chứa mã giao dịch tự động)
        const qrImg = document.getElementById('renewQrImage');
        const qrPlaceholder = document.getElementById('renewQrPlaceholder');
        
        const acctNum = (settings.accountNumber || '').replace(/\s/g, '');
        const amountRaw = (calculatedAmount || '').replace(/\D/g, '');
        const acctName = encodeURIComponent(settings.accountHolder || '');
        const addInfo = encodeURIComponent(transCode);
        
        if (bankCode && acctNum) {
            // VietQR API: https://img.vietqr.io/image/{bankCode}-{accountNo}-{template}.png
            const qrUrl = `https://img.vietqr.io/image/${bankCode}-${acctNum}-compact2.png?amount=${amountRaw}&addInfo=${addInfo}&accountName=${acctName}`;
            if (qrImg) {
                qrImg.src = qrUrl;
                qrImg.style.display = 'block';
                if (qrPlaceholder) qrPlaceholder.style.display = 'none';
            }
        } else {
            // Chưa cấu hình đầy đủ
            if (qrImg) qrImg.style.display = 'none';
            if (qrPlaceholder) qrPlaceholder.style.display = 'block';
        }
    } catch (e) {
        console.warn('Không thể tải cấu hình thanh toán:', e);
    }

    // Điền trạng thái tài khoản
    if (accountStatus) {
        const expiryDate = accountStatus.accountExpiry
            ? new Date(accountStatus.accountExpiry).toLocaleDateString('vi-VN')
            : 'Chưa xác định';
        const expiryEl = document.getElementById('renewExpiry');
        if (expiryEl) expiryEl.textContent = 'Hết hạn: ' + expiryDate;

        const badge = document.getElementById('renewDaysBadge');
        if (badge) {
            if (accountStatus.isExpired) {
                badge.textContent = 'Hết hạn';
                badge.className = 'renew-days-badge danger';
            } else if (accountStatus.isExpiring) {
                badge.textContent = accountStatus.daysLeft + ' ngày';
                badge.className = 'renew-days-badge warning';
            } else {
                badge.textContent = accountStatus.daysLeft + ' ngày';
                badge.className = 'renew-days-badge safe';
            }
        }
    }

    // Kiểm tra trạng thái yêu cầu gia hạn hiện tại
    try {
        const myStatus = await apiGet('/renewal/my-status');
        if (myStatus && myStatus.status === 'pending') {
            updateRenewalStepper('pending');
            // Hiện mã giao dịch cũ đang chờ
            if (codeEl) codeEl.textContent = myStatus.transactionRef || transCode;
            if (refInput) refInput.value = myStatus.transactionRef || transCode;
        } else if (myStatus && myStatus.status === 'approved') {
            // Kiểm tra xem đã duyệt gần đây (trong 24h) thì hiển thị completed
            const approvedTime = new Date(myStatus.createdAt);
            const hoursSince = (Date.now() - approvedTime.getTime()) / (1000 * 60 * 60);
            if (hoursSince < 24) {
                updateRenewalStepper('approved');
            } else {
                updateRenewalStepper('ready');
            }
        } else if (myStatus && myStatus.status === 'rejected') {
            updateRenewalStepper('rejected');
        } else {
            updateRenewalStepper('ready');
        }
    } catch (e) {
        updateRenewalStepper('ready');
    }

    modal.classList.add('active');
}

window.closeRenewModal = function() {
    const modal = document.getElementById('renewModal');
    if (modal) modal.classList.remove('active');
    const input = document.getElementById('renewTransRef');
    if (input) input.value = '';
}

// Cập nhật trạng thái stepper UI
function updateRenewalStepper(state) {
    // state: 'ready' | 'pending' | 'approved' | 'rejected'
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const step3 = document.getElementById('step3');
    const line1 = document.getElementById('stepLine1');
    const line2 = document.getElementById('stepLine2');
    const submitBtn = document.querySelector('.btn-renew-submit');
    
    // Reset tất cả
    [step1, step2, step3].forEach(s => { if(s) { s.className = 'stepper-step'; }});
    [line1, line2].forEach(l => { if(l) l.className = 'stepper-line'; });

    if (state === 'ready') {
        // Bước 1 đang active, chưa gửi
        if (step1) step1.classList.add('active');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.display = ''; }
    } else if (state === 'pending') {
        // Bước 1 xong, bước 2 đang chờ
        if (step1) step1.classList.add('done');
        if (line1) line1.classList.add('done');
        if (step2) step2.classList.add('active', 'pending-pulse');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.display = 'none'; }
    } else if (state === 'approved') {
        // Tất cả hoàn thành
        if (step1) step1.classList.add('done');
        if (line1) line1.classList.add('done');
        if (step2) step2.classList.add('done');
        if (line2) line2.classList.add('done');
        if (step3) step3.classList.add('done', 'complete');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.display = 'none'; }
    } else if (state === 'rejected') {
        // Bước 1 xong, bước 2 bị từ chối → cho phép gửi lại
        if (step1) step1.classList.add('done');
        if (line1) line1.classList.add('done');
        if (step2) step2.classList.add('rejected');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.display = ''; }
    }
}

window.submitRenewal = async function() {
    const amount = document.getElementById('renewAmountDisplay').textContent;
    const transRef = document.getElementById('renewTransRef') ? document.getElementById('renewTransRef').value.trim() : '';

    if (!transRef) {
        showToast('⚠️ Mã giao dịch bị thiếu, vui lòng đóng và mở lại form!');
        return;
    }

    try {
        showToast('⏳ Đang gửi yêu cầu phê duyệt...');
        // Gửi yêu cầu gia hạn (Pending) lên server
        await apiPost('/renewal/request', { 
            amount, 
            proofImage: '',
            transactionRef: transRef
        });
        
        // Cập nhật stepper sang trạng thái chờ duyệt
        updateRenewalStepper('pending');
        showToast('✅ Yêu cầu đã được gửi! Vui lòng chờ Admin phê duyệt.');
        
        // Cập nhật lại UI
        await checkAccountStatus();
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message);
    }
}

window.logoutExpired = function() {
    localStorage.removeItem('aishop_token');
    localStorage.removeItem('aishop_user');
    sessionStorage.removeItem('greeted');
    window.location.href = 'login.html';
}

// === Payment Proof Functions ===
window.previewPaymentProof = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('❌ File quá lớn (tối đa 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = function() {
        const preview = document.getElementById('paymentProofPreview');
        const container = document.getElementById('proofPreviewContainer');
        const placeholder = document.getElementById('proofPlaceholder');
        if (preview) preview.src = reader.result;
        if (container) container.style.display = 'block';
        if (placeholder) placeholder.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

window.removePaymentProof = function() {
    const preview = document.getElementById('paymentProofPreview');
    const container = document.getElementById('proofPreviewContainer');
    const placeholder = document.getElementById('proofPlaceholder');
    if (preview) preview.src = '';
    if (container) container.style.display = 'none';
    if (placeholder) placeholder.style.display = 'flex';
    const fileInput = document.getElementById('paymentProofInput');
    if (fileInput) fileInput.value = '';
}

// === Renewal Settings Functions (SuperAdmin) ===
async function loadRenewalSettingsForm() {
    try {
        const settings = await apiGet('/settings/renewal');
        // Bank dropdown — set selected option by value
        const bankEl = document.getElementById('renewalBankName');
        if (bankEl && settings.bankName) bankEl.value = settings.bankName;

        const fields = {
            renewalAccountNumber: settings.accountNumber,
            renewalAccountHolder: settings.accountHolder,
            renewalAmount: settings.amount,
        };
        for (const [id, val] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        }
    } catch (e) {
        console.warn('Không thể tải cấu hình thanh toán:', e);
    }
}

window.saveRenewalSettings = async function() {
    const bankEl = document.getElementById('renewalBankName');
    const data = {
        bankName: bankEl?.value || '',
        accountNumber: document.getElementById('renewalAccountNumber')?.value || '',
        accountHolder: document.getElementById('renewalAccountHolder')?.value || '',
        amount: document.getElementById('renewalAmount')?.value || '',
        transferNote: '',  // No longer used
        qrImage: '',       // QR is now dynamic via VietQR
    };

    try {
        await apiPost('/settings/renewal', data);
        showToast('✅ Đã lưu cấu hình thanh toán gia hạn!');
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message);
    }
}

window.previewRenewalQr = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('❌ File quá lớn (tối đa 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = function() {
        const preview = document.getElementById('renewalQrPreview');
        if (preview) { preview.src = reader.result; preview.style.display = 'block'; }
        const removeBtn = document.getElementById('removeRenewalQrBtn');
        if (removeBtn) removeBtn.style.display = 'inline-flex';
    };
    reader.readAsDataURL(file);
}

window.removeRenewalQr = function() {
    const preview = document.getElementById('renewalQrPreview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    const removeBtn = document.getElementById('removeRenewalQrBtn');
    if (removeBtn) removeBtn.style.display = 'none';
    const input = document.getElementById('renewalQrUpload');
    if (input) input.value = '';
}

// ======================================
// DOANH THU LOGIC
// ======================================
function initRevenueFilters() {
    const yearSelect = document.getElementById('revenueYearFilter');
    if (!yearSelect) return;
    const currentYear = new Date().getFullYear();
    let html = '';
    for (let y = currentYear; y >= 2024; y--) {
        html += `<option value="${y}">${y}</option>`;
    }
    yearSelect.innerHTML = html;
}

window.renderRevenue = function() {
    const year = parseInt(document.getElementById('revenueYearFilter').value);
    const grid = document.getElementById('revenueGrid');
    if (!grid) return;
    
    // Khởi tạo 12 tháng
    const months = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        total: 0,
        count: 0
    }));

    // Tính toán từ cachedCustomers
    cachedCustomers.forEach(c => {
        if (!c.startDate || !c.price) return;
        const d = new Date(c.startDate);
        if (d.getFullYear() === year) {
            const m = d.getMonth();
            months[m].total += parseInt(c.price) || 0;
            months[m].count += 1;
        }
    });

    // Render cards
    grid.innerHTML = months.reverse().map(m => `
        <div class="month-revenue-card glass-panel">
            <div class="month-label"> Th. ${m.month} / ${year} <i class="ph ph-trend-up" style="opacity:0.3"></i></div>
            <div class="month-value">${formatCurrency(m.total)} <small style="font-size:0.7rem; color:var(--text-muted); font-weight:normal;">VNĐ</small></div>
            <div class="customer-count"><i class="ph ph-users"></i> ${m.count} khách hàng mới</div>
        </div>
    `).join('');

    // Update Stats
    const yearlyTotal = months.reduce((acc, current) => acc + current.total, 0);
    const monthsWithData = months.filter(m => m.total > 0).length || 1;
    const avg = yearlyTotal / 12;
    const max = Math.max(...months.map(m => m.total));

    animateRevenueValue('revTotalYear', yearlyTotal);
    animateRevenueValue('revAvgMonth', Math.round(avg));
    animateRevenueValue('revMaxMonth', max);
}

function animateRevenueValue(id, end) {
    const el = document.getElementById(id);
    if (!el) return;
    const current = parseInt(el.dataset.val) || 0;
    el.dataset.val = end;
    const duration = 500;
    const startTime = performance.now();
    function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const val = Math.round(current + (end - current) * progress);
        el.textContent = formatCurrency(val);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

window.exportRevenueExcel = function() {
    const year = parseInt(document.getElementById('revenueYearFilter').value);
    const monthData = [];
    
    // Lấy dữ liệu 12 tháng
    for (let i = 0; i < 12; i++) {
        let total = 0, count = 0;
        cachedCustomers.forEach(c => {
            if (!c.startDate || !c.price) return;
            const d = new Date(c.startDate);
            if (d.getFullYear() === year && d.getMonth() === i) {
                total += parseInt(c.price) || 0;
                count++;
            }
        });
        monthData.push({
            "Tháng": `Tháng ${i + 1}`,
            "Năm": year,
            "Doanh Thu (VNĐ)": total,
            "Số Lượng Khách Hàng": count
        });
    }

    const ws = XLSX.utils.json_to_sheet(monthData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DoanhThu");
    XLSX.writeFile(wb, `Bao_Cao_Doanh_Thu_Nam_${year}.xlsx`);
    showToast("✅ Đã xuất báo cáo doanh thu!");
}

// ======================================
// MODAL PHÊ DUYỆT ĐĂNG KÝ
// ======================================
let _currentRegReqId = null;
let _currentRegNotifId = null;

window.openRegApprovalModal = async function(reqId, notifId) {
    _currentRegReqId = reqId;
    _currentRegNotifId = notifId;
    const overlay = document.getElementById('regApprovalOverlay');
    const content = document.getElementById('regApprovalContent');
    const approveBtn = document.getElementById('approveRegBtn');
    const rejectBtn = document.getElementById('rejectRegBtn');
    overlay.style.display = 'flex';
    content.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);"><i class="ph ph-spinner" style="font-size:2rem;"></i><br>Đang tải...</div>';
    try {
        // Lấy thông tin yêu cầu
        const allReqs = await apiGet('/register-request');
        const req = allReqs.find(r => r.id === reqId);
        // Lấy mã mời
        let inviteCode = '------';
        try { const ic = await apiGet('/settings/invite-code'); inviteCode = ic.code || '------'; } catch(_) {}

        if (!req) {
            content.innerHTML = '<div style="color:var(--danger);text-align:center;padding:20px;">❌ Yêu cầu không còn tồn tại.</div>';
            approveBtn.style.display = 'none';
            rejectBtn.style.display = 'none';
            return;
        }

        const alreadyDone = req.status !== 'pending';
        approveBtn.style.display = alreadyDone ? 'none' : 'inline-flex';
        rejectBtn.style.display = alreadyDone ? 'none' : 'inline-flex';

        content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;">
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;">
                <div style="display:grid;grid-template-columns:1fr;gap:8px;">
                    <div><div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">Mã Giao Dịch (Nội dung CK)</div><div style="font-weight:800;font-size:1.4rem;color:var(--primary-lighter);letter-spacing:2px;user-select:all;">${req.name}</div></div>
                    <div style="margin-top:10px;"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;">Gói đăng ký</div><div style="font-weight:600;color:var(--text-primary);">${req.plan || 'Chưa chọn'}</div></div>
                </div>
            </div>
            <div style="background:rgba(59,79,191,0.1);border:1px solid rgba(59,79,191,0.25);border-radius:12px;padding:14px;">
                <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">🔑 Mã mời đăng ký (sẽ được sao chép tự động khi phê duyệt):</div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                    <code id="approvalInviteCode" style="font-size:1.6rem;font-weight:800;color:var(--primary-lighter);letter-spacing:6px;">${inviteCode}</code>
                    <button onclick="copyRegInviteCode('${inviteCode}')" class="btn-icon" title="Sao chép" style="padding:8px 12px;"><i class="ph ph-copy"></i></button>
                </div>
            </div>
            ${alreadyDone ? `<div style="text-align:center;padding:10px;font-size:0.9rem;color:var(--text-muted);">${req.status === 'sent' ? '✅ Đã phê duyệt và gửi mã' : '❌ Đã từ chối'}</div>` : 
            '<div style="font-size:0.8rem;color:var(--text-muted);background:rgba(255,255,255,0.03);padding:10px 14px;border-radius:8px;">💡 Sau khi bấm <strong>Phê duyệt</strong>: mã mời sẽ được sao chép vào clipboard. Paste và gửi cho khách qua <strong>Zalo / Telegram</strong>.</div>'}
        </div>`;
    } catch(e) {
        content.innerHTML = `<div style="color:var(--danger);text-align:center;padding:16px;">❌ Lỗi: ${e.message}</div>`;
    }
};

window.closeRegApprovalModal = function() {
    document.getElementById('regApprovalOverlay').style.display = 'none';
    _currentRegReqId = null;
    _currentRegNotifId = null;
};

window.approveRegRequest = async function(status) {
    if (!_currentRegReqId) return;
    const btn = document.getElementById('approveRegBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner"></i> Đang xử lý...'; }
    try {
        if (status === 'sent') {
            // Gọi endpoint approve — tự động gửi email
            const res = await fetch(`${API_BASE}/register-request/${_currentRegReqId}/approve`, {
                method: 'POST', headers: getHeaders()
            });
            const data = await res.json();
            if (data.emailSent) {
                showToast(`✅ Đã gửi mã mời qua email tự động! ${data.message}`);
            } else {
                // Email chưa cấu hình — hiển thị mã để admin sao chép thủ công
                const code = data.inviteCode || '------';
                await navigator.clipboard.writeText(code).catch(() => {});
                showToast(`✅ Phê duyệt! Mã mời "${code}" đã sao chép (email chưa cấu hình).`);
            }
        } else {
            await fetch(`${API_BASE}/register-request/${_currentRegReqId}`, {
                method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ status })
            });
            showToast('❌ Đã từ chối yêu cầu đăng ký.');
        }
        if (_currentRegNotifId) await fsUpdateNotification(_currentRegNotifId, { isRead: true });
        closeRegApprovalModal();
        if (currentView === 'settings') loadRegRequests();
    } catch(e) {
        showToast('❌ Lỗi: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-check-circle"></i> Phê duyệt & Sao chép mã'; }
    }
};

// Phê duyệt nhanh từ nút trong chuông thông báo (không cần mở modal)
window.quickApproveReg = async function(reqId, notifId, btnEl) {
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '<i class="ph ph-spinner"></i> Đang gửi...'; }
    try {
        const res = await fetch(`${API_BASE}/register-request/${reqId}/approve`, {
            method: 'POST', headers: getHeaders()
        });
        const data = await res.json();
        if (data.emailSent) {
            showToast(`✅ Đã gửi mã mời qua email tự động!`);
            if (btnEl) { btnEl.innerHTML = '✅ Đã gửi email'; btnEl.style.background = 'var(--success)'; }
        } else {
            const code = data.inviteCode || '------';
            await navigator.clipboard.writeText(code).catch(() => {});
            showToast(`✅ Phê duyệt! Mã: "${code}" đã sao chép (email chưa cấu hình).`);
            if (btnEl) { btnEl.innerHTML = `✅ Mã: ${code}`; btnEl.style.background = 'rgba(255,255,255,0.1)'; }
        }
        if (notifId) await fsUpdateNotification(notifId, { isRead: true });
        if (currentView === 'settings') loadRegRequests();
    } catch(e) {
        showToast('❌ Lỗi: ' + e.message);
        if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '<i class="ph ph-check-circle"></i> Phê duyệt ngay'; }
    }
};

// ======================================
// YÊU CẦU ĐĂNG KÝ TÀI KHOẢN (SuperAdmin)
// ======================================
window.loadRegRequests = async function() {
    if (!currentUser || currentUser.role !== 'superadmin') return;
    const container = document.getElementById('regRequestsList');
    if (!container) return;
    const filter = document.getElementById('regRequestFilter')?.value || '';
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;"><i class="ph ph-spinner" style="font-size:1.5rem;"></i> Đang tải...</div>';
    try {
        const url = filter ? `/register-request?status=${filter}` : '/register-request';
        const list = await apiGet(url);
        if (!list.length) {
            container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px;"><i class="ph ph-inbox" style="font-size:2rem;display:block;margin-bottom:8px;"></i>Không có yêu cầu nào</div>';
            return;
        }
        // Lấy mã mời hiện tại để hiển thị
        let inviteCode = '------';
        try { const ic = await apiGet('/settings/invite-code'); inviteCode = ic.code || '------'; } catch(_) {}

        container.innerHTML = list.map(req => {
            const statusMap = { pending: { label: '⏳ Chờ xử lý', color: 'var(--warning)' }, sent: { label: '✅ Đã gửi mã', color: 'var(--success)' }, rejected: { label: '❌ Từ chối', color: 'var(--danger)' } };
            const st = statusMap[req.status] || { label: req.status, color: 'var(--text-muted)' };
            const dt = req.createdAt ? new Date(req.createdAt).toLocaleString('vi-VN') : '';
            return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px 18px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                    <div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:2px;">Mã Giao Dịch:</div>
                        <div style="font-weight:800;font-size:1.2rem;color:var(--primary-lighter);letter-spacing:1px;user-select:all;margin-bottom:6px;">${req.name}</div>
                        <div style="font-size:0.82rem;color:var(--text-muted);">📦 ${req.plan || 'Chưa chọn gói'} &nbsp;|&nbsp; 🕐 ${dt}</div>
                    </div>
                    <span style="font-size:0.8rem;font-weight:600;color:${st.color};background:rgba(255,255,255,0.05);padding:4px 12px;border-radius:20px;white-space:nowrap;">${st.label}</span>
                </div>
                <div style="background:rgba(59,79,191,0.08);border:1px solid rgba(59,79,191,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                    <div style="font-size:0.82rem;color:var(--text-muted);">Mã mời hiện tại:</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <code style="font-size:1.2rem;font-weight:800;color:var(--primary-lighter);letter-spacing:4px;">${inviteCode}</code>
                        <button onclick="copyRegInviteCode('${inviteCode}')" class="btn-icon" title="Sao chép mã mời" style="padding:6px 10px;"><i class="ph ph-copy"></i></button>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${req.status === 'pending' ? `
                    <button onclick="markRegRequest('${req.id}','sent')" class="btn-primary" style="font-size:0.82rem;padding:7px 14px;">
                        <i class="ph ph-check-circle"></i> Đánh dấu đã gửi mã
                    </button>
                    <button onclick="markRegRequest('${req.id}','rejected')" class="btn-secondary" style="font-size:0.82rem;padding:7px 14px;color:var(--danger);border-color:var(--danger);">
                        <i class="ph ph-x-circle"></i> Từ chối
                    </button>` : ''}
                    <button onclick="deleteRegRequest('${req.id}')" class="btn-secondary" style="font-size:0.82rem;padding:7px 14px;" title="Xóa">
                        <i class="ph ph-trash"></i> Xóa
                    </button>
                </div>
            </div>`;
        }).join('');
    } catch(e) {
        container.innerHTML = `<div style="color:var(--danger);text-align:center;padding:16px;">❌ Lỗi: ${e.message}</div>`;
    }
};

window.copyRegInviteCode = function(code) {
    navigator.clipboard.writeText(code).then(() => showToast('✅ Đã sao chép mã mời: ' + code));
};

window.markRegRequest = async function(id, status) {
    try {
        if (status === 'sent') {
            const res = await fetch(`${API_BASE}/register-request/${id}/approve`, {
                method: 'POST', headers: getHeaders()
            });
            const data = await res.json();
            showToast(data.message || '✅ Đã phê duyệt!');
        } else {
            await fetch(`${API_BASE}/register-request/${id}`, {
                method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ status })
            });
            showToast('✅ Đã cập nhật trạng thái');
        }
        loadRegRequests();
    } catch(e) {
        showToast('❌ Lỗi: ' + e.message);
    }
};

window.deleteRegRequest = async function(id) {
    if (!await showConfirm('Xóa yêu cầu đăng ký này?', 'Xác nhận xóa', '🗑️', 'Xóa')) return;
    try {
        await fetch(`${API_BASE}/register-request/${id}`, { method: 'DELETE', headers: getHeaders() });
        showToast('🗑️ Đã xóa yêu cầu');
        loadRegRequests();
    } catch(e) { showToast('❌ Lỗi: ' + e.message); }
};

init();
