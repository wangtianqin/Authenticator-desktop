# Third-party notices

Authenticator Desktop is built with the following open-source packages. This
file is provided for attribution; the licenses below apply to their respective
components, not to Authenticator Desktop's own source code.

Full license texts for bundled components are included in the `licenses/`
directory next to this file (and in the installed application's `resources`
directory).

## Runtime dependencies

### Electron / Chromium

- Project: https://www.electronjs.org/
- License: MIT (Electron); Chromium includes multiple open-source licenses.
- The Electron distribution bundles a `LICENSE` and `LICENSES.chromium.html`.
  Those files are included in the installed application directory.

### React / React DOM

- Project: https://react.dev/
- License: MIT
- Copyright: Meta Platforms, Inc. and affiliates.

### jsQR

- Project: https://github.com/cozmo/jsQR
- License: Apache License 2.0
- Copyright: Cosmo Wolfe and contributors.
- Used for QR code decoding from camera, image and screen captures.

The Apache License 2.0 text is available at
https://www.apache.org/licenses/LICENSE-2.0.

### qrcode-generator

- Project: https://github.com/kazuhikoarase/qrcode-generator
- License: MIT
- Copyright: Kazuhiko Arase.

### hash-wasm

- Project: https://github.com/Daninet/hash-wasm
- License: MIT
- Copyright: Dani Biró and contributors.
- Used only to derive keys when decrypting Authenticator browser-extension v3
  backups (Argon2id).

## Build-time dependencies

The following packages are used to build and package the application but are
not required at runtime as separate modules:

- Vite (MIT) — https://vite.dev/
- electron-builder (MIT) — https://www.electron.build/
- Node.js (MIT-style) — https://nodejs.org/

## Protocol references

- RFC 4226: HOTP: An HMAC-Based One-Time Password Algorithm
- RFC 6238: TOTP: Time-Based One-Time Password Algorithm
- Google Authenticator migration payload format (open-source protobuf schema)

No source code from the Authenticator browser extension is included in this
application. Its public backup formats are supported for interoperability.
