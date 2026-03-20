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

    // 渲染結果
    function renderResults(results) {
        if (!resultsContainer) return;

        if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> 沒有找到符合條件的場次，請調整查詢條件。
                    </div>
                </div>
            `;
            return;
        }

        // 顯示結果統計
        const statsHtml = `
            <div class="col-12 mb-3">
                <div class="alert alert-light border">
                     找到 <strong>${results.length}</strong> 個場次
                </div>
            </div>
        `;

        resultsContainer.innerHTML = statsHtml + results.map(showtime => `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card h-100 showtime-card shadow-sm">
                    <div class="row g-0">
                        <div class="col-4">
                            <a href="movie-detail.html?id=${showtime.movieId}" title="查看 ${showtime.movieTitle} 詳情">
                                <img src="${showtime.moviePoster}" class="img-fluid rounded-start h-100" 
                                     alt="${showtime.movieTitle}" style="object-fit: cover; cursor: pointer;">
                            </a>
                        </div>
                        <div class="col-8">
                            <div class="card-body">
                                <h6 class="card-title text-truncate" title="${showtime.movieTitle}">
                                    ${showtime.movieTitle}
                                </h6>
                                <p class="card-text mb-1">
                                    <small class="text-muted">
                                        <i class="far fa-calendar"></i> ${showtime.date}
                                    </small>
                                </p>
                                <p class="card-text mb-1">
                                    <small class="text-muted">
                                        <i class="far fa-clock"></i> ${showtime.time}
                                    </small>
                                </p>
                                <p class="card-text mb-1">
                                    <small class="text-muted">
                                        <i class="fas fa-film"></i> ${showtime.theaterName}
                                    </small>
                                </p>
                                <p class="card-text mb-2">
                                    <span class="badge bg-success">NT$ ${showtime.price}</span>
                                    <span class="badge bg-warning text-dark">⭐ ${showtime.movieRating}</span>
                                </p>
                                <a href="booking.html?showtime=${showtime.id}&movie=${showtime.movieId}&date=${showtime.date}&time=${showtime.time}" 
                                   class="btn btn-primary btn-sm">
                                    立即訂票
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
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
