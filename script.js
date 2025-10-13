document.addEventListener('DOMContentLoaded', () => {
    const stockInput = document.getElementById('stock-input');
    const addStockBtn = document.getElementById('add-stock-btn');
    const stockContainer = document.getElementById('stock-container');
    
    const modal = document.getElementById('chart-modal');
    const modalStockSymbol = document.getElementById('modal-stock-symbol');
    const closeModalBtn = document.querySelector('.close-btn');
    const modalChartCanvas = document.getElementById('modal-chart');
    let chartInstance = null;

    let stocks = [];
    const initialStocks = [
        'AMD', 'EOSE', 'NVDA', 'HOOD', 'RKLB', 'RCAT', 'OSCR', 'META', 'SOFI', 
        'PLTR', 'TSLA', 'AVGO', 'COIN', 'CRCL', 'GOOGL', 'MSTR', 'AAPL', 'MSFT', 
        'AMZN', 'INTC', 'SPOT', 'UBER', 'CRWD', 'CRM', 'TEAM', 'DKNG', 'HUBS', 
        'MRVL', 'SMCI', 'TMDX', 'UNH', 'OUST', 'HIMS', 'CYBR', 'OKLO'
    ];

    function loadInitialStocks() {
        stockContainer.innerHTML = '';
        stocks = [];
        initialStocks.forEach(symbol => addStock(symbol));
    }

    addStockBtn.addEventListener('click', () => {
        const stockSymbol = stockInput.value.toUpperCase().trim();
        if (stockSymbol) {
            addStock(stockSymbol);
            stockInput.value = '';
        }
    });

    async function addStock(symbol) {
        const url = `/api/stock/${symbol}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            // Sunucudan gelen hata mesajını kontrol et
            if (!response.ok || data.error) {
                throw new Error(data.error || `Sunucudan hata kodu geldi: ${response.status}`);
            }

            if (data.chart.result && data.chart.result[0]) {
                const meta = data.chart.result[0].meta;
                const indicators = data.chart.result[0].indicators.quote[0];

                const latestPrice = meta.regularMarketPrice;
                const previousPrice = meta.previousClose;
                
                const change = latestPrice - previousPrice;
                const changePercent = (change / previousPrice) * 100;
                
                const history = indicators.close.slice(-30);
                const timestamps = data.chart.result[0].timestamp.slice(-30);
                const labels = timestamps.map(ts => new Date(ts * 1000).toLocaleDateString());

                const stock = {
                    symbol: symbol,
                    price: latestPrice.toFixed(2),
                    change: change.toFixed(2),
                    changePercent: changePercent ? changePercent.toFixed(2) : '0.00',
                    history: history,
                    labels: labels
                };

                if (!stocks.some(s => s.symbol === symbol)) {
                    stocks.push(stock);
                    appendStockCard(stock);
                }
            } else {
                console.warn(`'${symbol}' için veri alınamadı.`, data);
                if (!initialStocks.includes(symbol)) {
                    alert(`'${symbol}' hissesi bulunamadı.`);
                }
            }
        } catch (error) {
            console.error(`'${symbol}' için veri alınırken hata oluştu:`, error.message);
            // Sadece ilk hissede hata mesajı göster, diğerleri için konsola yaz.
            if (stocks.length === 0) {
                alert(`Veri alınırken bir hata oluştu: ${error.message}. Lütfen internet bağlantınızı ve terminaldeki sunucu loglarını kontrol edin.`);
            }
        }
    }

    function appendStockCard(stock) {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const sign = stock.change >= 0 ? '+' : '';

        const stockCard = document.createElement('div');
        stockCard.classList.add('stock-card');
        stockCard.dataset.symbol = stock.symbol;
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        
        stockCard.innerHTML = `
            <h2>${stock.symbol}</h2>
            <div class="price">${currency}${stock.price}</div>
            <div class="change ${changeClass}">
                ${sign}${stock.change} (${sign}${stock.changePercent ? stock.changePercent.toFixed(2) : '0.00'}%)
            </div>
        `;
        
        stockCard.addEventListener('click', () => openChartModal(stock.symbol));
        stockContainer.appendChild(stockCard);
    }

    function openChartModal(symbol) {
        const stock = stocks.find(s => s.symbol === symbol);
        if (!stock) return;

        modalStockSymbol.textContent = stock.symbol;
        modal.style.display = 'flex';
        renderModalChart(stock);
    }

    function renderModalChart(stock) {
        if (chartInstance) {
            chartInstance.destroy();
        }
        chartInstance = new Chart(modalChartCanvas, {
            type: 'line',
            data: {
                labels: stock.labels,
                datasets: [{
                    label: 'Fiyat',
                    data: stock.history,
                    borderColor: stock.change >= 0 ? '#2ecc71' : '#e74c3c',
                    backgroundColor: stock.change >= 0 ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                    fill: true,
                    tension: 0.1,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { ticks: { callback: (value) => '$' + value } } }
            }
        });
    }

    closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    });

    loadInitialStocks();
});
