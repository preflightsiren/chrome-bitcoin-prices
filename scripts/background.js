// Manages the state of the plugin (ON/OFF) and handles script injection.

// Set default state to 'ON' upon installation
chrome.runtime.onInstalled.addListener(async () => {
    const { isEnabled } = await chrome.storage.local.get('isEnabled');
    if (isEnabled === undefined) {
        await chrome.storage.local.set({ isEnabled: true });
    }
});

// Listener for icon click to toggle state
chrome.action.onClicked.addListener(async (tab) => {
    const { isEnabled } = await chrome.storage.local.get('isEnabled');
    const newState = !isEnabled;

    await chrome.storage.local.set({ isEnabled: newState });

    // Update the badge text and color immediately
    const badgeText = newState ? 'ON' : 'OFF';
    const badgeColor = newState ? '#f7931a' : '#777777';

    chrome.action.setBadgeText({ text: badgeText, tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tab.id });

    // Reload the current page to inject/remove the script cleanly
    chrome.tabs.reload(tab.id);
});

// Listener for tab creation (sets the badge color/text immediately)
chrome.tabs.onCreated.addListener(async (tab) => {
    // Check global state
    const { isEnabled } = await chrome.storage.local.get('isEnabled');

    const badgeText = isEnabled ? 'ON' : 'OFF';
    const badgeColor = isEnabled ? '#f7931a' : '#777777';

    if (tab.id) {
        chrome.action.setBadgeText({ text: badgeText, tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tab.id });
    }
});

// Listener for tab updates (only handles state persistence/badge update across navigation)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 1. Get the current state
    const { isEnabled } = await chrome.storage.local.get('isEnabled');

    // 2. Always update the badge state based on the stored preference
    const badgeText = isEnabled ? 'ON' : 'OFF';
    const badgeColor = isEnabled ? '#f7931a' : '#777777';
    
    chrome.action.setBadgeText({ text: badgeText, tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId: tabId });
    
    // NOTE: Script injection logic is now in chrome.webNavigation.onCompleted for reliability.
});

// NEW: Listener for web navigation completion (for reliable script injection)
// Requires "webNavigation" permission in manifest.json
chrome.webNavigation.onCompleted.addListener(async (details) => {
    // Ensure we only process the main frame (frameId 0) to prevent injection into iframes
    if (details.frameId !== 0) return;

    // 1. Get the current state
    const { isEnabled } = await chrome.storage.local.get('isEnabled');
    
    // 2. Inject the script if enabled
    if (isEnabled) {
        try {
            // Use the URL from details object for robust filtering
            if (!details.url || details.url.startsWith('chrome://') || details.url.startsWith('about:') || details.url.startsWith('data:')) {
                 console.warn(`[BTC Converter] Internal or restricted page, skipping injection for tab ${details.tabId}.`);
                 return;
            }

            await chrome.scripting.executeScript({
                target: { tabId: details.tabId },
                files: ['scripts/content.js']
            });
            console.log(`[BTC Converter] Script injected into tab ${details.tabId}.`);
        } catch (e) {
            // This handles final permission errors (e.g., trying to inject on the Chrome Web Store) 
            console.warn(`[BTC Converter] Script injection prevented for tab ${details.tabId}: ${e.message}`);
        }
    }
});

