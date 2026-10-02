# Dynamic action acceptance regression

Run `npm run dev`, open `/tests/regression/dynamic-action-pending.html`, and click **Run regression**. The real action bar and card components run with a synthetic Electron bridge. All 21 assertions must pass.

The fixture checks mouse and Tab acceptance, synchronous and disabled-button dismissal guards, normal Tab navigation while acceptance is pending, duplicate suppression, retry after a failed acceptance, and successful acknowledgement. It makes no capture, provider, or native Electron request. Reload the page to run again.
