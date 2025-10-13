// --- Constants for Conversion and Localization ---
const BTC_SATOSHIS = 100000000;
const MAGNITUDE_MAP = {
    'hundred': 100,
    'thousand': 1000,
    'million': 1000000,
    'billion': 1000000000,
    'trillion': 1000000000000
};

// --- Regex to find prices ---
// Captures 1: Currency Symbol ($, £, €)
// Captures 2: Numerical part (e.g., 3, 500, 1,000.50)
// Captures 3: Optional magnitude word (e.g., hundred, thousand)
// The \b ensures we match a whole word if a magnitude is present.
const PRICE_REGEX = /([£$€])\s*(\d{1,3}(?:[,\s]?\d{3})*(?:\.\d+)?)\s?(hundred|thousand|million|billion|trillion)?\b/gi;

// Threshold: 0.5 BTC (50,000,000 Satoshis)
const BTC_THRESHOLD = 50000000;

// Placeholder for the real-time rate
let BTC_USD_RATE = null;

// --- Helper Functions ---

/**
 * Parses a price string potentially followed by a magnitude word (e.g., "5 thousand").
 * @param {string} priceString The numerical part of the price (e.g., "5", "100.5").
 * @param {string | undefined} magnitudeWord The magnitude word (e.g., "thousand", or undefined).
 * @returns {number | null} The final calculated numerical value, or null on error.
 */
function parsePriceMagnitude(priceString, magnitudeWord) {
    // 1. Clean the price string (remove commas/spaces) and parse as a float
    const baseValue = parseFloat(priceString.replace(/[,\s]/g, ''));

    if (isNaN(baseValue)) return null;

    if (!magnitudeWord) {
        // No magnitude word, return the base value directly
        return baseValue;
    }

    // 2. Look up the multiplier
    const multiplier = MAGNITUDE_MAP[magnitudeWord.toLowerCase()];

    if (!multiplier) {
        // This shouldn't happen if the regex is correct, but safe guard
        return baseValue;
    }

    // 3. Return the calculated numerical value
    return baseValue * multiplier;
}

/**
 * Executes API call with exponential backoff for price fetching.
 * @param {string} url The API endpoint URL.
 * @returns {Promise<any>} The parsed JSON response data.
 */
async function fetchWithBackoff(url) {
    let delay = 1000;
    const maxRetries = 3;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`Attempt ${i + 1} failed: ${error.message}`);
            if (i < maxRetries - 1) {
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            } else {
                throw new Error("Failed to fetch data after multiple retries.");
            }
        }
    }
}

/**
 * Fetches the real-time BTC/USD rate from CryptoCompare.
 * @returns {Promise<number | null>} The BTC/USD price or null if fetching fails.
 */
async function getRealtimeBtcRate() {
    const apiUrl = "https://data-api.cryptocompare.com/spot/v1/latest/tick/asset?base_asset=BTC&groups=ID%2CMAPPING%2CVALUE%2CMOVING_24_HOUR&page=1&page_size=10&sort_by=MARKET_BENCHMARK_TIER_AND_MOVING_24_HOUR_VOLUME&sort_direction=DESC&apply_mapping=true";

    try {
        const data = await fetchWithBackoff(apiUrl);
        if (data && data.Data && Array.isArray(data.Data.LIST)) {
            // Find the first PRICE associated with a BTC-USD or BTC-USDT instrument
            const usPriceEntry = data.Data.LIST.find(
                item => item.MAPPED_INSTRUMENT && (
                    item.MAPPED_INSTRUMENT.includes('BTC-USD') || 
                    item.MAPPED_INSTRUMENT.includes('BTC-USDT')
                ) && typeof item.PRICE === 'number'
            );

            if (usPriceEntry) {
                return usPriceEntry.PRICE;
            }
        }
    } catch (error) {
        console.error("Error fetching BTC price:", error);
    }
    // Fallback if API fails or parsing fails
    return null;
}

/**
 * Estimates the currency type based on domain and language.
 * @returns {{symbol: string, rate: number, name: string}} The estimated currency object.
 */
