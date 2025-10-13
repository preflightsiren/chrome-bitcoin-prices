// --- API & Constants ---
const BTC_RATE_API_URL = "https://data-api.cryptocompare.com/spot/v1/latest/tick/asset?base_asset=BTC&groups=ID%2CMAPPING%2CVALUE%2CMOVING_24_HOUR&page=1&page_size=10&sort_by=MARKET_BENCHMARK_TIER_AND_MOVING_24_HOUR_VOLUME&sort_direction=DESC&apply_mapping=true";
const SATOSHIS_PER_BTC = 100000000;
const SAT_THRESHOLD = 50000000; // 0.5 BTC
const FALLBACK_BTC_USD_RATE = 70000; // Fallback rate if API fails

// Currency conversion factors relative to USD (Mock rates as of Oct 2025)
const DOLLAR_CURRENCY_RATES = {
    'USD': 1.00, // US Dollar (Base)
    'AUD': 0.65, // Australian Dollar
    'CAD': 0.73, // Canadian Dollar
    'NZD': 0.60, // New Zealand Dollar
    'SGD': 0.74, // Singapore Dollar
};
const NON_DOLLAR_CURRENCY_RATES = {
    '€': 1.08, // EUR (relative to USD)
    '£': 1.25, // GBP (relative to USD)
};

/**
 * Approximates the local dollar currency ($) context based on URL, language, and page content.
 * @param {Node} doc The document object or root element.
 * @returns {string} The estimated 3-letter currency code (e.g., 'AUD', 'CAD', 'USD').
 */
function approximateDollarCurrency(doc) {
    const documentToUse = doc || document;
    
    // 1. Check for URL/Domain Clues (since we are not running in a real browser extension, this is limited)
    // In a real browser extension, this would check window.location.hostname
    const hostname = document.URL.toLowerCase(); 

    if (hostname.includes('.au') || hostname.includes('australia')) {
        return 'AUD';
    }
    if (hostname.includes('.ca') || hostname.includes('canada')) {
        return 'CAD';
    }
    if (hostname.includes('.nz') || hostname.includes('newzealand')) {
        return 'NZD';
    }
    if (hostname.includes('singapore')) {
        return 'SGD';
    }
    
    // 2. Check for explicit text references (more reliable if present)
    const textContent = (documentToUse.body.textContent || '').toUpperCase();

    if (textContent.includes('AUSTRALIAN DOLLAR') || textContent.includes('AUD')) {
        return 'AUD';
    }
    if (textContent.includes('CANADIAN DOLLAR') || textContent.includes('CAD')) {
        return 'CAD';
    }
    if (textContent.includes('NEW ZEALAND DOLLAR') || textContent.includes('NZD')) {
        return 'NZD';
    }
    if (textContent.includes('SINGAPORE DOLLAR') || textContent.includes('SGD')) {
        return 'SGD';
    }

    // 3. Check Language/Locale (less reliable but useful, disabled in this sandbox environment)
    /*
    const language = navigator.language.toLowerCase();
    if (language.includes('en-au')) return 'AUD';
    if (language.includes('en-ca') || language.includes('fr-ca')) return 'CAD';
    if (language.includes('en-nz')) return 'NZD';
    */
    
    // Default to USD
    return 'USD';
}

/**
 * Fetches the real-time BTC/USD price from the CryptoCompare API.
 * Uses exponential backoff for resilience.
 * @returns {Promise<number>} The BTC price in USD.
 */
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
                // Find the price where QUOTE is USD, USDT, or FDUSD
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
            console.error(`Attempt ${attempt + 1} failed:`, error.message);
            if (attempt < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, attempt)));
            }
        }
    }
    return FALLBACK_BTC_USD_RATE;
}

/**
 * Finds all price references in a given DOM element's text content and replaces them
 * in the DOM with the Bitcoin format (sats or ₿).
 *
 * @param {Node} rootElement The DOM element to modify.
 * @param {number} btcRate The current BTC price in USD.
 * @param {string} dollarContext The determined currency code for the '$' symbol (e.g., 'AUD').
 * @returns {Array<{original: string, btcFormatted: string}>} A list of found prices and their Bitcoin conversion.
 */
function convertPricesToSats(rootElement, btcRate, dollarContext) {
    if (!rootElement || rootElement.nodeType !== 1) {
        console.error("Input must be a valid DOM element to traverse and modify.");
        return [];
    }
    
    const MOCK_SATOSHIS_PER_USD = SATOSHIS_PER_BTC / btcRate;
    
    // Get the USD conversion rate for the dollar context
    const dollarToUsdRate = DOLLAR_CURRENCY_RATES[dollarContext] || DOLLAR_CURRENCY_RATES['USD'];

    const conversions = [];
    const priceRegex = /([$€£])\s*([\d\.\,]+)/g;

    // Use a TreeWalker to safely iterate over all Text nodes
    const walker = document.createTreeWalker(
        rootElement,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                if (node.parentElement && (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE')) {
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
                    // Use the dynamically detected dollar rate
                    usdValue = numericValue * dollarToUsdRate;
                } else {
                    // Use fixed rates for non-dollar currencies (EUR, GBP)
                    usdValue = numericValue * (NON_DOLLAR_CURRENCY_RATES[currencySymbol] || 1.0);
                }

                // Convert to Satoshis using the live BTC/USD rate
                const satoshiValue = Math.round(usdValue * MOCK_SATOSHIS_PER_USD);

                let btcFormatted;
                
                // Create the title attribute for the hover tooltip
                const originalPriceTitle = `title="Original Price: ${originalMatch.trim()} (${currencySymbol === '$' ? dollarContext : currencySymbol} equivalent)"`;


                if (satoshiValue >= SAT_THRESHOLD) {
                    // Render in Bitcoin (₿)
                    const btcValue = satoshiValue / SATOSHIS_PER_BTC;
                    btcFormatted = `<span class="bitcoin-price" ${originalPriceTitle}>${btcValue.toFixed(4)} ₿</span>`;
                } else {
                    // Render in Satoshis (sats)
                    btcFormatted = `<span class="bitcoin-price" ${originalPriceTitle}>${new Intl.NumberFormat('en-US').format(satoshiValue)} sats</span>`;
                }
                
                conversions.push({
                    original: originalMatch,
                    satsValue: satoshiValue,
                    btcFormatted: btcFormatted,
                });

                return btcFormatted;
            });
            
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newText;

            const fragment = document.createDocumentFragment();
            while (tempDiv.firstChild) {
                lastInsertedNode = tempDiv.firstChild; 
                fragment.appendChild(tempDiv.firstChild);
            }
            
            node.parentNode.replaceChild(fragment, node);

            // Reposition the TreeWalker
            if (lastInsertedNode) {
                walker.currentNode = lastInsertedNode;
            }
        }
    }
    
    return conversions;
}

window.onload = async function() {
    const dollarContext = approximateDollarCurrency(document);
    const btcRate = await getRealtimeBtcRate();
    // console.log(btcRate)
    convertPricesToSats(document.querySelector("article"), btcRate, dollarContext);
}
