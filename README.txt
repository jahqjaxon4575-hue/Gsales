G.sales — Final PWA package (Activity Log + CSV export + Sync Now + Last Sync)
Deploy:
1. Upload these files to a GitHub repository.
2. Enable GitHub Pages (branch main, root).
3. Open the published URL in Chrome and install via 'Add to Home screen'.
Notes:
- Server URL is hardcoded to: https://script.google.com/macros/s/AKfycbx.../exec
- Ensure your Google Apps Script endpoint accepts POST form-data and returns JSON: { "status": "ready" }
- Last sync time saved in localStorage under 'g_last_sync'.
