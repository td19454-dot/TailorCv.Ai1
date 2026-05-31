// TailorCV Auto Apply — Background Service Worker
// Switch to 'https://thetailorcv.com' when deploying to production
const BASE_URL = 'http://127.0.0.1:8005';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'GET_PROFILE') {
        const res = await fetch(`${BASE_URL}/api/extension/profile`, {
          credentials: 'include',
        });
        if (!res.ok) {
          sendResponse({ error: 'Not logged in to TailorCV. Please log in at thetailorcv.com first.' });
          return;
        }
        sendResponse({ data: await res.json() });

      } else if (msg.type === 'LOG_APPLICATION') {
        try {
          const res = await fetch(`${BASE_URL}/api/extension/log-application`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload),
          });
          sendResponse({ data: await res.json() });
        } catch (e) {
          sendResponse({ error: e.message });
        }

      } else {
        sendResponse({ error: 'Unknown message type' });
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();
  return true; // keep channel open for async response
});
