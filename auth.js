// ======================================
// AUTH SCRIPT — Login / Register
// ======================================
let API_BASE = window.location.origin + '/api';
if (window.location.protocol === 'file:' || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000') {
    API_BASE = 'http://localhost:3000/api';
}

let currentLoginAs = 'admin'; // 'admin' hoặc 'user'

// Kiểm tra nếu đã đăng nhập → redirect
// Chống redirect loop khi server Render đang cold start
(function checkAuth() {
    const token = localStorage.getItem('aishop_token');
    const user = localStorage.getItem('aishop_user');
    if (token && user) {
        // Có token + user trong localStorage → redirect ngay, không cần gọi API
        // (API sẽ verify token khi index.html load)
        window.location.href = 'index.html';
    }
})();

// ======================================
// TAB SWITCHING (Removed)
// ======================================
// Không còn dùng luồng riêng nữa vì Role phân biệt trong DB

// ======================================
// SHOW/HIDE FORMS
// ======================================
window.showRegister = function () {
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('registerCard').style.display = 'block';
    document.getElementById('registerCard').style.animation = 'cardFadeIn 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    // Sync panel tabs if they exist
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabRegister) tabRegister.classList.add('active');
}

window.showLogin = function () {
    document.getElementById('registerCard').style.display = 'none';
    document.getElementById('loginCard').style.display = 'block';
    document.getElementById('loginCard').style.animation = 'cardFadeIn 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
    // Sync panel tabs if they exist
    const tabLogin = document.getElementById('tabLogin');
    const tabRegister = document.getElementById('tabRegister');
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
}

// ======================================
// TOGGLE PASSWORD VISIBILITY
// ======================================
window.togglePwd = function (inputId, iconEl) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        iconEl.classList.remove('ph-eye');
        iconEl.classList.add('ph-eye-slash');
    } else {
        input.type = 'password';
        iconEl.classList.remove('ph-eye-slash');
        iconEl.classList.add('ph-eye');
    }
}

// ======================================
// LOGIN
// ======================================
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    errorEl.textContent = '';

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPwd').value;

    if (!email || !password) {
        errorEl.textContent = 'Vui lòng nhập đầy đủ email và mật khẩu';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Đang xử lý...';

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.innerHTML = `<i class="ph ph-warning-circle"></i> ${data.error}`;
            btn.disabled = false;
            btn.innerHTML = '<span>Đăng Nhập</span><i class="ph ph-sign-in"></i>';
            return;
        }

        // Lưu token và thông tin user
        localStorage.setItem('aishop_token', data.token);
        localStorage.setItem('aishop_user', JSON.stringify(data.user));

        btn.innerHTML = '<i class="ph ph-check-circle"></i> Thành công!';
        btn.style.background = 'linear-gradient(135deg, #10b981, #34d399)';

        setTimeout(() => {
            window.location.href = 'index.html';
        }, 600);

    } catch (err) {
        errorEl.innerHTML = `<i class="ph ph-warning-circle"></i> Lỗi kết nối server (${err.message || err})`;
        btn.disabled = false;
        btn.innerHTML = '<span>Đăng Nhập</span><i class="ph ph-sign-in"></i>';
    }
});

// ======================================
// REGISTER
// ======================================
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('registerError');
    const successEl = document.getElementById('registerSuccess');
    const btn = document.getElementById('registerBtn');
    errorEl.textContent = '';
    successEl.textContent = '';

    const fullName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPwd').value;
    const confirmPwd = document.getElementById('regPwdConfirm').value;
    const inviteCode = document.getElementById('regInviteCode').value.trim();

    if (!fullName || !email || !password || !inviteCode) {
        errorEl.textContent = 'Vui lòng điền đầy đủ thông tin';
        return;
    }
    if (password.length < 6) {
        errorEl.textContent = 'Mật khẩu phải có ít nhất 6 ký tự';
        return;
    }
    if (password !== confirmPwd) {
        errorEl.textContent = 'Mật khẩu xác nhận không khớp';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Đang xử lý...';

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, email, password, inviteCode })
        });
        const data = await res.json();

        if (!res.ok) {
            errorEl.innerHTML = `<i class="ph ph-warning-circle"></i> ${data.error}`;
            btn.disabled = false;
            btn.innerHTML = '<span>Đăng Ký Quản Trị Viên</span><i class="ph ph-shield-plus"></i>';
            return;
        }

        successEl.textContent = '✅ Đăng ký thành công! Đang chuyển đến trang đăng nhập...';
        btn.innerHTML = '<i class="ph ph-check-circle"></i> Thành công!';
        btn.style.background = 'linear-gradient(135deg, #10b981, #34d399)';

        setTimeout(() => {
            showLogin();
            document.getElementById('registerForm').reset();
            btn.disabled = false;
            btn.innerHTML = '<span>Đăng Ký</span><i class="ph ph-user-plus"></i>';
            btn.style.background = '';
            successEl.textContent = '';
        }, 1500);

    } catch (err) {
        errorEl.innerHTML = `<i class="ph ph-warning-circle"></i> Lỗi kết nối server (${err.message || err})`;
        btn.disabled = false;
        btn.innerHTML = '<span>Đăng Ký</span><i class="ph ph-user-plus"></i>';
    }
});
