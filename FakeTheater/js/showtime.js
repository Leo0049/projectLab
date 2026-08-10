// 場次查詢頁面邏輯 - 使用 DataAPI 載入資料

document.addEventListener('DOMContentLoaded', async function () {
    // 頁面元素
    const movieSelect = document.getElementById('search-movie');
    const theaterSelect = document.getElementById('search-theater');
    const dateInput = document.getElementById('search-date');
    const searchBtn = document.getElementById('search-btn');
    const resetBtn = document.getElementById('reset-btn');
    const resultsContainer = document.getElementById('showtime-results');
    const movieInfoSection = document.getElementById('movie-info-section');

    // 資料快取
    let allMovies = [];
    let allTheaters = [];
    let allShowtimes = [];

    // 初始化
    async function init() {
        showLoading();

        try {
            // 並行載入所有資料
            [allMovies, allTheaters, allShowtimes] = await Promise.all([
                DataAPI.getMovies(),
                DataAPI.getTheaters(),
                DataAPI.getShowtimes()
            ]);

            // 填充電影下拉選單
            if (movieSelect) {
                movieSelect.innerHTML = `
                    <option value="">全部電影</option>
                    ${allMovies.map(m => `<option value="${m.id}">${m.title}</option>`).join('')}
                `;

                // 監聽電影選擇變化
                movieSelect.addEventListener('change', function () {
                    updateMovieInfo(this.value);
                });
            }

            // 填充影廳下拉選單
            if (theaterSelect) {
                theaterSelect.innerHTML = `
                    <option value="">全部影廳</option>
                    ${allTheaters.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                `;
            }

            // 設定日期輸入的最小值為今天
            if (dateInput) {
                const today = new Date().toISOString().split('T')[0];
                dateInput.min = today;
                dateInput.value = today;
            }

            // 執行初始搜尋
            performSearch();

        } catch (error) {
            console.error('初始化失敗:', error);
            showError('無法載入資料，請重新整理頁面');
        }
    }

    // 顯示載入狀態
    function showLoading() {
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <div class="col-12 text-center py-5">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">載入中...</span>
                    </div>
                    <p class="mt-3 text-muted">正在從資料庫載入場次資料...</p>
                </div>
            `;
        }
    }

    // 顯示錯誤
    function showError(message) {
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle"></i> ${message}
                    </div>
                </div>
            `;
        }
    }

    // 執行搜尋
    function performSearch() {
        const movieId = movieSelect?.value;
        const theaterId = theaterSelect?.value;
        const date = dateInput?.value;

        let results = [...allShowtimes];

        // 篩選電影
        if (movieId) {
            results = results.filter(s => s.movieId === parseInt(movieId));
        }

        // 篩選日期
        if (date) {
            results = results.filter(s => s.date === date);
        }

        // 篩選影廳
        if (theaterId) {
            results = results.filter(s => s.theaterId === parseInt(theaterId));
        }

        // 按日期和時間排序
        results.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.time.localeCompare(b.time);
        });

        renderResults(results);
    }

    // 渲染結果：依電影分組，時段以「時間」為主視覺
    function renderResults(results) {
        if (!resultsContainer) return;

        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="col-12">
                    <div class="empty-state">
                        <span class="empty-icon">🔍</span>
                        <p class="mb-1">沒有找到符合條件的場次</p>
                        <p class="small mb-0">試著換個日期，或把影廳條件改成「所有影廳」。</p>
                    </div>
                </div>
            `;
            return;
        }

        // 依電影分組（維持原本已排序的先後順序）
        const groups = [];
        const groupIndex = new Map();

        results.forEach(showtime => {
            if (!groupIndex.has(showtime.movieId)) {
                groupIndex.set(showtime.movieId, groups.length);
                groups.push({
                    movie: allMovies.find(m => m.id === showtime.movieId),
                    movieId: showtime.movieId,
                    title: showtime.movieTitle,
                    poster: showtime.moviePoster,
                    rating: showtime.movieRating,
                    showtimes: []
                });
            }
            groups[groupIndex.get(showtime.movieId)].showtimes.push(showtime);
        });

        // 結果橫跨多天時，時段上要額外標出日期
        const multiDay = new Set(results.map(st => st.date)).size > 1;

        const statsHtml = `
            <div class="col-12 mb-3">
                <div class="alert alert-light border mb-0">
                    找到 <strong>${groups.length}</strong> 部電影、<strong>${results.length}</strong> 個場次
                </div>
            </div>
        `;

        resultsContainer.innerHTML = statsHtml + groups.map(group => `
            <div class="col-12 mb-3">
                <div class="card showtime-card">
                    <div class="row g-0">
                        <div class="col-md-2 col-4 showtime-poster-col">
                            <a href="movie-detail.html?id=${group.movieId}" class="showtime-poster-link"
                               title="查看 ${escapeHtml(group.title)} 詳情">
                                <img src="${escapeHtml(group.poster)}" class="showtime-poster"
                                     alt="${escapeHtml(group.title)}">
                            </a>
                        </div>
                        <div class="col-md-10 col-8">
                            <div class="card-body">
                                <h5 class="card-title mb-1">
                                    <a href="movie-detail.html?id=${group.movieId}"
                                       class="text-decoration-none link-body-emphasis">${escapeHtml(group.title)}</a>
                                </h5>
                                <div class="movie-meta mb-3">
                                    <span class="meta-rating">⭐ ${group.rating}</span>
                                    ${group.movie ? `
                                        <span class="meta-sep">·</span><span>${escapeHtml(group.movie.duration)}</span>
                                        <span class="meta-sep">·</span><span>${escapeHtml(group.movie.ratingClass)}</span>
                                    ` : ''}
                                    <span class="meta-sep">·</span><span>${group.showtimes.length} 個場次</span>
                                </div>
                                <div class="showtime-slots">
                                    ${group.showtimes.map(st => `
                                        <a class="showtime-slot"
                                           href="booking.html?showtime=${st.id}&movie=${st.movieId}&date=${st.date}&time=${st.time}">
                                            <span class="slot-time">${st.time}</span>
                                            <span class="slot-meta">
                                                ${multiDay ? escapeHtml(formatShortDate(st.date)) + ' · ' : ''}${escapeHtml(st.theaterName)} · NT$${st.price}
                                            </span>
                                        </a>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // 2026-08-10 → 8/10
    function formatShortDate(dateStr) {
        const [, month, day] = dateStr.split('-');
        return `${parseInt(month)}/${parseInt(day)}`;
    }

    // 更新電影詳情區塊
    function updateMovieInfo(movieId) {
        if (!movieInfoSection) return;

        if (!movieId) {
            // 沒有選擇特定電影，隱藏詳情區塊
            movieInfoSection.style.display = 'none';
            return;
        }

        const movie = allMovies.find(m => m.id === parseInt(movieId));
        if (!movie) {
            movieInfoSection.style.display = 'none';
            return;
        }

        // 填入電影資訊
        const poster = document.getElementById('showtime-movie-poster');
        const title = document.getElementById('showtime-movie-title');
        const rating = document.getElementById('showtime-movie-rating');
        const duration = document.getElementById('showtime-movie-duration');
        const ratingClass = document.getElementById('showtime-movie-class');
        const description = document.getElementById('showtime-movie-description');

        if (poster) {
            poster.src = movie.posterImage;
            poster.alt = movie.title;
        }
        if (title) title.textContent = movie.title;
        if (rating) rating.textContent = movie.rating;
        if (duration) duration.textContent = movie.duration;
        if (ratingClass) ratingClass.textContent = movie.ratingClass;
        if (description) description.textContent = movie.description;

        // 顯示區塊
        movieInfoSection.style.display = 'block';
    }

    // 綁定事件
    if (searchBtn) {
        searchBtn.addEventListener('click', performSearch);
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            if (movieSelect) movieSelect.value = '';
            if (theaterSelect) theaterSelect.value = '';
            if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
            updateMovieInfo(''); // 隱藏電影詳情
            performSearch();
        });
    }

    // 初始化頁面
    await init();
});
