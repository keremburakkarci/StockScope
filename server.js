const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8084;
const CACHE_TTL_MS = 5 * 1000; // 5 saniye
const cache = new Map();

// ============================================
// TEKNİK ANALİZ FONKSİYONLARI
// ============================================

// EMA (Exponential Moving Average) hesapla
function calculateEMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
}

// RSI (Relative Strength Index) hesapla
function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return null;
    
    let gains = 0, losses = 0;
    
    // İlk period için ortalama kazanç/kayıp
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    // Kalan veriler için smoothed average
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// ATR (Average True Range) hesapla
function calculateATR(highs, lows, closes, period = 14) {
    if (!highs || highs.length < period + 1) return null;
    
    const trueRanges = [];
    for (let i = 1; i < highs.length; i++) {
        const tr = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
        trueRanges.push(tr);
    }
    
    // İlk ATR - basit ortalama
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Smoothed ATR
    for (let i = period; i < trueRanges.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
    }
    
    return atr;
}

// SuperTrend hesapla (Profesyonel trend göstergesi)
function calculateSuperTrend(highs, lows, closes, period = 10, multiplier = 3.0) {
    if (!highs || highs.length < period + 1) return null;
    
    const atr = calculateATR(highs, lows, closes, period);
    if (!atr) return null;
    
    const currentPrice = closes[closes.length - 1];
    const hl2 = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
    
    // Basic Bands
    const basicUpperBand = hl2 + (multiplier * atr);
    const basicLowerBand = hl2 - (multiplier * atr);
    
    // Final Bands (simplified for last value)
    const finalUpperBand = basicUpperBand;
    const finalLowerBand = basicLowerBand;
    
    // Trend determination
    let trend = 'LONG';
    let superTrendValue = finalLowerBand;
    
    if (currentPrice <= finalLowerBand) {
        trend = 'SHORT';
        superTrendValue = finalUpperBand;
    }
    
    return {
        value: superTrendValue,
        trend: trend,
        upperBand: finalUpperBand,
        lowerBand: finalLowerBand,
        atr: atr
    };
}

// UT Bot Alerts hesapla (GELİŞTİRİLMİŞ - ATR bazlı trailing stop + EMA filtresi)
function calculateUTBot(highs, lows, closes, atrPeriod = 10, atrMultiplier = 3.5) {
    if (!closes || closes.length < atrPeriod + 1) return null;
    
    const atr = calculateATR(highs, lows, closes, atrPeriod);
    if (!atr) return null;
    
    const currentPrice = closes[closes.length - 1];
    const hl2 = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
    
    // Trailing stop seviyeleri
    const trailingStop = atr * atrMultiplier;
    
    // EMA 21 trend filtresi (muhafazakar yaklaşım)
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, 50);
    
    // Trend belirleme (iki EMA ile daha güvenilir)
    let trend = 'NEUTRAL';
    if (ema21 && ema50) {
        if (currentPrice > ema21 && ema21 > ema50) {
            trend = 'LONG';
        } else if (currentPrice < ema21 && ema21 < ema50) {
            trend = 'SHORT';
        }
    } else if (ema21) {
        trend = currentPrice > ema21 ? 'LONG' : 'SHORT';
    }
    
    // Dynamic support/resistance levels
    const buyLevel = hl2 - trailingStop;
    const sellLevel = hl2 + trailingStop;
    
    return {
        buyLevel: buyLevel,
        sellLevel: sellLevel,
        atr: atr,
        trend: trend,
        ema21: ema21,
        ema50: ema50,
        trailingStop: trailingStop
    };
}

// MACD hesapla (GELİŞTİRİLMİŞ - Doğru signal line ve crossover tespiti)
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!prices || prices.length < slowPeriod + signalPeriod + 10) return null;
    
    // Tüm fiyatlar için EMA hesapla
    const emaFastArray = [];
    const emaSlowArray = [];
    const macdLineArray = [];
    
    // EMA Fast hesapla (tüm array için)
    let multiplierFast = 2 / (fastPeriod + 1);
    let emaFast = prices.slice(0, fastPeriod).reduce((a, b) => a + b, 0) / fastPeriod;
    emaFastArray.push(emaFast);
    
    for (let i = fastPeriod; i < prices.length; i++) {
        emaFast = (prices[i] - emaFast) * multiplierFast + emaFast;
        emaFastArray.push(emaFast);
    }
    
    // EMA Slow hesapla (tüm array için)
    let multiplierSlow = 2 / (slowPeriod + 1);
    let emaSlow = prices.slice(0, slowPeriod).reduce((a, b) => a + b, 0) / slowPeriod;
    emaSlowArray.push(emaSlow);
    
    for (let i = slowPeriod; i < prices.length; i++) {
        emaSlow = (prices[i] - emaSlow) * multiplierSlow + emaSlow;
        emaSlowArray.push(emaSlow);
    }
    
    // MACD Line hesapla (EMA Fast - EMA Slow)
    const startIdx = slowPeriod;
    for (let i = 0; i < emaFastArray.length - (slowPeriod - fastPeriod); i++) {
        macdLineArray.push(emaFastArray[i + (slowPeriod - fastPeriod)] - emaSlowArray[i]);
    }
    
    if (macdLineArray.length < signalPeriod) return null;
    
    // Signal Line hesapla (MACD'nin EMA'sı)
    let multiplierSignal = 2 / (signalPeriod + 1);
    let signal = macdLineArray.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
    const signalArray = [signal];
    
    for (let i = signalPeriod; i < macdLineArray.length; i++) {
        signal = (macdLineArray[i] - signal) * multiplierSignal + signal;
        signalArray.push(signal);
    }
    
    // Son değerler
    const currentMacd = macdLineArray[macdLineArray.length - 1];
    const currentSignal = signalArray[signalArray.length - 1];
    const currentHistogram = currentMacd - currentSignal;
    
    // Önceki değerler (crossover için)
    const prevMacd = macdLineArray.length > 1 ? macdLineArray[macdLineArray.length - 2] : currentMacd;
    const prevSignal = signalArray.length > 1 ? signalArray[signalArray.length - 1] : currentSignal;
    const prevHistogram = prevMacd - prevSignal;
    
    // Crossover tespiti
    let crossover = null;
    if (prevMacd <= prevSignal && currentMacd > currentSignal) {
        crossover = 'BULLISH'; // Golden crossover - Alım sinyali
    } else if (prevMacd >= prevSignal && currentMacd < currentSignal) {
        crossover = 'BEARISH'; // Death crossover - Satım sinyali
    }
    
    // Histogram trend (momentum)
    let histogramTrend = 'NEUTRAL';
    if (currentHistogram > 0 && currentHistogram > prevHistogram) {
        histogramTrend = 'STRONG_BULLISH';
    } else if (currentHistogram > 0 && currentHistogram < prevHistogram) {
        histogramTrend = 'WEAKENING_BULLISH';
    } else if (currentHistogram < 0 && currentHistogram < prevHistogram) {
        histogramTrend = 'STRONG_BEARISH';
    } else if (currentHistogram < 0 && currentHistogram > prevHistogram) {
        histogramTrend = 'WEAKENING_BEARISH';
    }
    
    return {
        macd: currentMacd,
        signal: currentSignal,
        histogram: currentHistogram,
        crossover: crossover,
        histogramTrend: histogramTrend,
        trend: currentHistogram > 0 ? 'BULLISH' : 'BEARISH',
        // Ek bilgiler
        prevMacd: prevMacd,
        prevSignal: prevSignal,
        momentum: Math.abs(currentHistogram) // Momentumun gücü
    };
}

// OBV (On-Balance Volume) hesapla - Hacim ile fiyat onayı ve divergence tespiti
function calculateOBV(closes, volumes) {
    if (!closes || !volumes || closes.length < 2) return null;
    
    const obvArray = [volumes[0]]; // İlk değer
    
    // OBV hesapla
    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) {
            // Fiyat yükseldi → hacmi ekle
            obvArray.push(obvArray[i - 1] + volumes[i]);
        } else if (closes[i] < closes[i - 1]) {
            // Fiyat düştü → hacmi çıkar
            obvArray.push(obvArray[i - 1] - volumes[i]);
        } else {
            // Fiyat değişmedi → aynı kalsın
            obvArray.push(obvArray[i - 1]);
        }
    }
    
    const currentOBV = obvArray[obvArray.length - 1];
    const obvLength = obvArray.length;
    
    // OBV trend analizi (son 20 periyot)
    const recentOBV = obvArray.slice(-20);
    const obvEMA = recentOBV.reduce((a, b) => a + b, 0) / recentOBV.length;
    const obvTrend = currentOBV > obvEMA ? 'RISING' : 'FALLING';
    
    // Divergence tespiti (son 50 periyot)
    const lookback = Math.min(50, obvLength);
    const recentCloses = closes.slice(-lookback);
    const recentOBVs = obvArray.slice(-lookback);
    
    // Fiyat trend
    const priceChange = recentCloses[recentCloses.length - 1] - recentCloses[0];
    const priceDirection = priceChange > 0 ? 'UP' : 'DOWN';
    
    // OBV trend
    const obvChange = recentOBVs[recentOBVs.length - 1] - recentOBVs[0];
    const obvDirection = obvChange > 0 ? 'UP' : 'DOWN';
    
    // Divergence tespiti
    let divergence = null;
    if (priceDirection === 'UP' && obvDirection === 'DOWN') {
        divergence = 'BEARISH'; // Fiyat yükseliyor ama hacim düşüyor → Tehlike!
    } else if (priceDirection === 'DOWN' && obvDirection === 'UP') {
        divergence = 'BULLISH'; // Fiyat düşüyor ama hacim yükseliyor → Fırsat!
    }
    
    // OBV momentum (değişim hızı)
    const obvMomentum = obvArray.length > 10 ? 
        (currentOBV - obvArray[obvArray.length - 10]) / 10 : 0;
    
    return {
        value: currentOBV,
        trend: obvTrend,
        divergence: divergence,
        momentum: obvMomentum,
        ema: obvEMA,
        // Detaylı bilgi
        priceDirection: priceDirection,
        obvDirection: obvDirection,
        strength: Math.abs(obvChange) / lookback // Trend gücü
    };
}

// Bollinger Bands hesapla
function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (!prices || prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = recentPrices.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    return {
        upper: sma + (standardDeviation * stdDev),
        middle: sma,
        lower: sma - (standardDeviation * stdDev),
        bandwidth: ((sma + (standardDeviation * stdDev)) - (sma - (standardDeviation * stdDev))) / sma * 100
    };
}

// Fibonacci Retracement seviyeleri hesapla
function calculateFibonacci(high, low) {
    const diff = high - low;
    return {
        level_0: high,
        level_236: high - (diff * 0.236),
        level_382: high - (diff * 0.382),
        level_500: high - (diff * 0.500),
        level_618: high - (diff * 0.618),
        level_786: high - (diff * 0.786),
        level_100: low
    };
}

// ============================================
// PIVOT POINTS CALCULATION (ENHANCED - 3 TYPES)
// ============================================
// Pivot Points hesapla (günlük destek/direnç)
// Standard, Fibonacci ve Camarilla pivot points
function calculatePivotPointsLegacy(high, low, close) {
    const pivot = (high + low + close) / 3;
    
    // Standard Pivots
    const standard = {
        pivot: pivot,
        r1: (2 * pivot) - low,
        r2: pivot + (high - low),
        r3: high + 2 * (pivot - low),
        s1: (2 * pivot) - high,
        s2: pivot - (high - low),
        s3: low - 2 * (high - pivot)
    };
    
    // Fibonacci Pivots
    const fibonacci = {
        pivot: pivot,
        r1: pivot + 0.382 * (high - low),
        r2: pivot + 0.618 * (high - low),
        r3: pivot + 1.000 * (high - low),
        s1: pivot - 0.382 * (high - low),
        s2: pivot - 0.618 * (high - low),
        s3: pivot - 1.000 * (high - low)
    };
    
    // Camarilla Pivots (short-term, intraday focus)
    const camarilla = {
        r4: close + (high - low) * 1.1 / 2,
        r3: close + (high - low) * 1.1 / 4,
        r2: close + (high - low) * 1.1 / 6,
        r1: close + (high - low) * 1.1 / 12,
        s1: close - (high - low) * 1.1 / 12,
        s2: close - (high - low) * 1.1 / 6,
        s3: close - (high - low) * 1.1 / 4,
        s4: close - (high - low) * 1.1 / 2
    };
    
    // Return all types, prioritize Standard for long-term
    return {
        ...standard, // Backward compatibility
        standard,
        fibonacci,
        camarilla
    };
}

