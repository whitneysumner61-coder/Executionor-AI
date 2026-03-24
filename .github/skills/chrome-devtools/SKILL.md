# Chrome DevTools MCP

## Purpose

Use the Chrome DevTools MCP when you need to inspect the live Executionor UI in a browser instead of guessing from static HTML, CSS, or JavaScript alone.

This skill is high value for:

- validating layout and interaction changes in `public/index.html` and `public/app.js`
- checking real network requests from the Ops dashboard
- confirming WebSocket- or API-driven UI state updates
- finding browser console errors after frontend changes
- reviewing rendered styles, DOM state, and event behavior

## When to use it

Reach for this skill when any of the following are true:

- a UI change needs visual verification
- an Ops workflow works in the backend but the browser behavior is uncertain
- a user reports frontend issues that are hard to infer from code
- you need to inspect actual requests to `/api/ops`, `/api/monitor`, `/api/logs`, or related routes

Do not use it when a direct file read or API probe is enough.

## Preconditions

- The app is running locally, usually at `http://localhost:3100`
- The `chrome-devtools-mcp` package is installed in this repo
- You know which flow you are validating before opening the browser

## Recommended workflow

1. Start Executionor locally.
2. Open the app in Chrome through the Chrome DevTools MCP.
3. Reproduce the target workflow in the browser.
4. Inspect:
   - console errors
   - failed network requests
   - rendered DOM state
   - applied CSS/layout behavior
5. Make the smallest high-value fix.
6. Re-run the same browser flow to confirm the issue is truly resolved.

## Good targets in this repo

- Ops dashboard task creation, approval, rerun, and audit refresh
- Runbook save/load/instantiate/delete flows
- Policy editing and enforcement feedback
- Monitor, logs, and multi-panel layout behavior
- Any mismatch between backend success and frontend rendering

## Notes for Executionor

- This app is real-time and API-driven, so always inspect both the UI and the network tab together.
- Prefer validating the exact operator path that changed instead of generic page browsing.
- If backend endpoints pass but the UI fails, check browser console output before changing code.
