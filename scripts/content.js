// Constants for API and Conversion
const BTC_TICKER_API = "https://data-api.cryptocompare.com/spot/v1/latest/tick/asset?base_asset=BTC&groups=ID%2CMAPPING%2CVALUE%2CMOVING_24_HOUR&page=1&page_size=10&sort_by=MARKET_BENCHMARK_TIER_AND_MOVING_24_HOUR_VOLUME&sort_direction=DESC&apply_mapping=true";
const SATOSHIS_PER_BITCOIN = 100000000;
const BTC_DISPLAY_THRESHOLD_SATS = 50000000; // 0.5 BTC

// Map for converting magnitude words and ordinals to numerical factors
const MAGNITUDE_MAP = {
    'hundred': 100,
    'thousand': 1000,
    'k': 1000,
    'million': 1000000,
    'm': 1000000,
    'billion': 1000000000,
    'b': 1000000000,
    'trillion': 1000000000000,
    't': 1000000000000,
};

// Regex to capture currency symbol, number, and optional magnitude word/ordinal (k, M, B)
const PRICE_REGEX = /([\$€£])\s?(\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?)\s?(hundred|thousand|million|billion|trillion|k|m|b)?\b/gi;

/**
 * Helper to get the numerical value from a price string, supporting magnitude words/ordinals.
 * e.g., "5.5" and "million" -> 5500000
 */
function parsePriceMagnitude(priceString, magnitudeWord) {
    // Clean up the price string (remove commas) and convert to float
    let value = parseFloat(priceString.replace(/,/g, ''));
    
    if (magnitudeWord) {
        const factor = MAGNITUDE_MAP[magnitudeWord.toLowerCase()];
        if (factor) {
            value *= factor;
        }
    }
    return value;
}

/**
 * Approximates the dollar currency based on document content and domain.
 * Returns the currency symbol and its name.
 */
function approximateDollarCurrency(document) {
    const url = document.location.href.toLowerCase();
    const language = (navigator.language || navigator.userLanguage).toLowerCase();
    const content = document.body.textContent;

    if (url.includes('.ca') || language.includes('en-ca') || content.includes('CDN')) {
        return { symbol: '$', name: 'CAD' };
    }
    if (url.includes('.au') || language.includes('en-au') || content.includes('AUD')) {
        return { symbol: '$', name: 'AUD' };
    }
    if (url.includes('.nz') || language.includes('en-nz') || content.includes('NZD')) {
        return { symbol: '$', name: 'NZD' };
    }
    // Default to USD for all other dollar signs
    return { symbol: '$', name: 'USD' };
}

/**
 * Converts a fiat value to Satoshis or Bitcoin, formatted as a display string.
 */
function formatToBitcoin(usdValue, btcPrice) {
    if (btcPrice === 0) return 'Error: Price 0';

    const satoshiValue = Math.round((usdValue / btcPrice) * SATOSHIS_PER_BITCOIN);

    if (satoshiValue >= BTC_DISPLAY_THRESHOLD_SATS) {
        // Render in Bitcoin (₿)
        const btcValue = satoshiValue / SATOSHIS_PER_BITCOIN;
        return `${btcValue.toFixed(4)} ₿`;
    } else {
        // Render in Satoshis (sats)
        return `${satoshiValue.toLocaleString()} sats`;
    }
}

/**
 * The core function that finds prices in the target element and replaces them in the DOM.
 */