// GELİŞMİŞ DESTEK/DİRENÇ ALGORİTMASI (OPTİMİZE EDİLMİŞ)
// PROFESYONEL ANALİST YÖNTEMİ: Her hisse için özelleştirilmiş strateji (Cuma Çevik yaklaşımı)
// Büyük cap (AAPL, MSFT) → MA50, MA200 önemli
// Volatile (EOSE, HOOD) → Kısa vadeli swing'ler ve yakın destekler
// Growth (PLTR, NVDA) → Fibonacci ve momentum
function findAdvancedSupportResistance(closes, highs, lows, volumes, lookbackPeriod = 100) {
    if (!closes || closes.length < 50) return null;
    
    const current = closes[closes.length - 1];
    // ============================================
    // ATR(14) - Volatilite bazlı seviye genişlikleri için
    // ============================================
    let atr14 = null;
    if (highs && lows && closes.length >= 20) {
        const period = 14;
        const start = Math.max(1, closes.length - period - 1);
        const trueRanges = [];
        for (let i = start; i < closes.length; i++) {
            const h = highs[i];
            const l = lows[i];
            const prevClose = closes[i - 1];
            if (prevClose !== undefined) {
                const tr = Math.max(
                    h - l,
                    Math.abs(h - prevClose),
                    Math.abs(l - prevClose)
                );
                trueRanges.push(tr);
            }
        }
        if (trueRanges.length >= period) {
            atr14 = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
        } else if (trueRanges.length > 0) {
            atr14 = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
        }
    }
    console.log(`  ATR(14): ${atr14 ? atr14.toFixed(2) : 'N/A'}`);
    
    // ============================================
    // 1. HİSSE PROFİLİ ANALİZİ (Her hisse farklı)
    // ============================================
    
    // Volatilite analizi (son 20 gün)
    const recentCloses = closes.slice(-20);
    const avgPrice = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    const volatility = Math.sqrt(
        recentCloses.map(p => Math.pow(p - avgPrice, 2)).reduce((a, b) => a + b, 0) / recentCloses.length
    ) / avgPrice;
    
    // Trend analizi (son 50 gün)
    const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const sma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : sma50;
    const trendStrength = (current - sma50) / sma50; // Pozitif = yükseliş trendi
    
    // Hacim trendi (son 20 gün ortalama vs son 5 gün)
    const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const avgVolume5 = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const volumeTrend = avgVolume5 / avgVolume20; // >1 = artan hacim
    
    console.log(`  ===== HİSSE PROFİLİ =====`);
    console.log(`  Volatilite: ${(volatility * 100).toFixed(2)}%`);
    console.log(`  Trend: ${trendStrength > 0 ? '📈 Yükseliş' : '📉 Düşüş'} (${(trendStrength * 100).toFixed(1)}%)`);
    console.log(`  Hacim Trend: ${volumeTrend > 1 ? '📊 Artan' : '📉 Azalan'} (${volumeTrend.toFixed(2)}x)`);
    
    // HİSSE TİPİ BELİRLE (Cuma Çevik yaklaşımı)
    let stockType = 'UNKNOWN';
    let recommendedMAs = [];
    let focusArea = '';
    
    if (volatility < 0.015 && current > sma200) {
        // Büyük cap, düşük volatilite, yükseliş trendinde (AAPL, MSFT, GOOGL)
        stockType = 'STABLE_UPTREND';
        recommendedMAs = [21, 50, 200]; // MA50 ve MA200 kritik
        focusArea = 'MA50 ve MA200 çok önemli. Psikolojik seviyeler işe yarar.';
        lookbackPeriod = 200; // Uzun dönem
    } else if (volatility < 0.015 && current < sma200) {
        // Büyük cap, düşük volatilite, düşüş trendinde
        stockType = 'STABLE_DOWNTREND';
        recommendedMAs = [50, 100, 200];
        focusArea = 'MA200 direnç olarak çalışır. Swing lowlar önemli.';
        lookbackPeriod = 200;
    } else if (volatility > 0.04 && volumeTrend > 1.2) {
        // Yüksek volatilite + Artan hacim (Momentum hisse: HOOD, PLTR, RKLB)
        stockType = 'HIGH_MOMENTUM';
        recommendedMAs = [21, 50]; // Kısa vadeli MA'ler
        focusArea = 'Kısa vadeli swingler ve yakın destek/dirençler. Fibonacci önemli.';
        lookbackPeriod = 60; // Orta dönem
    } else if (volatility > 0.04) {
        // Yüksek volatilite (Volatil hisse: EOSE, HIMS, MSTR)
        stockType = 'HIGH_VOLATILITY';
        recommendedMAs = [21]; // Sadece MA21
        focusArea = 'Son 30-40 günlük swingler. Uzak seviyeler işe yaramaz.';
        lookbackPeriod = 40; // Kısa dönem
    } else if (trendStrength > 0.15) {
        // Güçlü yükseliş trendi (Growth hisse: NVDA, AMD, META)
        stockType = 'STRONG_GROWTH';
        recommendedMAs = [21, 50, 100];
        focusArea = 'Fibonacci extensionlar önemli. MA21 dinamik destek.';
        lookbackPeriod = 100;
    } else {
        // Karışık / Normal (Çoğu hisse)
        stockType = 'MIXED';
        recommendedMAs = [21, 50, 100, 200];
        focusArea = 'Tüm indikatörleri dengeli kullan.';
        lookbackPeriod = 100;
    }
    
    console.log(`  Hisse Tipi: ${stockType}`);
    console.log(`  Önerilen MA'ler: ${recommendedMAs.map(m => 'MA' + m).join(', ')}`);
    console.log(`  Strateji: ${focusArea}`);
    console.log(`  Lookback Period: ${lookbackPeriod} gün`);
    
    const dataLength = Math.min(lookbackPeriod, closes.length);
    
    // ============================================
    // 2. DİNAMİK MOVING AVERAGES (Her hisse için özelleştirilmiş)
    // ============================================
    const movingAverages = {};
    const maWeights = {}; // Her MA için özel ağırlık
    
    recommendedMAs.forEach(period => {
        if (closes.length >= period) {
            const ma = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
            movingAverages[`MA${period}`] = ma;
            
            // HİSSE TİPİNE GÖRE AĞIRLIK (Cuma Çevik yaklaşımı)
            let weight = 1.0;
            if (stockType === 'STABLE_UPTREND' || stockType === 'STABLE_DOWNTREND') {
                // Büyük cap: MA50 ve MA200 çok önemli
                if (period === 50) weight = 5.0; // MA50 kritik!
                else if (period === 200) weight = 4.5; // MA200 kritik!
                else if (period === 21) weight = 3.0;
            } else if (stockType === 'HIGH_MOMENTUM' || stockType === 'HIGH_VOLATILITY') {
                // Volatil: Sadece yakın MA'ler önemli
                if (period === 21) weight = 5.0; // MA21 en önemli
                else if (period === 50) weight = 3.5;
                else weight = 1.5; // Uzun MA'ler pek önemli değil
            } else if (stockType === 'STRONG_GROWTH') {
                // Growth: MA21 dinamik destek
                if (period === 21) weight = 5.0;
                else if (period === 50) weight = 4.0;
                else if (period === 100) weight = 3.0;
            } else {
                // Standart ağırlıklar
                if (period === 21) weight = 3.5;
                else if (period === 50) weight = 3.0;
                else if (period === 100) weight = 2.5;
                else if (period === 200) weight = 2.0;
            }
            
            maWeights[`MA${period}`] = weight;
            console.log(`  MA${period}: $${ma.toFixed(2)} (ağırlık: ${weight.toFixed(1)}x, ${ma < current ? 'DESTEK ✅' : 'DİRENÇ ⚠️'})`);
        }
    });
    
    // ============================================
    // 3. SWING HIGH/LOW DETECTION (Hisse tipine göre optimize)
    // ============================================
    const swingHighs = [];
    const swingLows = [];
    
    // Swing strength: Hisse tipine göre ayarla
    let swingStrength;
    if (stockType === 'HIGH_VOLATILITY') {
        swingStrength = 3; // Volatil: Sık swing'ler
    } else if (stockType === 'HIGH_MOMENTUM') {
        swingStrength = 4; // Momentum: Orta
    } else {
        swingStrength = 5; // Stabil: Güçlü swing'ler
    }
    
    for (let i = swingStrength; i < dataLength - swingStrength; i++) {
        const idx = closes.length - dataLength + i;
        const currentHigh = highs[idx];
        const currentLow = lows[idx];
        
        // Swing High: Solda ve sağda daha düşük high'lar
        let isSwingHigh = true;
        for (let j = 1; j <= swingStrength; j++) {
            if (highs[idx - j] >= currentHigh || highs[idx + j] >= currentHigh) {
                isSwingHigh = false;
                break;
            }
        }
        if (isSwingHigh) {
            swingHighs.push({
                price: currentHigh,
                index: idx,
                volume: volumes[idx],
                strength: calculateLevelStrength(highs, idx, true, swingStrength)
            });
        }
        
        // Swing Low: Solda ve sağda daha yüksek low'lar
        let isSwingLow = true;
        for (let j = 1; j <= swingStrength; j++) {
            if (lows[idx - j] <= currentLow || lows[idx + j] <= currentLow) {
                isSwingLow = false;
                break;
            }
        }
        if (isSwingLow) {
            swingLows.push({
                price: currentLow,
                index: idx,
                volume: volumes[idx],
                strength: calculateLevelStrength(lows, idx, false, swingStrength)
            });
        }
    }
    
    // 2. VOLUME WEIGHTED PRICE LEVELS (VWAP benzeri - OPTİMİZE)
    // Yüksek hacimli seviyeler güçlü destek/direnç olur
    const volumeProfile = [];
    // Volatiliteye göre daha hassas veya daha geniş aralık
    const volumePeriod = Math.min(Math.floor(dataLength * 0.7), 50); // Max 50 gün
    const volumeDataHigh = Math.max(...highs.slice(-volumePeriod));
    const volumeDataLow = Math.min(...lows.slice(-volumePeriod));
    const priceRange = volumeDataHigh - volumeDataLow;
    // Volatiliteye göre bucket sayısı: Volatil → daha az bucket (daha geniş aralık)
    const numBuckets = volatility > 0.05 ? 15 : 20;
    const priceStep = priceRange / numBuckets;
    
    console.log(`  Volume Profile: ${volumePeriod} days, ${numBuckets} buckets, step: $${priceStep.toFixed(2)}`);
    
    for (let price = volumeDataLow; price <= volumeDataHigh; price += priceStep) {
        let volumeAtLevel = 0;
        let count = 0;
        
        for (let i = closes.length - volumePeriod; i < closes.length; i++) {
            if (lows[i] <= price && highs[i] >= price) {
                volumeAtLevel += volumes[i] || 0;
                count++;
            }
        }
        
        if (count > 0) {
            volumeProfile.push({
                price: price,
                volume: volumeAtLevel,
                touches: count
            });
        }
    }
    
    // En yüksek hacimli seviyeler
    volumeProfile.sort((a, b) => b.volume - a.volume);
    const highVolumeLevels = volumeProfile.slice(0, 5);
    
    // 3. FIBONACCI RETRACEMENT LEVELS (OPTİMİZE - Daha yakın tarih)
    // Son büyük hareketin Fibonacci seviyeleri - Sadece yakın tarihe odaklan
    const fibPeriod = Math.min(Math.floor(dataLength * 0.6), 60); // Max 60 gün, volatil hisselerde daha az
    const recentHighs = highs.slice(-fibPeriod);
    const recentLows = lows.slice(-fibPeriod);
    const swingHigh = Math.max(...recentHighs);
    const swingLow = Math.min(...recentLows);
    const range = swingHigh - swingLow;
    
    console.log(`  Fibonacci period: ${fibPeriod} days (High: $${swingHigh.toFixed(2)}, Low: $${swingLow.toFixed(2)})`);
    
    const fibLevels = {
        level_0: swingLow,
        level_236: swingLow + range * 0.236,
        level_382: swingLow + range * 0.382,
        level_500: swingLow + range * 0.500,
        level_618: swingLow + range * 0.618,
        level_786: swingLow + range * 0.786,
        level_100: swingHigh,
        // Extension levels (direnç için)
        level_1272: swingHigh + range * 0.272,
        level_1618: swingHigh + range * 0.618,
        level_2618: swingHigh + range * 1.618
    };
    
    // 4. PIVOT POINTS (Standart + Fibonacci + Camarilla)
    const pivots = calculatePivotPointsLegacy(swingHigh, swingLow, current);
    
    // 5. DESTEK SEVİYELERİNİ BİRLEŞTİR ve SKORLA (OPTİMİZE - Yakınlık ağırlığı)
    const supportCandidates = [];
    const rawLevels = []; // Hem destek hem direnç ham seviyeleri (zone clustering için)
    
    // Moving Averages ekle (DİNAMİK AĞIRLIK - Her hisse için özelleştirilmiş)
    Object.entries(movingAverages).forEach(([maName, maPrice]) => {
        if (maPrice < current) {
            const distanceFromCurrent = current - maPrice;
            const distancePercent = distanceFromCurrent / current;
            
            // Mesafe faktörü: Çok yakın veya çok uzak olanları dengele
            let distanceFactor;
            if (distancePercent < 0.02) {
                // Çok yakın (%0-2): Maksimum ağırlık
                distanceFactor = 1.0;
            } else if (distancePercent < 0.05) {
                // Yakın (%2-5): Yüksek ağırlık
                distanceFactor = 0.9;
            } else if (distancePercent < 0.10) {
                // Orta (%5-10): Orta ağırlık
                distanceFactor = 0.7;
            } else {
                // Uzak (%10+): Düşük ağırlık
                distanceFactor = 0.5;
            }
            
            // HİSSE TİPİNE ÖZEL AĞIRLIK KULLAN
            const maStrength = maWeights[maName] || 2.0;
            
            supportCandidates.push({
                price: maPrice,
                type: 'Moving Average',
                strength: maStrength * distanceFactor,
                reason: `${maName} desteği (${stockType})`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'support',
                    price: maPrice,
                    baseStrength: maStrength,
                    distancePct: distancePercent,
                    category: 'MA',
                    label: maName,
                    trendAligned: maPrice < current && stockType.includes('UP') ? 1 : 0
                });
        }
    });
    
    // Swing Lows ekle (En güvenilir)
    swingLows.forEach(sl => {
        if (sl.price < current) {
            // YAKINA DAHA FAZLA AĞIRLIK: Güncel fiyata yakın seviyeler daha önemli
            const distanceFromCurrent = current - sl.price;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current)); // En az %30 ağırlık
            
            supportCandidates.push({
                price: sl.price,
                type: 'Swing Low',
                strength: sl.strength * 3 * distanceFactor, // Swing × yakınlık
                reason: `Güçlü destek (${sl.strength} test)`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'support',
                    price: sl.price,
                    baseStrength: sl.strength,
                    distancePct: distanceFromCurrent / current,
                    category: 'SWING',
                    touches: sl.strength,
                    label: 'Swing Low',
                    trendAligned: stockType.includes('UP') ? 1 : 0
                });
        }
    });
    
    // Volume Profile ekle (Yakınlık ağırlığı ile)
    highVolumeLevels.forEach(vl => {
        if (vl.price < current) {
            const distanceFromCurrent = current - vl.price;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            supportCandidates.push({
                price: vl.price,
                type: 'Volume Level',
                strength: (vl.volume / Math.max(...volumeProfile.map(v => v.volume))) * 2 * distanceFactor,
                reason: `Yüksek hacim bölgesi (${vl.touches} temas)`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'support',
                    price: vl.price,
                    baseStrength: (vl.volume / Math.max(...volumeProfile.map(v => v.volume))) * 2,
                    distancePct: distanceFromCurrent / current,
                    category: 'VOLUME',
                    volumeRatio: vl.volume / Math.max(...volumeProfile.map(v => v.volume)),
                    touches: vl.touches,
                    label: 'Volume Node',
                    trendAligned: stockType.includes('UP') ? 1 : 0
                });
        }
    });
    
    // Fibonacci ekle (Sadece önemli seviyeler + yakınlık ağırlığı)
    Object.entries(fibLevels).forEach(([level, price]) => {
        if (price < current && !level.includes('1272') && !level.includes('1618') && !level.includes('2618')) {
            const distanceFromCurrent = current - price;
            const distanceFactor = Math.max(0.2, 1 - (distanceFromCurrent / current)); // Fib için daha toleranslı
            
            // Sadece güçlü Fibonacci seviyelerine odaklan (618, 500, 382)
            const fibStrength = level.includes('618') ? 2.5 : 
                               level.includes('500') ? 2.0 : 
                               level.includes('382') ? 1.8 : 1.0;
            
            supportCandidates.push({
                price: price,
                type: 'Fibonacci',
                strength: fibStrength * distanceFactor,
                reason: `Fibonacci ${level.replace('level_', '')} seviyesi`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'support',
                    price: price,
                    baseStrength: fibStrength,
                    distancePct: distanceFromCurrent / current,
                    category: 'FIB',
                    label: level,
                    trendAligned: stockType.includes('UP') ? 1 : 0
                });
        }
    });
    
    // Pivot destek seviyeleri ekle (Yakınlık ağırlığı ile)
    [pivots.s1, pivots.s2, pivots.s3].forEach((price, idx) => {
        if (price < current) {
            const distanceFromCurrent = current - price;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            supportCandidates.push({
                price: price,
                type: 'Pivot',
                strength: (1.5 - (idx * 0.3)) * distanceFactor,
                reason: `Pivot S${idx + 1} destek`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'support',
                    price: price,
                    baseStrength: 1.5 - (idx * 0.3),
                    distancePct: distanceFromCurrent / current,
                    category: 'PIVOT',
                    label: `S${idx+1}`,
                    trendAligned: stockType.includes('UP') ? 1 : 0
                });
        }
    });
    
    // 6. DİRENÇ SEVİYELERİNİ BİRLEŞTİR ve SKORLA (OPTİMİZE - Yakınlık ağırlığı)
    const resistanceCandidates = [];
    
    // Moving Averages ekle (DİNAMİK AĞIRLIK - Direnç)
    Object.entries(movingAverages).forEach(([maName, maPrice]) => {
        if (maPrice > current) {
            const distanceFromCurrent = maPrice - current;
            const distancePercent = distanceFromCurrent / current;
            
            let distanceFactor;
            if (distancePercent < 0.02) distanceFactor = 1.0;
            else if (distancePercent < 0.05) distanceFactor = 0.9;
            else if (distancePercent < 0.10) distanceFactor = 0.7;
            else distanceFactor = 0.5;
            
            const maStrength = maWeights[maName] || 2.0;
            
            resistanceCandidates.push({
                price: maPrice,
                type: 'Moving Average',
                strength: maStrength * distanceFactor,
                reason: `${maName} direnci (${stockType})`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'resistance',
                    price: maPrice,
                    baseStrength: maStrength,
                    distancePct: distancePercent,
                    category: 'MA',
                    label: maName,
                    trendAligned: maPrice > current && stockType.includes('DOWN') ? 1 : 0
                });
        }
    });
    
    // Swing Highs ekle (Yakınlık ağırlığı ile)
    swingHighs.forEach(sh => {
        if (sh.price > current) {
            const distanceFromCurrent = sh.price - current;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            resistanceCandidates.push({
                price: sh.price,
                type: 'Swing High',
                strength: sh.strength * 3 * distanceFactor,
                reason: `Güçlü direnç (${sh.strength} test)`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'resistance',
                    price: sh.price,
                    baseStrength: sh.strength,
                    distancePct: distanceFromCurrent / current,
                    category: 'SWING',
                    touches: sh.strength,
                    label: 'Swing High',
                    trendAligned: stockType.includes('DOWN') ? 1 : 0
                });
        }
    });
    
    // Volume Profile ekle (Yakınlık ağırlığı ile)
    highVolumeLevels.forEach(vl => {
        if (vl.price > current) {
            const distanceFromCurrent = vl.price - current;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            resistanceCandidates.push({
                price: vl.price,
                type: 'Volume Level',
                strength: (vl.volume / Math.max(...volumeProfile.map(v => v.volume))) * 2 * distanceFactor,
                reason: `Yüksek hacim bölgesi (${vl.touches} temas)`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'resistance',
                    price: vl.price,
                    baseStrength: (vl.volume / Math.max(...volumeProfile.map(v => v.volume))) * 2,
                    distancePct: distanceFromCurrent / current,
                    category: 'VOLUME',
                    volumeRatio: vl.volume / Math.max(...volumeProfile.map(v => v.volume)),
                    touches: vl.touches,
                    label: 'Volume Node',
                    trendAligned: stockType.includes('DOWN') ? 1 : 0
                });
        }
    });
    
    // Fibonacci Extension ekle (Sadece yakın hedefler + yakınlık ağırlığı)
    [fibLevels.level_100, fibLevels.level_1272, fibLevels.level_1618].forEach((price, idx) => {
        if (price > current) {
            const distanceFromCurrent = price - current;
            const distanceFactor = Math.max(0.2, 1 - (distanceFromCurrent / current));
            
            // Extension seviyeleri için ağırlık
            const extStrength = idx === 0 ? 2.5 : idx === 1 ? 2.0 : 1.5;
            
            resistanceCandidates.push({
                price: price,
                type: 'Fibonacci Extension',
                strength: extStrength * distanceFactor,
                reason: idx === 0 ? 'Fibonacci %100 (önceki zirve)' : `Fibonacci %${idx === 1 ? '127.2' : '161.8'} Extension`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'resistance',
                    price: price,
                    baseStrength: extStrength,
                    distancePct: distanceFromCurrent / current,
                    category: 'FIB_EXT',
                    label: idx === 0 ? '100' : (idx === 1 ? '127.2' : '161.8'),
                    trendAligned: stockType.includes('DOWN') ? 1 : 0
                });
        }
    });
    
    // Pivot direnç seviyeleri ekle (Yakınlık ağırlığı ile)
    [pivots.r1, pivots.r2, pivots.r3].forEach((price, idx) => {
        if (price > current) {
            const distanceFromCurrent = price - current;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            resistanceCandidates.push({
                price: price,
                type: 'Pivot',
                strength: (1.5 - (idx * 0.3)) * distanceFactor,
                reason: `Pivot R${idx + 1} direnç`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'resistance',
                    price: price,
                    baseStrength: 1.5 - (idx * 0.3),
                    distancePct: distanceFromCurrent / current,
                    category: 'PIVOT',
                    label: `R${idx+1}`,
                    trendAligned: stockType.includes('DOWN') ? 1 : 0
                });
        }
    });
    
    // PSİKOLOJİK SEVİYELER ekle (Yuvarlak sayılar - $50, $100, $150, $200, $250, vb.)
    // Cuma Çevik'in kullandığı metod: Trader'lar bu seviyelere önem verir
    const psychologicalLevels = [];
    // Fiyat aralığına göre interval belirle
    let roundingInterval = 10; // Default $10
    if (current < 20) roundingInterval = 5;
    else if (current < 50) roundingInterval = 10;
    else if (current < 100) roundingInterval = 25;
    else if (current < 200) roundingInterval = 50;
    else roundingInterval = 100;
    
    // Güncel fiyatın etrafında ±3 psikolojik seviye bul
    const nearestRound = Math.round(current / roundingInterval) * roundingInterval;
    for (let i = -3; i <= 3; i++) {
        const level = nearestRound + (i * roundingInterval);
        if (level > 0 && level !== nearestRound) { // Tam güncel fiyat değilse
            psychologicalLevels.push(level);
        }
    }
    
    console.log(`  Psychological levels (${roundingInterval} interval):`, psychologicalLevels.map(l => `$${l}`).join(', '));
    
    // Psikolojik destek seviyeleri ekle
    psychologicalLevels.forEach(level => {
        if (level < current) {
            const distanceFromCurrent = current - level;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            supportCandidates.push({
                price: level,
                type: 'Psychological',
                strength: 2.0 * distanceFactor, // Orta-yüksek öncelik
                reason: `Psikolojik destek ($${level})`,
                distance: distanceFromCurrent
            });
            rawLevels.push({
                side: 'support',
                price: level,
                baseStrength: 2.0,
                distancePct: distanceFromCurrent / current,
                category: 'PSYCHO',
                label: `Psy ${roundingInterval}`,
                trendAligned: stockType.includes('UP') ? 1 : 0
            });
        }
    });

    // 7.B - ZONE CLUSTERING (ATR tabanlı yeni metod)
    // =================================================
    // Profesyonel yaklaşım: Tekil fiyatlar yerine "zone" (bölge) kullanmak; çünkü gerçek hayatta destek/direnç alanları birkaç dolarlık aralıklardır.
    // Zone yarıçapı: Dinamik = max(ATR(14)*0.35, price*0.006) (yaklaşık %0.6 veya ATR bazlı)
    // Zones arrays (local) removed; we directly build from rawLevels filters
    const supportLevelsRaw = rawLevels.filter(l => l.side === 'support');
    const resistanceLevelsRaw = rawLevels.filter(l => l.side === 'resistance');
    const baseRadius = atr14 ? atr14 * 0.35 : current * 0.006; // ATR varsa onu kullan, yoksa fiyata göre %0.6
    const dynamicRadiusFor = (price) => Math.max(baseRadius, price * 0.006);

    function buildZones(levels, side){
        if (levels.length === 0) return [];
        // Fiyata göre sırala
        levels.sort((a,b) => a.price - b.price);
        const zones = [];
        let active = {
            min: levels[0].price,
            max: levels[0].price,
            center: levels[0].price,
            levels: [levels[0]]
        };
        let radius = dynamicRadiusFor(levels[0].price);
        for (let i=1;i<levels.length;i++){
            const lvl = levels[i];
            const currentRadius = dynamicRadiusFor(lvl.price);
            // Eğer bu seviye mevcut zone ile yeterince yakınsa birleştir
            if (Math.abs(lvl.price - active.center) <= Math.max(radius, currentRadius)){
                active.levels.push(lvl);
                active.min = Math.min(active.min, lvl.price);
                active.max = Math.max(active.max, lvl.price);
                // Ağırlıklı merkez: baseStrength kullan
                const totalStrength = active.levels.reduce((s,x)=> s + (x.baseStrength || 1),0);
                active.center = active.levels.reduce((s,x)=> s + x.price * (x.baseStrength || 1),0) / totalStrength;
                radius = dynamicRadiusFor(active.center);
            } else {
                zones.push(active);
                active = {
                    min: lvl.price,
                    max: lvl.price,
                    center: lvl.price,
                    levels: [lvl]
                };
                radius = dynamicRadiusFor(lvl.price);
            }
        }
        zones.push(active);
        // Zone genişliği ve tür çeşitliliği gibi meta ekle
        return zones.map(z => {
            const types = new Set(z.levels.map(l => l.category));
            const avgDistancePct = z.levels.reduce((s,l)=> s + (l.distancePct || 0),0) / z.levels.length;
            const swingTouches = z.levels.filter(l => l.category === 'SWING').reduce((s,l)=> s + (l.touches || 0),0);
            const volumeScoreRaw = z.levels.filter(l => l.category === 'VOLUME').reduce((s,l)=> s + (l.volumeRatio || 0),0);
            const maWeighted = z.levels.filter(l => l.category === 'MA').reduce((s,l)=> s + (l.baseStrength || 0),0);
            const fibCount = z.levels.filter(l => l.category.startsWith('FIB')).length;
            const psychoCount = z.levels.filter(l => l.category === 'PSYCHO').length;
            const trendAlignCount = z.levels.reduce((s,l)=> s + (l.trendAligned || 0),0);
            return {
                side,
                center: z.center,
                min: z.min,
                max: z.max,
                width: z.max - z.min,
                radius: dynamicRadiusFor(z.center),
                levelCount: z.levels.length,
                types: Array.from(types),
                diversity: types.size,
                avgDistancePct,
                swingTouches,
                volumeScoreRaw,
                maWeighted,
                fibCount,
                psychoCount,
                trendAlignCount,
                levels: z.levels
            };
        });
    }

    const builtSupportZones = buildZones(supportLevelsRaw, 'support');
    const builtResistanceZones = buildZones(resistanceLevelsRaw, 'resistance');

    // 7.C - CONFLUENCE SCORING
    function scoreZone(z){
        // Bileşenler: Çeşitlilik, MA ağırlığı, Swing dokunuşları, Volume, Fib, Psikolojik, Trend uyumu, Yakınlık
        // Normalize eden çarpanlar (deneysel):
        const diversityScore = z.diversity * 4; // Farklı kaynak sayısı önemli
        const maScore = z.maWeighted * 3; // Büyük cap hisseler için MA önemli
        const swingScore = Math.min(z.swingTouches * 2, 12); // Aşırı şişmesini engelle
        const volumeScore = z.volumeScoreRaw * 5; // Yüksek hacim güçlü
        const fibScore = z.fibCount * 3;
        const psychoScore = z.psychoCount * 2;
        const trendBias = z.trendAlignCount * 1.5; // Trend uyumu bonus
        const proximityScore = (1 / (z.avgDistancePct + 0.005)) * 6; // Yakınlık ters orantılı
        // Geniş zone'ları hafif cezalandır (net değilse) - width / center oranı
        const widthPenalty = (z.width / z.center) > 0.01 ? (z.width / z.center) * 50 : 0; // ~%1 üzeri genişlikte ceza
        const raw = diversityScore + maScore + swingScore + volumeScore + fibScore + psychoScore + trendBias + proximityScore - widthPenalty;
        return {
            raw,
            components: {diversityScore, maScore, swingScore, volumeScore, fibScore, psychoScore, trendBias, proximityScore, widthPenalty}
        };
    }

    const scoredSupportZones = builtSupportZones.map(z => { const s = scoreZone(z); return {...z, score: s.raw, components: s.components}; }).sort((a,b)=> b.score - a.score);
    const scoredResistanceZones = builtResistanceZones.map(z => { const s = scoreZone(z); return {...z, score: s.raw, components: s.components}; }).sort((a,b)=> b.score - a.score);

    // Seçilebilir support/resistance zone'ları (mesafe kısıtı: ilk 15-20%)
    const maxZoneDistancePct = volatility > 0.05 ? 0.20 : 0.15;
    const actionableSupportZones = scoredSupportZones.filter(z => ((current - z.center)/current) <= maxZoneDistancePct && z.center < current);
    const actionableResistanceZones = scoredResistanceZones.filter(z => ((z.center - current)/current) <= maxZoneDistancePct && z.center > current);

    // Ordering: önce mesafe (yakınlık), ardından skor (tie-break)
    actionableSupportZones.sort((a,b)=> {
        const da = (current - a.center)/current;
        const db = (current - b.center)/current;
        if (Math.abs(da - db) < 0.007) return b.score - a.score; // ~%0.7 fark altında skor önceliği
        return da - db;
    });
    actionableResistanceZones.sort((a,b)=> {
        const da = (a.center - current)/current;
        const db = (b.center - current)/current;
        if (Math.abs(da - db) < 0.007) return b.score - a.score;
        return da - db;
    });

    const primarySupportZone = actionableSupportZones[0] || null;
    const secondarySupportZone = actionableSupportZones[1] || null;

    // Uzun vadeli ve anlamlı satış seviyeleri için filtre
    const minSupportGapAbs = Math.max(atr14 ? atr14 * 0.8 : current * 0.03, current * 0.03, 3.00); // ATR veya %3 - Uzun vade için
    const minResistanceGapAbs = Math.max(atr14 ? atr14 * 0.8 : current * 0.10, current * 0.10, 10.00); // ATR veya %10 - Çok daha uzun vade
    // Sadece son 1-2 yılın en yükseklerine yakın ve fiyatın %10-20 üzerinde olan dirençler
    const longTermResistanceZones = actionableResistanceZones.filter(z => {
        const pctAbove = (z.center - current) / current;
        // Direnç zone'u fiyatın %10 üzerinde ve son 200 günün en yükseklerine yakın olmalı
        return pctAbove >= 0.10 && pctAbove <= 0.20 && Math.abs(z.center - swingHigh) < (atr14 ? atr14 * 1.5 : current * 0.05);
    });
    // Sadece en güçlü zone'u ve gap'i büyük olanı seç
    const primaryResistanceZone = longTermResistanceZones[0] || null;
    let secondaryResistanceZone = null;
    if (primaryResistanceZone) {
        secondaryResistanceZone = longTermResistanceZones.find(z => (z.center - primaryResistanceZone.center) >= minResistanceGapAbs);
    }

    // Debug log - daha fazla metrik
    if (primarySupportZone){
        console.log(`  Zone Support1: ${primarySupportZone.min.toFixed(2)}-${primarySupportZone.max.toFixed(2)} center ${primarySupportZone.center.toFixed(2)} dist ${((current - primarySupportZone.center)/current*100).toFixed(2)}% score ${primarySupportZone.score.toFixed(2)} types ${primarySupportZone.types.join('/')}`);
    }
    if (secondarySupportZone){
        console.log(`  Zone Support2: ${secondarySupportZone.min.toFixed(2)}-${secondarySupportZone.max.toFixed(2)} center ${secondarySupportZone.center.toFixed(2)} gap ${( (primarySupportZone.center - secondarySupportZone.center)/current*100 ).toFixed(2)}% score ${secondarySupportZone.score.toFixed(2)}`);
    } else if (primarySupportZone) {
        console.log(`  Zone Support2: YOK (gap < ${(minSupportGapAbs/current*100).toFixed(2)}%)`);
    }
    if (primaryResistanceZone){
        console.log(`  [UZUN VADE] Zone Resistance1: ${primaryResistanceZone.min.toFixed(2)}-${primaryResistanceZone.max.toFixed(2)} center ${primaryResistanceZone.center.toFixed(2)} dist ${((primaryResistanceZone.center - current)/current*100).toFixed(2)}% score ${primaryResistanceZone.score.toFixed(2)} types ${primaryResistanceZone.types.join('/')}`);
    }
    if (secondaryResistanceZone){
        console.log(`  [UZUN VADE] Zone Resistance2: ${secondaryResistanceZone.min.toFixed(2)}-${secondaryResistanceZone.max.toFixed(2)} center ${secondaryResistanceZone.center.toFixed(2)} gap ${( (secondaryResistanceZone.center - primaryResistanceZone.center)/current*100 ).toFixed(2)}% score ${secondaryResistanceZone.score.toFixed(2)}`);
    } else if (primaryResistanceZone) {
        console.log(`  [UZUN VADE] Zone Resistance2: YOK (gap < ${(minResistanceGapAbs/current*100).toFixed(2)}%)`);
    }

    // Psikolojik destek döngüsü daha yukarıda doğru şekilde kapandı.
    
    // Psikolojik direnç seviyeleri ekle
    psychologicalLevels.forEach(level => {
        if (level > current) {
            const distanceFromCurrent = level - current;
            const distanceFactor = Math.max(0.3, 1 - (distanceFromCurrent / current));
            
            resistanceCandidates.push({
                price: level,
                type: 'Psychological',
                strength: 2.0 * distanceFactor,
                reason: `Psikolojik direnç ($${level})`,
                distance: distanceFromCurrent
            });
                rawLevels.push({
                    side: 'resistance',
                    price: level,
                    baseStrength: 2.0,
                    distancePct: distanceFromCurrent / current,
                    category: 'PSYCHO',
                    label: `Psy ${roundingInterval}`,
                    trendAligned: stockType.includes('DOWN') ? 1 : 0
                });
        }
    });
    
    // 7. CLUSTER DETECTION (Yakın seviyeleri birleştir - DİNAMİK)
    // Volatiliteye göre tolerans: Volatil hisse → daha geniş cluster
    const clusterTolerance = volatility > 0.05 ? current * 0.025 : current * 0.015; // %2.5 veya %1.5
    console.log(`  Cluster tolerance: ${(clusterTolerance / current * 100).toFixed(2)}%`);
    
    const supportClusters = clusterLevels(supportCandidates, clusterTolerance);
    const resistanceClusters = clusterLevels(resistanceCandidates, clusterTolerance);
    
    // 8. EN GÜÇLÜ SEVİYELERİ SEÇ (TAMAMEN YENİDEN YAZILDI - AKILLI SEÇİM)
    // Maksimum %15 uzaklıktaki seviyeleri kabul et (volatiliteye göre)
    const maxDistancePercent = volatility > 0.05 ? 0.20 : 0.15; // Volatil hisselerde %20, stabil hisselerde %15
    
    const validSupports = supportClusters.filter(s => {
        const distancePercent = (current - s.price) / current;
        return distancePercent <= maxDistancePercent && s.price > 0 && s.price < current;
    });
    
    const validResistances = resistanceClusters.filter(r => {
        const distancePercent = (r.price - current) / current;
        return distancePercent <= maxDistancePercent && r.price > current;
    });
    
    console.log(`  Valid supports: ${validSupports.length}/${supportClusters.length} (within ${(maxDistancePercent * 100).toFixed(0)}%)`);
    console.log(`  Valid resistances: ${validResistances.length}/${resistanceClusters.length} (within ${(maxDistancePercent * 100).toFixed(0)}%)`);
    
    // DESTEK SEVİYELERİ - AKILLI SEÇİM (En yakın ve en güçlü 2 seviye, aralarında minimum %3 fark olsun)
    const sortedSupports = validSupports.sort((a, b) => b.price - a.price); // Yakından uzağa (current'a yakın önce)
    const selectedSupports = [];
    const minSupportGapPercent = 0.03; // Minimum %3 fark (örn: $240 ve $233 arası)
    
    if (sortedSupports.length > 0) {
        // İlk destek: En yakın ve güçlü olan
        // Güç ve yakınlığı dengele: Score = strength × (1 / distance_factor)
        const scoredSupports = sortedSupports.map(s => {
            const distancePercent = (current - s.price) / current;
            const proximityScore = 1 / (distancePercent + 0.01); // Yakın olana bonus
            return {
                ...s,
                score: s.totalStrength * proximityScore,
                distancePercent
            };
        }).sort((a, b) => b.score - a.score);
        
        const firstSupport = scoredSupports[0];
        selectedSupports.push(firstSupport);
        console.log(`  1st Support: $${firstSupport.price.toFixed(2)} (score: ${firstSupport.score.toFixed(2)}, distance: ${(firstSupport.distancePercent * 100).toFixed(1)}%)`);
        
        // İkinci destek: İlk destekten minimum %3 uzakta ve güçlü olan
        const remainingSupports = scoredSupports.filter(s => {
            const gapPercent = (firstSupport.price - s.price) / current;
            return gapPercent >= minSupportGapPercent;
        });
        
        if (remainingSupports.length > 0) {
            const secondSupport = remainingSupports[0];
            selectedSupports.push(secondSupport);
            console.log(`  2nd Support: $${secondSupport.price.toFixed(2)} (score: ${secondSupport.score.toFixed(2)}, gap: ${((firstSupport.price - secondSupport.price) / current * 100).toFixed(1)}%)`);
        } else {
            console.log(`  2nd Support: Not found (all candidates too close to 1st support)`);
        }
    }
    
    // DİRENÇ SEVİYELERİ - AKILLI SEÇİM (En yakın ve en güçlü 2 seviye, aralarında minimum %3 fark olsun)
    const sortedResistances = validResistances.sort((a, b) => a.price - b.price); // Yakından uzağa (current'a yakın önce)
    const selectedResistances = [];
    const minResistanceGapPercent = 0.03; // Minimum %3 fark
    
    if (sortedResistances.length > 0) {
        // İlk direnç: En yakın ve güçlü olan
        const scoredResistances = sortedResistances.map(r => {
            const distancePercent = (r.price - current) / current;
            const proximityScore = 1 / (distancePercent + 0.01);
            return {
                ...r,
                score: (r.totalStrength || 1) * proximityScore,
                distancePercent
            };
        }).sort((a, b) => b.score - a.score);
        const firstResistance = scoredResistances[0];
        selectedResistances.push(firstResistance);
        console.log(`  1st Resistance: $${firstResistance.price.toFixed(2)} (score: ${firstResistance.score.toFixed(2)}, distance: ${(firstResistance.distancePercent * 100).toFixed(1)}%)`);
        // İkinci direnç: İlk dirençten minimum %3 uzakta ve güçlü olan
        const remainingResistances = scoredResistances.filter(s => {
            const gapPercent = (s.price - firstResistance.price) / current;
            return gapPercent >= minResistanceGapPercent;
        });
        if (remainingResistances.length > 0) {
            const secondResistance = remainingResistances[0];
            selectedResistances.push(secondResistance);
            console.log(`  2nd Resistance: $${secondResistance.price.toFixed(2)} (score: ${secondResistance.score.toFixed(2)}, gap: ${((secondResistance.price - firstResistance.price) / current * 100).toFixed(1)}%)`);
        } else {
            console.log(`  2nd Resistance: Not found (all candidates too close to 1st resistance)`);
        }
    }
    
    // FALLBACK: Eğer hiç seviye bulunamazsa, swing low/high kullan
    if (selectedSupports.length === 0) {
        console.log('  WARNING: No valid supports found, using swing low as fallback');
        selectedSupports.push({ price: swingLow, totalStrength: 1, reason: 'Fallback swing low' });
    }
    if (selectedResistances.length === 0) {
        console.log('  WARNING: No valid resistances found, using swing high as fallback');
        selectedResistances.push({ price: swingHigh, totalStrength: 1, reason: 'Fallback swing high' });
    }
    
    // KRİTİK FİX: allSupports ve allResistances listelerini fiyata göre sırala
    // Böylece performTechnicalAnalysis fallback'inde doğru sıralama kullanılır
    selectedSupports.sort((a, b) => b.price - a.price); // Yüksek fiyat (yakın destek) önce
    selectedResistances.sort((a, b) => a.price - b.price); // Düşük fiyat (yakın direnç) önce
    
    return {
        support: selectedSupports[0]?.price || swingLow,
        resistance: selectedResistances[0]?.price || swingHigh,
        allSupports: selectedSupports,
        allResistances: selectedResistances,
        swingHighs: swingHighs.slice(0, 3),
        swingLows: swingLows.slice(0, 3),
        fibLevels: fibLevels,
        volumeProfile: highVolumeLevels,
        pivots: pivots,
        movingAverages: movingAverages, // MA'leri de döndür
        stockType: stockType, // Hisse tipi bilgisi
        focusArea: focusArea, // Strateji açıklaması
        atr14: atr14,
        zones: {
            support: scoredSupportZones,
            resistance: scoredResistanceZones,
            actionable: {
                support: actionableSupportZones,
                resistance: actionableResistanceZones
            },
            selected: {
                primarySupport: primarySupportZone || null,
                secondarySupport: secondarySupportZone || null,
                primaryResistance: primaryResistanceZone || null,
                secondaryResistance: secondaryResistanceZone || null
            }
        }
    };
}

