# Privacy Policy — Agent Latency Lab

**Last updated:** September 4, 2026

## Summary

Agent Latency Lab does not collect, transmit, store on any server, or share any user data. It makes no network requests of its own. Everything it does happens locally in your browser.

## What the extension accesses

When you have the Agent Latency panel open in Chrome DevTools, the extension receives timing information about network requests made by the tab you are inspecting. This is provided by Chrome's standard `chrome.devtools.network` API and includes the request URL, HTTP method, response status, timing phases (connection setup, waiting, receiving), and request headers such as `traceparent`.

This information is held in the panel's memory only while the panel is open, and is used solely to render the waterfall, percentile summaries, alert feed, and SLO simulation you see on screen. It is discarded when you close DevTools, clear the capture, or navigate away. It is never written to disk, never sent anywhere, and never shared with the developer or any third party.

If you use the Export button, the captured data is written to a file on your own computer at your explicit request. Nothing is uploaded.

## What the extension stores

The extension writes one thing to `chrome.storage.local`: your SLO simulation settings — latency threshold, objective percentage, window size, trial count, and choice of latency measure. These are numbers you type into the panel, and they are saved only so the form is not blank the next time you open it. They remain on your device and are not synced or transmitted.

## What the extension does not do

- No analytics, telemetry, crash reporting, or usage tracking of any kind
- No network requests to any server, including the developer's
- No advertising, and no data sold or shared with data brokers
- No cookies, no browsing history access, no tab access, no host permissions
- No account, login, or identifier of any kind

## Permissions

The extension declares exactly one permission, `storage`, used for the SLO settings described above. Access to request timings comes from the `devtools_page` manifest entry, which grants the standard DevTools APIs and applies only to the tab you have DevTools open on.

## Data retention and deletion

Because nothing is transmitted or stored remotely, there is no data for the developer to retain or delete. To remove the locally saved settings, uninstall the extension — Chrome deletes its local storage automatically.

## Changes

If a future version changes any of the above, this policy will be updated before that version is published, and the change will be noted in the release notes.

## Contact

Questions about this policy: johnbakerjobs@gmail.com

Source code: https://github.com/juubaker/agent-latency-lab-extension
