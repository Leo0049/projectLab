/**
 * 共用功能模組 - HTML 轉義、側邊欄狀態、回到頂部按鈕
 *
 * 共用樣式統一放在 css/custom.css，本檔只負責行為。
 */

/**
 * 將字串轉為可安全放進 innerHTML 的文字
 * 全站以樣板字串組 HTML，凡是使用者可控的內容都要經過這裡
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CommonUI = {
    init() {
        this.setSidebarActiveState();
        this.createBackToTopButton();
        this.bindEvents();
    },

    // 設定側邊欄當前頁面 active 狀態
    setSidebarActiveState() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const sidebarLinks = document.querySelectorAll('#sidebar .sidebarstyle');

        sidebarLinks.forEach(link => {
            const href = link.getAttribute('href');
            link.classList.toggle('active', href === currentPage);
        });

        // 同時處理手機版導覽列中的連結
        document.querySelectorAll('.navbar-nav .nav-link.d-lg-none').forEach(link => {
            if (link.getAttribute('href') === currentPage) {
                link.classList.add('active');
            }
        });
    },

    // 建立回到頂部按鈕
    createBackToTopButton() {
        if (document.getElementById('backToTopBtn')) return;

        const btn = document.createElement('button');
        btn.id = 'backToTopBtn';
        btn.className = 'back-to-top';
        btn.type = 'button';
        btn.innerHTML = '↑';
        btn.title = '回到頂部';
        btn.setAttribute('aria-label', '回到頂部');
        document.body.appendChild(btn);
    },

    bindEvents() {
        const backToTopBtn = document.getElementById('backToTopBtn');
        if (!backToTopBtn) return;

        window.addEventListener('scroll', () => {
            backToTopBtn.classList.toggle('visible', window.scrollY > 300);
        }, { passive: true });

        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CommonUI.init();
});
