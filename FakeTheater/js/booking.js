document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.endsWith('booking.html')) {
        setupBookingPage();
    }
});

let selectedSeats = [];
let showtimePrice = 0;

async function setupBookingPage() {
    const movieSelect = document.getElementById('movie-select');
    const dateSelect = document.getElementById('date-select');
    const showtimeSelect = document.getElementById('showtime-select');
    const seatMapContainer = document.getElementById('seat-map-container');

    // --- FAKE API for demonstration ---
    const FAKE_DB_BOOKING = {
        movies: [
            { id: 1, title: 'Inception' },
            { id: 2, title: 'The Dark Knight' },
            { id: 3, title: 'Interstellar' },
        ],
        showtimes: [
            { id: 1, movieId: 1, startTime: '2025-12-10 18:00:00', price: 12.00, theater: { rows: 10, cols: 15 } },
            { id: 2, movieId: 1, startTime: '2025-12-10 21:00:00', price: 12.00, theater: { rows: 10, cols: 15 } },
            { id: 3, movieId: 2, startTime: '2025-12-11 19:00:00', price: 15.00, theater: { rows: 8, cols: 20 } },
        ],
        occupiedSeats: [ // Fake occupied seats for a given showtime
            { row: 2, col: 5 },
            { row: 2, col: 6 },
            { row: 5, col: 10 },
            { row: 5, col: 11 },
        ]
    };

    // Populate movie select
    movieSelect.innerHTML = '<option selected disabled>Choose a movie...</option>' +
        FAKE_DB_BOOKING.movies.map(m => `<option value="${m.id}">${m.title}</option>`).join('');

    movieSelect.addEventListener('change', () => {
        const movieId = movieSelect.value;
        const availableDates = [...new Set(FAKE_DB_BOOKING.showtimes
            .filter(s => s.movieId == movieId)
            .map(s => s.startTime.split(' ')[0])
        )];
        
        dateSelect.innerHTML = '<option selected disabled>Choose a date...</option>' +
            availableDates.map(d => `<option value="${d}">${d}</option>`).join('');
        dateSelect.disabled = false;
        showtimeSelect.disabled = true;
        seatMapContainer.style.display = 'none';
    });

    dateSelect.addEventListener('change', () => {
        const movieId = movieSelect.value;
        const selectedDate = dateSelect.value;
        const availableShowtimes = FAKE_DB_BOOKING.showtimes
            .filter(s => s.movieId == movieId && s.startTime.startsWith(selectedDate));
            
        showtimeSelect.innerHTML = '<option selected disabled>Choose a showtime...</option>' +
            availableShowtimes.map(s => `<option value="${s.id}">${s.startTime.split(' ')[1]}</option>`).join('');
        showtimeSelect.disabled = false;
        seatMapContainer.style.display = 'none';
    });

    showtimeSelect.addEventListener('change', () => {
        const showtimeId = showtimeSelect.value;
        const showtime = FAKE_DB_BOOKING.showtimes.find(s => s.id == showtimeId);
        if (showtime) {
            showtimePrice = showtime.price;
            generateSeatMap(showtime.theater.rows, showtime.theater.cols, FAKE_DB_BOOKING.occupiedSeats);
            seatMapContainer.style.display = 'block';
        }
    });

    document.getElementById('confirm-booking-btn').addEventListener('click', confirmBooking);
}


function generateSeatMap(rows, cols, occupiedSeats) {
    const seatMap = document.getElementById('seat-map');
    seatMap.innerHTML = '';
    selectedSeats = [];

    for (let i = 1; i <= rows; i++) {
        for (let j = 1; j <= cols; j++) {
            const seat = document.createElement('div');
            seat.classList.add('seat');
            const isOccupied = occupiedSeats.some(s => s.row === i && s.col === j);

            if (isOccupied) {
                seat.classList.add('occupied');
            } else {
                seat.classList.add('available');
                seat.dataset.row = i;
                seat.dataset.col = j;
                seat.addEventListener('click', toggleSeatSelection);
            }
            seatMap.appendChild(seat);
        }
    }
    updateBookingSummary();
}

function toggleSeatSelection(event) {
    const seat = event.target;
    const seatId = `r${seat.dataset.row}c${seat.dataset.col}`;

    if (seat.classList.contains('selected')) {
        seat.classList.remove('selected');
        selectedSeats = selectedSeats.filter(s => s.id !== seatId);
    } else {
        seat.classList.add('selected');
        selectedSeats.push({ id: seatId, row: seat.dataset.row, col: seat.dataset.col });
    }
    updateBookingSummary();
}

function updateBookingSummary() {
    const bookingSummary = document.getElementById('booking-summary');
    if (selectedSeats.length > 0) {
        document.getElementById('summary-movie').textContent = document.getElementById('movie-select').selectedOptions[0].text;
        document.getElementById('summary-showtime').textContent = document.getElementById('date-select').value + ' ' + document.getElementById('showtime-select').selectedOptions[0].text;
        document.getElementById('summary-seats').textContent = selectedSeats.map(s => `R${s.row}C${s.col}`).join(', ');
        document.getElementById('summary-price').textContent = (selectedSeats.length * showtimePrice).toFixed(2);
        bookingSummary.style.display = 'block';
    } else {
        bookingSummary.style.display = 'none';
    }
}

async function confirmBooking() {
    const userInfo = JSON.parse(localStorage.getItem('userInfo'));
    if (!userInfo) {
        alert('Please login to book tickets.');
        window.location.href = 'login.html';
        return;
    }

    if (selectedSeats.length === 0) {
        alert('Please select at least one seat.');
        return;
    }

    const showtimeId = document.getElementById('showtime-select').value;
    
    // In a real app, you would make an API call like this:
    /*
    const response = await fetch('/api/reserve', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userInfo.token}`
        },
        body: JSON.stringify({
            userId: userInfo.id,
            showtimeId: showtimeId,
            seats: selectedSeats.map(s => ({ row: s.row, col: s.col }))
        })
    });

    if (response.ok) {
        alert('Booking successful!');
        window.location.href = 'wallet.html';
    } else {
        const error = await response.json();
        alert(`Booking failed: ${error.message}`);
        // Optionally refresh seat map
    }
    */

    // --- FAKE BOOKING ---
    console.log('Faking booking confirmation for user', userInfo.id);
    console.log('Showtime:', showtimeId);
    console.log('Seats:', selectedSeats);
    alert('Booking successful! (This is a demo)');
    window.location.href = 'wallet.html';
    // --- END FAKE BOOKING ---
}
