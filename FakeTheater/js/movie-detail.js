// 電影詳情頁面邏輯 - 使用 DataAPI 載入資料

document.addEventListener('DOMContentLoaded', async function () {
    // 從 URL 取得電影 ID
    const urlParams = new URLSearchParams(window.location.search);
    const movieId = parseInt(urlParams.get('id'));

    // 顯示載入狀態
    const container = document.getElementById('movie-detail-container');
    const showtimesContainer = document.getElementById('movie-showtimes');

    if (container) {
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">載入中...</span>
                </div>
                <p class="mt-3 text-muted">正在從資料庫載入電影資料...</p>
            </div>
        `;
    }

    try {
        // 從 API 取得電影資料
        const movie = await DataAPI.getMovieById(movieId);

        if (!movie) {
            // 電影不存在，顯示錯誤訊息
            if (container) {
                container.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-danger">
                            <h4><i class="fas fa-exclamation-triangle"></i> 找不到電影</h4>
                            <p>您查詢的電影不存在，請返回首頁重新選擇。</p>
                            <a href="index.html" class="btn btn-primary">返回首頁</a>
                        </div>
                    </div>
                `;
            }
            if (showtimesContainer) {
                showtimesContainer.innerHTML = '';
            }
            return;
        }

        // 更新頁面標題
        document.title = `${movie.title} - 電影購票系統`;
        const movieTitleElement = document.getElementById('movie-title');
        if (movieTitleElement) {
            movieTitleElement.textContent = movie.title;
        }

        // 渲染電影詳情
        if (container) {
            container.innerHTML = `
                <div class="col-md-4 mb-4">
                    <img src="${escapeHtml(movie.posterImage)}" alt="${escapeHtml(movie.title)}" class="img-fluid rounded shadow movie-poster-large" style="width: 100%; max-width: 350px;">
                </div>
                <div class="col-md-8">
                    <div class="card shadow-sm">
                        <div class="card-body">
                            <h3 class="card-title text-primary mb-3">${escapeHtml(movie.title)}</h3>
                            <div class="mb-3">
                                <span class="badge bg-warning text-dark fs-6">
                                    ⭐ ${escapeHtml(movie.rating)}/10
                                </span>
                                <span class="badge bg-secondary ms-2">${escapeHtml(movie.ratingClass)}</span>
                                <span class="badge bg-info ms-2">${escapeHtml(movie.duration)}</span>
                            </div>
                            
                            <h5 class="mt-4 mb-3">📖 劇情簡介</h5>
                            <p class="card-text text-muted lh-lg">${escapeHtml(movie.description)}</p>

                            <hr class="my-4">

                            <h5 class="mb-3">📋 電影資訊</h5>
                            <div class="row">
                                <div class="col-sm-6">
                                    <ul class="list-unstyled">
                                        <li class="mb-2"><strong> 片長：</strong> ${escapeHtml(movie.duration)}</li>
                                        <li class="mb-2"><strong> 分級：</strong> ${escapeHtml(movie.ratingClass)}</li>
                                    </ul>
                                </div>
                                <div class="col-sm-6">
                                    <ul class="list-unstyled">
                                        <li class="mb-2"><strong>上映日期：</strong> ${escapeHtml(movie.releaseDate)}</li>
                                        <li class="mb-2"><strong>類別：</strong> ${getCategoryLabel(movie.category)}</li>
                                    </ul>
                                </div>
                            </div>

                            <div class="mt-4">
                                <a href="booking.html?movie=${movie.id}" class="btn btn-primary btn-lg">
                                     立即訂票
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // 取得場次資料
        await loadShowtimes(movieId, movie);

    } catch (error) {
        console.error('載入電影失敗:', error);
        if (container) {
            container.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger">
                        <h4><i class="fas fa-exclamation-triangle"></i> 載入失敗</h4>
                        <p>無法載入電影資料，請稍後再試。</p>
                        <p class="small text-muted">錯誤: ${escapeHtml(error.message)}</p>
                        <a href="index.html" class="btn btn-primary">返回首頁</a>
                    </div>
                </div>
            `;
        }
    }

    // 取得類別標籤
    function getCategoryLabel(category) {
        const labels = {
            'NowShowing': '現正熱映',
            'TopPick': '精選推薦',
            'ComingSoon': '即將上映'
        };
        return labels[category] || escapeHtml(category);
    }

    // 載入場次資料
    async function loadShowtimes(movieId, movie) {
        try {
            // 取得影廳資料
            const theaters = await DataAPI.getTheaters();

            // 取得該電影的所有場次
            const showtimes = await DataAPI.getShowtimesByMovie(movieId);

            // 按日期分組
            const showtimesByDate = {};
            const days = DataAPI.getNextDays(7);

            days.forEach(day => {
                showtimesByDate[day.dateStr] = {
                    ...day,
                    times: []
                };
            });

            showtimes.forEach(st => {
                if (showtimesByDate[st.date]) {
                    const theater = theaters.find(t => t.id === st.theaterId);
                    showtimesByDate[st.date].times.push({
                        id: st.id,
                        time: st.time,
                        theater: theater || { name: '未知影廳' },
                        price: st.price
                    });
                }
            });

            // 過濾出有場次的日期，並按時間排序
            const validDays = Object.values(showtimesByDate)
                .filter(day => day.times.length > 0)
                .map(day => ({
                    ...day,
                    times: day.times.sort((a, b) => a.time.localeCompare(b.time))
                }));

            renderShowtimes(validDays, movie);

        } catch (error) {
            console.error('載入場次失敗:', error);
            if (showtimesContainer) {
                showtimesContainer.innerHTML = `
                    <div class="col-12">
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-circle"></i> 無法載入場次資料
                        </div>
                    </div>
                `;
            }
        }
    }

    // 渲染場次
    function renderShowtimes(days, movie) {
        if (!showtimesContainer) return;

        if (days.length === 0) {
            showtimesContainer.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> 目前尚無可用場次
                    </div>
                </div>
            `;
            return;
        }

        showtimesContainer.innerHTML = days.map(day => `
            <div class="col-12 mb-3">
                <div class="card showtime-card shadow-sm">
                    <div class="card-header bg-light">
                        <strong>${day.isToday ? '🔥 今天' : day.displayStr}</strong>
                        <span class="text-muted ms-2">週${day.dayOfWeek}</span>
                        <span class="badge bg-primary ms-2">${day.times.length} 場</span>
                    </div>
                    <div class="card-body">
                        <div class="showtime-slots">
                            ${day.times.map(st => `
                                <a class="showtime-slot"
                                   href="booking.html?showtime=${st.id}&movie=${movie.id}&date=${day.dateStr}&time=${st.time}">
                                    <span class="slot-time">${st.time}</span>
                                    <span class="slot-meta">${escapeHtml(st.theater.name)} · NT$${st.price}</span>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }
});
