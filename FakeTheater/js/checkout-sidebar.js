/**
 * 結帳側邊欄
 *
 * 座位在開啟這個側邊欄之前就已經由伺服器保留住了（見 booking.js 的 onConfirm），
 * 所以這裡會顯示保留倒數；時間到就自動放棄，把位子還給其他人。
 * 扣款與開票都在伺服器完成，前端只負責顯示結果。
 */

const CheckoutSidebar = {
    isOpen: false,
    orderData: null,
    paid: false,
    lockTimer: null,

    init() {
        this.renderSidebar();
        this.bindEvents();
    },

    renderSidebar() {
        if (document.getElementById('checkoutSidebar')) return;

        const sidebarHTML = `
        <div class="checkout-overlay" id="checkoutOverlay"></div>

        <div class="checkout-sidebar" id="checkoutSidebar">
            <div class="checkout-sidebar-header">
                <h5 class="mb-0">確認訂單</h5>
                <button type="button" class="btn-close" id="checkout-close-btn" aria-label="Close"></button>
            </div>
            <div class="checkout-sidebar-body">
                <!-- 座位保留倒數 -->
                <div class="lock-timer" id="checkout-lock-timer">
                    座位保留中，剩餘 <strong id="checkout-lock-remaining">--:--</strong>
                </div>

                <!-- 訂單明細 -->
                <div class="order-card mb-4">
                    <div id="checkout-order-details"></div>
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

    bindEvents() {
        document.addEventListener('click', (e) => {
            if (e.target.id === 'checkout-close-btn' || e.target.closest('#checkout-close-btn')) {
                this.close();
                return;
            }

            if (e.target.id === 'checkoutOverlay') {
                this.close();
                return;
            }

            if (e.target.id === 'checkout-deposit-btn' || e.target.closest('#checkout-deposit-btn')) {
                e.preventDefault();
                if (!AuthManager.isLoggedIn()) {
                    AuthManager.showToast('請先登入', 'warning');
                    return;
                }
                new bootstrap.Modal(document.getElementById('depositModal')).show();
                return;
            }

            if (e.target.id === 'checkout-pay-btn' || e.target.closest('#checkout-pay-btn')) {
                this.handlePayment();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.close();
        });

        // 餘額變動時即時更新（由 AuthManager.updateBalanceDisplay 發出）
        document.addEventListener('balance:changed', () => {
            if (this.isOpen && this.orderData) this.updateBalanceDisplay();
        });
    },

    /* -------------------------------------------------------------- *
     * 開關
     * -------------------------------------------------------------- */

    open(orderData) {
        if (!orderData) {
            console.error('缺少訂單資料');
            return;
        }

        const sidebar = document.getElementById('checkoutSidebar');
        const overlay = document.getElementById('checkoutOverlay');
        if (!sidebar || !overlay) return;

        this.orderData = orderData;
        this.paid = false;

        this.renderOrderDetails();
        this.updateBalanceDisplay();
        this.startLockCountdown();

        sidebar.classList.add('open');
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        this.isOpen = true;
    },

    close() {
        const sidebar = document.getElementById('checkoutSidebar');
        const overlay = document.getElementById('checkoutOverlay');
        if (!sidebar || !overlay) return;

        this.stopLockCountdown();

        // 沒付款就離開 → 把保留的位子還回去，不要佔著。
        // 保留已過期的話，座位早就被伺服器清掉了，不必多打這一槍，
        // 但座位圖仍要重繳，清掉畫面上殘留的選位狀態。
        if (this.orderData && !this.paid) {
            const lockValid = Date.now() < (this.orderData.expiresAt || Infinity);
            const released = lockValid
                ? DataAPI.releaseSeats(this.orderData.showtimeId)
                : Promise.resolve();
            released
                .then(() => {
                    if (typeof refreshSeatMap === 'function') refreshSeatMap();
                })
                .catch(error => console.warn('釋放座位失敗:', error));
        }

        sidebar.classList.remove('open');
        overlay.classList.remove('open');
        document.body.style.overflow = '';
        this.isOpen = false;
        this.orderData = null;
    },

    /* -------------------------------------------------------------- *
     * 座位保留倒數
     * -------------------------------------------------------------- */

    startLockCountdown() {
        this.stopLockCountdown();

        const timerBox = document.getElementById('checkout-lock-timer');
        const remainingEl = document.getElementById('checkout-lock-remaining');
        if (!timerBox || !remainingEl || !this.orderData?.expiresAt) {
            if (timerBox) timerBox.style.display = 'none';
            return;
        }

        timerBox.style.display = 'block';

        const tick = () => {
            const msLeft = this.orderData.expiresAt - Date.now();

            if (msLeft <= 0) {
                this.stopLockCountdown();
                AuthManager.showToast('座位保留時間已到，請重新選位', 'warning');
                this.close();
                return;
            }

            const totalSeconds = Math.ceil(msLeft / 1000);
            const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
            const seconds = String(totalSeconds % 60).padStart(2, '0');
            remainingEl.textContent = `${minutes}:${seconds}`;
            timerBox.classList.toggle('is-urgent', totalSeconds <= 60);
        };

        tick();
        this.lockTimer = setInterval(tick, 1000);
    },

    stopLockCountdown() {
        if (this.lockTimer) {
            clearInterval(this.lockTimer);
            this.lockTimer = null;
        }
    },

    /* -------------------------------------------------------------- *
     * 畫面
     * -------------------------------------------------------------- */

    renderOrderDetails() {
        const container = document.getElementById('checkout-order-details');
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

        document.getElementById('checkout-ticket-count').textContent = order.seats.length;
        document.getElementById('checkout-ticket-price').textContent = order.pricePerSeat;
        document.getElementById('checkout-total-amount').textContent = order.totalAmount;
    },

    updateBalanceDisplay() {
        if (!this.orderData) return;

        const balance = AuthManager.getBalance();
        const userBalanceEl = document.getElementById('checkout-user-balance');
        const remainingBalanceEl = document.getElementById('checkout-remaining-balance');
        const payBtn = document.getElementById('checkout-pay-btn');
        const insufficientAlert = document.getElementById('checkout-insufficient-alert');

        if (userBalanceEl) userBalanceEl.textContent = balance;

        const remaining = balance - this.orderData.totalAmount;

        if (remainingBalanceEl) {
            remainingBalanceEl.textContent = `NT$ ${remaining}`;
            remainingBalanceEl.className = remaining >= 0 ? 'text-success' : 'text-danger';
        }

        if (payBtn) payBtn.disabled = remaining < 0;
        if (insufficientAlert) insufficientAlert.style.display = remaining >= 0 ? 'none' : 'block';
    },

    /* -------------------------------------------------------------- *
     * 付款
     * -------------------------------------------------------------- */

    async handlePayment() {
        const payBtn = document.getElementById('checkout-pay-btn');
        if (!this.orderData || this.paid) return;

        if (!AuthManager.isLoggedIn()) {
            AuthManager.showToast('請先登入', 'warning');
            return;
        }

        const order = this.orderData;
        payBtn.disabled = true;

        try {
            // 扣款、座位檢查、開票都在伺服器的同一筆交易裡完成
            const { balance } = await DataAPI.createBooking({
                showtimeId: order.showtimeId,
                seats: order.seats
            });

            this.paid = true;
            AuthManager.setBalance(balance);
            AuthManager.showToast('付款成功！票券已加入票夾', 'success');
            this.close();

            if (typeof refreshSeatMap === 'function') {
                await refreshSeatMap();
            }
        } catch (error) {
            AuthManager.showToast(error.message || '付款失敗', 'danger');

            // 位子被搶走或保留已過期：關閉結帳並重新載入座位圖
            if (error.status === 409) {
                this.close();
                if (typeof refreshSeatMap === 'function') await refreshSeatMap();
            }
        } finally {
            if (this.isOpen) {
                this.updateBalanceDisplay();
            } else if (payBtn) {
                payBtn.disabled = false;
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CheckoutSidebar.init();
});