function approximateDollarCurrency() {
    const url = window.location.href;
    const language = (navigator.language || navigator.userLanguage).toLowerCase();
    
    // Default to USD
    let currency = { symbol: '$', rate: 1.0, name: 'USD' };

    // Simple keyword checks for common dollar types
    if (url.includes('.ca') || url.includes('canada') || language.includes('en-ca')) {
        currency = { symbol: '$', rate: 0.73, name: 'CAD' }; // CAD to USD conversion rate (approx)
    } else if (url.includes('.au') || url.includes('australia') || language.includes('en-au')) {
        currency = { symbol: '$', rate: 0.65, name: 'AUD' }; // AUD to USD conversion rate (approx)
    } else if (url.includes('.nz') || url.includes('new-zealand') || language.includes('en-nz')) {
        currency = { symbol: '$', rate: 0.60, name: 'NZD' }; // NZD to USD conversion rate (approx)
    } else if (url.includes('.gb') || url.includes('united-kingdom') || language.includes('en-gb')) {
        // GBP is handled separately by the currency symbol regex, but if a '$' is used on a UK site:
        currency = { symbol: '$', rate: 1.0, name: 'USD' }; 
    }
    
    // Set fixed non-dollar rates for display purposes only, conversion happens against BTC_USD_RATE
    if (currency.symbol !== '$') {
        if (language.includes('en-gb')) {
             currency = { symbol: '£', rate: 1.25, name: 'GBP' }; // GBP to USD conversion rate (approx)
        } else if (language.includes('fr') || url.includes('.eu')) {
             currency = { symbol: '€', rate: 1.08, name: 'EUR' }; // EUR to USD conversion rate (approx)
        }
    }

    return currency;
}


/**
 * Core function to find prices and convert them to Satoshis or Bitcoin.
 * @param {HTMLElement | null} element The root element to search within (e.g., document.body).
 */
