/**
 * 頁尾模組 - 自動插入統一的頁尾區域
 */

const Footer = {
    init() {
        this.renderFooter();
        this.setupResponsiveGroups();
    },

    /**
     * 頁尾連結區在手機版預設收合、桌機版恆常展開。
     * <details> 關閉時內容會被瀏覽器隱藏，無法純靠 CSS 覆寫，因此用 JS 同步 open 狀態。
     */
    setupResponsiveGroups() {
        const groups = document.querySelectorAll('#site-footer .footer-group');
        if (groups.length === 0) return;

        const desktop = window.matchMedia('(min-width: 768px)');

        const sync = () => {
            groups.forEach(group => { group.open = desktop.matches; });
        };

        sync();
        desktop.addEventListener('change', sync);
    },

    renderFooter() {
        // 避免重複插入
        if (document.getElementById('site-footer')) return;

        const footerHTML = `
        <footer id="site-footer" class="site-footer">
            <div class="footer-container">
                <div class="footer-main">
                    <!-- 品牌區塊 -->
                    <div class="footer-brand">
                        <h4 class="footer-logo"> FakeTheater</h4>
                        <p class="footer-tagline">您的最佳電影體驗夥伴</p>
                        <div class="footer-social">
                            <a href="#" class="social-link" title="Facebook">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
                                </svg>
                            </a>
                            <a href="#" class="social-link" title="Instagram">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                                </svg>
                            </a>
                            <a href="#" class="social-link" title="Twitter/X">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                                </svg>
                            </a>
                            <a href="#" class="social-link" title="YouTube">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                                </svg>
                            </a>
                        </div>
                    </div>

                    <!-- 快速連結（手機版可收合，桌機版恆常展開） -->
                    <details class="footer-group" open>
                        <summary class="footer-heading">快速連結</summary>
                        <ul class="footer-nav">
                            <li><a href="index.html">首頁</a></li>
                            <li><a href="showtime.html">場次查詢</a></li>
                            <li><a href="schedule.html">電影時刻表</a></li>
                            <li><a href="booking.html">線上訂票</a></li>
                        </ul>
                    </details>

                    <!-- 客戶服務 -->
                    <details class="footer-group" open>
                        <summary class="footer-heading">客戶服務</summary>
                        <ul class="footer-nav">
                            <li><a href="#">常見問題</a></li>
                            <li><a href="#">退票規則</a></li>
                            <li><a href="#">會員權益</a></li>
                            <li><a href="#">優惠活動</a></li>
                        </ul>
                    </details>

                    <!-- 聯絡我們 -->
                    <details class="footer-group" open>
                        <summary class="footer-heading">聯絡我們</summary>
                        <ul class="footer-nav">
                            <li><a href="mailto:service@faketheater.com">service@faketheater.com</a></li>
                            <li>客服專線: 04-1234-5678</li>
                            <li>服務時間: 09:00 - 22:00</li>
                            <li>台中市XX區XX路XX號</li>
                        </ul>
                    </details>
                </div>

                <!-- 底部版權 -->
                <div class="footer-bottom">
                    <div class="footer-legal">
                        <a href="#">隱私政策</a>
                        <span class="divider">|</span>
                        <a href="#">服務條款</a>
                        <span class="divider">|</span>
                        <a href="#">Cookie 政策</a>
                    </div>
                    <p class="footer-copyright">
                        © ${new Date().getFullYear()} FakeTheater. All rights reserved. 本網站僅供學習展示使用。
                    </p>
                </div>
            </div>
        </footer>
        `;

        // 插入到 body 結尾（但在 script 標籤之前）
        document.body.insertAdjacentHTML('beforeend', footerHTML);
    }
};

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    Footer.init();
});
