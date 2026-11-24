# Airport Digital Customer Service

LAN-Based Video Assistance System | Independent Portfolio Project

## Project Overview

Airport Digital Customer Service demonstrates how a passenger can request live video assistance from an airport service desk on a local network. It pairs a mobile passenger portal with a desktop officer dashboard.

After installing the dependencies and setting up local HTTPS, the application can run without internet access on a LAN that allows devices to reach each other. WebRTC can use direct local connectivity. The configured public STUN server requires internet access and is unavailable offline.

## Independent Portfolio Disclaimer

This is an independent portfolio project. It is not an official product and is not affiliated with, endorsed by, or supported by any company, airport, or airport operator. Use synthetic names and service data for demos.

## Key Features

- One-to-one video calls using WebRTC and Push-to-Talk audio.
- Real-time Socket.IO queue, officer dashboard, and Accept/Reject Call actions.
- Server-verified local officer access and **Logout / Ganti Petugas** for switching demo identities.
- Officer waiting timer based on the server enqueue timestamp. It updates each second and preserves elapsed time through view changes and temporary reconnects.
- Passenger UI in Indonesian, English, French, Japanese, Arabic (right-to-left), and Simplified Chinese.
- Service notes, passenger ratings, and dashboard statistics. Recent Calls shows up to five cards per page.
- Persistent `CS-DDMMYY-NNN` call references with **Copy ID** and daily numbering in Asia/Jakarta.
- Local SQLite storage for call metadata, notes, and ratings. The application does not record call audio or video.

## Tech Stack

| Layer | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, Express, Socket.IO |
| Media | WebRTC, browser camera and microphone APIs |
| Storage | SQLite via Node.js `node:sqlite` |
| Local TLS | mkcert and the Vite HTTPS development server |

## System Architecture

The officer browser uses a loopback HTTP URL. The passenger browser uses the laptop's LAN IP over HTTPS. Both frontends send Socket.IO requests to the same origin. Vite proxies them to the backend at `127.0.0.1:3000`. Socket.IO coordinates the queue and WebRTC signaling. The browsers exchange media directly when WebRTC establishes a peer connection.

```text
Officer browser (loopback HTTP)      Passenger browser (LAN HTTPS)
                 |                            |
                 +------ Vite /socket.io -----+
                              |
                     Express + Socket.IO
                       |              |
                Live queue in RAM    Local SQLite

Officer browser <--------- WebRTC media ---------> Passenger browser
```

## Project Structure

```text
src/                 Frontend, WebRTC hooks, and passenger locale dictionaries
public/              Original logo and browser icons
server/              Express, Socket.IO queue, and SQLite storage
server/tests/        Queue, call history, and locale checks
vite.config.ts       Development HTTP/HTTPS and Socket.IO proxy
.env.example         Optional frontend environment template
server/.env.example  Local backend environment template
```

## Requirements

- Node.js 22.20+ on the Node 22 line and npm. Verification used Node.js 22.20.0 and npm 10.9.3.
- A browser with WebRTC support, a camera, and a microphone.
- mkcert for passenger HTTPS. Use a LAN or hotspot where the laptop and passenger device can reach each other.

## Installation

From the project root:

```sh
npm ci
npm --prefix server ci
```

The frontend and backend each use an npm `package-lock.json`. npm is the sole documented package manager. The superseded alternative lockfile is excluded from the public project.

Copy `server/.env.example` to `server/.env`. In PowerShell, use `Copy-Item server/.env.example server/.env` for a new checkout. Set `OFFICER_ACCESS_CODE` to a private, randomly generated value of 16–128 characters in that server file. Use a password manager to generate and share it only with intended demo officers. Leave `VITE_SOCKET_URL` unset so both frontends use the same-origin proxy. Keep the backend on its loopback default and leave `CLIENT_ORIGIN` unset for the standard setup.

## Local HTTPS Setup

Generate your own development certificate with mkcert. From the project root, create `certs/` and run the command below, replacing the example address with the laptop's current LAN IPv4 address.