// Swing seviyesinin gücünü hesapla (kaç kez test edildi?)
function calculateLevelStrength(prices, index, isHigh, range) {
    const targetPrice = prices[index];
    const tolerance = targetPrice * 0.005; // %0.5 tolerans
    let touches = 1;
    
    // Önce ve sonra bu seviyeye kaç kez yaklaşıldı?
    for (let i = Math.max(0, index - 50); i < Math.min(prices.length, index + 50); i++) {
        if (i !== index && Math.abs(prices[i] - targetPrice) <= tolerance) {
            touches++;
        }
    }
    
    return Math.min(touches, 10); // Max 10 touch
}

// Yakın seviyeleri cluster'la (birleştir)
function clusterLevels(candidates, tolerance) {
    if (candidates.length === 0) return [];
    
    // Fiyata göre sırala
    candidates.sort((a, b) => a.price - b.price);
    
    const clusters = [];
    let currentCluster = {
        price: candidates[0].price,
        levels: [candidates[0]],
        totalStrength: candidates[0].strength
    };
    
    for (let i = 1; i < candidates.length; i++) {
        if (candidates[i].price - currentCluster.price <= tolerance) {
            // Aynı cluster'a ekle
            currentCluster.levels.push(candidates[i]);
            currentCluster.totalStrength += candidates[i].strength;
            // Ağırlıklı ortalama fiyat
            currentCluster.price = currentCluster.levels.reduce((sum, l) => sum + l.price * l.strength, 0) / currentCluster.totalStrength;
        } else {
            // Yeni cluster başlat
            clusters.push({
                ...currentCluster,
                reason: currentCluster.levels.map(l => l.reason).join(' + ')
            });
            currentCluster = {
                price: candidates[i].price,
                levels: [candidates[i]],
                totalStrength: candidates[i].strength
            };
        }
    }
    
    // Son cluster'ı ekle
    clusters.push({
        ...currentCluster,
        reason: currentCluster.levels.map(l => l.reason).join(' + ')
    });
    
    return clusters;
}