function convertPricesToSats(element) {
    if (!element || !BTC_USD_RATE) {
        // Cannot proceed without an element or a valid exchange rate
        return;
    }

    // 1 USD is 1 / BTC_USD_RATE BTC. 
    // 1 USD is (1 / BTC_USD_RATE) * 100,000,000 Satoshis.
    const SATS_PER_USD = BTC_SATOSHIS / BTC_USD_RATE;

    // Use a TreeWalker to safely traverse text nodes only.
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT, // We only care about text nodes
        null,
        false
    );

    let node;
    while ((node = walker.nextNode()) !== null) {
        // Skip nodes inside certain tags (e.g., script, style)
        if (node.parentElement && (
            node.parentElement.tagName === 'SCRIPT' || 
            node.parentElement.tagName === 'STYLE' ||
            node.parentElement.tagName === 'A' ||
            node.parentElement.classList.contains('bitcoin-price-converted') // Avoid processing converted nodes
        )) {
            continue;
        }

        const nodeContent = node.nodeValue;
        if (!nodeContent || !PRICE_REGEX.test(nodeContent)) {
            continue;
        }

        // Reset regex state for the current node
        PRICE_REGEX.lastIndex = 0;
        
        // Temporarily store the matches and replacement strings
        const replacements = [];
        let lastIndex = 0;
        let match;

        while ((match = PRICE_REGEX.exec(nodeContent)) !== null) {
            const [fullMatch, currencySymbol, priceString, magnitudeWord] = match;
            const originalPriceString = fullMatch.trim();

            // 1. Convert the currency price string to a raw numerical value
            const numericalValue = parsePriceMagnitude(priceString, magnitudeWord);

            if (numericalValue === null || isNaN(numericalValue)) {
                 // Skip if parsing failed
                 continue;
            }

            // 2. Approximate USD rate for non-USD currencies (for better Sat conversion)
            let usdValue;
            let estimatedCurrencyName = 'USD'; // Default to USD
            
            if (currencySymbol === '$') {
                // Approximate dollar type (CAD, AUD, USD default)
                const dollarCurrency = approximateDollarCurrency();
                // Convert approximated dollar value to true USD value using the fixed approximation rate
                usdValue = numericalValue * dollarCurrency.rate;
                estimatedCurrencyName = dollarCurrency.name; // Capture the estimated name
            } else if (currencySymbol === '£') {
                // Assume GBP
                usdValue = numericalValue * 1.25; // Approximate GBP to USD rate
                estimatedCurrencyName = 'GBP'; // Set GBP name
            } else if (currencySymbol === '€') {
                // Assume EUR
                usdValue = numericalValue * 1.08; // Approximate EUR to USD rate
                estimatedCurrencyName = 'EUR'; // Set EUR name
            } else {
                // Fallback: Use USD as the conversion base
                usdValue = numericalValue;
                estimatedCurrencyName = 'USD';
            }

            // 3. Convert USD value to Satoshis and format
            const satoshiValue = Math.round(usdValue * SATS_PER_USD);
            let convertedText;
            
            if (satoshiValue >= BTC_THRESHOLD) {
                // Large amount: display in Bitcoin (₿)
                const btcValue = satoshiValue / BTC_SATOSHIS;
                convertedText = `${btcValue.toFixed(4)} ₿`;
            } else {
                // Small amount: display in Satoshis (sats)
                convertedText = `${satoshiValue.toLocaleString()} sats`;
            }

            // 4. Create the span element for injection
            const span = document.createElement('span');
            span.className = 'bitcoin-price-converted';
            span.textContent = convertedText;
            // UPDATED TITLE: Show original price and its estimated currency
            span.title = `Original Price: ${originalPriceString} ${estimatedCurrencyName}`;
            
            // 5. Store the replacement data
            replacements.push({
                index: match.index,
                length: fullMatch.length,
                element: span
            });
        }

        if (replacements.length === 0) {
            continue;
        }

        // --- DOM Replacement Logic (Handles the TreeWalker repositioning) ---
        const fragment = document.createDocumentFragment();
        let currentPos = 0;
        let lastInsertedNode = null;

        replacements.forEach(({ index, length, element }) => {
            // Append the text before the match
            const textBefore = nodeContent.substring(currentPos, index);
            if (textBefore.length > 0) {
                fragment.appendChild(document.createTextNode(textBefore));
            }

            // Append the new converted element
            fragment.appendChild(element);
            lastInsertedNode = element; // Track the last inserted element

            currentPos = index + length;
        });

        // Append the remaining text after the last match
        const textAfter = nodeContent.substring(currentPos);
        if (textAfter.length > 0) {
            fragment.appendChild(document.createTextNode(textAfter));
            // Update lastInsertedNode if it was text (less critical, but safe)
            lastInsertedNode = fragment.lastChild;
        }

        // Replace the original Text node with the new Fragment
        node.parentNode.replaceChild(fragment, node);

        // Reposition the TreeWalker to the last node that was inserted.
        // This is crucial to prevent the walker from getting lost and skipping content.
        if (lastInsertedNode) {
            walker.currentNode = lastInsertedNode;
        }
    }
}

// --- Main Execution ---

async function init() {
    // 1. Fetch the real-time rate
    BTC_USD_RATE = await getRealtimeBtcRate();
    if (!BTC_USD_RATE) {
        console.warn("Bitcoin Price Converter: Could not fetch real-time BTC price. Conversion disabled.");
        return;
    }
    console.log(`Bitcoin Price Converter: Using 1 BTC = $${BTC_USD_RATE.toFixed(2)}`);

    // 2. Add minimal styling to make the converted prices stand out
    const style = document.createElement('style');
    style.textContent = `
        .bitcoin-price-converted {
            color: #f7931a; /* Bitcoin orange */
            font-weight: bold;
            text-decoration: underline dotted #f7931a;
            cursor: help;
            margin: 0 2px;
            padding: 1px 3px;
            border-radius: 4px;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);
    
    // 3. Run the conversion on the entire document body
    convertPricesToSats(document.body);
}

// Execute the initialization function
init();

