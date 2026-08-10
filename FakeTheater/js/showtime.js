// 場次查詢頁：依電影分組 + 無限滾動

document.addEventListener('DOMContentLoaded', async function () {
    const movieSelect = document.getElementById('search-movie');
    const theaterSelect = document.getElementById('search-theater');
    const dateInput = document.getElementById('search-date');
    const searchBtn = document.getElementById('search-btn');
    const resetBtn = document.getElementById('reset-btn');
    const resultsContainer = document.getElementById('showtime-results');
    const statsContainer = document.getElementById('showtime-stats');
    const sentinelContainer = document.getElementById('showtime-sentinel');
    const movieInfoSection = document.getElementById('movie-info-section');

    const PAGE_SIZE = 12;

    let allMovies = [];
    let allTheaters = [];

    // 目前畫面上已經建立的電影分組：movieId → 放時段按鈕的容器
    const groups = new Map();
    let showtimeCount = 0;
    let scroller = null;

    /* -------------------------------------------------------------- *
     * 初始化
     * -------------------------------------------------------------- */

    async function init() {
        showSkeleton();

        try {
            [allMovies, allTheaters] = await Promise.all([
                DataAPI.getMovies(),
                DataAPI.getTheaters()
            ]);
        } catch (error) {
            console.error('初始化失敗:', error);
            showError('無法載入資料，請重新整理頁面');
            return;
        }

        movieSelect.innerHTML = `
            <option value="">全部電影</option>
            ${allMovies.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('')}
        `;
        movieSelect.addEventListener('change', function () {
            updateMovieInfo(this.value);
        });

        theaterSelect.innerHTML = `
            <option value="">全部影廳</option>
            ${allTheaters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
        `;

        const today = DataAPI.getLocalDateStr();
        dateInput.min = today;
        dateInput.value = today;

        scroller = new InfiniteScroll({
            container: sentinelContainer,
            pageSize: PAGE_SIZE,
            loadPage: loadShowtimePage,
            render: appendShowtimes,
            onEmpty: showEmptyState
        });

        performSearch();
    }

    /* -------------------------------------------------------------- *
     * 資料載入
     * -------------------------------------------------------------- */

    async function loadShowtimePage(offset, limit) {
        const { showtimes, total, hasMore } = await DataAPI.getShowtimePage({
            movieId: movieSelect.value,
            date: dateInput.value,
            theaterId: theaterSelect.value,
            limit,
            offset
        });

        return { items: showtimes, total, hasMore };
    }

    function performSearch() {
        resultsContainer.innerHTML = '';
        statsContainer.innerHTML = '';
        groups.clear();
        showtimeCount = 0;
        scroller.reset();
    }

    /* -------------------------------------------------------------- *
     * 畫面
     * -------------------------------------------------------------- */

    function showSkeleton() {
        resultsContainer.innerHTML = Array.from({ length: 3 }, () => `
            <div class="col-12 mb-3">
                <div class="loading-skeleton loading-showtime-card"></div>
            </div>
        `).join('');
    }

    function showError(message) {
        resultsContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">${escapeHtml(message)}</div>
            </div>
        `;
    }

    function showEmptyState() {
        statsContainer.innerHTML = '';
        resultsContainer.innerHTML = `
            <div class="col-12">
                <div class="empty-state">
                    <span class="empty-icon">🔍</span>
                    <p class="mb-1">沒有找到符合條件的場次</p>
                    <p class="small mb-0">試著換個日期，或把影廳條件改成「全部影廳」。</p>
                </div>
            </div>
        `;
    }

    function updateStats(total) {
        statsContainer.innerHTML = `
            <div class="alert alert-light border mb-3">
                共 <strong>${total}</strong> 個場次，已顯示 <strong>${showtimeCount}</strong> 個
                （${groups.size} 部電影）
            </div>
        `;
    }

    /**
     * 把新一頁的場次接到畫面上：同一部電影併入既有分組，新電影建立新卡片
     */
    function appendShowtimes(showtimes, { isFirstPage, total }) {
        if (isFirstPage) {
            resultsContainer.innerHTML = '';
            groups.clear();
            showtimeCount = 0;
        }

        const multiDay = !dateInput.value;

        showtimes.forEach(showtime => {
            let slotsContainer = groups.get(showtime.movieId);

            if (!slotsContainer) {
                slotsContainer = createGroupCard(showtime);
                groups.set(showtime.movieId, slotsContainer);
            }

            slotsContainer.insertAdjacentHTML('beforeend', renderSlot(showtime, multiDay));
            showtimeCount += 1;
        });

        updateStats(total);
    }

    function createGroupCard(showtime) {
        const movie = allMovies.find(m => m.id === showtime.movieId);

        const wrapper = document.createElement('div');
        wrapper.className = 'col-12 mb-3 showtime-group';
        wrapper.innerHTML = `
            <div class="card showtime-card">
                <div class="row g-0">
                    <div class="col-md-2 col-4 showtime-poster-col">
                        <a href="movie-detail.html?id=${showtime.movieId}" class="showtime-poster-link"
                           title="查看 ${escapeHtml(showtime.movieTitle)} 詳情">
                            <img src="${escapeHtml(showtime.moviePoster)}" class="showtime-poster"
                                 alt="${escapeHtml(showtime.movieTitle)}" loading="lazy">
                        </a>
                    </div>
                    <div class="col-md-10 col-8">
                        <div class="card-body">
                            <h5 class="card-title mb-1">
                                <a href="movie-detail.html?id=${showtime.movieId}"
                                   class="text-decoration-none link-body-emphasis">${escapeHtml(showtime.movieTitle)}</a>
                            </h5>
                            <div class="movie-meta mb-3">
                                <span class="meta-rating">⭐ ${showtime.movieRating}</span>
                                ${movie ? `
                                    <span class="meta-sep">·</span><span>${escapeHtml(movie.duration)}</span>
                                    <span class="meta-sep">·</span><span>${escapeHtml(movie.ratingClass)}</span>
                                ` : ''}
                            </div>
                            <div class="showtime-slots"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        resultsContainer.appendChild(wrapper);
        return wrapper.querySelector('.showtime-slots');
    }

    function renderSlot(showtime, multiDay) {
        const dateLabel = multiDay ? `${formatShortDate(showtime.date)} · ` : '';
        return `
            <a class="showtime-slot"
               href="booking.html?showtime=${showtime.id}&movie=${showtime.movieId}&date=${showtime.date}&time=${showtime.time}">
                <span class="slot-time">${showtime.time}</span>
                <span class="slot-meta">${escapeHtml(dateLabel + showtime.theaterName)} · NT$${showtime.price}</span>
            </a>
        `;
    }

    // 2026-08-10 → 8/10
    function formatShortDate(dateStr) {
        const [, month, day] = dateStr.split('-');
        return `${parseInt(month)}/${parseInt(day)}`;
    }

    /* -------------------------------------------------------------- *
     * 電影詳情區塊
     * -------------------------------------------------------------- */

    function updateMovieInfo(movieId) {
        if (!movieInfoSection) return;

        const movie = movieId ? allMovies.find(m => m.id === parseInt(movieId)) : null;
        if (!movie) {
            movieInfoSection.style.display = 'none';
            return;
        }

        const poster = document.getElementById('showtime-movie-poster');
        if (poster) {
            poster.src = movie.posterImage;
            poster.alt = movie.title;
        }
        document.getElementById('showtime-movie-title').textContent = movie.title;
        document.getElementById('showtime-movie-rating').textContent = movie.rating;
        document.getElementById('showtime-movie-duration').textContent = movie.duration;
        document.getElementById('showtime-movie-class').textContent = movie.ratingClass;
        document.getElementById('showtime-movie-description').textContent = movie.description;

        movieInfoSection.style.display = 'block';
    }

    /* -------------------------------------------------------------- *
     * 事件
     * -------------------------------------------------------------- */

    searchBtn.addEventListener('click', performSearch);

    resetBtn.addEventListener('click', function () {
        movieSelect.value = '';
        theaterSelect.value = '';
        dateInput.value = DataAPI.getLocalDateStr();
        updateMovieInfo('');
        performSearch();
    });

    await init();
});