// Eski fonksiyon - backward compatibility için
function findSupportResistance(closes, highs, lows) {
    if (!closes || closes.length < 20) return null;
    
    const recent = closes.slice(-20);
    const recentHighs = highs.slice(-20);
    const recentLows = lows.slice(-20);
    
    const high = Math.max(...recentHighs);
    const low = Math.min(...recentLows);
    const current = closes[closes.length - 1];
    
    // Pivot noktaları kullan
    const pivots = calculatePivotPointsLegacy(high, low, current);
    
    return {
        resistance: [pivots.r1, pivots.r2, pivots.r3].filter(r => r > current).sort((a, b) => a - b)[0],
        support: [pivots.s1, pivots.s2, pivots.s3].filter(s => s < current).sort((a, b) => b - a)[0],
        allLevels: pivots
    };
}

// Kapsamlı teknik analiz yap (UZUN VADELİ YATIRIM STRATEJİSİ)
function performTechnicalAnalysis(ohlcData) {
    if (!ohlcData || !ohlcData.closes || ohlcData.closes.length < 200) {
        return null;
    }
    
    const { opens, highs, lows, closes, volumes } = ohlcData;
    const currentPrice = closes[closes.length - 1];
    
    // EMA'lar (kısa, orta ve uzun vadeli)
    const ema21 = calculateEMA(closes, 21);
    const ema50 = calculateEMA(closes, 50);
    const ema100 = calculateEMA(closes, 100);
    const ema200 = calculateEMA(closes, 200);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes); // GELİŞTİRİLMİŞ (crossover tespiti ile)
    const bb = calculateBollingerBands(closes, 20, 2);
    
    // YENİ GÖSTERGELER
    const superTrend = calculateSuperTrend(highs, lows, closes, 10, 2.5); // Agresif
    const utBot = calculateUTBot(highs, lows, closes, 10, 3.5); // Muhafazakar
    const obv = calculateOBV(closes, volumes); // Divergence tespiti için
    
    // DEBUG: Check if indicators are calculated
    console.log('Technical indicators calculated:', {
        superTrend: superTrend ? 'OK' : 'NULL',
        utBot: utBot ? 'OK' : 'NULL',
        obv: obv ? 'OK' : 'NULL',
        macd: macd ? 'OK' : 'NULL'
    });
    
    // GELİŞMİŞ DESTEK/DİRENÇ ANALİZİ (Swing High/Low, Volume Profile, Fibonacci)
    const advancedSR = findAdvancedSupportResistance(closes, highs, lows, volumes, 100);
    const sr = advancedSR || findSupportResistance(closes, highs, lows);
    
    // Son 50 günün en yüksek ve en düşük değerleri
    const recent50Highs = highs.slice(-50);
    const recent50Lows = lows.slice(-50);
    const high50 = Math.max(...recent50Highs);
    const low50 = Math.min(...recent50Lows);
    
    // UZUN VADELİ TREND ANALİZİ (EMA 50-100-200)
    let longTermTrend = 'NEUTRAL';
    let trendStrength = 0;
    
    if (ema50 && ema100 && ema200) {
        // Güçlü yükseliş trendi: Fiyat > EMA50 > EMA100 > EMA200
        if (currentPrice > ema50 && ema50 > ema100 && ema100 > ema200) {
            longTermTrend = 'STRONG_BULLISH';
            trendStrength = 3;
        }
        // Orta yükseliş trendi: Fiyat > EMA50 ve EMA50 > EMA200
        else if (currentPrice > ema50 && ema50 > ema200) {
            longTermTrend = 'BULLISH';
            trendStrength = 2;
        }
        // Güçlü düşüş trendi: Fiyat < EMA50 < EMA100 < EMA200
        else if (currentPrice < ema50 && ema50 < ema100 && ema100 < ema200) {
            longTermTrend = 'STRONG_BEARISH';
            trendStrength = -3;
        }
        // Orta düşüş trendi: Fiyat < EMA50 ve EMA50 < EMA200
        else if (currentPrice < ema50 && ema50 < ema200) {
            longTermTrend = 'BEARISH';
            trendStrength = -2;
        }
    }
    
    // UZUN VADELİ ALIM/SATIM FİYATLARI
    let buyPrice, sellPrice, stopLoss, takeProfit;
    let buyReason = [];
    let sellReason = [];
    let signals = [];
    
    // EKLEME STRATEJİSİ (Gelişmiş Destek Analizi ile)
    // Güçlü destek seviyelerinde ekleme yap
    const supportLevels = [];
    
    // Gelişmiş destek/direnç analizi varsa kullan
    if (advancedSR && advancedSR.allSupports && advancedSR.allSupports.length > 0) {
        advancedSR.allSupports.slice(0, 3).forEach((support, idx) => {
            supportLevels.push({
                price: support.price,
                reason: support.reason,
                strength: support.totalStrength
            });
        });
    }
    
    // EMA destekleri ekle
    if (ema200 && ema200 < currentPrice) {
        supportLevels.push({ price: ema200, reason: 'EMA 200 (Çok güçlü destek)', strength: 3 });
    }
    if (ema100 && ema100 < currentPrice) {
        supportLevels.push({ price: ema100, reason: 'EMA 100 (Güçlü destek)', strength: 2.5 });
    }
    if (ema50 && ema50 < currentPrice) {
        supportLevels.push({ price: ema50, reason: 'EMA 50 (Orta vade destek)', strength: 2 });
    }
    
    // Bollinger alt bandı
    if (bb?.lower && bb.lower < currentPrice) {
        supportLevels.push({ price: bb.lower, reason: 'Bollinger alt bandı', strength: 1.5 });
    }
    
    // En güçlü destekleri seç
    supportLevels.sort((a, b) => {
        // Önce güncel fiyata yakınlık (en yakın destek en güvenilir)
        const distanceA = currentPrice - a.price;
        const distanceB = currentPrice - b.price;
        const distanceDiff = distanceA - distanceB;
        
        // %5'ten az fark varsa güce bak
        if (Math.abs(distanceDiff) < currentPrice * 0.05) {
            const strengthDiff = (b.strength || 1) - (a.strength || 1);
            if (Math.abs(strengthDiff) > 0.5) return strengthDiff;
        }
        
        // Aksi halde en yakın destek öncelikli
        return distanceDiff;
    });
    
    // En yakın ve en güçlü desteği al (destek VEYA %0.5 yukarısındakiler)
    const validSupports = supportLevels.filter(s => s.price <= currentPrice * 1.005);
    
    // SON GÜVENLİK: validSupports'u fiyata göre azalan sırada sırala (yakın önce)
    // Böylece validSupports[0] her zaman en yüksek (yakın), validSupports[1] daha derin olur
    validSupports.sort((a, b) => b.price - a.price);
    
    // ZONE BAZLI ALIM SEVİYESİ ÖNCELİĞİ (primary support zone varsa onu kullan)
    let secondBuyPrice = null;
    if (advancedSR && advancedSR.zones && advancedSR.zones.selected.primarySupport) {
        const ps = advancedSR.zones.selected.primarySupport;
        // Tüm uygulanabilir zone'ları fiyatına göre (yüksekteki önce) sırala – böylece yakın (daha yüksek) her zaman Buy1 olur
        const zoneSupports = [];
        if (advancedSR.zones.actionable && Array.isArray(advancedSR.zones.actionable.support)) {
            advancedSR.zones.actionable.support.forEach(z => zoneSupports.push(z));
        } else {
            // Fallback sadece seçilmişleri ekler
            zoneSupports.push(ps);
            if (advancedSR.zones.selected.secondarySupport) zoneSupports.push(advancedSR.zones.selected.secondarySupport);
        }
        // Filtre: sadece current altında olanlar
        const currentPriceSafe = currentPrice;
        const filteredZoneSupports = zoneSupports.filter(z => z && z.center < currentPriceSafe);
        filteredZoneSupports.sort((a,b)=> b.center - a.center); // En yakın (yüksek) önce
        console.log(`[ZONE MODE] Filtered ${filteredZoneSupports.length} support zones below current price`);
        if (filteredZoneSupports.length > 0){
            buyPrice = filteredZoneSupports[0].center;
            buyReason.push(`Zone1 (En Yakın): $${filteredZoneSupports[0].center.toFixed(2)} | Türler: ${filteredZoneSupports[0].types.join(', ')} | Skor: ${filteredZoneSupports[0].score.toFixed(1)}`);
            console.log(`[ZONE MODE] Buy1 from zone: ${buyPrice.toFixed(2)}`);
        }
        if (filteredZoneSupports.length > 1){
            // İkinci seviye mutlaka daha düşük (derin) olacak çünkü sıraladık
            secondBuyPrice = filteredZoneSupports[1].center;
            buyReason.push(`Zone2 (Derin): $${filteredZoneSupports[1].center.toFixed(2)} | Türler: ${filteredZoneSupports[1].types.join(', ')} | Skor: ${filteredZoneSupports[1].score.toFixed(1)}`);
            console.log(`[ZONE MODE] Buy2 from zone: ${secondBuyPrice.toFixed(2)}`);
        }
        // Eğer primary/secondary seçilmiş ve sıralama farklı ise bilgi amaçlı ekle
        if (advancedSR.zones.selected.secondarySupport) {
            const ss = advancedSR.zones.selected.secondarySupport;
            if (!filteredZoneSupports.find(z => z.center === ss.center)) {
                buyReason.push(`(Not: Secondary zone $${ss.center.toFixed(2)} sıralama filtresine alınmadı)`);
            }
        }
    } else if (validSupports.length > 0) {
        // Fallback eski liste
        buyPrice = validSupports[0].price;
        buyReason.push(validSupports[0].reason);
        console.log(`[FALLBACK MODE] Using validSupports[0]: ${buyPrice.toFixed(2)}`);
        if (validSupports.length > 1) {
            secondBuyPrice = validSupports[1].price;
            buyReason.push(`2. Destek: ${validSupports[1].reason} ($${validSupports[1].price.toFixed(2)})`);
            console.log(`[FALLBACK MODE] Using validSupports[1]: ${secondBuyPrice.toFixed(2)}`);
        }
        if (validSupports.length > 2) {
            buyReason.push(`3. Güçlü Destek: ${validSupports[2].reason} ($${validSupports[2].price.toFixed(2)})`);
        }
    } else {
        buyPrice = low50;
        buyReason.push('50 günlük dip seviyesi');
        console.log(`[EMERGENCY FALLBACK] Using low50: ${buyPrice.toFixed(2)}`);
    }
    // Ordering guard: ensure secondBuyPrice < buyPrice (daha derin)
    console.log('[BUY LEVELS RAW]', {
        primarySupportZone: advancedSR?.zones?.selected?.primarySupport?.center,
        secondarySupportZone: advancedSR?.zones?.selected?.secondarySupport?.center,
        buyPriceRaw: buyPrice,
        secondBuyPriceRaw: secondBuyPrice,
        method: advancedSR?.zones?.selected?.primarySupport ? 'zone-based' : 'fallback-list'
    });
    // Nihai sıralama garantisi: Buy1 her zaman daha yüksek olmalı (yüzde bazlı eşitlikte küçük farklar olabilir)
    if (secondBuyPrice !== null) {
        if (secondBuyPrice >= buyPrice) {
            // Swap and mark correction
            const tmp = buyPrice;
            buyPrice = secondBuyPrice;
            secondBuyPrice = tmp;
            buyReason.push('(Oto Düzeltme: Buy1 > Buy2 kuralı uygulandı)');
        }
        // Ek koruma: aradaki fark ÇOK küçükse (< %2.5 veya $2.5) ikinci alımı iptal et
        // Zone mantığı zaten minimum gap (ATR*0.8 veya %3) kontrol ediyor, bu sadece son koruma - UZUN VADE
        const gapPct = ((buyPrice - secondBuyPrice) / buyPrice) * 100;
        const gapAbs = buyPrice - secondBuyPrice;
        if (gapPct < 2.5 || gapAbs < 2.50) {
            buyReason.push(`(İkinci seviye iptal: Gap çok küçük - ${gapPct.toFixed(2)}% veya $${gapAbs.toFixed(2)})`);
            secondBuyPrice = null;
        }
    }
    
    // FALLBACK GÜÇLENDİRME: Zone2 bulunamadıysa veya iptal edildiyse alternatif ara
    if (!secondBuyPrice && validSupports.length > 1) {
        console.log('[FALLBACK] Zone2 yok, validSupports\'tan alternatif aranıyor...');
        // validSupports zaten fiyata göre sıralı (yüksekten düşüğe)
        // buyPrice'dan düşük ve minimum %2.5 gap olan ilk seviyeyi bul
        for (let i = 0; i < validSupports.length; i++) {
            const candidate = validSupports[i];
            if (candidate.price < buyPrice) {
                const gapPct = ((buyPrice - candidate.price) / buyPrice) * 100;
                const gapAbs = buyPrice - candidate.price;
                // Minimum %2.5 gap veya $2.5 mutlak fark - UZUN VADE
                if (gapPct >= 2.5 || gapAbs >= 2.50) {
                    secondBuyPrice = candidate.price;
                    buyReason.push(`2. Alım (Alternatif): ${candidate.reason} - Gap: ${gapPct.toFixed(2)}%`);
                    console.log(`[FALLBACK] Alternatif bulundu: $${secondBuyPrice.toFixed(2)} (gap: ${gapPct.toFixed(2)}%)`);
                    break;
                }
            }
        }
        if (!secondBuyPrice) {
            console.log('[FALLBACK] Uygun alternatif bulunamadı (tüm seviyeler çok yakın veya buyPrice\'dan yüksek)');
        }
    }
    
    console.log('[BUY LEVELS FINAL]', { buyPrice, secondBuyPrice, buyReason });
    
    // KISMİ SATIŞ STRATEJİSİ (Gelişmiş Direnç Analizi ile)
    // Direnç seviyelerinde veya aşırı yükseldiğinde kısmi sat
    const resistanceLevels = [];
    
    // Gelişmiş direnç analizi varsa kullan (daha fazla seviye ekle)
    if (advancedSR && advancedSR.allResistances && advancedSR.allResistances.length > 0) {
        advancedSR.allResistances.slice(0, 8).forEach((resistance, idx) => {
            resistanceLevels.push({
                price: resistance.price,
                reason: resistance.reason,
                strength: resistance.totalStrength
            });
        });
    }
    
    // EMA dirençleri ekle (fiyatın üzerindeyse direnç!)
    // NOT: EMA-21 kısa vade için çok yakın, uzun vadeli stratejide kullanmayalım
    // if (ema21 && ema21 > currentPrice) {
    //     resistanceLevels.push({ price: ema21, reason: 'EMA 21 (Kısa vade direnç)', strength: 1.5 });
    // }
    if (ema50 && ema50 > currentPrice) {
        resistanceLevels.push({ price: ema50, reason: 'EMA 50 (Orta vade direnç)', strength: 2.5 });
    }
    if (ema100 && ema100 > currentPrice) {
        resistanceLevels.push({ price: ema100, reason: 'EMA 100 (Güçlü direnç)', strength: 3 });
    }
    if (ema200 && ema200 > currentPrice) {
        resistanceLevels.push({ price: ema200, reason: 'EMA 200 (Çok güçlü direnç)', strength: 3.5 });
    }
    
    // Bollinger üst bandı
    if (bb?.upper && bb.upper > currentPrice) {
        resistanceLevels.push({ price: bb.upper, reason: 'Bollinger üst bandı', strength: 1.5 });
    }
    
    // 50 günlük en yüksek + %2-10 (güçlü direnç bölgesi)
    // Uzun vadede HER ZAMAN hedef olarak ekle (fiyat üzerinde olsa bile)
    resistanceLevels.push({ price: high50 * 1.02, reason: '50 günlük zirve + %2', strength: 2.2 });
    resistanceLevels.push({ price: high50 * 1.05, reason: '50 günlük zirve + %5', strength: 2 });
    resistanceLevels.push({ price: high50 * 1.10, reason: '50 günlük zirve + %10', strength: 1.8 });
    resistanceLevels.push({ price: high50 * 1.15, reason: '50 günlük zirve + %15', strength: 1.5 });
    
    // Fibonacci extension levels (güçlü kar al bölgeleri) - HER ZAMAN EKLE
    if (advancedSR?.fibLevels) {
        const fib = advancedSR.fibLevels;
        if (fib.level_1000) {
            resistanceLevels.push({ price: fib.level_1000, reason: 'Fibonacci %100 (önceki zirve)', strength: 2.8 });
        }
        if (fib.level_1272) {
            resistanceLevels.push({ price: fib.level_1272, reason: 'Fibonacci %127.2 Extension', strength: 2.5 });
        }
        if (fib.level_1618) {
            resistanceLevels.push({ price: fib.level_1618, reason: 'Fibonacci %161.8 Extension (Güçlü)', strength: 3 });
        }
    }
    
    // En güçlü dirençleri seç
    resistanceLevels.sort((a, b) => {
        // Önce güncel fiyata yakınlık (en yakın direnç en önemli)
        const distanceA = a.price - currentPrice;
        const distanceB = b.price - currentPrice;
        const distanceDiff = distanceA - distanceB;
        
        // %5'ten az fark varsa güce bak
        if (Math.abs(distanceDiff) < currentPrice * 0.05) {
            const strengthDiff = (b.strength || 1) - (a.strength || 1);
            if (Math.abs(strengthDiff) > 0.5) return strengthDiff;
        }
        
        // Aksi halde en yakın direnç öncelikli
        return distanceDiff;
    });
    
    // En yakın ve en güçlü direnci al (direnç VEYA %0.5 aşağısındakiler)
    const validResistances = resistanceLevels.filter(r => r.price >= currentPrice * 0.995);
    
    // CLUSTER: Yakın dirençleri birleştir (desteklerde yaptığımız gibi)
    const clusteredResistances = [];
    const minResistanceGap = currentPrice * 0.040; // %4.0 minimum gap (UZUN VADE - anlamlı hedefler)
    // Dinamik absolute gap: Düşük fiyatlı hisseler için daha düşük ($15 hisse için $0.60, $200 hisse için $5)
    const absoluteMinGap = Math.min(5.00, Math.max(0.50, currentPrice * 0.015)); // Min $0.50, max $5.00, veya %1.5
    
    console.log(`Resistance clustering: minGap=${minResistanceGap.toFixed(2)} (${((minResistanceGap/currentPrice)*100).toFixed(1)}%), absMinGap=$${absoluteMinGap.toFixed(2)}`);
    
    validResistances.sort((a, b) => a.price - b.price); // Önce yakından uzağa sırala
    
    for (const resistance of validResistances) {
        // Bu direnç, mevcut cluster'lardan herhangi birine çok yakın mı?
        // Sadece yukarıya bakıyoruz (resistance.price >= cluster), aşağıya değil
        const nearbyCluster = clusteredResistances.find(c => {
            const gap = Math.abs(c.price - resistance.price);
            return gap < Math.max(minResistanceGap, absoluteMinGap) && gap > 0.01; // En az $0.01 fark olmalı
        });
        
        if (nearbyCluster) {
            // Yakın bir cluster var, birleştir
            // Daha güçlü olanın fiyatını kullan
            if ((resistance.strength || 1) > (nearbyCluster.strength || 1)) {
                nearbyCluster.price = resistance.price;
                nearbyCluster.reason = resistance.reason;
                nearbyCluster.strength = resistance.strength;
            } else {
                // Mevcut cluster daha güçlü, sadece sebepleri birleştir
                if (!nearbyCluster.reason.includes(resistance.reason.split('(')[0])) {
                    nearbyCluster.reason += ` + ${resistance.reason}`;
                }
                nearbyCluster.strength = Math.max(nearbyCluster.strength || 1, resistance.strength || 1);
            }
        } else {
            // Yeni cluster oluştur
            clusteredResistances.push({
                price: resistance.price,
                reason: resistance.reason,
                strength: resistance.strength || 1
            });
        }
    }
    
    // Cluster sonrası tekrar sırala (yakın önce, güçlü öncelikli)
    clusteredResistances.sort((a, b) => {
        const distanceA = a.price - currentPrice;
        const distanceB = b.price - currentPrice;
        const distanceDiff = distanceA - distanceB;
        
        // %5'ten az fark varsa güce bak
        if (Math.abs(distanceDiff) < currentPrice * 0.05) {
            return (b.strength || 1) - (a.strength || 1);
        }
        return distanceDiff;
    });
    
    // SON GÜVENLİK: clusteredResistances'ı fiyata göre artan sırada sırala
    clusteredResistances.sort((a, b) => a.price - b.price);
    
    // Swap guard SORTING SONRASI: İkinci direnç birinciden küçük/eşitse swap et veya sil
    if (clusteredResistances.length >= 2) {
        const gap = clusteredResistances[1].price - clusteredResistances[0].price;
        const gapPct = (gap / clusteredResistances[0].price) * 100;
        
        // ÖNCE: Ters sıra kontrolü (R2 < R1)
        if (gap < 0) {
            console.log(`⚠️ RESISTANCE REVERSED: R1=$${clusteredResistances[0].price.toFixed(2)} > R2=$${clusteredResistances[1].price.toFixed(2)}, swapping...`);
            [clusteredResistances[0], clusteredResistances[1]] = [clusteredResistances[1], clusteredResistances[0]];
        }
        // SONRA: Gap çok küçükse sil
        else if (gap < 0.01 || gapPct < 0.5) {
            // Gap çok küçük (<$0.01 veya <%0.5), ikinci direnci sil
            console.log(`⚠️ RESISTANCE GAP TOO SMALL: R1=$${clusteredResistances[0].price.toFixed(2)}, R2=$${clusteredResistances[1].price.toFixed(2)}, gap=${gapPct.toFixed(2)}%, removing R2...`);
            clusteredResistances.splice(1, 1);
        }
    }
    
    // Debug: Support/Resistance details
    console.log(`Resistance cluster debug: validResistances=${validResistances.length}, clusteredResistances=${clusteredResistances.length}`);
    if (validSupports.length > 0) {
        console.log(`Support levels (top 3): ${validSupports.slice(0, 3).map(s => `$${s.price.toFixed(2)} (${s.reason})`).join(', ')}`);
    }
    if (clusteredResistances.length > 0) {
        console.log(`Resistance levels (clustered, top 3): ${clusteredResistances.slice(0, 3).map(r => `$${r.price.toFixed(2)} (${r.reason})`).join(', ')}`);
    } else {
        console.log(`⚠️ NO CLUSTERED RESISTANCES! Checking validResistances...`);
        if (validResistances.length > 0) {
            console.log(`Valid resistances before clustering: ${validResistances.slice(0, 5).map(r => `$${r.price.toFixed(2)} (${r.reason})`).join(', ')}`);
        }
    }
    
    if (clusteredResistances.length > 0) {
        sellPrice = clusteredResistances[0].price;
        sellReason.push(`Kısmi satış: ${clusteredResistances[0].reason}`);
        
        // İkinci ve üçüncü direnç hedefleri
        if (clusteredResistances.length > 1) {
            sellReason.push(`2. Hedef: ${clusteredResistances[1].reason} ($${clusteredResistances[1].price.toFixed(2)})`);
        }
        if (clusteredResistances.length > 2) {
            sellReason.push(`3. Güçlü Direnç: ${clusteredResistances[2].reason} ($${clusteredResistances[2].price.toFixed(2)})`);
        }
    } else {
        sellPrice = high50 * 1.15;
        sellReason.push('50 günlük zirve + %15');
    }
    
    // STOP LOSS (Uzun vade için çok geniş - sadece felaket senaryosu)
    stopLoss = ema200 ? ema200 * 0.90 : buyPrice * 0.85;  // EMA200'ün %10 altı veya alışın %15 altı
    
    // TAKE PROFIT (Kısmi satış için - tümünü satma)
    takeProfit = sellPrice * 1.05; // İlk hedefin %5 üstü (ikinci kısmi satış)
    
    // BUY & HOLD STRATEJİSİ İÇİN SİNYALLER
    
    // Fiyat konumu analizi (50 günlük aralık)
    const pricePosition = ((currentPrice - low50) / (high50 - low50)) * 100;
    
    if (pricePosition < 20) {
        signals.push('🟢 GÜÇLÜ ALIM FIRSATI: Fiyat 50 günlük aralığın en alt %20\'sinde - Ekleme zamanı!');
    } else if (pricePosition < 40) {
        signals.push('💚 İYİ ALIM FIRSATI: Fiyat düşük seviyelerde - Ekleme yapılabilir.');
    } else if (pricePosition > 80) {
        signals.push('🔴 PAHALI BÖLGE: Fiyat 50 günlük aralığın en üst %20\'sinde - Kısmi satış düşünülebilir.');
    } else if (pricePosition > 60) {
        signals.push('🟡 ORTA-YÜKSEK: Fiyat ortalama üzerinde - Yeni alım için beklenebilir.');
    }
    
    // RSI bazlı sinyaller (uzun vade - daha katı)
    if (rsi < 30) {
        signals.push('📊 RSI ÇOK DÜŞÜK (' + rsi.toFixed(0) + ') - Aşırı satım bölgesi, güçlü ekleme fırsatı.');
    } else if (rsi < 40) {
        signals.push('📊 RSI DÜŞÜK (' + rsi.toFixed(0) + ') - Ekleme yapılabilir.');
    } else if (rsi > 70) {
        signals.push('📊 RSI YÜKSEK (' + rsi.toFixed(0) + ') - Aşırı alım, kısmi kar realizasyonu düşünülebilir.');
    } else if (rsi > 60) {
        signals.push('📊 RSI ORTA-YÜKSEK (' + rsi.toFixed(0) + ') - Yeni alım için beklenebilir.');
    }
    
    // EMA bazlı pozisyon analizi
    if (ema200 && currentPrice > ema200) {
        const distanceFromEma200 = ((currentPrice - ema200) / ema200) * 100;
        if (distanceFromEma200 > 15) {
            signals.push('⚠️ EMA200\'den %' + distanceFromEma200.toFixed(1) + ' uzakta - Pahalı bölge, düzeltme beklenebilir.');
        } else {
            signals.push('✅ EMA200 üzerinde - Sağlam yükseliş trendi.');
        }
    } else if (ema200 && currentPrice < ema200) {
        const distanceToEma200 = ((ema200 - currentPrice) / currentPrice) * 100;
        if (distanceToEma200 > 10) {
            signals.push('🎯 EMA200\'e %' + distanceToEma200.toFixed(1) + ' mesafede - Güçlü ekleme fırsatı!');
        } else {
            signals.push('📉 EMA200 altında - Dikkatli olunmalı, ancak yakında ekleme fırsatı olabilir.');
        }
    }
    
    // Golden Cross / Death Cross kontrol
    if (ema50 && ema200) {
        const ema50Prev = calculateEMA(closes.slice(0, -10), 50);
        const ema200Prev = calculateEMA(closes.slice(0, -10), 200);
        if (ema50 > ema200 && ema50Prev <= ema200Prev) {
            signals.push('🌟 GOLDEN CROSS OLUŞTU! - Uzun vadeli yükseliş trendi başladı, pozisyon büyütülebilir.');
        } else if (ema50 < ema200 && ema50Prev >= ema200Prev) {
            signals.push('💀 DEATH CROSS OLUŞTU! - Uzun vadeli düşüş riski, dikkatli olunmalı.');
        }
    }
    
    // MACD momentum analizi (GELİŞTİRİLMİŞ - Crossover tespiti ile)
    if (macd) {
        if (macd.crossover === 'BULLISH') {
            signals.push('🚀 MACD GOLDEN CROSSOVER! - Güçlü alım sinyali, momentum pozitife döndü.');
        } else if (macd.crossover === 'BEARISH') {
            signals.push('⚠️ MACD DEATH CROSSOVER! - Satış sinyali, momentum negatife döndü.');
        }
        
        if (macd.histogramTrend === 'STRONG_BULLISH') {
            signals.push('📈 MACD Güçlü Yükseliş - Momentum artıyor, trend devam edebilir.');
        } else if (macd.histogramTrend === 'WEAKENING_BULLISH') {
            signals.push('⚠️ MACD Zayıflayan Yükseliş - Momentum azalıyor, dikkatli olun.');
        } else if (macd.histogramTrend === 'STRONG_BEARISH') {
            signals.push('📉 MACD Güçlü Düşüş - Negatif momentum artıyor.');
        } else if (macd.histogramTrend === 'WEAKENING_BEARISH') {
            signals.push('💚 MACD Zayıflayan Düşüş - Düşüş yavaşlıyor, fırsat olabilir.');
        }
    }
    
    // SuperTrend sinyalleri (Agresif - Kısa vadeli)
    if (superTrend) {
        if (superTrend.trend === 'LONG') {
            signals.push('🟢 SuperTrend: LONG - Kısa vadeli yükseliş trendi aktif.');
        } else {
            signals.push('🔴 SuperTrend: SHORT - Kısa vadeli düşüş trendi, kısmi kar al.');
        }
    }
    
    // UT Bot sinyalleri (Muhafazakar - Ana trend)
    if (utBot) {
        if (utBot.trend === 'LONG' && currentPrice > utBot.buyLevel) {
            signals.push('🔵 UT Bot: ANA TREND LONG - Güçlü destek üstünde, pozisyon tut.');
        } else if (utBot.trend === 'SHORT' || currentPrice < utBot.sellLevel) {
            signals.push('🟠 UT Bot: ANA TREND RISK - Destek kırıldı, tamamen sat.');
        }
        
        // UT Bot + SuperTrend Confluence
        if (superTrend && superTrend.trend === 'LONG' && utBot.trend === 'LONG') {
            signals.push('💎 GÜÇLÜ SİNYAL: SuperTrend + UT Bot ikisi de LONG - Yüksek güven.');
        } else if (superTrend && superTrend.trend === 'SHORT' && (utBot.trend === 'SHORT' || currentPrice < utBot.sellLevel)) {
            signals.push('💥 GÜÇLÜ SATIM: SuperTrend + UT Bot ikisi de negatif - Acil çık.');
        }
    }
    
    // OBV (On-Balance Volume) Divergence Analizi
    if (obv) {
        if (obv.divergence === 'BEARISH') {
            signals.push('⚠️ OBV BEARISH DIVERGENCE! - Fiyat yükseliyor ama hacim düşüyor, tehlike!');
        } else if (obv.divergence === 'BULLISH') {
            signals.push('💚 OBV BULLISH DIVERGENCE! - Fiyat düşüyor ama hacim yükseliyor, fırsat!');
        }
        
        if (obv.trend === 'RISING' && obv.momentum > 0) {
            signals.push('📊 OBV Yükselişte - Hacim fiyatı destekliyor, sağlam trend.');
        } else if (obv.trend === 'FALLING' && obv.momentum < 0) {
            signals.push('📊 OBV Düşüşte - Hacim fiyatı desteklemiyor, zayıf trend.');
        }
    }
    
    const result = {
        currentPrice: currentPrice,
        indicators: {
            ema50: ema50,
            ema100: ema100,
            ema200: ema200,
            rsi: rsi,
            macd: macd, // GELİŞTİRİLMİŞ (crossover + histogram trend)
            bollingerBands: bb,
            supportResistance: sr,
            advancedSR: advancedSR, // GELİŞMİŞ DESTEK/DİRENÇ BİLGİLERİ
            superTrend: superTrend, // YENİ - Agresif trend takibi
            utBot: utBot, // YENİ - Muhafazakar ana trend
            obv: obv, // YENİ - Hacim divergence tespiti
            high50: high50,
            low50: low50,
            pricePosition: pricePosition
        },
        signals: {
            overall: longTermTrend,
            trendStrength: trendStrength,
            messages: signals
        },
        recommendations: {
            buyPrice: buyPrice,
            secondBuyPrice: secondBuyPrice || null,
            buyReason: buyReason.join(', '),
            sellPrice: sellPrice,
            sellReason: sellReason.join(', '),
            stopLoss: stopLoss,
            takeProfit: takeProfit,
            riskRewardRatio: ((sellPrice - buyPrice) / (buyPrice - stopLoss)).toFixed(2),
            // Detaylı seviyeler (frontend için)
            supportLevels: validSupports.slice(0, 5).map(s => ({
                price: s.price,
                reason: s.reason,
                strength: s.strength
            })),
            resistanceLevels: validResistances.slice(0, 5).map(r => ({
                price: r.price,
                reason: r.reason,
                strength: r.strength
            })),
            // İlk 3 seviye için özel alan
            // KRİTİK FİX: buyPrice ve secondBuyPrice ile tutarlı ol
            advancedLevels: {
                support: (() => {
                    const levels = [];
                    // İlk seviye her zaman buyPrice
                    if (buyPrice) {
                        levels.push({
                            price: buyPrice,
                            reason: buyReason[0] || 'Primary support',
                            strength: 3
                        });
                    }
                    // İkinci seviye varsa secondBuyPrice
                    if (secondBuyPrice) {
                        levels.push({
                            price: secondBuyPrice,
                            reason: buyReason[1] || 'Secondary support',
                            strength: 2
                        });
                    }
                    // Üçüncü seviye için validSupports'tan al (eğer farklı ise)
                    if (validSupports.length > 2 && validSupports[2].price !== buyPrice && validSupports[2].price !== secondBuyPrice) {
                        levels.push({
                            price: validSupports[2].price,
                            reason: validSupports[2].reason,
                            strength: validSupports[2].strength
                        });
                    } else if (validSupports.length > 1 && levels.length < 3 && validSupports[1].price !== buyPrice && validSupports[1].price !== secondBuyPrice) {
                        // Alternatif olarak ikinci validSupport ekle
                        levels.push({
                            price: validSupports[1].price,
                            reason: validSupports[1].reason,
                            strength: validSupports[1].strength
                        });
                    }
                    return levels;
                })(),
                resistance: (() => {
                    // Uzun vadeli zone ve RSI > 70 ise
                    if (advancedSR && Array.isArray(advancedSR.resistanceZones) && rsi > 70) {
                        return advancedSR.resistanceZones.slice(0, 3).map(z => ({
                            price: z.center,
                            reason: `[UZUN VADE ZONE] ${z.types.join(', ')} | Skor: ${z.score.toFixed(1)} | RSI=${rsi.toFixed(1)}`,
                            strength: z.score
                        }));
                    } else {
                        // Fallback: Klasik cluster
                        return clusteredResistances && clusteredResistances.length > 0 ? clusteredResistances.slice(0, 3).map(r => ({
                            price: r.price,
                            reason: r.reason,
                            strength: r.strength || 1
                        })) : [];
                    }
                })()
            }
        }
    };
    
    return result;
}

