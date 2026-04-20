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
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiPost(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiPut(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(`${API_BASE}${path}`, { 
        method: 'DELETE',
        headers: getHeaders()
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
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
    try { await apiDelete('/notifications/read'); }
    catch (e) { showToast('❌ Lỗi xoá thông báo: ' + e.message); console.error(e); }
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
    else if (view === 'settings') { if (viewSettingsNode) viewSettingsNode.classList.add('active'); }
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
        let roleLabel = '';
        if (a.role === 'superadmin') roleLabel = '<span class="badge" style="background:var(--primary); color:white;">Admin (Tổng)</span>';
        else if (a.role === 'admin') roleLabel = '<span class="badge warning">Quản Trị Viên</span>';
        else roleLabel = '<span class="badge safe">Nhân Viên</span>';
        const tr = document.createElement('tr');
        
        // Nút xem khách hàng (chỉ superadmin mới thấy)
        let viewCustBtn = '';
        if (currentUser && currentUser.role === 'superadmin') {
            viewCustBtn = `<button class="btn-icon" onclick="viewAdminCustomers('${a.id}', '${a.fullName.replace(/'/g, "\\'")}')" title="Xem khách hàng" style="color:var(--primary);"><i class="ph ph-users-three"></i></button>`;
        }
        
        tr.innerHTML = `
            <td>${roleLabel}</td>
            <td><strong>${a.fullName}</strong></td><td>${a.email}</td>
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
    showToast('🗑️ Đã xoá các thông báo đã đọc.');
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
        list.innerHTML = cachedNotifications.sort((a, b) => new Date(b.time) - new Date(a.time)).map(n => `
            <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="markNotifAsRead('${n.id}')">
                <div class="notif-title">${n.title}</div>
                <div class="notif-body">${n.body}</div>
                <div class="notif-time">${new Date(n.time).toLocaleString('vi-VN')}</div>
            </div>`).join('');
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
        const superadminSettings = document.getElementById('superadminSettings');
        if (superadminSettings) superadminSettings.style.display = 'flex';
        fetchInviteCode();
    } else {
        // Ẩn nút Thêm Nhân Sự đối với Quản trị viên thường
        const adminBtn = document.getElementById('addAdminBtn');
        if (adminBtn) adminBtn.style.display = 'none';
        
        // Cập nhật giao diện ẩn Setting và Nhân Sự
        const navSettings = document.getElementById('navSettings');
        if (navSettings) navSettings.style.display = 'none';
        const statAdmins = document.getElementById('statAdmins');
        if (statAdmins) statAdmins.closest('.stat-card').style.display = 'none';
        const thAdminColumn = document.getElementById('thAdminColumn');
        if (thAdminColumn) thAdminColumn.style.display = 'none';
        const superadminSettings = document.getElementById('superadminSettings');
        if (superadminSettings) superadminSettings.style.display = 'none';
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

init();
