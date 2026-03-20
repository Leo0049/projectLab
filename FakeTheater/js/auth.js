const AuthManager = {
    currentUser: null,


    init() {
        this.loadUserFromStorage();
        this.renderAuthUI();
        this.bindEvents();
        this.updateNavbar();
    },

    loadUserFromStorage() {
        const userInfo = localStorage.getItem('userInfo');
        if (userInfo) {
            this.currentUser = JSON.parse(userInfo);
            if (this.currentUser.balance === undefined) {
                this.currentUser.balance = 0;
                this.saveUserToStorage();
            }
        }
    },

    saveUserToStorage() {
        if (this.currentUser) {
            localStorage.setItem('userInfo', JSON.stringify(this.currentUser));
        }
    },

    isLoggedIn() {
        return this.currentUser !== null;
    },


    getUser() {
        return this.currentUser;
    },


    getBalance() {
        return this.currentUser?.balance || 0;
    },


    updateBalance(amount) {
        if (this.currentUser) {
            this.currentUser.balance = amount;
            this.saveUserToStorage();
            this.updateBalanceDisplay();
        }
    },


    deposit(amount) {
        if (this.currentUser && amount > 0) {
            this.currentUser.balance += amount;
            this.saveUserToStorage();
            this.addTransaction('儲值', amount);
            this.updateBalanceDisplay();
            return true;
        }
        return false;
    },


    deduct(amount, description = '購票', details = {}) {
        if (this.currentUser && this.currentUser.balance >= amount) {
            this.currentUser.balance -= amount;
            this.saveUserToStorage();
            this.addTransaction(description, -amount, details);
            this.updateBalanceDisplay();
            return true;
        }
        return false;
    },

    addTransaction(type, amount, details = {}) {
        const transactions = JSON.parse(localStorage.getItem('transactions') || '[]');
        transactions.push({
            id: Date.now(),
            type: type,
            amount: amount,
            date: new Date().toLocaleString('zh-TW'),
            userId: this.currentUser?.id,
            movieTitle: details.movieTitle || '',
            movieDate: details.movieDate || '',
            showtime: details.showtime || ''
        });
        localStorage.setItem('transactions', JSON.stringify(transactions));
    },


    getTransactions() {
        const transactions = JSON.parse(localStorage.getItem('transactions') || '[]');
        return transactions.filter(t => t.userId === this.currentUser?.id);
    },


    updateBalanceDisplay() {
        const balanceElements = document.querySelectorAll('.user-balance');
        balanceElements.forEach(el => {
            el.textContent = this.getBalance();
        });
    },

    async login(username, password) {
        const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const registeredUser = registeredUsers.find(u => u.username === username);

        if (registeredUser && registeredUser.password === password) {
            this.currentUser = {
                id: registeredUser.id,
                username: registeredUser.username,
                email: registeredUser.email,
                balance: registeredUser.balance || 0,
                token: 'mock-token-' + Date.now()
            };
            this.saveUserToStorage();
            return { success: true };
        }

        try {
            const jsonUser = await DataAPI.loginUser(username, password);
            if (jsonUser) {
                this.currentUser = {
                    id: jsonUser.id,
                    username: jsonUser.username,
                    email: jsonUser.username + '@faketheater.com',
                    balance: jsonUser.balance || 0,
                    token: 'mock-token-' + Date.now(),
                    isJsonUser: true
                };
                this.saveUserToStorage();
                return { success: true };
            }
        } catch (error) {
            console.error('DataAPI login failed:', error);
        }

        return { success: false, message: '用戶名或密碼錯誤' };
    },

    googleLogin() {
        this.currentUser = {
            id: Date.now(),
            username: 'Google 用戶',
            email: 'google.user@gmail.com',
            balance: 0,
            token: 'google-mock-token-' + Date.now(),
            isGoogleUser: true
        };
        this.saveUserToStorage();
        return { success: true };
    },

    register(username, email, password) {
        const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');

        if (users.find(u => u.username === username)) {
            return { success: false, message: '用戶名已存在' };
        }


        if (users.find(u => u.email === email)) {
            return { success: false, message: '電子郵件已被使用' };
        }

        const newUser = {
            id: Date.now(),
            username: username,
            email: email,
            password: password,
            balance: 0
        };

        users.push(newUser);
        localStorage.setItem('registeredUsers', JSON.stringify(users));

        return { success: true };
    },


    logout() {
        this.currentUser = null;
        localStorage.removeItem('userInfo');
        this.updateNavbar();
        window.location.reload();
    },


    updateUsername(newUsername) {
        if (this.currentUser && newUsername.trim()) {
            this.currentUser.username = newUsername;
            this.saveUserToStorage();

            const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            const userIndex = users.findIndex(u => u.id === this.currentUser.id);
            if (userIndex !== -1) {
                users[userIndex].username = newUsername;
                localStorage.setItem('registeredUsers', JSON.stringify(users));
            }

            this.updateNavbar();
            return true;
        }
        return false;
    },

    renderAuthUI() {
        if (document.getElementById('authModal')) return;

        const modalHTML = `
        <!-- 登入/註冊 Modal -->
        <div class="modal fade" id="authModal" tabindex="-1" aria-labelledby="authModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content auth-modal-content">
                    <div class="modal-header border-0 pb-0">
                        <button type="button" class="btn-close position-absolute mb-5" style="top: 15px; right: 15px;" 
                            data-bs-dismiss="modal" aria-label="Close"></button>
                        <ul class="nav nav-pills auth-tabs w-100 mt-4" id="authTabs" role="tablist">
                            <li class="nav-item flex-fill" role="presentation">
                                <button class="nav-link active w-100" id="login-tab" data-bs-toggle="pill" 
                                    data-bs-target="#login-panel" type="button" role="tab">登入</button>
                            </li>
                            <li class="nav-item flex-fill" role="presentation">
                                <button class="nav-link w-100" id="register-tab" data-bs-toggle="pill" 
                                    data-bs-target="#register-panel" type="button" role="tab">註冊</button>
                            </li>
                        </ul>

                    </div>

                    <div class="modal-body pt-4">
                        <div class="tab-content" id="authTabsContent">
                            <!-- 登入面板 -->
                            <div class="tab-pane fade show active" id="login-panel" role="tabpanel">
                                <form id="modal-login-form">
                                    <div class="mb-3">
                                        <label for="login-username" class="form-label">用戶名</label>
                                        <input type="text" class="form-control" id="login-username" 
                                            placeholder="請輸入用戶名" required>
                                    </div>
                                    <div class="mb-3">
                                        <label for="login-password" class="form-label">密碼</label>
                                        <input type="password" class="form-control" id="login-password" 
                                            placeholder="請輸入密碼" required>
                                    </div>
                                    <div class="mb-3 form-check">
                                        <input type="checkbox" class="form-check-input" id="remember-me">
                                        <label class="form-check-label" for="remember-me">記住我</label>
                                    </div>
                                    <div class="d-grid gap-2">
                                        <button type="submit" class="btn btn-primary btn-lg">登入</button>
                                    </div>
                                    <div class="auth-divider my-4">
                                        <span>或</span>
                                    </div>
                                    <div class="d-grid">
                                        <button type="button" class="btn btn-outline-dark btn-google" id="google-login-btn">
                                            <svg width="18" height="18" viewBox="0 0 18 18" class="me-2">
                                                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"></path>
                                                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"></path>
                                                <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"></path>
                                                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"></path>
                                            </svg>
                                            使用 Google 帳戶登入
                                        </button>
                                    </div>
                                </form>
                            </div>
                            <!-- 註冊面板 -->
                            <div class="tab-pane fade" id="register-panel" role="tabpanel">
                                <form id="modal-register-form">
                                    <div class="mb-3">
                                        <label for="register-username" class="form-label">用戶名</label>
                                        <input type="text" class="form-control" id="register-username" 
                                            placeholder="請輸入用戶名" required>
                                    </div>
                                    <div class="mb-3">
                                        <label for="register-email" class="form-label">電子郵件</label>
                                        <input type="email" class="form-control" id="register-email" 
                                            placeholder="請輸入電子郵件" required>
                                    </div>
                                    <div class="mb-3">
                                        <label for="register-password" class="form-label">密碼</label>
                                        <input type="password" class="form-control" id="register-password" 
                                            placeholder="請輸入密碼" required>
                                    </div>
                                    <div class="mb-3">
                                        <label for="register-confirm-password" class="form-label">確認密碼</label>
                                        <input type="password" class="form-control" id="register-confirm-password" 
                                            placeholder="再次輸入密碼" required>
                                    </div>
                                    <div class="d-grid gap-2">
                                        <button type="submit" class="btn btn-success btn-lg">立即註冊</button>
                                    </div>
                                    <div class="auth-divider my-4">
                                        <span>或</span>
                                    </div>
                                    <div class="d-grid">
                                        <button type="button" class="btn btn-outline-dark btn-google" id="google-register-btn">
                                            <svg width="18" height="18" viewBox="0 0 18 18" class="me-2">
                                                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"></path>
                                                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"></path>
                                                <path fill="#FBBC05" d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"></path>
                                                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"></path>
                                            </svg>
                                            使用 Google 帳戶註冊
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 儲值 Modal -->
        <div class="modal fade" id="depositModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title"> 儲值</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">當前餘額</label>
                            <div class="h4 text-primary">NT$ <span class="user-balance">0</span></div>
                        </div>
                        <div class="mb-3">
                            <label for="deposit-amount" class="form-label">儲值金額</label>
                            <div class="d-flex gap-2 mb-2">
                                <button type="button" class="btn btn-outline-primary quick-deposit" data-amount="100">$100</button>
                                <button type="button" class="btn btn-outline-primary quick-deposit" data-amount="300">$300</button>
                                <button type="button" class="btn btn-outline-primary quick-deposit" data-amount="500">$500</button>
                                <button type="button" class="btn btn-outline-primary quick-deposit" data-amount="1000">$1000</button>
                            </div>
                            <input type="number" class="form-control" id="deposit-amount" placeholder="或輸入自訂金額" min="1">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-primary" id="confirm-deposit-btn">確認儲值</button>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    },

    bindEvents() {
        const loginForm = document.getElementById('modal-login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = document.getElementById('login-username').value;
                const password = document.getElementById('login-password').value;

                const result = await this.login(username, password);
                if (result.success) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
                    modal.hide();
                    this.showToast('登入成功！', 'success');
                    this.updateNavbar();
                    setTimeout(() => window.location.reload(), 500);
                } else {
                    this.showToast(result.message || '登入失敗', 'danger');
                }
            });
        }

        const registerForm = document.getElementById('modal-register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const username = document.getElementById('register-username').value;
                const email = document.getElementById('register-email').value;
                const password = document.getElementById('register-password').value;
                const confirmPassword = document.getElementById('register-confirm-password').value;

                if (password !== confirmPassword) {
                    this.showToast('密碼不一致', 'danger');
                    return;
                }

                const result = this.register(username, email, password);
                if (result.success) {
                    this.showToast('註冊成功！請登入', 'success');
                    document.getElementById('login-tab').click();
                    document.getElementById('login-username').value = username;
                } else {
                    this.showToast(result.message || '註冊失敗', 'danger');
                }
            });
        }

        const googleLoginBtn = document.getElementById('google-login-btn');
        if (googleLoginBtn) {
            googleLoginBtn.addEventListener('click', () => {
                const result = this.googleLogin();
                if (result.success) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
                    modal.hide();
                    this.showToast('Google 登入成功！', 'success');
                    this.updateNavbar();
                    setTimeout(() => window.location.reload(), 500);
                }
            });
        }

        const googleRegisterBtn = document.getElementById('google-register-btn');
        if (googleRegisterBtn) {
            googleRegisterBtn.addEventListener('click', () => {
                const result = this.googleLogin();
                if (result.success) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
                    modal.hide();
                    this.showToast('Google 帳戶已連結！', 'success');
                    this.updateNavbar();
                    setTimeout(() => window.location.reload(), 500);
                }
            });
        }

        document.querySelectorAll('.quick-deposit').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('deposit-amount').value = btn.dataset.amount;
            });
        });

        const confirmDepositBtn = document.getElementById('confirm-deposit-btn');
        if (confirmDepositBtn) {
            confirmDepositBtn.addEventListener('click', () => {
                const amount = parseInt(document.getElementById('deposit-amount').value);
                if (amount && amount > 0) {
                    if (this.deposit(amount)) {
                        const modal = bootstrap.Modal.getInstance(document.getElementById('depositModal'));
                        modal.hide();
                        this.showToast(`成功儲值 NT$ ${amount}`, 'success');
                        document.getElementById('deposit-amount').value = '';
                    }
                } else {
                    this.showToast('請輸入有效金額', 'warning');
                }
            });
        }

        document.addEventListener('click', (e) => {
            if (e.target.id === 'logout-btn' || e.target.closest('#logout-btn')) {
                e.preventDefault();
                this.logout();
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.id === 'nav-login-btn' || e.target.closest('#nav-login-btn')) {
                e.preventDefault();
                const authModal = new bootstrap.Modal(document.getElementById('authModal'));
                authModal.show();
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.id === 'nav-register-btn' || e.target.closest('#nav-register-btn')) {
                e.preventDefault();
                const authModal = new bootstrap.Modal(document.getElementById('authModal'));
                authModal.show();
                setTimeout(() => document.getElementById('register-tab').click(), 100);
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.id === 'nav-deposit-btn' || e.target.closest('#nav-deposit-btn')) {
                e.preventDefault();
                if (!this.isLoggedIn()) {
                    this.showToast('請先登入', 'warning');
                    return;
                }
                this.updateBalanceDisplay();
                const depositModal = new bootstrap.Modal(document.getElementById('depositModal'));
                depositModal.show();
            }
        });
    },

    updateNavbar() {
        const navContainer = document.querySelector('.navbar-nav.ms-auto');
        if (!navContainer) return;

        if (this.isLoggedIn()) {
            navContainer.innerHTML = `
                <li class="nav-item">
                    <a class="nav-link" href="#" id="nav-deposit-btn" title="餘額: NT$ ${this.getBalance()}">
                        $ <span class="user-balance">${this.getBalance()}</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" href="#" id="wallet-toggle-btn">我的票夾</a>
                </li>
                <li class="nav-item dropdown">
                    <a class="nav-link dropdown-toggle" href="#" id="navbarDropdown" role="button" 
                        data-bs-toggle="dropdown" aria-expanded="false">
                        ${this.currentUser.username}
                    </a>
                    <ul class="dropdown-menu dropdown-menu-end">
                        <li><a class="dropdown-item" href="profile.html">個人專區</a></li>
                        <li><a class="dropdown-item" href="#" id="nav-deposit-btn-2">儲值</a></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-danger" href="#" id="logout-btn">登出</a></li>
                    </ul>
                </li>
            `;

            const depositBtn2 = document.getElementById('nav-deposit-btn-2');
            if (depositBtn2) {
                depositBtn2.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.updateBalanceDisplay();
                    const depositModal = new bootstrap.Modal(document.getElementById('depositModal'));
                    depositModal.show();
                });
            }
        } else {
            navContainer.innerHTML = `
                <li class="nav-item">
                    <a class="nav-link" href="#" id="nav-register-btn">註冊</a>
                </li>
                <li class="nav-item">
                    <a class="nav-link" href="#" id="nav-login-btn">登入</a>
                </li>
            `;
        }
    },

    showToast(message, type = 'info') {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
            toastContainer.style.zIndex = '9999';
            document.body.appendChild(toastContainer);
        }

        const toastId = 'toast-' + Date.now();
        const toastHTML = `
            <div id="${toastId}" class="toast align-items-center text-white bg-${type} border-0" role="alert">
                <div class="d-flex">
                    <div class="toast-body">${message}</div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `;

        toastContainer.insertAdjacentHTML('beforeend', toastHTML);
        const toastElement = document.getElementById(toastId);
        const toast = new bootstrap.Toast(toastElement, { delay: 3000 });
        toast.show();

        toastElement.addEventListener('hidden.bs.toast', () => {
            toastElement.remove();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AuthManager.init();
});
