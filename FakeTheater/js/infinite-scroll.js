/**
 * 無限滾動
 *
 * 用 IntersectionObserver 監看列表尾端的哨兵元素，捲到附近就自動載入下一頁。
 * 比監聽 scroll 事件好：不需要節流、不會在每次捲動都計算版面。
 *
 * 用法：
 *   const scroller = new InfiniteScroll({
 *       container,               // 放哨兵的容器
 *       loadPage: offset => ..., // 回傳 {items, total, hasMore}
 *       render: items => ...,    // 把新資料接到畫面上
 *       pageSize: 20
 *   });
 *   scroller.reset();            // 重新從第一頁開始
 */

class InfiniteScroll {
    constructor({ container, loadPage, render, onEmpty, pageSize = 20, rootMargin = '240px' }) {
        this.container = container;
        this.loadPage = loadPage;
        this.render = render;
        this.onEmpty = onEmpty;
        this.pageSize = pageSize;

        this.offset = 0;
        this.total = 0;
        this.loading = false;
        this.done = false;
        // 每次 reset 會遞增，用來丟棄前一次查詢晚回來的結果
        this.generation = 0;

        this.sentinel = document.createElement('div');
        this.sentinel.className = 'infinite-sentinel';
        this.container.appendChild(this.sentinel);

        this.observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) this.loadMore();
        }, { rootMargin });

        this.observer.observe(this.sentinel);
    }

    /**
     * 重新開始（例如換了查詢條件）
     */
    reset() {
        this.generation += 1;
        this.offset = 0;
        this.total = 0;
        this.done = false;
        this.loading = false;
        this.setSentinel('');
        return this.loadMore();
    }

    setSentinel(html) {
        this.sentinel.innerHTML = html;
    }

    showLoading() {
        this.setSentinel(`
            <div class="infinite-loading">
                <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                載入中…
            </div>
        `);
    }

    showEnd() {
        this.setSentinel(
            this.total > 0
                ? `<div class="infinite-end">已顯示全部 ${this.total} 筆</div>`
                : ''
        );
    }

    showError(message) {
        this.setSentinel(`
            <div class="infinite-error">
                <p class="mb-2">${message}</p>
                <button type="button" class="btn btn-sm btn-outline-primary" data-retry>重試</button>
            </div>
        `);
        this.sentinel.querySelector('[data-retry]')
            ?.addEventListener('click', () => this.loadMore());
    }

    async loadMore() {
        if (this.loading || this.done) return;

        this.loading = true;
        const generation = this.generation;
        this.showLoading();

        try {
            const result = await this.loadPage(this.offset, this.pageSize);

            // 期間已經 reset 過，這批資料是舊查詢的，直接丟掉
            if (generation !== this.generation) return;

            this.total = result.total ?? 0;
            const items = result.items || [];

            if (this.offset === 0 && items.length === 0) {
                this.done = true;
                this.setSentinel('');
                if (this.onEmpty) this.onEmpty();
                return;
            }

            this.offset += items.length;
            this.render(items, { isFirstPage: this.offset === items.length, total: this.total });

            if (!result.hasMore || items.length === 0) {
                this.done = true;
                this.showEnd();
            } else {
                this.setSentinel('');
                // 若新內容不足以把哨兵推出畫面，IntersectionObserver 不會再次觸發，
                // 重新 observe 一次強制它回報目前的可見狀態，繼續載下一頁
                this.observer.unobserve(this.sentinel);
                this.observer.observe(this.sentinel);
            }
        } catch (error) {
            if (generation !== this.generation) return;
            console.error('載入更多失敗:', error);
            this.showError(error.message || '載入失敗');
        } finally {
            if (generation === this.generation) this.loading = false;
        }
    }

    destroy() {
        this.observer.disconnect();
        this.sentinel.remove();
    }
}
