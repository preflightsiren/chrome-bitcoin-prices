// Default state is enabled
chrome.runtime.onInstalled.addListener(async () => {
    // Check if the state already exists. We only set the default if it's undefined (first install).
    const { isEnabled } = await chrome.storage.local.get('isEnabled');

    if (isEnabled === undefined) {
        // If undefined (first run), set the default to enabled (true)
        await chrome.storage.local.set({ isEnabled: true });
        
        // Set the global default badge status
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#f7931a' });
    }
});

/**
 * Ensures the badge state is correctly displayed immediately when a new tab or window is opened.
 */
chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.id) {
        const { isEnabled } = await chrome.storage.local.get('isEnabled');

        const badgeText = isEnabled ? 'ON' : 'OFF';
        const badgeColor = isEnabled ? '#f7931a' : '#777777';

        // Set the badge for the new tab ID
        chrome.action.setBadgeText({ tabId: tab.id, text: badgeText });
        chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: badgeColor });
    }
});

/**
 * Ensures the badge state is correctly displayed whenever a tab is updated (reloaded or navigated).
 * This also handles the automatic re-injection of the script if the extension is enabled.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only proceed when the tab has finished loading
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome')) {
        const { isEnabled } = await chrome.storage.local.get('isEnabled');

        const badgeText = isEnabled ? 'ON' : 'OFF';
        const badgeColor = isEnabled ? '#f7931a' : '#777777';

        // 1. Update the badge for this specific tab to reflect the saved state
        chrome.action.setBadgeText({ tabId: tabId, text: badgeText });
        chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: badgeColor });

        // 2. If the extension is enabled, run the conversion script on the newly loaded page
        if (isEnabled) {
            // Adding a small delay helps avoid race conditions where the 'complete' status fires 
            // slightly before the DOM is fully ready for script injection.
            setTimeout(async () => {
                try {
                    // Rerun injection on the new page load
                    await chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['scripts/content.js']
                    });
                } catch (e) {
                    // Log errors but prevent crashing (e.g., trying to inject into chrome:// pages)
                    if (!e.message.includes('Cannot access a chrome')) {
                        console.error("Failed to inject content script on tab update:", e);
                    }
                }
            }, 100); // Wait 100ms
        }
    }
});


/**
 * Handle clicks on the extension icon to toggle state.
 */
chrome.action.onClicked.addListener(async (tab) => {
    // 1. Get the current state and calculate the new state
    const { isEnabled } = await chrome.storage.local.get('isEnabled');
    const newState = !isEnabled;

    // 2. Save the new state
    await chrome.storage.local.set({ isEnabled: newState });

    // 3. Update the icon/badge immediately (The onUpdated listener will handle persistence)
    const badgeText = newState ? 'ON' : 'OFF';
    const badgeColor = newState ? '#f7931a' : '#777777';

    chrome.action.setBadgeText({ tabId: tab.id, text: badgeText });
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: badgeColor });

    if (newState) {
        // --- ENABLE: Inject immediately for the current page
        console.log("Price converter enabled. Injecting script.");
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['scripts/content.js']
            });
        } catch (e) {
            console.error("Failed to inject content script on click:", e);
        }
    } else {
        // --- DISABLE: Reload the tab to clear all injected content/styles
        // The subsequent reload will hit the onUpdated listener, which will see newState is false, 
        // set the badge to 'OFF' and SKIP the script injection.
        console.log("Price converter disabled. Reloading page to clear changes.");
        chrome.tabs.reload(tab.id);
    }
});

