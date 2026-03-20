/**
 * 共用功能模組 - 回到頂部按鈕、共用樣式等
 */

const CommonUI = {
    // 初始化
    init() {
        this.injectStyles();
        this.createBackToTopButton();
        this.setSidebarActiveState();
        this.bindEvents();
    },

    // 設定側邊欄當前頁面 active 狀態
    setSidebarActiveState() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const sidebarLinks = document.querySelectorAll('#sidebar .sidebarstyle');

        sidebarLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === currentPage) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // 同時處理手機版導覽列中的連結
        const mobileNavLinks = document.querySelectorAll('.navbar-nav .nav-link.d-lg-none');
        mobileNavLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href === currentPage) {
                link.classList.add('active');
            }
        });
    },

    // 注入共用樣式
    injectStyles() {
        if (document.getElementById('common-ui-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'common-ui-styles';
        styles.textContent = `
            /* 認證 Modal 樣式 */
            .auth-modal-content {
                border-radius: 16px;
                border: none;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            }

            .auth-tabs {
                background: #f8f9fa;
                border-radius: 10px;
                padding: 4px;
            }

            .auth-tabs .nav-link {
                border-radius: 8px;
                font-weight: 600;
                color: #666;
                transition: all 0.3s;
            }

            .auth-tabs .nav-link.active {
                background: linear-gradient(135deg, #505152, #2d2e2e);
                color: white;
            }

            .auth-divider {
                display: flex;
                align-items: center;
                text-align: center;
                color: #aaa;
            }

            .auth-divider::before,
            .auth-divider::after {
                content: '';
                flex: 1;
                border-bottom: 1px solid #ddd;
            }

            .auth-divider span {
                padding: 0 15px;
                font-size: 0.85rem;
            }

            .btn-google {
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid #ddd;
                border-radius: 8px;
                padding: 12px;
                font-weight: 500;
                transition: all 0.3s;
            }

            .btn-google:hover {
                background: #f8f9fa;
                border-color: #ccc;
            }

            /* 票夾側邊欄樣式 */
            .wallet-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s;
                z-index: 1040;
            }

            .wallet-overlay.open {
                opacity: 1;
                visibility: visible;
            }

            .wallet-sidebar {
                position: fixed;
                top: 0;
                right: -400px;
                width: 380px;
                max-width: 90vw;
                height: 100%;
                background: white;
                box-shadow: -5px 0 30px rgba(0, 0, 0, 0.2);
                transition: right 0.3s ease;
                z-index: 1050;
                display: flex;
                flex-direction: column;
            }

            .wallet-sidebar.open {
                right: 0;
            }

            .wallet-sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                background: linear-gradient(135deg, #505152, #2d2e2e);
                color: white;
            }

            .wallet-sidebar-header .btn-close {
                filter: brightness(0) invert(1);
            }

            .wallet-sidebar-body {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }

            /* 票券卡片樣式 */
            .ticket-card {
                background: white;
                border: 1px solid #eee;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
                transition: transform 0.2s;
            }

            .ticket-card:hover {
                transform: translateY(-2px);
            }

            .ticket-card.used {
                opacity: 0.7;
            }

            .ticket-card-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 15px;
                background: #f8f9fa;
            }

            .ticket-card-body {
                padding: 15px;
            }

            .ticket-card-footer {
                padding: 10px 15px;
                border-top: 1px dashed #eee;
                text-align: center;
            }

            /* 回到頂部按鈕 */
            .back-to-top {
                position: fixed;
                bottom: 30px;
                right: 30px;
                width: 50px;
                height: 50px;
                background: linear-gradient(135deg, #505152, #2d2e2e);
                color: white;
                border: none;
                border-radius: 50%;
                cursor: pointer;
                font-size: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s;
                z-index: 1000;
                box-shadow: 0 4px 15px #505152;
            }

            .back-to-top.visible {
                opacity: 1;
                visibility: visible;
            }

            .back-to-top:hover {
                transform: translateY(-5px);
                box-shadow: 0 8px 25px  #505152;
            }

            /* Toast 容器 */
            .toast-container {
                z-index: 9999 !important;
            }

            /* 導覽列用戶餘額 */
            .nav-link .user-balance {
                font-weight: bold;
            }

            /* 電影海報修正 */
            .movie-card .card-img-top,
            .card .card-img-top {
                width: 100%;
                height: auto;
                aspect-ratio: 2/3;
                object-fit: cover;
            }

            /* 修正座位圖顏色 - 圖例中的空位 */
            .seat-legend .seat-sample.available,
            .list-inline-item .seat:not(.selected):not(.occupied) {
                background: #e9ecef !important;
                border: 2px solid #adb5bd !important;
            }
        `;

        document.head.appendChild(styles);
    },

    // 創建回到頂部按鈕
    createBackToTopButton() {
        if (document.getElementById('backToTopBtn')) return;

        const btn = document.createElement('button');
        btn.id = 'backToTopBtn';
        btn.className = 'back-to-top';
        btn.innerHTML = '↑';
        btn.title = '回到頂部';
        document.body.appendChild(btn);
    },

    // 綁定事件
    bindEvents() {
        // 回到頂部按鈕
        const backToTopBtn = document.getElementById('backToTopBtn');
        if (backToTopBtn) {
            // 顯示/隱藏按鈕
            window.addEventListener('scroll', () => {
                if (window.scrollY > 300) {
                    backToTopBtn.classList.add('visible');
                } else {
                    backToTopBtn.classList.remove('visible');
                }
            });

            // 點擊回到頂部
            backToTopBtn.addEventListener('click', () => {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            });
        }
    }
};

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    CommonUI.init();
});
