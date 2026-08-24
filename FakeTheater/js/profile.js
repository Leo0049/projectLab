/**
 * 個人專區：票券統計、消費紀錄（無限滾動）、金流付款回來的處理
 *
 * 原本是嵌在 profile.html 裡的內聯腳本；為了讓全站能啟用嚴格的
 * Content-Security-Policy（script-src 'self'，禁止內聯腳本），抽出成獨立檔案。
 */

const TRANSACTION_PAGE_SIZE = 15;

document.addEventListener('DOMContentLoaded', async function () {
    await AuthManager.ready;

    if (!AuthManager.isLoggedIn()) {
        window.location.replace('index.html');
        return;
    }

    const user = AuthManager.getUser();
    document.getElementById('current_amount').textContent = user.balance;

    const usernameInput = document.getElementById('usernameUpdate');
    usernameInput.placeholder = user.username;

    await handlePaymentReturn();

    setupTransactionScroll();
    loadTicketStats();

    document.getElementById('update-profile-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const newName = usernameInput.value.trim();

        if (!newName) {
            AuthManager.showToast('請輸入有效的名稱', 'warning');
            return;
        }

        const result = await AuthManager.updateUsername(newName);
        if (result.success) {
            AuthManager.showToast('用戶名已更新！', 'success');
            usernameInput.value = '';
            usernameInput.placeholder = newName;
        } else {
            AuthManager.showToast(result.message || '更新失敗', 'danger');
        }
    });
});

/**
 * 從金流商付款完導回來時，網址會帶 order 與 result。
 * 但真正的入帳是靠伺服器對伺服器的回調，所以這裡要向後端確認訂單狀態，
 * 不能直接相信網址上的 result 參數。
 */
async function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const orderNo = params.get('order');
    if (!orderNo) return;

    // 清掉網址參數，重新整理才不會又跳一次提示
    window.history.replaceState({}, '', window.location.pathname);

    try {
        const order = await DataAPI.getPaymentOrder(orderNo);

        if (order.status === 'paid') {
            await AuthManager.refreshUser();
            AuthManager.setBalance(AuthManager.getBalance());
            document.getElementById('current_amount').textContent = AuthManager.getBalance();
            AuthManager.showToast(`儲值成功，已入帳 NT$ ${order.amount}`, 'success');
        } else if (order.status === 'failed') {
            AuthManager.showToast('付款失敗，訂單未完成', 'danger');
        } else {
            AuthManager.showToast('付款結果處理中，請稍後重新整理', 'warning');
        }
    } catch (error) {
        AuthManager.showToast('無法確認付款結果', 'danger');
    }
}

// 票券統計
async function loadTicketStats() {
    try {
        const stats = await DataAPI.getTicketStats();
        document.getElementById('stat-unused').textContent = stats.activeTickets;
        document.getElementById('stat-used').textContent = stats.usedTickets;
        document.getElementById('stat-spent').textContent = stats.totalSpent;
        document.getElementById('stat-refunded').textContent = stats.refundedTickets;
    } catch (error) {
        console.error('載入票券統計失敗:', error);
    }
}

// 消費紀錄：捲到底自動載入更多
function setupTransactionScroll() {
    const tbody = document.getElementById('transaction-list');
    const noTransactions = document.getElementById('no-transactions');
    let rowIndex = 0;

    new InfiniteScroll({
        container: document.getElementById('transaction-sentinel'),
        pageSize: TRANSACTION_PAGE_SIZE,
        loadPage: async (offset, limit) => {
            const page = await DataAPI.getTransactionPage({ limit, offset });
            return { items: page.transactions, total: page.total, hasMore: page.hasMore };
        },
        render: (transactions, { isFirstPage }) => {
            if (isFirstPage) {
                tbody.innerHTML = '';
                rowIndex = 0;
                noTransactions.style.display = 'none';
            }
            tbody.insertAdjacentHTML('beforeend',
                transactions.map(t => renderTransactionRow(t, ++rowIndex)).join(''));
        },
        onEmpty: () => {
            tbody.innerHTML = '';
            noTransactions.style.display = 'block';
        }
    }).reset();
}

function renderTransactionRow(t, index) {
    const isIncome = t.amount > 0;
    const badgeClass = t.type === '退票' ? 'bg-info' : (isIncome ? 'bg-success' : 'bg-warning');

    return `
        <tr>
            <td>${index}</td>
            <td><span class="badge ${badgeClass}">${escapeHtml(t.type)}</span></td>
            <td class="small">${escapeHtml(t.movieTitle) || '-'}</td>
            <td class="small">${t.movieDate ? escapeHtml(`${t.movieDate} ${t.showtime || ''}`) : '-'}</td>
            <td class="${isIncome ? 'text-success' : 'text-danger'} fw-bold">
                ${isIncome ? '+' : ''}$${t.amount}
            </td>
            <td class="text-muted small">${escapeHtml(t.createdAt)}</td>
        </tr>
    `;
}
