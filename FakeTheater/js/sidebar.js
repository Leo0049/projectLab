/**
 * 側邊欄
 *
 * 原本六個 HTML 檔各自複製一份側邊欄 markup，改動要改六次；
 * 現在統一由這裡產生，也才有辦法依登入狀態與角色顯示不同項目。
 */

const SIDEBAR_ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16.5 14.5h.01"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="11" width="7" height="10" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/>'
};

function sidebarIcon(name) {
    return `<svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true">${SIDEBAR_ICONS[name] || ''}</svg>`;
}

const Sidebar = {
    /**
     * 每一組是一個區塊：標題 + 項目。requiresAuth / requiresAdmin 控制顯示。
     */
    sections: [
        {
            label: '探索',
            items: [
                { href: 'index.html', label: '首頁', icon: 'home' },
                { href: 'showtime.html', label: '場次查詢', icon: 'search' },
                { href: 'schedule.html', label: '電影時刻表', icon: 'calendar' },
                { href: 'booking.html', label: '線上訂票', icon: 'ticket' }
            ]
        },
        {
            label: '會員',
            requiresAuth: true,
            items: [
                { href: 'profile.html', label: '個人專區', icon: 'user' },
                { href: '#', label: '我的票夾', icon: 'wallet', id: 'sidebar-wallet-btn' }
            ]
        },
        {
            label: '管理',
            requiresAdmin: true,
            items: [
                { href: 'admin.html', label: '管理後台', icon: 'dashboard' }
            ]
        }
    ],

    init() {
        this.render();

        // AuthManager 向伺服器確認完登入狀態後再畫一次，會員／管理區塊才會出現
        if (typeof AuthManager !== 'undefined' && AuthManager.ready) {
            AuthManager.ready.then(() => this.render());
        }
    },

    currentPage() {
        return window.location.pathname.split('/').pop() || 'index.html';
    },

    render() {
        const container = document.getElementById('sidebar');
        if (!container) return;

        const isLoggedIn = typeof AuthManager !== 'undefined' && AuthManager.isLoggedIn();
        const isAdmin = isLoggedIn && AuthManager.getUser()?.role === 'admin';
        const current = this.currentPage();

        const sections = this.sections
            .filter(section => {
                if (section.requiresAdmin) return isAdmin;
                if (section.requiresAuth) return isLoggedIn;
                return true;
            })
            .map(section => `
                <div class="sidebar-section">
                    <p class="sidebar-section-label">${escapeHtml(section.label)}</p>
                    <ul class="sidebar-nav">
                        ${section.items.map(item => `
                            <li>
                                <a class="sidebar-link${item.href === current ? ' active' : ''}"
                                   href="${escapeHtml(item.href)}"
                                   ${item.id ? `id="${item.id}"` : ''}>
                                    ${sidebarIcon(item.icon)}
                                    <span>${escapeHtml(item.label)}</span>
                                </a>
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `).join('');

        container.innerHTML = `
            <div class="sidebar-inner">
                ${sections}
                ${isLoggedIn ? this.renderUserCard() : this.renderGuestCard()}
            </div>
        `;
    },

    renderUserCard() {
        const user = AuthManager.getUser();
        const initial = (user.username || '?').trim().charAt(0).toUpperCase();

        return `
            <div class="sidebar-user">
                <div class="sidebar-avatar">${escapeHtml(initial)}</div>
                <div class="sidebar-user-info">
                    <p class="sidebar-username">${escapeHtml(user.username)}</p>
                    <p class="sidebar-balance">NT$ <span class="user-balance">${user.balance}</span></p>
                </div>
            </div>
        `;
    },

    renderGuestCard() {
        return `
            <div class="sidebar-user sidebar-guest">
                <p class="mb-2 small text-muted">登入後即可訂票與查看票夾</p>
                <button type="button" class="btn btn-primary btn-sm w-100" id="sidebar-login-btn">登入 / 註冊</button>
            </div>
        `;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Sidebar.init();
});

// 側邊欄的票夾與登入按鈕沿用既有的事件委派
document.addEventListener('click', (e) => {
    if (e.target.closest('#sidebar-wallet-btn')) {
        e.preventDefault();
        WalletSidebar.toggle();
    }
    if (e.target.closest('#sidebar-login-btn')) {
        e.preventDefault();
        new bootstrap.Modal(document.getElementById('authModal')).show();
    }
});
