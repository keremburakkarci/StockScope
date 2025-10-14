document.addEventListener('DOMContentLoaded', () => {
    const stockInput = document.getElementById('stock-input');
    const addStockBtn = document.getElementById('add-stock-btn');
    const stockContainer = document.getElementById('stock-container');
    
    const modal = document.getElementById('chart-modal');
    const modalStockSymbol = document.getElementById('modal-stock-symbol');
    const closeModalBtn = document.querySelector('.close-btn');
    const tradingViewWidget = document.getElementById('tradingview-widget');
    let currentStock = null;
    let currentTimeframe = '1d';
    let tradingViewChart = null;

    let stocks = [];
    let sortableInstance = null;
    let favorites = [];
    let updateInterval = null;
    let isUpdating = false;
    // Debug panel state
    const stockData = {}; // symbol -> last data
    let debugPanelEnabled = false;
    let debugInterval = null;
    const initialStocks = [
        'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA' // Only Magnificent 7
    ];

    // Magnificent 7 companies
    const magnificent7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'];

    function loadInitialStocks() {
        stockContainer.innerHTML = '';
        stocks = [];
        loadFavorites();
        
        // Load saved order
        const savedOrder = loadStockOrder();
        let stocksToLoad = initialStocks;
        
        if (savedOrder && savedOrder.length > 0) {
            // Use saved order, append missing ones to the end - ONLY FOR MAG7
            const mag7SavedOrder = savedOrder.filter(symbol => magnificent7.includes(symbol));
            const missingStocks = initialStocks.filter(symbol => !mag7SavedOrder.includes(symbol));
            stocksToLoad = [...mag7SavedOrder, ...missingStocks];
            console.log('Saved order loaded (Mag7 only):', mag7SavedOrder);
        }
        
        // Load all stocks sequentially
        async function loadAllStocks() {
            for (const symbol of stocksToLoad) {
                await addStock(symbol);
            }
            console.log('All stocks loaded, saving order');
            saveStockOrder();
            initializeSortable();
        }
        
        loadAllStocks();
    }

    function initializeSortable() {
        if (sortableInstance) {
            sortableInstance.destroy();
        }
        
        sortableInstance = new Sortable(stockContainer, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: function(evt) {
                // Update stocks array when order changes
                updateStocksOrder();
            }
        });
    }

    function updateStocksOrder() {
        const stockCards = stockContainer.querySelectorAll('.stock-card');
        const newStocks = [];
        
        stockCards.forEach(card => {
            const symbol = card.dataset.symbol;
            const stock = stocks.find(s => s.symbol === symbol);
            if (stock) {
                newStocks.push(stock);
            }
        });
        
        stocks = newStocks;
        saveStockOrder(); // Save order
        console.log('Stock order updated:', stocks.map(s => s.symbol));
    }

    function saveStockOrder() {
        const stockOrder = stocks.map(stock => stock.symbol);
        try {
            localStorage.setItem('stockOrder', JSON.stringify(stockOrder));
        } catch (e) {
            console.error('Sıralama kaydedilemedi:', e);
        }
    }

    function loadStockOrder() {
        const savedOrder = localStorage.getItem('stockOrder');
        if (savedOrder) {
            try {
                const orderArray = JSON.parse(savedOrder);
                // Filter only Magnificent 7 companies
                const mag7Order = orderArray.filter(symbol => magnificent7.includes(symbol));
                return mag7Order;
            } catch (e) {
                console.error('Could not read saved order:', e);
                return [];
            }
        }
        return [];
    }

    function loadFavorites() {
        const savedFavorites = localStorage.getItem('favorites');
        if (savedFavorites) {
            try {
                favorites = JSON.parse(savedFavorites);
                console.log('Favorites loaded:', favorites);
            } catch (e) {
                console.error('Could not read favorites:', e);
                favorites = [];
            }
        } else {
            favorites = [];
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem('favorites', JSON.stringify(favorites));
            console.log('Favorites saved:', favorites);
        } catch (e) {
            console.error('Could not save favorites:', e);
        }
    }

    function toggleFavorite(symbol) {
        const index = favorites.indexOf(symbol);
        if (index > -1) {
            favorites.splice(index, 1);
            console.log(`${symbol} removed from favorites`);
            // Move to after Mag 7 when unfavorited
            moveToAfterMagnificent7(symbol);
        } else {
            favorites.push(symbol);
            console.log(`${symbol} added to favorites`);
            // Move to top when favorited
            updateStockOrder();
        }
        saveFavorites();
    }

    function updateStockOrder() {
        // Sort: Favorites first, then Mag 7 alphabetically, then others
        const favoriteStocks = stocks.filter(stock => favorites.includes(stock.symbol));
        const mag7Stocks = stocks.filter(stock => magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol))
                                 .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Sort Mag 7 alphabetically
        const otherStocks = stocks.filter(stock => !magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol));
        const newOrder = [...favoriteStocks, ...mag7Stocks, ...otherStocks];
        
        // Reorder DOM
        stockContainer.innerHTML = '';
        newOrder.forEach(stock => {
            appendStockCard(stock);
        });
        
        // Update stocks array
        stocks = newOrder;
        saveStockOrder();
        initializeSortable();
        
        console.log('Order updated - Favorites first:', favorites);
    }

    function moveToAfterMagnificent7(symbol) {
        // New order: Favorites + Mag 7 (alphabetically) + Others (removed stock after Mag 7)
        const favoriteStocks = stocks.filter(stock => favorites.includes(stock.symbol));
        const mag7Stocks = stocks.filter(stock => magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol))
                                 .sort((a, b) => a.symbol.localeCompare(b.symbol)); // Sort Mag 7 alphabetically
        const otherStocks = stocks.filter(stock => !magnificent7.includes(stock.symbol) && !favorites.includes(stock.symbol));
        
        // Find and remove the unfavorited stock from other stocks
        const removedStock = otherStocks.find(stock => stock.symbol === symbol);
        if (removedStock) {
            const index = otherStocks.indexOf(removedStock);
            otherStocks.splice(index, 1);
        }
        
        // New order: Favorites + Mag 7 (alphabetically) + Removed Stock + Others
        const newOrder = [...favoriteStocks, ...mag7Stocks];
        if (removedStock) {
            newOrder.push(removedStock);
        }
        newOrder.push(...otherStocks);
        
        // Reorder DOM
        stockContainer.innerHTML = '';
        newOrder.forEach(stock => {
            appendStockCard(stock);
        });
        
        // Update stocks array
        stocks = newOrder;
        saveStockOrder();
        initializeSortable();
        
        console.log(`${symbol} moved to position after Mag 7`);
    }

    addStockBtn.addEventListener('click', () => {
        const stockSymbol = stockInput.value.toUpperCase().trim();
        if (stockSymbol) {
            addStock(stockSymbol);
            stockInput.value = '';
        }
    });

    // Reset order button
    const resetOrderBtn = document.getElementById('reset-order-btn');
    resetOrderBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset the order? This action cannot be undone.')) {
            resetToMagnificent7Order();
        }
    });

    function resetToMagnificent7Order() {
        console.log('Resetting Magnificent 7 order...');
        
        // Clear localStorage
        localStorage.removeItem('stockOrder');
        
        // Reload page
        stockContainer.innerHTML = '';
        stocks = [];
        
        // Favorite stocks first, then Magnificent 7 (alphabetically), then others
        const favoriteStocks = initialStocks.filter(symbol => favorites.includes(symbol));
        const magnificent7Stocks = magnificent7.filter(symbol => !favorites.includes(symbol))
                                              .sort((a, b) => a.localeCompare(b)); // Sort Mag 7 alphabetically
        const otherStocks = initialStocks.filter(symbol => 
            !magnificent7.includes(symbol) && !favorites.includes(symbol)
        );
        
        const newOrder = [...favoriteStocks, ...magnificent7Stocks, ...otherStocks];
        
        console.log('Favorite stocks:', favoriteStocks);
        console.log('Magnificent 7 (non-favorites):', magnificent7Stocks);
        console.log('Other stocks:', otherStocks);
        console.log('New order:', newOrder);
        
        // Load with new order
        async function loadWithNewOrder() {
            for (const symbol of newOrder) {
                await addStock(symbol);
            }
            console.log('Magnificent 7 order loaded');
            
            // Reorder DOM
            reorderDOM(newOrder);
            
            // Update stocks array
            updateStocksOrder();
            
            saveStockOrder();
            initializeSortable();
        }
        
        loadWithNewOrder();
    }

    function reorderDOM(newOrder) {
        // Clear existing cards
        stockContainer.innerHTML = '';
        
        // Re-add cards according to new order
        newOrder.forEach(symbol => {
            const stock = stocks.find(s => s.symbol === symbol);
            if (stock) {
                appendStockCard(stock);
            }
        });
        
        console.log('DOM reordered');
    }

    async function addStock(symbol) {
        const url = `/api/stock/${symbol}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            // Check error message from server
            if (!response.ok || data.error) {
                throw new Error(data.error || `Error code from server: ${response.status}`);
            }

            if (data.chart.result && data.chart.result[0]) {
                const meta = data.chart.result[0].meta;
                const indicators = data.chart.result[0].indicators.quote[0];

                // Check premarket data
                let combinedMeta = { ...meta };
                
                // Log all meta data for debug (optional)
                // console.log(`${symbol} full meta data:`, meta);
                
                // Check pre/post market data
                if (meta.preMarketPrice !== undefined && meta.preMarketPrice !== null) {
                    console.log(`${symbol} premarket price found: ${meta.preMarketPrice}`);
                    combinedMeta.preMarketPrice = meta.preMarketPrice;
                    combinedMeta.preMarketChange = meta.preMarketChange;
                    combinedMeta.preMarketChangePercent = meta.preMarketChangePercent;
                    combinedMeta.marketState = meta.marketState || 'PRE';
                }
                
                if (meta.postMarketPrice !== undefined && meta.postMarketPrice !== null) {
                    console.log(`${symbol} postmarket price found: ${meta.postMarketPrice}`);
                    combinedMeta.postMarketPrice = meta.postMarketPrice;
                    combinedMeta.postMarketChange = meta.postMarketChange;
                    combinedMeta.postMarketChangePercent = meta.postMarketChangePercent;
                }
                
                // If API doesn't provide pre/post market data, auto-detect based on time
                const now = new Date();
                const utcHour = now.getUTCHours();
                const utcMinute = now.getUTCMinutes();
                const utcTimeInMinutes = utcHour * 60 + utcMinute;
                
                // NYSE/NASDAQ hours (UTC):
                // Pre-market: 08:00 - 13:30 UTC (04:00 - 09:30 EST)
                // Regular: 13:30 - 20:00 UTC (09:30 - 16:00 EST)
                // After-hours: 20:00 - 00:00 UTC (16:00 - 20:00 EST)
                
                const preMarketStart = 8 * 60; // 08:00 UTC
                const regularStart = 13 * 60 + 30; // 13:30 UTC
                const regularEnd = 20 * 60; // 20:00 UTC
                const afterHoursEnd = 24 * 60; // 00:00 UTC
                
                // Weekday check (0 = Sunday, 6 = Saturday)
                const dayOfWeek = now.getUTCDay();
                const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
                
                if (isWeekday) {
                    if (utcTimeInMinutes >= preMarketStart && utcTimeInMinutes < regularStart) {
                        combinedMeta.marketState = 'PRE';
                    } else if (utcTimeInMinutes >= regularEnd && utcTimeInMinutes < afterHoursEnd) {
                        combinedMeta.marketState = 'POST';
                    } else if (utcTimeInMinutes >= regularStart && utcTimeInMinutes < regularEnd) {
                        combinedMeta.marketState = 'REGULAR';
                    } else {
                        combinedMeta.marketState = 'CLOSED';
                    }
                } else {
                    combinedMeta.marketState = 'CLOSED';
                }
                
                console.log(`${symbol} - Time analysis: UTC ${utcHour}:${utcMinute}, Market State: ${combinedMeta.marketState}`);

                // Price selection - based only on actual marketState
                let latestPrice;
                if (combinedMeta.marketState === 'PRE') {
                    // Pre-market hours: first real pre, then derived pre, otherwise regular
                    const hasDerivedPre = combinedMeta.derivedPreMarketPrice !== undefined;
                    latestPrice = combinedMeta.preMarketPrice || (hasDerivedPre ? combinedMeta.derivedPreMarketPrice : combinedMeta.regularMarketPrice);
                } else if (combinedMeta.marketState === 'POST') {
                    // Post-market hours: first real post, then derived post, otherwise regular
                    const hasDerivedPost = combinedMeta.derivedPostMarketPrice !== undefined;
                    latestPrice = combinedMeta.postMarketPrice || (hasDerivedPost ? combinedMeta.derivedPostMarketPrice : combinedMeta.regularMarketPrice);
                } else {
                    // Regular or Closed: only use regularMarketPrice
                    latestPrice = combinedMeta.regularMarketPrice || combinedMeta.previousClose;
                }
                
                // Determine previousClose: based on market state
                let previousPrice;
                if (combinedMeta.marketState === 'PRE' || combinedMeta.marketState === 'POST') {
                    // Pre/Post market: regularMarketPrice = yesterday's close
                    previousPrice = combinedMeta.regularMarketPrice || combinedMeta.chartPreviousClose || combinedMeta.previousClose;
                } else {
                    // Regular market: previousClose = yesterday's close
                    previousPrice = combinedMeta.previousClose || combinedMeta.chartPreviousClose || combinedMeta.regularMarketPrice;
                }
                
                // Debug logs - activate if needed
                // console.log(`${symbol} combined meta:`, combinedMeta);
                // console.log(`${symbol} market state:`, combinedMeta.marketState);
                
                // Determine market status - ONLY based on marketState (don't check derived existence!)
                let marketStatus = 'normal';
                if (combinedMeta.marketState === 'PRE') {
                    marketStatus = 'premarket';
                } else if (combinedMeta.marketState === 'POST') {
                    marketStatus = 'postmarket';
                } else if (combinedMeta.marketState === 'REGULAR') {
                    marketStatus = 'normal';
                } else {
                    marketStatus = 'normal'; // CLOSED durumunda da normal göster
                }

                // Use actual premarket data (first direct API, then derived)
                const effectivePre = combinedMeta.preMarketPrice !== undefined ? combinedMeta.preMarketPrice : combinedMeta.derivedPreMarketPrice;
                const effectivePost = combinedMeta.postMarketPrice !== undefined ? combinedMeta.postMarketPrice : combinedMeta.derivedPostMarketPrice;

                // Calculate change (MANUAL) -> always calculate based on previousClose; don't use API change fields
                let change = 0; let changePercent = 0;
                const base = previousPrice && previousPrice !== 0 ? previousPrice : null;
                if (base) {
                    if (marketStatus === 'premarket' && effectivePre !== undefined) {
                        // Premarket change = premarket price - previous close
                        change = effectivePre - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} premarket change: ${effectivePre.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    } else if (marketStatus === 'postmarket' && effectivePost !== undefined) {
                        // Postmarket change = postmarket price - previous close
                        change = effectivePost - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} postmarket change: ${effectivePost.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    } else if (combinedMeta.regularMarketPrice !== undefined) {
                        // Regular market change = regular price - previous close
                        change = combinedMeta.regularMarketPrice - base;
                        changePercent = (change / base) * 100;
                        console.log(`${symbol} regular change: ${combinedMeta.regularMarketPrice.toFixed(2)} - ${base.toFixed(2)} = ${change.toFixed(2)} (${changePercent.toFixed(2)}%)`);
                    }
                }
                
                const history = indicators.close ? indicators.close.slice(-30) : [];
                const timestamps = data.chart.result[0].timestamp ? data.chart.result[0].timestamp.slice(-30) : [];
                const labels = timestamps.map(ts => new Date(ts * 1000).toLocaleDateString());

                const stock = {
                    symbol: symbol,
                    price: (marketStatus === 'premarket' && effectivePre !== undefined) ? effectivePre : (marketStatus === 'postmarket' && effectivePost !== undefined) ? effectivePost : latestPrice,
                    change: change,
                    changePercent: changePercent,
                    marketStatus: marketStatus,
                    previousClose: previousPrice,
                    preMarketPrice: combinedMeta.preMarketPrice !== undefined ? combinedMeta.preMarketPrice : combinedMeta.derivedPreMarketPrice,
                    postMarketPrice: combinedMeta.postMarketPrice !== undefined ? combinedMeta.postMarketPrice : combinedMeta.derivedPostMarketPrice,
                    preMarketDerived: combinedMeta.preMarketPrice === undefined && combinedMeta.derivedPreMarketPrice !== undefined,
                    postMarketDerived: combinedMeta.postMarketPrice === undefined && combinedMeta.derivedPostMarketPrice !== undefined,
                    dataSourcePre: combinedMeta.dataSources?.preMarket,
                    dataSourcePost: combinedMeta.dataSources?.postMarket,
                    history: history,
                    labels: labels,
                    regularMarketPrice: combinedMeta.regularMarketPrice,
                    previousCloseRaw: combinedMeta.previousClose,
                    marketState: combinedMeta.marketState,
                    technicalAnalysis: combinedMeta.technicalAnalysis || null, // Add technical analysis
                    _lastUpdate: Date.now()
                };

                if (!stocks.some(s => s.symbol === symbol)) {
                    stocks.push(stock);
                    appendStockCard(stock);
                    initializeSortable(); // Reinitialize sortable when new stock is added
                }
                stockData[symbol] = stock; // Save for debug panel
            } else {
                console.warn(`Could not get data for '${symbol}'.`, data);
                if (!initialStocks.includes(symbol)) {
                    alert(`Stock '${symbol}' not found.`);
                }
            }
        } catch (error) {
            console.error(`Error fetching data for '${symbol}':`, error.message);
            // Show error message only for first stock, write to console for others.
            if (stocks.length === 0) {
                alert(`An error occurred while fetching data: ${error.message}. Please check your internet connection and server logs in terminal.`);
            }
        }
    }

    function appendStockCard(stock) {
        const changeClass = stock.change >= 0 ? 'positive' : 'negative';
        const sign = stock.change >= 0 ? '+' : '';
        const isFavorite = favorites.includes(stock.symbol);
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        // Source badge mapping: Y (yahoo direct), ~ (derived), F (Finnhub)
        function sourceBadgeFor(stock){
            if (stock.marketStatus === 'premarket') {
                if (stock.preMarketDerived) return '<span class="src-badge" title="Kaynak: Yahoo (türetilmiş bar)" data-src="yahoo-derived">~</span>';
                if (stock.preMarketPrice !== undefined && stock.dataSourcePre === 'finnhub') return '<span class="src-badge" title="Kaynak: Finnhub fallback" data-src="finnhub">F</span>';
                if (stock.preMarketPrice !== undefined) return '<span class="src-badge" title="Kaynak: Yahoo" data-src="yahoo">Y</span>';
            } else if (stock.marketStatus === 'postmarket') {
                if (stock.postMarketDerived) return '<span class="src-badge" title="Kaynak: Yahoo (türetilmiş bar)" data-src="yahoo-derived">~</span>';
                if (stock.postMarketPrice !== undefined && stock.dataSourcePost === 'finnhub') return '<span class="src-badge" title="Kaynak: Finnhub fallback" data-src="finnhub">F</span>';
                if (stock.postMarketPrice !== undefined) return '<span class="src-badge" title="Kaynak: Yahoo" data-src="yahoo">Y</span>';
            }
            return '';
        }
        // New single price display: if pre or post exists, show it in main price.
        let marketStatusLabel = '';
        if (stock.marketStatus === 'premarket') {
            marketStatusLabel = '<div class="market-status inline-badge premarket">PRE</div>';
        } else if (stock.marketStatus === 'postmarket') {
            marketStatusLabel = '<div class="market-status inline-badge postmarket">POST</div>';
        }

        const stockCard = document.createElement('div');
        stockCard.classList.add('stock-card');
        stockCard.dataset.symbol = stock.symbol;
        
        // Main price to display: if preMarket exists (badge PRE), or postMarket exists (badge POST), otherwise regular
        let displayPriceValue = stock.price;
        if (stock.marketStatus === 'premarket' && stock.preMarketPrice !== undefined) {
            displayPriceValue = stock.preMarketPrice;
        } else if (stock.marketStatus === 'postmarket' && stock.postMarketPrice !== undefined) {
            displayPriceValue = stock.postMarketPrice;
        }
        const sourceBadge = sourceBadgeFor(stock);
        
        // Technical analysis summary (LONG TERM)
        let taHtml = '';
        let trendEmoji = '';
        let trendShort = '';
        let trendColor = '#888';
        let ta = null;
        let positionText = '';
        let positionBadge = '';
        let positionTooltip = '';
        
        if (stock.technicalAnalysis) {
            ta = stock.technicalAnalysis;
            
            if (ta.signals.overall === 'STRONG_BULLISH') {
                trendEmoji = '🚀'; trendColor = '#00ff00'; trendShort = 'Güçlü Yükseliş';
            } else if (ta.signals.overall === 'BULLISH') {
                trendEmoji = '📈'; trendColor = '#51cf66'; trendShort = 'Yükseliş';
            } else if (ta.signals.overall === 'STRONG_BEARISH') {
                trendEmoji = '💥'; trendColor = '#ff4444'; trendShort = 'Güçlü Düşüş';
            } else if (ta.signals.overall === 'BEARISH') {
                trendEmoji = '📉'; trendColor = '#ff6b6b'; trendShort = 'Düşüş';
            } else {
                trendEmoji = '➡️'; trendColor = '#ffaa00'; trendShort = 'Yatay';
            }
            
            // Calculate price position (where in support/resistance range)
            if (ta.indicators.pricePosition !== undefined) {
                const pos = ta.indicators.pricePosition;
                if (pos < 20) {
                    positionText = 'Dip Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Price very close to support levels. Excellent level for adding positions.';
                } else if (pos < 40) {
                    positionText = 'İyi Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Price close to support levels. Good level for adding positions.';
                } else if (pos < 60) {
                    positionText = 'Orta Fiyat';
                    positionBadge = '🟡';
                    positionTooltip = 'Price at mid-levels. Neither cheap nor expensive.';
                } else if (pos < 80) {
                    positionText = 'Yüksek Fiyat';
                    positionBadge = '🟠';
                    positionTooltip = 'Price close to resistance levels. Consider partial profit taking.';
                } else {
                    positionText = 'Tepe Fiyat';
                    positionBadge = '🔴';
                    positionTooltip = 'Price very close to resistance levels. Partial profit realization recommended.';
                }
            }
            
            // Determine trend color and glow
            let trendBorderColor = '#3498db';
            let trendEmojiColor = 'inherit';
            let trendGlow = '';
            
            if (trendColor === '#00ff00') { // Strong Bullish (💹)
                trendBorderColor = '#00ff00';
                trendEmojiColor = '#00ff00';
                trendGlow = '0 0 12px rgba(0, 255, 0, 0.8), 0 0 24px rgba(0, 255, 0, 0.4)';
            } else if (trendColor === '#51cf66') { // Bullish (📈)
                trendBorderColor = '#2ecc71';
                trendEmojiColor = '#51cf66';
                trendGlow = '0 0 10px rgba(81, 207, 102, 0.6)';
            } else if (trendColor === '#ff4444') { // Strong Bearish (💥)
                trendBorderColor = '#ff4444';
                trendEmojiColor = '#ff4444';
                trendGlow = '0 0 12px rgba(255, 68, 68, 0.8), 0 0 24px rgba(255, 68, 68, 0.4)';
            } else if (trendColor === '#ff6b6b') { // Bearish (📉)
                trendBorderColor = '#e74c3c';
                trendEmojiColor = '#ff6b6b';
                trendGlow = '0 0 10px rgba(255, 107, 107, 0.6)';
            } else { // Sideways (➡️)
                trendBorderColor = '#f39c12';
                trendEmojiColor = '#f39c12';
                trendGlow = '0 0 10px rgba(243, 156, 18, 0.6)';
            }
            
            // Determine price position color and glow
            let positionBorderColor = '#95a5a6';
            let positionEmojiColor = 'inherit';
            let positionGlow = '';
            
            if (positionBadge === '🟢') { // Bottom/Good Price - Strong Bullish/Bullish (Green)
                // Dip Fiyat için parlak yeşil, İyi Fiyat için normal yeşil
                if (positionText === 'Dip Fiyat') {
                    positionBorderColor = '#00ff00';
                    positionEmojiColor = '#00ff00';
                    positionGlow = '0 0 18px rgba(0, 255, 0, 1), 0 0 36px rgba(0, 255, 0, 0.6), 0 0 54px rgba(0, 255, 0, 0.3)';
                } else { // İyi Fiyat
                    positionBorderColor = '#51cf66';
                    positionEmojiColor = '#51cf66';
                    positionGlow = '0 0 14px rgba(81, 207, 102, 0.9), 0 0 28px rgba(81, 207, 102, 0.4)';
                }
            } else if (positionBadge === '🟡') { // Mid Price - Sideways (Yellow)
                positionBorderColor = '#ffaa00';
                positionEmojiColor = '#ffaa00';
                positionGlow = '0 0 12px rgba(255, 170, 0, 0.8)';
            } else if (positionBadge === '🟠') { // High Price - Bearish (Orange)
                positionBorderColor = '#ff6b6b';
                positionEmojiColor = '#ff6b6b';
                positionGlow = '0 0 12px rgba(255, 107, 107, 0.8)';
            } else if (positionBadge === '🔴') { // Top Price - Strong Bearish (Red)
                positionBorderColor = '#ff4444';
                positionEmojiColor = '#ff4444';
                positionGlow = '0 0 18px rgba(255, 68, 68, 1), 0 0 36px rgba(255, 68, 68, 0.6), 0 0 54px rgba(255, 68, 68, 0.3)';
            }
            
            taHtml = `
                <div class="ta-summary" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.08);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 20px;">
                        <div style="flex: 1; display: flex; justify-content: center;">
                            <span style="font-size: 1.6em; color: ${trendEmojiColor};">${trendEmoji}</span>
                        </div>
                        ${positionBadge ? `
                            <div style="flex: 1; display: flex; justify-content: center;">
                                <span style="font-size: 1.6em; color: ${positionEmojiColor};">${positionBadge}</span>
                            </div>
                        ` : ''}
                    </div>
                    
                    <div style="display: flex; gap: 8px; font-size: 0.8em;">
                        <div style="flex: 1; background: rgba(81, 207, 102, 0.1); padding: 6px; border-radius: 6px; text-align: center; border: 1px solid rgba(81, 207, 102, 0.2);">
                            <div style="color: #51cf66; font-weight: 600;">${currency}${ta.recommendations.buyPrice.toFixed(2)}</div>
                            <div style="color: #888; font-size: 0.85em; margin-top: 2px;">Ekleme</div>
                        </div>
                        <div style="flex: 1; background: rgba(255, 107, 107, 0.1); padding: 6px; border-radius: 6px; text-align: center; border: 1px solid rgba(255, 107, 107, 0.2);">
                            <div style="color: #ff6b6b; font-weight: 600;">${currency}${ta.recommendations.sellPrice.toFixed(2)}</div>
                            <div style="color: #888; font-size: 0.85em; margin-top: 2px;">Satış</div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        stockCard.innerHTML = `
            <!-- Stacked (Card) Layout -->
            <div class="card-stacked" style="display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div class="favorite-star ${isFavorite ? 'active' : 'inactive'}" data-symbol="${stock.symbol}" style="font-size: 22px;">★</div>
                    ${marketStatusLabel}
                </div>
                <div style="text-align: center; margin-top: 2px;">
                    <h2 style="margin: 0; font-size: 1.1em; font-weight: 600; letter-spacing: 0.02em;">${stock.symbol}</h2>
                </div>
                <div style="text-align: center;">
                    <div class="stock-price" style="font-size: 1.6em; font-weight: 700; letter-spacing: -0.02em;">${currency}${Number(displayPriceValue).toFixed(2)}</div>
                </div>
                <div style="display: flex; justify-content: center; align-items: baseline; gap: 12px; font-size: 0.85em;">
                    <span class="stock-change ${changeClass}">${sign}${Number(stock.change).toFixed(2)}</span>
                    <span class="stock-change-percent ${changeClass}">${sign}${Number(stock.changePercent).toFixed(2)}%</span>
                </div>
                ${taHtml}
            </div>

            <!-- Row (List) Layout -->
            <div class="row-view" data-symbol="${stock.symbol}">
                <div class="cell cell-star">
                    <span class="favorite-star ${isFavorite ? 'active' : 'inactive'}" data-symbol="${stock.symbol}">★</span>
                </div>
                <div class="cell cell-symbol">
                    <span class="sym">${stock.symbol}</span>
                </div>
                <div class="cell cell-price">
                    ${marketStatusLabel}
                    <span class="stock-price">${currency}${Number(displayPriceValue).toFixed(2)}</span>
                </div>
                <div class="cell cell-change"><span class="stock-change ${changeClass}">${sign}${Number(stock.change).toFixed(2)}</span></div>
                <div class="cell cell-percent"><span class="stock-change-percent ${changeClass}">${sign}${Number(stock.changePercent).toFixed(2)}%</span></div>
                <div class="cell cell-trend">
                    <span class="trend-text" style="color: ${trendColor};">${trendEmoji} ${trendShort}</span>
                </div>
                <div class="cell cell-position">
                    ${positionBadge ? `<span class="position-badge">${positionBadge} ${positionText}</span>` : '-'}
                </div>
                <div class="cell cell-buy"><span class="buy-price">${ta && ta.recommendations ? currency + ta.recommendations.buyPrice.toFixed(2) : '-'}</span></div>
                <div class="cell cell-sell"><span class="sell-price">${ta && ta.recommendations ? currency + ta.recommendations.sellPrice.toFixed(2) : '-'}</span></div>
            </div>
        `;
        
        // Click event for favorite stars (both card-stacked and row-view)
        const starElements = stockCard.querySelectorAll('.favorite-star');
        starElements.forEach(starElement => {
            starElement.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent card/row click
                toggleFavorite(stock.symbol);
            });
        });
        
        // Card click (open chart) - for both card and row-view
        stockCard.addEventListener('click', (e) => {
            // Open chart modal if star is not clicked
            if (!e.target.classList.contains('favorite-star')) {
                openChartModal(stock.symbol);
            }
        });
        
        // Row-view specific click handler
        const rowView = stockCard.querySelector('.row-view');
        if (rowView) {
            rowView.addEventListener('click', (e) => {
                if (!e.target.classList.contains('favorite-star')) {
                    openChartModal(stock.symbol);
                }
            });
        }
        
        stockContainer.appendChild(stockCard);
    }

    function openChartModal(symbol) {
        const stock = stocks.find(s => s.symbol === symbol);
        if (!stock) return;

        currentStock = stock;
        modalStockSymbol.textContent = stock.symbol;
        modal.style.display = 'flex';
        
        // Fill Technical Analysis Panel
        renderTechnicalAnalysisPanel(stock);
        
        // Set default timeframe
        currentTimeframe = '1d';
        
        // Load TradingView widget
        loadTradingViewChart(symbol, currentTimeframe);
    }
    
    function renderTechnicalAnalysisPanel(stock) {
        const taPanel = document.getElementById('technical-analysis-panel');
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        
        if (!stock.technicalAnalysis) {
            taPanel.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">Technical analysis data is loading.</div>';
            return;
        }
        
        const ta = stock.technicalAnalysis;
        const ind = ta.indicators;
        const sig = ta.signals;
        const rec = ta.recommendations;
        
        // Trend color and emoji (LONG TERM)
        let trendClass, trendEmoji, trendText;
        if (sig.overall === 'STRONG_BULLISH') {
            trendClass = 'trend-bullish';
            trendEmoji = '🚀';
            trendText = 'Güçlü Yükseliş';
        } else if (sig.overall === 'BULLISH') {
            trendClass = 'trend-bullish';
            trendEmoji = '📈';
            trendText = 'Yükseliş';
        } else if (sig.overall === 'STRONG_BEARISH') {
            trendClass = 'trend-bearish';
            trendEmoji = '💥';
            trendText = 'Güçlü Düşüş';
        } else if (sig.overall === 'BEARISH') {
            trendClass = 'trend-bearish';
            trendEmoji = '📉';
            trendText = 'Düşüş';
        } else {
            trendClass = 'trend-neutral';
            trendEmoji = '➡️';
            trendText = 'Yatay';
        }
        
        // RSI color
        let rsiClass = 'rsi-neutral';
        let rsiStatus = 'Normal';
        if (ind.rsi < 30) {
            rsiClass = 'rsi-oversold';
            rsiStatus = 'Aşırı Satım';
        } else if (ind.rsi > 70) {
            rsiClass = 'rsi-overbought';
            rsiStatus = 'Aşırı Alım';
        }
        
        taPanel.innerHTML = `
            <div class="ta-header">
                <div class="ta-trend ${trendClass}">
                    <span>${trendEmoji}</span>
                    <span>${trendText}</span>
                </div>
                <div style="font-size: 0.95em; color: #fff; font-weight: bold;">
                    ${currency}${ta.currentPrice.toFixed(2)}
                </div>
            </div>
            
            <div class="ta-simple-section">
                <div class="ta-simple-title">🎯 Alım</div>
                <div class="ta-simple-price buy">${currency}${rec.buyPrice.toFixed(2)}</div>
                <div class="ta-simple-desc">${ind.supportResistance ? `Destek: ${currency}${ind.supportResistance.support.toFixed(2)}` : 'Destek seviyesi.'}</div>
            </div>
            
            <div class="ta-simple-section">
                <div class="ta-simple-title">💰 Satış</div>
                <div class="ta-simple-price sell">${currency}${rec.sellPrice.toFixed(2)}</div>
                <div class="ta-simple-desc">${ind.supportResistance ? `Direnç: ${currency}${ind.supportResistance.resistance.toFixed(2)}` : 'Direnç seviyesi.'}</div>
            </div>
            
            <div class="ta-simple-section">
                <div class="ta-simple-title">⚠️ Stop</div>
                <div class="ta-simple-price stop">${currency}${rec.stopLoss.toFixed(2)}</div>
                <div class="ta-simple-desc">Kriz için.</div>
            </div>
            
            <div class="ta-simple-section" style="border-bottom: none;">
                <div class="ta-simple-title">📊 RSI</div>
                <div class="ta-simple-price ${rsiClass}">${ind.rsi ? ind.rsi.toFixed(1) : 'N/A'}</div>
                <div class="ta-simple-desc">${rsiStatus}.</div>
            </div>
            
            ${sig.messages && sig.messages.length > 0 ? `
            <div class="ta-signals">
                <div class="ta-signals-title">📢 Sinyaller</div>
                ${sig.messages.map(msg => `<div class="ta-signal-item">${msg}</div>`).join('')}
            </div>` : ''}
        `;
    }

    function loadTradingViewChart(symbol, timeframe) {
        // Clear previous widget
        if (tradingViewChart) {
            tradingViewChart.remove();
        }
        
        // Clear widget container
        tradingViewWidget.innerHTML = '';
        
        // Convert timeframe to TradingView format
        const timeframeMap = {
            '1d': '1D',
            '5d': '5D',
            '1mo': '1M',
            '3mo': '3M',
            '6mo': '6M',
            '1y': '1Y',
            '2y': '2Y',
            '5y': '5Y'
        };
        
        const tvTimeframe = timeframeMap[timeframe] || '1D';
        
        // Determine symbol format
        let symbolFormat = `NASDAQ:${symbol}`;
        
        // Some stocks are on different exchanges
        const nyseStocks = ['UNH', 'CRM', 'TEAM', 'DKNG', 'HUBS', 'MRVL', 'SMCI', 'HIMS', 'CYBR', 'UBER', 'COIN', 'SPOT'];
        const nasdaqStocks = ['AMD', 'NVDA', 'HOOD', 'RKLB', 'META', 'SOFI', 'PLTR', 'TSLA', 'AVGO', 'GOOGL', 'AAPL', 'MSFT', 'AMZN', 'INTC', 'CRWD'];
        
        if (nyseStocks.includes(symbol)) {
            symbolFormat = `NYSE:${symbol}`;
        } else if (nasdaqStocks.includes(symbol)) {
            symbolFormat = `NASDAQ:${symbol}`;
        } else {
            // Default to NASDAQ
            symbolFormat = `NASDAQ:${symbol}`;
        }
        
        console.log(`Loading chart: ${symbolFormat}`);
        
        // Create TradingView widget
        try {
            tradingViewChart = new TradingView.widget({
                "autosize": true,
                "symbol": symbolFormat,
                "interval": tvTimeframe,
                "timezone": "Europe/Istanbul",
                "theme": "dark",
                "style": "1",
                "locale": "tr",
                "toolbar_bg": "#2a2a2a",
                "enable_publishing": false,
                "hide_top_toolbar": false,
                "hide_legend": false,
                "save_image": false,
                "container_id": "tradingview-widget",
                "studies": [
                    // Volume (Hacim)
                    "Volume@tv-basicstudies",
                    
                    // EMA 50, 100, 200 (Uzun Vadeli Trendler)
                    {
                        "id": "MAExp@tv-basicstudies",
                        "inputs": {
                            "length": 50,
                            "source": "close"
                        }
                    },
                    {
                        "id": "MAExp@tv-basicstudies",
                        "inputs": {
                            "length": 100,
                            "source": "close"
                        }
                    },
                    {
                        "id": "MAExp@tv-basicstudies",
                        "inputs": {
                            "length": 200,
                            "source": "close"
                        }
                    },
                    
                    // RSI (Relative Strength Index)
                    {
                        "id": "RSI@tv-basicstudies",
                        "inputs": {
                            "length": 14
                        }
                    },
                    
                    // MACD (Moving Average Convergence Divergence)
                    {
                        "id": "MACD@tv-basicstudies",
                        "inputs": {
                            "fast_length": 12,
                            "slow_length": 26,
                            "signal_length": 9
                        }
                    },
                    
                    // Bollinger Bands
                    {
                        "id": "BB@tv-basicstudies",
                        "inputs": {
                            "length": 20,
                            "mult": 2
                        }
                    }
                ],
                "show_popup_button": false,
                "popup_width": "1400",
                "popup_height": "800",
                "no_referral_id": true,
                "referral_id": "",
                "withdateranges": true,
                "hide_side_toolbar": false,
                "allow_symbol_change": false,
                "details": true,
                "hotlist": false,
                "calendar": false,
                "news": false,
                "hide_volume": false,
                "support_host": "https://www.tradingview.com",
                "onReady": function() {
                    console.log(`${symbol} grafiği başarıyla yüklendi (EMA 50-100-200, RSI, MACD, BB ile)`);
                },
                "onError": function(error) {
                    console.error(`${symbol} grafiği yüklenirken hata:`, error);
                    showChartError(symbol);
                }
            });
        } catch (error) {
            console.error(`${symbol} widget oluşturulurken hata:`, error);
            showChartError(symbol);
        }
    }

    function showChartError(symbol) {
        tradingViewWidget.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
                color: #cccccc;
                text-align: center;
                padding: 20px;
            ">
                <div style="font-size: 48px; margin-bottom: 20px;">📈</div>
                <h3 style="color: #ff4757; margin-bottom: 10px;">Grafik Yüklenemedi</h3>
                <p style="margin-bottom: 10px;">${symbol} hissesi için grafik bulunamadı.</p>
                <p style="font-size: 14px; color: #888;">Bu hisse TradingView'da mevcut olmayabilir.</p>
                <button onclick="loadTradingViewChart('${symbol}', '${currentTimeframe}')" 
                        style="
                            margin-top: 20px;
                            padding: 10px 20px;
                            background-color: #3498db;
                            color: white;
                            border: none;
                            border-radius: 5px;
                            cursor: pointer;
                        ">
                    Tekrar Dene
                </button>
            </div>
        `;
    }

    closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    });

    // Close modal with ESC key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'flex') {
            modal.style.display = 'none';
        }
    });
    // Update all stock prices (unified logic)
    async function updateAllStockPrices() {
        if (isUpdating) return;
        isUpdating = true;
        const refreshBtn = document.getElementById('refresh-btn');
        refreshBtn.classList.add('updating');
        refreshBtn.disabled = true;
        console.log('Updating prices...');
        try {
            await Promise.all(stocks.map(async stock => {
                try {
                    const resp = await fetch(`/api/stock/${stock.symbol}`);
                    if(!resp.ok) throw new Error('status '+resp.status);
                    const data = await resp.json();
                    const meta = data.chart?.result?.[0]?.meta;
                    if(!meta) return;
                    console.log(`[UPDATE] ${stock.symbol} meta:`, {
                        preMarketPrice: meta.preMarketPrice,
                        derivedPreMarketPrice: meta.derivedPreMarketPrice,
                        postMarketPrice: meta.postMarketPrice,
                        derivedPostMarketPrice: meta.derivedPostMarketPrice,
                        regularMarketPrice: meta.regularMarketPrice,
                        previousClose: meta.previousClose,
                        marketState: meta.marketState
                    });
                    // previousClose belirleme: piyasa durumuna göre
                    let previousClose;
                    if (meta.marketState === 'PRE' || meta.marketState === 'POST') {
                        previousClose = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
                    } else {
                        previousClose = meta.previousClose || meta.chartPreviousClose || meta.regularMarketPrice;
                    }
                    
                    // Market status - SADECE marketState'e göre belirle
                    let marketStatus = 'normal';
                    if (meta.marketState === 'PRE') {
                        marketStatus = 'premarket';
                    } else if (meta.marketState === 'POST') {
                        marketStatus = 'postmarket';
                    }
                    
                    // Effective pre/post - derived dahil
                    const effectivePre = meta.preMarketPrice !== undefined ? meta.preMarketPrice : meta.derivedPreMarketPrice;
                    const effectivePost = meta.postMarketPrice !== undefined ? meta.postMarketPrice : meta.derivedPostMarketPrice;
                    // Gösterilecek fiyat (pre/post varsa onları göster, yoksa regular -> previousClose fallback)
                    let displayPrice = (marketStatus === 'premarket' && effectivePre !== undefined) ? effectivePre : (marketStatus === 'postmarket' && effectivePost !== undefined) ? effectivePost : (meta.regularMarketPrice ?? previousClose);
                    // Değişim manuel hesap
                    let change = 0, changePercent = 0;
                    if (previousClose && previousClose !== 0) {
                        if (marketStatus === 'premarket' && effectivePre !== undefined) {
                            change = effectivePre - previousClose; 
                            changePercent = (change / previousClose) * 100;
                            console.log(`[UPDATE] ${stock.symbol} premarket: ${effectivePre} - ${previousClose} = ${change} (${changePercent.toFixed(2)}%)`);
                        } else if (marketStatus === 'postmarket' && effectivePost !== undefined) {
                            change = effectivePost - previousClose; 
                            changePercent = (change / previousClose) * 100;
                            console.log(`[UPDATE] ${stock.symbol} postmarket: ${effectivePost} - ${previousClose} = ${change} (${changePercent.toFixed(2)}%)`);
                        } else if (meta.regularMarketPrice !== undefined) {
                            change = meta.regularMarketPrice - previousClose; 
                            changePercent = (change / previousClose) * 100;
                            console.log(`[UPDATE] ${stock.symbol} regular: ${meta.regularMarketPrice} - ${previousClose} = ${change} (${changePercent.toFixed(2)}%)`);
                        }
                    }
                    // Save old values
                    const oldPrice = stock.price; const oldChange = stock.change; const oldChangePercent = stock.changePercent;
                    // Update
                    stock.price = displayPrice; // Plus: card logic won't recalculate
                    stock.marketStatus = marketStatus;
                    stock.change = change; 
                    stock.changePercent = changePercent;
                    console.log(`[UPDATE] ${stock.symbol} final values:`, {
                        price: stock.price,
                        change: stock.change,
                        changePercent: stock.changePercent,
                        marketStatus: stock.marketStatus,
                        displayPrice: displayPrice
                    });
                    stock.preMarketPrice = effectivePre;
                    stock.postMarketPrice = effectivePost;
                    stock.preMarketDerived = meta.preMarketPrice === undefined && meta.derivedPreMarketPrice !== undefined;
                    stock.postMarketDerived = meta.postMarketPrice === undefined && meta.derivedPostMarketPrice !== undefined;
                    stock.dataSourcePre = meta.dataSources?.preMarket;
                    stock.dataSourcePost = meta.dataSources?.postMarket;
                    stock.regularMarketPrice = meta.regularMarketPrice;
                    stock.previousClose = previousClose;
                    stock.marketState = meta.marketState;
                    stock.technicalAnalysis = meta.technicalAnalysis || stock.technicalAnalysis; // Update technical analysis
                    stock._lastUpdate = Date.now();
                    stockData[stock.symbol] = stock;
                    updateStockCard(stock, oldPrice, oldChange, oldChangePercent);
                } catch(e){ console.error('Update fail', stock.symbol, e.message); }
            }));
        } catch(e){
            console.error('Fiyat güncelleme hatası:', e.message);
        } finally {
            isUpdating = false;
            const refreshBtn2 = document.getElementById('refresh-btn');
            if(refreshBtn2){
                refreshBtn2.classList.remove('updating');
                refreshBtn2.disabled = false;
            }
        }
    }

    // Hisse kartını güncelle (hem card-stacked hem row-view)
    function updateStockCard(stock, oldPrice, oldChange, oldChangePercent) {
        const stockCard = document.querySelector(`.stock-card[data-symbol="${stock.symbol}"]`);
        if (!stockCard) return;
        
        const priceElements = stockCard.querySelectorAll('.stock-price');
        const changeElements = stockCard.querySelectorAll('.stock-change');
        const changePercentElements = stockCard.querySelectorAll('.stock-change-percent');
        const marketStatusElements = stockCard.querySelectorAll('.market-status');
        
        // Eski market-status badge'lerini temizle
        marketStatusElements.forEach(el => el.remove());
        
        // Yeni market-status badge'lerini ekle (hem card-stacked hem row-view için)
        let marketStatusLabel = '';
        if (stock.marketStatus === 'premarket') {
            marketStatusLabel = '<div class="market-status inline-badge premarket">PRE</div>';
        } else if (stock.marketStatus === 'postmarket') {
            marketStatusLabel = '<div class="market-status inline-badge postmarket">POST</div>';
        }
        
        // Card-stacked için
        const cardStacked = stockCard.querySelector('.card-stacked');
        if (cardStacked && marketStatusLabel) {
            cardStacked.insertAdjacentHTML('afterbegin', marketStatusLabel);
        }
        
        // Row-view için (fiyat kolonunda)
        const cellPrice = stockCard.querySelector('.row-view .cell-price');
        if (cellPrice && marketStatusLabel) {
            const firstChild = cellPrice.firstChild;
            cellPrice.insertAdjacentHTML('afterbegin', marketStatusLabel);
        }
        
        // Fiyatları güncelle (tüm elementler için)
        priceElements.forEach(priceElement => {
            // Fiyat değişimini vurgula
            if (stock.price > oldPrice) {
                priceElement.style.color = '#2ecc71';
                priceElement.style.animation = 'priceUp 0.5s ease-in-out';
            } else if (stock.price < oldPrice) {
                priceElement.style.color = '#e74c3c';
                priceElement.style.animation = 'priceDown 0.5s ease-in-out';
            }
            
            setTimeout(() => {
                priceElement.style.color = '';
                priceElement.style.animation = '';
            }, 500);
            
            const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
            // MANUEL PREMARKET FİYATLARI KULLAN (API'ler yanlış veri veriyor)
            let displayPriceValue = stock.price;
            if (stock.marketStatus === 'premarket' && stock.preMarketPrice !== undefined) {
                displayPriceValue = stock.preMarketPrice;
            } else if (stock.marketStatus === 'postmarket' && stock.postMarketPrice !== undefined) {
                displayPriceValue = stock.postMarketPrice;
            }
            const sourceBadge = sourceBadgeFor(stock);
            priceElement.innerHTML = `${currency}${Number(displayPriceValue).toFixed(2)} ${sourceBadge}`;
        });
        console.log(`[CARD UPDATE] ${stock.symbol} price: ${displayPriceValue}, change: ${stock.change}, changePercent: ${stock.changePercent}`);
        
        // Değişim değerlerini güncelle (tüm elementler için)
        changeElements.forEach(changeElement => {
            const sign = Number(stock.change) >= 0 ? '+' : '';
            const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
            changeElement.textContent = `${sign}${Number(stock.change).toFixed(2)}`;
            changeElement.style.color = Number(stock.change) >= 0 ? '#2ecc71' : '#e74c3c';
            changeElement.className = `stock-change ${Number(stock.change) >= 0 ? 'positive' : 'negative'}`;
        });
        
        // Yüzde değerlerini güncelle (tüm elementler için)
        changePercentElements.forEach(changePercentElement => {
            const sign = Number(stock.changePercent) >= 0 ? '+' : '';
            changePercentElement.textContent = `${sign}${Number(stock.changePercent).toFixed(2)}%`;
            changePercentElement.style.color = Number(stock.changePercent) >= 0 ? '#2ecc71' : '#e74c3c';
            changePercentElement.className = `stock-change-percent ${Number(stock.changePercent) >= 0 ? 'positive' : 'negative'}`;
        });
        
        // Update Technical Analysis summary (LONG TERM)
        let taElement = stockCard.querySelector('.ta-summary');
        if (stock.technicalAnalysis) {
            const ta = stock.technicalAnalysis;
            let trendEmoji, trendColor, trendShort;
            
            if (ta.signals.overall === 'STRONG_BULLISH') {
                trendEmoji = '🚀'; trendColor = '#00ff00'; trendShort = 'Güçlü Yükseliş';
            } else if (ta.signals.overall === 'BULLISH') {
                trendEmoji = '📈'; trendColor = '#51cf66'; trendShort = 'Yükseliş';
            } else if (ta.signals.overall === 'STRONG_BEARISH') {
                trendEmoji = '💥'; trendColor = '#ff4444'; trendShort = 'Güçlü Düşüş';
            } else if (ta.signals.overall === 'BEARISH') {
                trendEmoji = '📉'; trendColor = '#ff6b6b'; trendShort = 'Düşüş';
            } else {
                trendEmoji = '➡️'; trendColor = '#ffaa00'; trendShort = 'Yatay';
            }
            
            const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
            
            // Fiyat pozisyonu
            let positionText = '';
            let positionBadge = '';
            let positionTooltip = '';
            if (ta.indicators.pricePosition !== undefined) {
                const pos = ta.indicators.pricePosition;
                if (pos < 20) {
                    positionText = 'Dip Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Price very close to support levels. Excellent level for adding positions.';
                } else if (pos < 40) {
                    positionText = 'İyi Fiyat';
                    positionBadge = '🟢';
                    positionTooltip = 'Price close to support levels. Good level for adding positions.';
                } else if (pos < 60) {
                    positionText = 'Orta Fiyat';
                    positionBadge = '🟡';
                    positionTooltip = 'Price at mid-levels. Neither cheap nor expensive.';
                } else if (pos < 80) {
                    positionText = 'Yüksek Fiyat';
                    positionBadge = '🟠';
                    positionTooltip = 'Price close to resistance levels. Consider partial profit taking.';
                } else {
                    positionText = 'Tepe Fiyat';
                    positionBadge = '🔴';
                    positionTooltip = 'Price very close to resistance levels. Partial profit realization recommended.';
                }
            }
            
            const taHtml = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="color: ${trendColor}; font-weight: 600; font-size: 0.9em;">
                        ${trendEmoji} ${trendShort}
                    </div>
                    ${positionText ? `
                        <div class="tooltip-container" style="background: rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 12px; font-size: 0.8em; font-weight: 600; cursor: help; position: relative;">
                            ${positionBadge} ${positionText}
                            <div class="tooltip" style="width: 200px;">${positionTooltip}</div>
                        </div>
                    ` : ''}
                </div>
                
                <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 10px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <div style="color: #888; font-size: 0.75em; margin-bottom: 4px;">Ekleme</div>
                            <div style="color: #51cf66; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.buyPrice.toFixed(2)}</div>
                        </div>
                        <div style="flex: 1; text-align: right;">
                            <div style="color: #888; font-size: 0.75em; margin-bottom: 4px;">Kısmi Satış</div>
                            <div style="color: #ff6b6b; font-weight: 600; font-size: 0.9em;">${currency}${ta.recommendations.sellPrice.toFixed(2)}</div>
                        </div>
                    </div>
                </div>
            `;
            
            if (taElement) {
                taElement.innerHTML = taHtml;
            } else {
                // TA özeti yoksa ekle
                taElement = document.createElement('div');
                taElement.className = 'ta-summary';
                taElement.style.cssText = 'margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1);';
                taElement.innerHTML = taHtml;
                stockCard.appendChild(taElement);
            }
            
            // Row-view kolonlarını da güncelle
            const rowView = stockCard.querySelector('.row-view');
            if (rowView) {
                // Trend kolonunu güncelle
                const trendCell = rowView.querySelector('.cell-trend .trend-text');
                if (trendCell) {
                    trendCell.style.color = trendColor;
                    trendCell.textContent = `${trendEmoji} ${trendShort}`;
                }
                
                // Position kolonunu güncelle
                const positionCell = rowView.querySelector('.cell-position');
                if (positionCell) {
                    if (positionBadge && positionText) {
                        positionCell.innerHTML = `<span class="position-badge">${positionBadge} ${positionText}</span>`;
                    } else {
                        positionCell.textContent = '-';
                    }
                }
                
                // Buy/Sell kolonlarını güncelle
                const buyCell = rowView.querySelector('.cell-buy .buy-price');
                const sellCell = rowView.querySelector('.cell-sell .sell-price');
                if (buyCell && ta.recommendations) {
                    buyCell.textContent = `${currency}${ta.recommendations.buyPrice.toFixed(2)}`;
                }
                if (sellCell && ta.recommendations) {
                    sellCell.textContent = `${currency}${ta.recommendations.sellPrice.toFixed(2)}`;
                }
            }
        }
    }

    // Otomatik güncelleme başlat
    function startAutoUpdate() {
        // Her 2 dakikada bir güncelle
        updateInterval = setInterval(() => {
            if (stocks.length > 0 && !isUpdating) {
                updateAllStockPrices();
            }
        }, 120000); // 2 dakika
        
        console.log('Otomatik güncelleme başlatıldı (2 dakika)');
    }

    // Otomatik güncelleme durdur
    function stopAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
            console.log('Otomatik güncelleme durduruldu');
        }
    }



    // Hisse kartını güncelle
    function updateStockCard(stock, oldPrice, oldChange, oldChangePercent) {
        const stockCard = document.querySelector(`[data-symbol="${stock.symbol}"]`);
        if (!stockCard) return;
        
        const priceElement = stockCard.querySelector('.stock-price');
        const changeElement = stockCard.querySelector('.stock-change');
        const changePercentElement = stockCard.querySelector('.stock-change-percent');
        const marketStatusElement = stockCard.querySelector('.market-status');
        
        // Piyasa durumu etiketini güncelle
        if (marketStatusElement) {
            marketStatusElement.remove();
        }
        
        // Yeni piyasa durumu etiketini ekle
        if (stock.marketStatus === 'premarket') {
            const statusLabel = document.createElement('div');
            statusLabel.className = 'market-status premarket';
            statusLabel.textContent = 'Öncesi';
            stockCard.insertBefore(statusLabel, stockCard.querySelector('h2'));
        } else if (stock.marketStatus === 'postmarket') {
            const statusLabel = document.createElement('div');
            statusLabel.className = 'market-status postmarket';
            statusLabel.textContent = 'Sonrası';
            stockCard.insertBefore(statusLabel, stockCard.querySelector('h2'));
        }
        
        const currency = stock.symbol.endsWith('.IS') ? '₺' : '$';
        priceElements.forEach(pe => {
            if (stock.price > oldPrice) {
                pe.style.color = '#2ecc71';
                pe.style.animation = 'priceUp 0.5s ease-in-out';
            } else if (stock.price < oldPrice) {
                pe.style.color = '#e74c3c';
                pe.style.animation = 'priceDown 0.5s ease-in-out';
            }
            setTimeout(() => { pe.style.color=''; pe.style.animation=''; }, 500);
            pe.textContent = `${currency}${Number(stock.price).toFixed(2)}`;
        });
        const sign = Number(stock.change) >= 0 ? '+' : '';
        changeElements.forEach(ce => {
            ce.textContent = `${sign}${Number(stock.change).toFixed(2)}`;
            ce.style.color = Number(stock.change) >= 0 ? '#2ecc71' : '#e74c3c';
            ce.className = `stock-change ${Number(stock.change) >= 0 ? 'positive' : 'negative'}`;
        });
        changePercentElements.forEach(cpe => {
            const signPct = Number(stock.changePercent) >= 0 ? '+' : '';
            cpe.textContent = `${signPct}${Number(stock.changePercent).toFixed(2)}%`;
            cpe.style.color = Number(stock.changePercent) >= 0 ? '#2ecc71' : '#e74c3c';
            cpe.className = `stock-change-percent ${Number(stock.changePercent) >= 0 ? 'positive' : 'negative'}`;
        });
    }

    loadInitialStocks();
    startAutoUpdate();
    
    // Manuel yenile butonu
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.addEventListener('click', () => {
        updateAllStockPrices();
    });

    // ================= View Toggle (Card/List) ==================
    const cardViewBtn = document.getElementById('card-view-btn');
    const listViewBtn = document.getElementById('list-view-btn');

    // localStorage'dan görünüm modunu yükle
    const savedViewMode = localStorage.getItem('viewMode') || 'card';
    if (savedViewMode === 'list') {
        stockContainer.classList.add('list-view');
        cardViewBtn.classList.remove('active');
        listViewBtn.classList.add('active');
        addListViewHeader();
    }

    cardViewBtn.addEventListener('click', () => {
        stockContainer.classList.remove('list-view');
        cardViewBtn.classList.add('active');
        listViewBtn.classList.remove('active');
        localStorage.setItem('viewMode', 'card');
        const header = document.querySelector('.list-view-header');
        if (header) header.remove();
    });

    listViewBtn.addEventListener('click', () => {
        stockContainer.classList.add('list-view');
        listViewBtn.classList.add('active');
        cardViewBtn.classList.remove('active');
        localStorage.setItem('viewMode', 'list');
        addListViewHeader();
    });

    function addListViewHeader() {
        if (!document.querySelector('.list-view-header')) {
            const header = document.createElement('div');
            header.className = 'list-view-header';
            header.style.display = 'grid';
            header.style.gridTemplateColumns = '24px repeat(8,1fr)';
            header.style.alignItems = 'center';
            header.innerHTML = `
                <div class="hcol"></div>
                <div class="hcol">Sembol</div>
                <div class="hcol">Fiyat</div>
                <div class="hcol">Değişim</div>
                <div class="hcol">%</div>
                <div class="hcol">Trend</div>
                <div class="hcol">Ucuzluk</div>
                <div class="hcol">Ekleme</div>
                <div class="hcol">Satış</div>
            `;
            stockContainer.parentElement.insertBefore(header, stockContainer);
        }
    }

    // ================= Debug / Observation Panel ==================
    function formatPrice(v){
        if(v === undefined || v === null || v === '-') return '-';
        if(isNaN(v)) return '-';
        return Number(v).toFixed(2);
    }

    function renderDebugTable(){
        if(!debugPanelEnabled) return;
        const tbody = document.querySelector('#debug-table tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        const now = Date.now();
        stocks.forEach(s => {
            const tr = document.createElement('tr');
            const preVal = s.preMarketPrice !== undefined ? s.preMarketPrice : '-';
            const postVal = s.postMarketPrice !== undefined ? s.postMarketPrice : '-';
            const deltaPct = (s.regularMarketPrice && s.previousClose) ? (((s.regularMarketPrice - s.previousClose)/s.previousClose)*100).toFixed(2) : '-';
            const cls = deltaPct !== '-' ? (parseFloat(deltaPct) >= 0 ? 'val-pos':'val-neg') : '';
            const updatedAgo = s._lastUpdate ? ((now - s._lastUpdate)/1000).toFixed(0)+'s' : '-';
            tr.innerHTML = `
                <td>${s.symbol}</td>
                <td>${s.marketState || s.marketStatus || '-'}</td>
                <td>${formatPrice(preVal)}</td>
                <td>${s.preMarketPrice !== undefined ? `<span class="src-badge" data-kind="${s.preMarketDerived?'derived':'direct'}">${s.preMarketDerived?'~':'Y'}</span>`:''}</td>
                <td>${formatPrice(postVal)}</td>
                <td>${s.postMarketPrice !== undefined ? `<span class="src-badge" data-kind="${s.postMarketDerived?'derived':'direct'}">${s.postMarketDerived?'~':'Y'}</span>`:''}</td>
                <td>${formatPrice(s.regularMarketPrice || s.price)}</td>
                <td>${formatPrice(s.previousClose)}</td>
                <td class="${cls}">${deltaPct !== '-' ? deltaPct+'%' : '-'}</td>
                <td>${updatedAgo}</td>`;
            tbody.appendChild(tr);
        });
    }

    function toggleDebugPanel(){
        debugPanelEnabled = !debugPanelEnabled;
        const panel = document.getElementById('debug-panel');
        if(!panel) return;
        panel.style.display = debugPanelEnabled ? 'flex' : 'none';
        if(debugPanelEnabled){
            renderDebugTable();
            if(debugInterval) clearInterval(debugInterval);
            debugInterval = setInterval(renderDebugTable, 15000);
        } else {
            if(debugInterval) clearInterval(debugInterval);
        }
    }

    const toggleDebugBtn = document.getElementById('toggle-debug-btn');
    if(toggleDebugBtn){
        toggleDebugBtn.addEventListener('click', toggleDebugPanel);
    }
    const closeDebugBtn = document.getElementById('close-debug');
    if(closeDebugBtn){
        closeDebugBtn.addEventListener('click', () => { if(debugPanelEnabled) toggleDebugPanel(); });
    }

    // Global Legend Modal Event Listeners
    const globalLegendBtn = document.getElementById('global-legend-btn');
    const globalLegendModal = document.getElementById('global-legend-modal');
    const globalLegendClose = document.getElementById('global-legend-close');

    if(globalLegendBtn){
        globalLegendBtn.addEventListener('click', () => {
            if(globalLegendModal){
                globalLegendModal.style.display = 'flex';
            }
        });
    }

    if(globalLegendClose){
        globalLegendClose.addEventListener('click', () => {
            if(globalLegendModal){
                globalLegendModal.style.display = 'none';
            }
        });
    }

    if(globalLegendModal){
        globalLegendModal.addEventListener('click', (e) => {
            if(e.target === globalLegendModal){
                globalLegendModal.style.display = 'none';
            }
        });
    }

    // Close modal with ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
            if (globalLegendModal && globalLegendModal.style.display === 'flex') {
                globalLegendModal.style.display = 'none';
            }
        }
    });

    // Sort Buttons - Daily Performance Sorting
    let currentSortMode = 'manual'; // 'manual', 'gainers', 'losers'
    let originalOrder = []; // Save original order
    
    const sortGainersBtn = document.getElementById('sort-gainers-btn');
    const sortLosersBtn = document.getElementById('sort-losers-btn');
    const sortResetBtn = document.getElementById('sort-reset-btn');

    function saveOriginalOrder() {
        originalOrder = Array.from(stockContainer.children).map(card => card.dataset.symbol);
    }

    function sortStocksByPerformance(mode) {
        const stockCards = Array.from(stockContainer.children);
        
        stockCards.sort((a, b) => {
            const stockA = stocks.find(s => s.symbol === a.dataset.symbol);
            const stockB = stocks.find(s => s.symbol === b.dataset.symbol);
            
            if (!stockA || !stockB) return 0;
            
            const changeA = stockA.changePercent || 0;
            const changeB = stockB.changePercent || 0;
            
            if (mode === 'gainers') {
                return changeB - changeA; // Büyükten küçüğe (en çok yükselenler)
            } else if (mode === 'losers') {
                return changeA - changeB; // Küçükten büyüğe (en çok düşenler)
            }
            return 0;
        });

        // Sıralanmış kartları yeniden ekle
        stockCards.forEach(card => stockContainer.appendChild(card));
    }

    function restoreOriginalOrder() {
        const stockCards = Array.from(stockContainer.children);
        
        stockCards.sort((a, b) => {
            const indexA = originalOrder.indexOf(a.dataset.symbol);
            const indexB = originalOrder.indexOf(b.dataset.symbol);
            return indexA - indexB;
        });

        stockCards.forEach(card => stockContainer.appendChild(card));
    }

    function updateSortButtons(mode) {
        sortGainersBtn.classList.remove('active');
        sortLosersBtn.classList.remove('active');
        sortResetBtn.classList.remove('active');

        if (mode === 'gainers') {
            sortGainersBtn.classList.add('active');
            sortResetBtn.style.display = 'flex';
        } else if (mode === 'losers') {
            sortLosersBtn.classList.add('active');
            sortResetBtn.style.display = 'flex';
        } else {
            sortResetBtn.classList.add('active');
            sortResetBtn.style.display = 'none';
        }
    }

    if(sortGainersBtn) {
        sortGainersBtn.addEventListener('click', () => {
            if (currentSortMode !== 'gainers') {
                if (currentSortMode === 'manual') {
                    saveOriginalOrder();
                }
                currentSortMode = 'gainers';
                sortStocksByPerformance('gainers');
                updateSortButtons('gainers');
            }
        });
    }

    if(sortLosersBtn) {
        sortLosersBtn.addEventListener('click', () => {
            if (currentSortMode !== 'losers') {
                if (currentSortMode === 'manual') {
                    saveOriginalOrder();
                }
                currentSortMode = 'losers';
                sortStocksByPerformance('losers');
                updateSortButtons('losers');
            }
        });
    }

    if(sortResetBtn) {
        sortResetBtn.addEventListener('click', () => {
            if (currentSortMode !== 'manual') {
                currentSortMode = 'manual';
                restoreOriginalOrder();
                updateSortButtons('manual');
            }
        });
    }

    // Periyodik olarak debug tablosunu güncelle (aktifse)
    setInterval(() => { if(debugPanelEnabled) renderDebugTable(); }, 5000);
});

