// --- API & Constants (Same as before) ---
const BTC_RATE_API_URL = "https://data-api.cryptocompare.com/spot/v1/latest/tick/asset?base_asset=BTC&groups=ID%2CMAPPING%2CVALUE%2CMOVING_24_HOUR&page=1&page_size=10&sort_by=MARKET_BENCHMARK_TIER_AND_MOVING_24_HOUR_VOLUME&sort_direction=DESC&apply_mapping=true";
const SATOSHIS_PER_BTC = 100000000;
const SAT_THRESHOLD = 50000000; // 0.5 BTC
const FALLBACK_BTC_USD_RATE = 70000;

// Currency conversion factors relative to USD (Mock rates as of Oct 2025)
const DOLLAR_CURRENCY_RATES = {
    'USD': 1.00,
    'AUD': 0.65,
    'CAD': 0.73,
    'NZD': 0.60,
    'SGD': 0.74,
};
const NON_DOLLAR_CURRENCY_RATES = {
    '€': 1.08,
    '£': 1.25,
};

// Inject CSS styles for the converted prices
function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .bitcoin-price-converter-span {
            font-weight: 700;
            color: #f7931a !important; /* Bitcoin orange */
            padding: 0 2px;
            background-color: #fffbe6; 
            border-radius: 4px;
            cursor: help;
        }
    `;
    document.head.appendChild(style);
}
        
function approximateDollarCurrency() {
    // In a real content script, this is where you can check the live URL and content.
    const hostname = window.location.hostname.toLowerCase(); 

    if (hostname.includes('.au') || hostname.includes('australia')) return 'AUD';
    if (hostname.includes('.ca') || hostname.includes('canada')) return 'CAD';
    if (hostname.includes('.nz') || hostname.includes('newzealand')) return 'NZD';
    if (hostname.includes('singapore')) return 'SGD';
    
    // Check for explicit text references (using a fast check on a subset of the document)
    const textContent = (document.body.textContent || '').toUpperCase();
    if (textContent.includes('AUSTRALIAN DOLLAR') || textContent.includes('AUD')) return 'AUD';
    if (textContent.includes('CANADIAN DOLLAR') || textContent.includes('CAD')) return 'CAD';
    if (textContent.includes('NEW ZEALAND DOLLAR') || textContent.includes('NZD')) return 'NZD';
    if (textContent.includes('SINGAPORE DOLLAR') || textContent.includes('SGD')) return 'SGD';
    
    return 'USD';
}
        
async function getRealtimeBtcRate() {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(BTC_RATE_API_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            if (data.Data && data.Data.LIST) {
                const usdEquivalent = data.Data.LIST.find(item => 
                    item.QUOTE === 'USD' || item.QUOTE === 'USDT' || item.QUOTE === 'FDUSD'
                );
                if (usdEquivalent && usdEquivalent.PRICE) {
                    const price = parseFloat(usdEquivalent.PRICE);
                    if (!isNaN(price) && price > 0) {
                        return price;
                    }
                }
            }
            throw new Error("Invalid data structure or price not found.");
        } catch (error) {
            console.error(`BTC Rate Fetch Attempt ${attempt + 1} failed:`, error.message);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
            }
        }
    }
    return FALLBACK_BTC_USD_RATE;
}
        
/**
 * Core function to find and replace prices in the entire body of the page.
 */
function convertPricesToSats(btcRate, dollarContext) {
    const rootElement = document.body;
    const MOCK_SATOSHIS_PER_USD = SATOSHIS_PER_BTC / btcRate;
    const dollarToUsdRate = DOLLAR_CURRENCY_RATES[dollarContext] || DOLLAR_CURRENCY_RATES['USD'];

    const priceRegex = /([$€£])\s*([\d\.\,]+)/g;

    const walker = document.createTreeWalker(
        rootElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                // Ignore nodes inside script, style, and the injected price spans
                if (node.parentElement && (
                    node.parentElement.tagName === 'SCRIPT' || 
                    node.parentElement.tagName === 'STYLE' ||
                    node.parentElement.classList.contains('bitcoin-price-converter-span')
                )) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (node.textContent.trim() === '') {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        },
        false
    );

    let node;
    while ((node = walker.nextNode())) {
        let originalText = node.textContent;

        if (priceRegex.test(originalText)) {
            priceRegex.lastIndex = 0; 
            let lastInsertedNode = null; 

            const newText = originalText.replace(priceRegex, (match, currencySymbol, numericalString) => {
                const originalMatch = match;
                let cleanString = numericalString.replace(/,/g, ''); 
                const numericValue = parseFloat(cleanString);

                if (isNaN(numericValue)) return originalMatch; 

                let usdValue;
                if (currencySymbol === '$') {
                    usdValue = numericValue * dollarToUsdRate;
                } else {
                    usdValue = numericValue * (NON_DOLLAR_CURRENCY_RATES[currencySymbol] || 1.0);
                }

                const satoshiValue = Math.round(usdValue * MOCK_SATOSHIS_PER_USD);
                let btcFormatted;
                
                const originalPriceTitle = `title="Original Price: ${originalMatch.trim()} (${currencySymbol === '$' ? dollarContext : currencySymbol} equivalent)"`;

                if (satoshiValue >= SAT_THRESHOLD) {
                    const btcValue = satoshiValue / SATOSHIS_PER_BTC;
                    btcFormatted = `<span class="bitcoin-price-converter-span" ${originalPriceTitle}>${btcValue.toFixed(4)} ₿</span>`;
                } else {
                    btcFormatted = `<span class="bitcoin-price-converter-span" ${originalPriceTitle}>${new Intl.NumberFormat('en-US').format(satoshiValue)} sats</span>`;
                }
                
                return btcFormatted;
            });
            
            // DOM manipulation logic to avoid TreeWalker issues
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newText;
            const fragment = document.createDocumentFragment();
            while (tempDiv.firstChild) {
                lastInsertedNode = tempDiv.firstChild; 
                fragment.appendChild(tempDiv.firstChild);
            }
            
            node.parentNode.replaceChild(fragment, node);

            if (lastInsertedNode) {
                walker.currentNode = lastInsertedNode;
            }
        }
    }
}

// --- Initialization Logic ---
async function initializeConverter() {
    console.log("Satoshi Converter: Starting initialization...");
    injectStyles();
    
    const dollarContext = approximateDollarCurrency();
    console.log(`Satoshi Converter: Dollar context detected as ${dollarContext}.`);

    const btcRate = await getRealtimeBtcRate();
    console.log(`Satoshi Converter: Fetched BTC rate: $${btcRate.toFixed(2)} USD.`);

    convertPricesToSats(btcRate, dollarContext);
    console.log("Satoshi Converter: Conversion complete.");
}

// This script executes automatically when injected by the service worker
initializeConverter();

