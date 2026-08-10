/**
 * 結帳側邊欄模組
 * 在 booking.html 中以側邊欄形式顯示結帳流程
 */

const CheckoutSidebar = {
    isOpen: false,
    orderData: null,

    // 初始化
    init() {
        this.renderSidebar();
        this.bindEvents();
    },

    // 渲染側邊欄
    renderSidebar() {
        if (document.getElementById('checkoutSidebar')) return;

        const sidebarHTML = `
        <!-- 結帳側邊欄遮罩 -->
        <div class="checkout-overlay" id="checkoutOverlay"></div>
        
        <!-- 結帳側邊欄 -->
        <div class="checkout-sidebar" id="checkoutSidebar">
            <div class="checkout-sidebar-header">
                <h5 class="mb-0">確認訂單</h5>
                <button type="button" class="btn-close" id="checkout-close-btn" aria-label="Close"></button>
            </div>
            <div class="checkout-sidebar-body">
                <!-- 訂單明細 -->
                <div class="order-card mb-4">
                    <div id="checkout-order-details">
                        <!-- 動態載入 -->
                    </div>
                </div>

                <!-- 付款資訊 -->
                <div class="payment-card">
                    <h6 class="payment-card-header">付款資訊</h6>
                    <div class="payment-card-body">
                        <div class="d-flex justify-content-between mb-2">
                            <span>票數</span>
                            <span id="checkout-ticket-count">0</span>
                        </div>
                        <div class="d-flex justify-content-between mb-2">
                            <span>單價</span>
                            <span>NT$ <span id="checkout-ticket-price">0</span></span>
                        </div>
                        <hr>
                        <div class="d-flex justify-content-between mb-3">
                            <strong>總計</strong>
                            <strong class="text-primary">NT$ <span id="checkout-total-amount">0</span></strong>
                        </div>

                        <hr>

                        <div class="d-flex justify-content-between mb-2">
                            <span>目前餘額</span>
                            <span class="text-success">NT$ <span id="checkout-user-balance">0</span></span>
                        </div>
                        <div class="d-flex justify-content-between mb-3">
                            <span>付款後餘額</span>
                            <span id="checkout-remaining-balance">NT$ 0</span>
                        </div>

                        <div id="checkout-insufficient-alert" class="alert alert-danger py-2 small" style="display: none;">
                            餘額不足，請先儲值
                        </div>

                        <div class="d-grid gap-2 mt-3">
                            <button id="checkout-pay-btn" class="btn btn-success btn-lg" disabled>
                                確認付款
                            </button>
                            <button id="checkout-deposit-btn" class="btn btn-outline-primary">
                                儲值
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', sidebarHTML);
    },

    // 綁定事件
    bindEvents() {
        // 關閉按鈕
        document.addEventListener('click', (e) => {
            if (e.target.id === 'checkout-close-btn' || e.target.closest('#checkout-close-btn')) {
                this.close();
            }
        });

        // 點擊遮罩關閉
        document.addEventListener('click', (e) => {
            if (e.target.id === 'checkoutOverlay') {
                this.close();
            }
        });

        // ESC 關閉
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });

        // 儲值按鈕
        document.addEventListener('click', (e) => {
            if (e.target.id === 'checkout-deposit-btn' || e.target.closest('#checkout-deposit-btn')) {
                e.preventDefault();
                if (!AuthManager.isLoggedIn()) {
                    AuthManager.showToast('請先登入', 'warning');
                    return;
                }
                const depositModal = new bootstrap.Modal(document.getElementById('depositModal'));
                depositModal.show();
            }
        });

        // 付款按鈕
        document.addEventListener('click', (e) => {
            if (e.target.id === 'checkout-pay-btn' || e.target.closest('#checkout-pay-btn')) {
                this.handlePayment();
            }
        });

        // 餘額變動時即時更新（由 AuthManager.updateBalanceDisplay 發出）
        document.addEventListener('balance:changed', () => {
            if (this.isOpen && this.orderData) {
                this.updateBalanceDisplay();
            }
        });
    },

    // 開啟側邊欄
    open(orderData) {
        if (!orderData) {
            console.error('缺少訂單資料');
            return;
        }

        this.orderData = orderData;

        const sidebar = document.getElementById('checkoutSidebar');
        const overlay = document.getElementById('checkoutOverlay');

        if (sidebar && overlay) {
            // 渲染訂單資訊
            this.renderOrderDetails();
            this.updateBalanceDisplay();

            sidebar.classList.add('open');
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
            this.isOpen = true;
        }
    },

    // 關閉側邊欄
    close() {
        const sidebar = document.getElementById('checkoutSidebar');
        const overlay = document.getElementById('checkoutOverlay');

        if (sidebar && overlay) {
            sidebar.classList.remove('open');
            overlay.classList.remove('open');
            document.body.style.overflow = '';
            this.isOpen = false;
        }
    },

    // 渲染訂單詳情
    renderOrderDetails() {
        const container = document.getElementById('checkout-order-details');
        const ticketCount = document.getElementById('checkout-ticket-count');
        const ticketPrice = document.getElementById('checkout-ticket-price');
        const totalAmount = document.getElementById('checkout-total-amount');

        if (!this.orderData || !container) return;

        const order = this.orderData;

        container.innerHTML = `
            <div class="order-movie-info">
                <img src="${escapeHtml(order.moviePoster || '')}"
                     class="order-movie-poster" alt="${escapeHtml(order.movieTitle)}">
                <div class="order-movie-details">
                    <h6 class="mb-2">${escapeHtml(order.movieTitle)}</h6>
                    <p class="mb-1 small"><strong>日期：</strong>${escapeHtml(order.date)}</p>
                    <p class="mb-1 small"><strong>時間：</strong>${escapeHtml(order.time)}</p>
                    <p class="mb-1 small"><strong>影廳：</strong>${escapeHtml(order.theaterName)}</p>
                    <p class="mb-1 small"><strong>座位：</strong>${escapeHtml(order.seatLabels)}</p>
                    <p class="mb-0 small"><strong>數量：</strong>${order.seats.length} 張</p>
                </div>
            </div>
        `;

        if (ticketCount) ticketCount.textContent = order.seats.length;
        if (ticketPrice) ticketPrice.textContent = order.pricePerSeat;
        if (totalAmount) totalAmount.textContent = order.totalAmount;
    },

    // 更新餘額顯示
    updateBalanceDisplay() {
        const balance = AuthManager.getBalance();
        const userBalanceEl = document.getElementById('checkout-user-balance');
        const remainingBalanceEl = document.getElementById('checkout-remaining-balance');
        const payBtn = document.getElementById('checkout-pay-btn');
        const insufficientAlert = document.getElementById('checkout-insufficient-alert');

        if (!this.orderData) return;

        if (userBalanceEl) {
            userBalanceEl.textContent = balance;
        }

        const remaining = balance - this.orderData.totalAmount;

        if (remainingBalanceEl) {
            remainingBalanceEl.textContent = `NT$ ${remaining}`;
            remainingBalanceEl.className = remaining >= 0 ? 'text-success' : 'text-danger';
        }

        if (remaining >= 0) {
            if (payBtn) payBtn.disabled = false;
            if (insufficientAlert) insufficientAlert.style.display = 'none';
        } else {
            if (payBtn) payBtn.disabled = true;
            if (insufficientAlert) insufficientAlert.style.display = 'block';
        }
    },

    // 處理付款
    async handlePayment() {
        const payBtn = document.getElementById('checkout-pay-btn');

        try {
            if (!this.orderData) return;

            if (!AuthManager.isLoggedIn()) {
                AuthManager.showToast('請先登入', 'warning');
                return;
            }

            if (AuthManager.getBalance() < this.orderData.totalAmount) {
                AuthManager.showToast('餘額不足', 'danger');
                return;
            }

            // 避免連點造成重複扣款
            if (payBtn) payBtn.disabled = true;

            const order = this.orderData;

            // 扣款（帶電影詳情，供個人專區的消費紀錄顯示）
            const deductDetails = {
                movieTitle: order.movieTitle,
                movieDate: order.date,
                showtime: order.time
            };

            if (!AuthManager.deduct(order.totalAmount, `購票 - ${order.movieTitle}`, deductDetails)) {
                AuthManager.showToast('扣款失敗，請確認餘額', 'danger');
                return;
            }

            const result = await DataAPI.createBooking({
                userId: AuthManager.getUser().id,
                showtimeId: order.showtimeId,
                movieId: order.movieId,
                seats: order.seats,
                movieTitle: order.movieTitle,
                moviePoster: order.moviePoster,
                date: order.date,
                time: order.time,
                theaterName: order.theaterName,
                pricePerSeat: order.pricePerSeat
            });

            if (!result.success) {
                // 訂票失敗就退款，不能只扣錢不給票
                AuthManager.deposit(order.totalAmount);
                AuthManager.showToast('訂票失敗：' + result.message, 'danger');
                return;
            }

            AuthManager.showToast('付款成功！票券已加入票夾', 'success');
            this.close();

            // 重畫座位圖，讓剛買的位子立刻變成已售出
            if (typeof refreshSeatMap === 'function') {
                await refreshSeatMap();
            } else {
                setTimeout(() => window.location.reload(), 1500);
            }
        } catch (error) {
            console.error('付款錯誤:', error);
            AuthManager.showToast('付款過程發生錯誤', 'danger');
        } finally {
            // 由餘額重新決定按鈕狀態（側邊欄已關閉時就不用管了）
            if (this.isOpen) {
                this.updateBalanceDisplay();
            } else if (payBtn) {
                payBtn.disabled = false;
            }
        }
    }
};

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', () => {
    CheckoutSidebar.init();
});