function convertPricesToSats(targetElement, btcPrice) {
    const content = targetElement.textContent;
    if (!content) return;

    // Use a TreeWalker to safely iterate over all Text nodes within the target element
    const walker = document.createTreeWalker(
        targetElement,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let node;
    while (node = walker.nextNode()) {
        const text = node.nodeValue;
        if (!text) continue;

        let match;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text.replace(PRICE_REGEX, (match, currencySymbol, priceValue, magnitudeWord) => {
            
            // 1. Determine the fiat value based on currency symbol and magnitude
            const numericalValue = parsePriceMagnitude(priceValue, magnitudeWord);
            
            let usdValue = numericalValue;
            let estimatedCurrencyName = 'USD'; // Default for non-$, non-€, non-£

            // 2. Adjust USD value based on approximation (only needed for '$')
            if (currencySymbol === '$') {
                const approximation = approximateDollarCurrency(document);
                estimatedCurrencyName = approximation.name;
                // Since we don't have real-time cross rates, we treat all $ prices as USD for the conversion calculation,
                // but we correctly show the *estimated* source currency in the tooltip.
            } else if (currencySymbol === '€') {
                 estimatedCurrencyName = 'EUR';
            } else if (currencySymbol === '£') {
                 estimatedCurrencyName = 'GBP';
            }

            // 3. Convert and format to Bitcoin/Satoshis
            const btcFormat = formatToBitcoin(usdValue, btcPrice);
            
            // 4. Create the final HTML string with the hover title
            const originalPriceString = `${currencySymbol}${priceValue}${magnitudeWord || ''}`;
            const hoverTitle = `Original Price: ${originalPriceString} ${estimatedCurrencyName}`;

            return `<span class="btc-converted-price" title="${hoverTitle}">${btcFormat}</span>`;
        });
        
        // If no replacements were made, move to the next node
        if (tempDiv.innerHTML === text) continue;

        // --- DOM MANIPULATION AND TREEWALKER REPOSITIONING ---
        // This is necessary to avoid issues after modifying the DOM
        const fragment = document.createDocumentFragment();
        let lastInsertedNode = null;

        while (tempDiv.firstChild) {
            lastInsertedNode = tempDiv.firstChild;
            fragment.appendChild(tempDiv.firstChild);
        }

        // Replace the original Text node with the new Fragment
        node.parentNode.replaceChild(fragment, node);

        // Reposition the walker to the last inserted node so it can correctly find the next text node.
        if (lastInsertedNode) {
            walker.currentNode = lastInsertedNode;
        }
    }
}

// --- Main Execution Block ---
(async function () {
    // Check the plugin state from storage right away
    const { isEnabled } = await chrome.storage.local.get('isEnabled');

    // EXIT EARLY if the plugin is disabled (safety check)
    if (isEnabled === false) {
        console.log('[BTC Converter] Disabled by user preference.');
        return; 
    }
    
    // Check if the script has already run to prevent duplicate injections on SPAs
    if (document.body.hasAttribute('data-btc-converter-active')) {
        console.log('[BTC Converter] Already active, preventing re-execution.');
        return;
    }
    
    document.body.setAttribute('data-btc-converter-active', 'true');

    // 1. Fetch the real-time Bitcoin price
    let btcPrice = 0;
    try {
        const response = await fetch(BTC_TICKER_API);
        const data = await response.json();
        
        // Look for USD or USDT market price
        const usdMarket = data.Data.LIST.find(
            item => item.QUOTE === 'USD' || item.QUOTE === 'USDT'
        );
        
        if (usdMarket && usdMarket.PRICE) {
            btcPrice = usdMarket.PRICE;
            console.log(`[BTC Converter] Live BTC Price fetched: $${btcPrice.toLocaleString()}`);
        } else {
            console.error('[BTC Converter] Could not find a suitable BTC price.');
            return;
        }
    } catch (error) {
        console.error('[BTC Converter] Failed to fetch Bitcoin price:', error);
        return;
    }

    // 2. Add necessary CSS styling for the converted price
    const style = document.createElement('style');
    style.textContent = `
        .btc-converted-price {
            color: #f7931a;
            font-weight: 600;
            cursor: help;
            border-bottom: 1px dotted #f7931a;
            white-space: nowrap;
        }
        .btc-converted-price:hover {
            opacity: 0.8;
        }
    `;
    document.head.appendChild(style);

    // 3. Run the conversion on the entire document body
    convertPricesToSats(document.body, btcPrice);
    
    console.log('[BTC Converter] Conversion complete.');
})();