```sh
mkcert -cert-file certs/echo-call.pem -key-file certs/echo-call-key.pem localhost 127.0.0.1 ::1 192.0.2.10
```

Reuse your existing mkcert CA. If you need to create and trust a local CA on the laptop, run `mkcert -install` before generating the development certificate. If your iPhone needs to trust the CA, use `mkcert -CAROOT` to locate the public certificate `rootCA.pem`. Transfer only that certificate to your iPhone as a `.crt` file, install its profile in Settings, and enable full trust under **Settings > General > About > Certificate Trust Settings**. Regenerate the development certificate if the LAN IP changes.

## Running the Application

Run these commands separately from the project root, one per terminal:

```sh
npm --prefix server start
npm run dev:https
npm run dev -- --host 127.0.0.1 --port 5175
```

The backend listens on port 3000, the passenger HTTPS frontend on 5173, and the officer loopback frontend on 5175. Keep the Vite proxy target aligned with the backend port if you customize it.

## Officer and Passenger Access

| Role | Open | Demo flow |
| --- | --- | --- |
| Officer | `http://localhost:5175/` on the laptop | Enter a demo name and the local officer access code, then accept or reject an incoming request. After a connected call, review and save notes. Use **Pengaturan Akun → Logout / Ganti Petugas** to switch identities after any active or reserved call ends. |
| Passenger | `https://<LAPTOP_LAN_IP>:5173/` on the passenger device | Enter a demo name, choose a language and category, check camera and microphone, then join the queue. A completed call can be rated. |

Loopback hostnames select the officer view. Other HTTPS origins select the passenger view. The server checks officer privileges separately. An officer session lasts eight hours, preserves its server-assigned identity across reconnects, and is revoked by logout. Changes to the access code invalidate older grants after a backend restart. The shared code establishes the officer role. Display names are demo labels rather than individually verified accounts. Recent Calls and dashboard statistics are shared among authorized officers.

The `/legacy` page is reserved for internal direct-call testing. Its signaling is disabled by default. To opt in, set `ENABLE_LEGACY=true` in `server/.env`, restart the backend, and use two loopback tabs. Legacy participants have a separate roster and cannot access queue or history features through the legacy connection.

## Screenshots

Screenshots of the current branding are pending. Future images should show the officer dashboard, incoming call, and passenger workflow using synthetic data only.

## Testing

Run from the project root after installing both dependency sets:

```sh
npm run typecheck
npm run build
npm test
```

The tests cover local access controls, legacy signaling, queue lifecycle, call history and references, SQLite persistence, and the six locale dictionaries. They exercise signaling with test data and do not capture live camera or microphone output. For a manual check, choose a language and join the queue as a passenger. Accept the call as an officer, end it, then verify officer notes, the passenger rating, and the saved entry in Recent Calls.

## Security Limitations

Run this demo only on a trusted LAN with synthetic data. Do not deploy it publicly or use it in production without additional access control, network hardening, and data protection. Do not expose the development servers through a public tunnel or port forwarding. Passenger sign-in uses a display name. Officers share a local access code and authorized officers can read global saved call history. The backend checks the browser origin for polling and WebSocket requests, separately from session authorization.

SQLite and browser storage can contain names, notes, ratings, and session-related information. The local database is not encrypted by the application. Keep local environment files, certificates, private keys, databases, and logs out of the repository. Never share the mkcert root CA private key.

## Known Limitations

- The active queue is in memory and is reset on server restart. Saved call history uses local SQLite.
- Browser permissions, LAN isolation, or firewall settings can block media. There is no configured TURN relay.
- Passenger localization covers the UI. Spoken conversation is not translated.
- A physical laptop-to-iPhone video call has not been reconfirmed since the visual rebrand.

## Future Improvements

- Add production-grade authentication and role authorization before considering a public service.
- Add retention and deletion policies, operational monitoring, and deployment security controls.
- Expand physical device and browser coverage and capture current screenshots with synthetic data.