// ============================================
// CACHE VE VERİ ÇEKME FONKSİYONLARI
// ============================================

function getCached(symbol) {
    const entry = cache.get(symbol);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        cache.delete(symbol);
        return null;
    }
    return entry.data;
}

function setCached(symbol, data) {
    cache.set(symbol, { timestamp: Date.now(), data });
}

// Yahoo Finance Chart API - 1 dakikalık barlar ile pre/post market verileri
async function fetchYahooData(symbol) {
    return new Promise((resolve, reject) => {
        const chartPath = `/v8/finance/chart/${symbol}?range=1d&interval=1m&includePrePost=true&includeAdjustedClose=true&events=div%2Csplit&useYfid=true&lang=en-US&region=US&corsDomain=finance.yahoo.com`;

        const options = {
            hostname: 'query1.finance.yahoo.com',
            path: chartPath,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com'
            }
        };

        https.get(options, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Yahoo API error: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Yahoo Finance Chart API - Günlük barlar (uzun vadeli analiz için)
async function fetchYahooHistoricalData(symbol) {
    return new Promise((resolve, reject) => {
        // 1 yıllık günlük veri (teknik analiz için yeterli)
        const chartPath = `/v8/finance/chart/${symbol}?range=1y&interval=1d&includeAdjustedClose=true&events=div%2Csplit&useYfid=true&lang=en-US&region=US&corsDomain=finance.yahoo.com`;

        const options = {
            hostname: 'query1.finance.yahoo.com',
            path: chartPath,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/',
                'Origin': 'https://finance.yahoo.com'
            }
        };

        https.get(options, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Yahoo Historical API error: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// ============================================
// PIVOT POINTS CALCULATION (Yahoo Finance Based)
// ============================================

function calculatePivotPoints(ohlcData) {
    if (!ohlcData || !ohlcData.highs || !ohlcData.lows || !ohlcData.closes) {
        return null;
    }
    
    const { highs, lows, closes } = ohlcData;
    const len = closes.length;
    
    if (len < 1) return null;
    
    // Use last completed day's data
    const high = highs[len - 1];
    const low = lows[len - 1];
    const close = closes[len - 1];
    
    // Standard Pivot Points
    const PP = (high + low + close) / 3;
    const R1 = (2 * PP) - low;
    const R2 = PP + (high - low);
    const R3 = high + 2 * (PP - low);
    const S1 = (2 * PP) - high;
    const S2 = PP - (high - low);
    const S3 = low - 2 * (high - PP);
    
    // Fibonacci Pivot Points
    const fibPP = PP;
    const fibR1 = PP + 0.382 * (high - low);
    const fibR2 = PP + 0.618 * (high - low);
    const fibR3 = PP + 1.000 * (high - low);
    const fibS1 = PP - 0.382 * (high - low);
    const fibS2 = PP - 0.618 * (high - low);
    const fibS3 = PP - 1.000 * (high - low);
    
    // Camarilla Pivot Points
    const camR4 = close + (high - low) * 1.1 / 2;
    const camR3 = close + (high - low) * 1.1 / 4;
    const camR2 = close + (high - low) * 1.1 / 6;
    const camR1 = close + (high - low) * 1.1 / 12;
    const camS1 = close - (high - low) * 1.1 / 12;
    const camS2 = close - (high - low) * 1.1 / 6;
    const camS3 = close - (high - low) * 1.1 / 4;
    const camS4 = close - (high - low) * 1.1 / 2;
    
    return {
        standard: {
            pivot: PP,
            resistances: [R1, R2, R3],
            supports: [S1, S2, S3]
        },
        fibonacci: {
            pivot: fibPP,
            resistances: [fibR1, fibR2, fibR3],
            supports: [fibS1, fibS2, fibS3]
        },
        camarilla: {
            resistances: [camR1, camR2, camR3, camR4],
            supports: [camS1, camS2, camS3, camS4]
        }
    };
}

async function getStockData(symbol) {
    // Cache check
    const cached = getCached(symbol);
    if (cached) return cached;

    try {
        // Chart API'den tam veriyi çek (Quote API kaldırıldı - çok sık hata veriyor)
        const data = await fetchYahooData(symbol);
        
        if (data && data.chart && data.chart.result && data.chart.result[0]) {
            const chartResult = data.chart.result[0];
            const meta = chartResult.meta;
            
            // Chart barlarından pre/post türet
            const timestamps = chartResult.timestamp;
            const indicators = chartResult.indicators?.quote?.[0];
            
            if (meta && Array.isArray(timestamps) && indicators?.close) {
                const preStart = 8 * 60;        // 08:00 UTC
                const preEnd = 13 * 60 + 30;    // 13:30 UTC
                const postStart = 20 * 60;      // 20:00 UTC
                const postEnd = 24 * 60;        // 24:00 UTC
                
                let lastPreClose, lastPostClose;
                
                for (let i = 0; i < timestamps.length; i++) {
                    const ts = timestamps[i] * 1000;
                    const d = new Date(ts);
                    const m = d.getUTCMinutes() + d.getUTCHours() * 60;
                    const closeVal = indicators.close[i];
                    
                    if (closeVal == null) continue;
                    
                    if (m >= preStart && m < preEnd) {
                        lastPreClose = closeVal;
                    } else if (m >= postStart && m < postEnd) {
                        lastPostClose = closeVal;
                    }
                }
                
                // Add derived values only during actual pre/post market hours
                const now = new Date();
                const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
                const isPreMarketTime = currentMinutes >= preStart && currentMinutes < preEnd;
                const isPostMarketTime = currentMinutes >= postStart && currentMinutes < postEnd;
                
                if (isPreMarketTime && meta.preMarketPrice === undefined && lastPreClose !== undefined) {
                    meta.derivedPreMarketPrice = lastPreClose;
                    console.log(`${symbol}: Pre-market derived: ${lastPreClose.toFixed(2)}`);
                }
                
                if (isPostMarketTime && meta.postMarketPrice === undefined && lastPostClose !== undefined) {
                    meta.derivedPostMarketPrice = lastPostClose;
                    console.log(`${symbol}: Post-market derived: ${lastPostClose.toFixed(2)}`);
                }
                
                // TEKNİK ANALİZ EKLE (UZUN VADELİ - GÜNLÜK VERİ)
                try {
                    // Günlük veri çek (1 yıllık)
                    const historicalData = await fetchYahooHistoricalData(symbol);
                    
                    if (historicalData?.chart?.result?.[0]) {
                        const histResult = historicalData.chart.result[0];
                        const histTimestamps = histResult.timestamp;
                        const histIndicators = histResult.indicators?.quote?.[0];
                        
                        if (histIndicators && histTimestamps && histTimestamps.length >= 200) {
                            // OHLC verilerini hazırla (günlük)
                            const validIndices = [];
                            for (let i = 0; i < histTimestamps.length; i++) {
                                if (histIndicators.close[i] != null && histIndicators.high[i] != null && 
                                    histIndicators.low[i] != null && histIndicators.open[i] != null) {
                                    validIndices.push(i);
                                }
                            }
                            
                            if (validIndices.length >= 200) {
                                const ohlcData = {
                                    timestamps: validIndices.map(i => histTimestamps[i]),
                                    opens: validIndices.map(i => histIndicators.open[i]),
                                    highs: validIndices.map(i => histIndicators.high[i]),
                                    lows: validIndices.map(i => histIndicators.low[i]),
                                    closes: validIndices.map(i => histIndicators.close[i]),
                                    volumes: validIndices.map(i => histIndicators.volume?.[i] || 0)
                                };
                                
                                const technicalAnalysis = performTechnicalAnalysis(ohlcData);
                                if (technicalAnalysis) {
                                    meta.technicalAnalysis = technicalAnalysis;
                                    console.log(`${symbol}: Technical analysis completed - Trend: ${technicalAnalysis.signals.overall} (${validIndices.length} days of data)`);
                                    
                                    // Calculate Pivot Points (Yahoo Finance based - no API key needed!)
                                    const pivotPoints = calculatePivotPoints(ohlcData);
                                    if (pivotPoints) {
                                        meta.technicalAnalysis.pivotPoints = pivotPoints;
                                        console.log(`${symbol}: Pivot Points calculated - Standard: R3=${pivotPoints.standard.resistances[2].toFixed(2)}, S3=${pivotPoints.standard.supports[2].toFixed(2)}`);
                                    }
                                }
                            }
                        }
                    }
                } catch (taError) {
                    console.error(`${symbol}: Teknik analiz hatası:`, taError.message);
                }
            }
            
            setCached(symbol, data);
            return data;
        }
    } catch (e) {
        console.error(`${symbol}: Yahoo provider error:`, e.message);
    }
    
    return null;
}

// Hisse arama fonksiyonu - Sadece ABD borsaları
async function searchStocks(query) {
    if (!query || query.length < 1) return [];
    
    return new Promise((resolve, reject) => {
        const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
        
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const quotes = json.quotes || [];
                    
                    console.log(`Search for "${query}": Found ${quotes.length} total results`);
                    
                    // Sadece ABD borsalarından hisseleri filtrele
                    const usStocks = quotes.filter(q => {
                        const quoteType = q.quoteType?.toLowerCase() || '';
                        const symbol = q.symbol || '';
                        
                        // Kripto, forex ve vadeli işlemleri çıkar
                        const isInvalidType = symbol.includes('-USD') || 
                                             symbol.includes('=X') || 
                                             symbol.includes('=F') ||
                                             quoteType === 'cryptocurrency' ||
                                             quoteType === 'currency' ||
                                             quoteType === 'future' ||
                                             quoteType === 'index';
                        
                        if (isInvalidType) {
                            return false;
                        }
                        
                        // Sadece equity (hisse senedi) kabul et
                        const isEquity = quoteType === 'equity';
                        
                        if (isEquity) {
                            console.log(`  ✓ ${symbol} - ${q.shortname || q.longname} (${q.exchDisp || q.exchange})`);
                        }
                        
                        return isEquity;
                    }).slice(0, 10).map(q => ({
                        symbol: q.symbol,
                        name: q.longname || q.shortname || q.symbol,
                        exchange: q.exchDisp || q.exchange || 'US'
                    }));
                    
                    console.log(`  → Returning ${usStocks.length} US stocks`);
                    
                    resolve(usStocks);
                } catch (e) {
                    console.error('Search parse error:', e.message);
                    resolve([]);
                }
            });
        }).on('error', (err) => {
            console.error('Search request error:', err.message);
            resolve([]);
        });
    });
}

const server = http.createServer((req, res) => {
    // Search API endpoint
    if (req.url.startsWith('/api/search/')) {
        const query = decodeURIComponent(req.url.split('/')[3]);
        searchStocks(query).then(results => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        }).catch(err => {
            console.error('Search error', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Search failed' }));
        });
        return;
    }

    // API isteği için proxy
    if (req.url.startsWith('/api/stock/')) {
        const symbol = req.url.split('/')[3];
        getStockData(symbol).then(data => {
            if (!data) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Data fetch failed' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        }).catch(err => {
            console.error('Provider error', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal provider error' }));
        });
        return;
    }

    // Statik dosya sunumu (HTML, CSS, JS)
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            res.writeHead(404);
            res.end('404: File Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor.`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`HATA: Port ${PORT} zaten kullanılıyor. Lütfen terminali kapatıp tekrar deneyin veya server.js dosyasındaki PORT numarasını değiştirin.`);
    } else {
        console.error('Sunucu hatası:', err);
    }
});
