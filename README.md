# eas-webdec-test — simple direct audio server

One server. No Icecast. This package serves a public listener at /, the administrator HTML at /admin, and the continuous MP3 audio at /stream.mp3.

## Short online setup (Render)

1. Extract this ZIP.
2. Create a GitHub repository. Upload the extracted contents with render.yaml at the repository root and backend/ as a folder. Do not upload your administrator token.
3. In Render, choose New > Blueprint, connect that repository, and review the proposed service. This blueprint uses a PAID Starter web service and a 1 GB persistent disk. Check the displayed cost before creating it. Free services sleep and cannot use this disk.
4. Deploy. Render builds the Docker image including FFmpeg and eSpeak NG and assigns an HTTPS onrender.com URL.
5. Open the service's Environment settings and copy the generated ADMIN_TOKEN. Keep it private.
6. Open https://YOUR-SERVICE.onrender.com/admin. The server URL fills itself in. Enter ADMIN_TOKEN and authorize.
7. Configuration: set location/coordinates, automatic forecast interval, forecast periods, loop volume and voice speed.
8. Audio Files: upload your files (25 MB each) and put them in order.
9. Station Status: Enable Station. Generate Forecast Now to test. Open the base website URL and click Connect to Stream.
10. SAME Encoder: fill in location codes, origin, event, eight-character sender and expiry; choose optional attention tone and voice text. Generate Local Preview before Review and Send to Stream.

You can close the panel or shut down your PC; the remote service keeps running. Disable Station stops the source and disconnects listeners. Restarting the remote server resumes the saved desired state; expect an interruption during restarts/deploys.

The HTML pages can also be downloaded and hosted separately. Enter the server's HTTPS URL in the separate control panel. Add that panel's exact origin to ADMIN_ORIGINS on the server. On a separately hosted listener, set STREAM_URL to the server's HTTPS /stream.mp3 URL instead of its default same-origin URL.

## Operation

- Automatic NWS forecast speech for supported US coordinates; defaults are Virginia Beach, every 30 minutes.
- Loop files are saved on the persistent disk. Empty playlist means silence.
- Messages interrupt loop files and play once. Already queued messages finish first, then the loop resumes.
- SAME generation is server-side AFSK: 520.8333 baud, LSB first, 16-byte AB preambles, three identical headers, optional attention tone, optional speech and three NNNN end bursts with one-second gaps.
- Attention choices: none, 1050 Hz for 10 seconds, or 853+960 Hz for 8 seconds.
- The test defaults are EAS/RWT/TEST0001 with no attention tone. Supply your own valid geographic codes; formatting validation does not confirm that a code/event exists.
- Timestamp is UTC and stamped at generation. If you queue messages for a long time, their expiry may elapse before playback.
- Generated SAME messages are operator-authored. Forecast generation does not automatically send SAME alerts.
- This is an independent internet test station, not a government service or a certified EAS encoder. Physical receiver interoperability has not been verified.
- Stream is 128 kbps MP3. Bandwidth increases with listener count (about 58 MB per listener-hour); the server caps connections at 100.
- The login page is public; the backend authenticates all administration actions with the token. Token is held in page memory only.
- A fatal encoder error requires you to correct the error and re-enable. Forecast failures appear in the activity log while loop audio continues.

## Alternate Docker host

Copy .env.example to .env and set a private ADMIN_TOKEN (at least 24 characters). Run docker compose up -d --build on an always-running remote Docker host. Expose the server through the host's HTTPS proxy. Persist /data and keep one instance. An HTML-only hosting service cannot run this engine.

## Checks

node --test backend/tests/*.test.mjs

Tests cover authenticated remote control, persistence, actual FFmpeg MP3 loop and announcement playback, independent SAME demodulation, header/EOM repetition, authenticated preview/queue, and both HTML routes. Real eSpeak/Docker builds and a deployed host still require verification.

Protocol reference: https://www.weather.gov/media/directives/010_pdfs/pd01017012curr.pdf
Hosting: https://render.com/docs/blueprint-spec and https://render.com/docs/disks
