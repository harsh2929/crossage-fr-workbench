# Mobile Companion

Vintrace includes a responsive, read-only web companion for phones and tablets. It reads the active desktop workspace through the existing authenticated `/v1` service, so it does not copy the catalog or run a second inference stack on the mobile device.

## Support Contract

- The Vintrace desktop app and its managed backend must remain running and the active workspace must remain unlocked.
- Real devices require one trusted HTTPS origin with no path, query, fragment, or embedded credentials, for example `https://photos.example.com`.
- TLS termination and routing to `127.0.0.1:8765` are operator-owned. A private VPN or LAN-only reverse proxy is preferred over direct internet exposure.
- The public proxy must preserve the request host and serve the mobile shell and API from the same origin. No CORS configuration is required or supported.
- The companion supports library summaries, collections, lexical/hybrid/semantic search, existing local analysis, and optional bounded previews. It cannot edit, organize, import, export, invoke MCP, run recipes, use connectors, or start jobs.
- The companion is online-only. It deliberately registers no service worker and stores no private library response for offline use.

## Pair A Device

1. Route a trusted HTTPS origin to the desktop host's loopback service at `http://127.0.0.1:8765`.
2. Open **AI Agents** in Vintrace and find **Mobile companion**.
3. Enter the public HTTPS origin and save it. `VINTRACE_MOBILE_PUBLIC_URL` can set the origin for managed deployments; an environment value is read-only in the UI.
4. Choose a device label, an expiry of 1, 7, or 30 days, and whether that device may request photo previews.
5. Create the pairing code and scan the QR code on the device. The pairing link is one-use and expires after 10 minutes.

The managed backend starts when a pairing is created. A production pairing is refused until the configured origin uses HTTPS. Plain HTTP is accepted only on loopback in an explicit development/test configuration and must not be exposed to a real device.

## Security Model

- The desktop creates 256 bits of random pairing entropy and places the secret in the URL fragment. The mobile shell removes the fragment from browser history before exchanging it.
- Disk storage contains only the pairing-secret SHA-256 before exchange. A successful exchange deletes that hash, generates a separate random session token, and stores only its SHA-256.
- The browser receives the session only in the host-bound `__Host-vintrace_mobile` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, and `/` scope. JavaScript cannot read it, and no bearer token is written to local storage or session storage.
- Every mobile principal is permanently marked read-only. A deny-by-default route firewall independently allows only the mobile session, library, search, asset metadata/analysis, and optional preview reads. Write, destructive, admin, MCP, connector, recipe, operation, and future unclassified routes return `403`.
- Preview permission is a separate `images:preview` scope and can be omitted per device. Existing consent, Safe Mode, resource bounds, path redaction, and audit controls still apply.
- The static shell contains no workspace data or credential. Documents and private API responses use `no-store`; hashed assets are immutable. CSP, frame denial, MIME sniffing denial, no-referrer, cross-origin isolation headers, and a restrictive permissions policy apply to the shell.
- Mobile account records live under the active workspace at `agent/mobile-companions.json`. POSIX storage is owner-only (`0700` directory, `0600` file), symlinks and oversized files are rejected, writes are atomic, and desktop/backend updates share a cross-process lock.

These controls follow the bearer-token TLS requirement in [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html) and current OAuth deployment guidance in [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). They do not make an internet-exposed desktop host maintenance-free: patch the host and proxy, restrict ingress, monitor access, and revoke unused devices.

## Sessions And Revocation

The phone's **Sign out** command clears only that browser cookie. To invalidate the credential everywhere, revoke the device from **AI Agents** in the desktop app. Revocation disables the account and clears its token hash; the backend rechecks the credential file on every request, so an existing browser session stops working without a server restart.

Expiry is enforced by the backend, not only by the UI. At most 25 unexpired mobile devices can exist in one workspace. Revoked and expired records are retained only as bounded tombstones for operational history.

## Verification

```bash
npm run test:mobile-companion
npm run test:e2e:mobile
npm run build:backend
VINTRACE_MCP_TEST_EXECUTABLE="$PWD/backend-dist/crossage-backend/crossage-backend" npm run test:frozen-mobile-companion
npm run package:check
```

The macOS, Windows, and Linux release workflows run the frozen mobile HTTP suite before packaging. Package checks require the mobile document, manifest, icon, hashed JavaScript, and hashed CSS inside the frozen backend; Linux inspection repeats this for AppImage, deb, and RPM payloads.
