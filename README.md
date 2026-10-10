# eas-webdec-test: Paul voice and subtle radio/VHS audio

One direct audio server. No Icecast. Public listener at /, administration at /admin, MP3 stream at /stream.mp3.

## Free online setup

1. Extract this ZIP and upload its contents to a GitHub repository, with render.yaml at the root and backend/ as a folder.
2. In Render choose New > Blueprint, connect the repository and review the FREE service configuration. No disk is included.
3. If Blueprint asks for payment, deploy manually: New > Web Service > Docker, Root Directory backend, Dockerfile ./Dockerfile, plan Free. Add ADMIN_TOKEN as a private random value of at least 24 characters.
4. Deploy. Copy the generated ADMIN_TOKEN from the service Environment settings (or use the one you supplied manually).
5. Open your assigned HTTPS URL followed by /admin. Enter the token; the server URL fills automatically.
6. Configure your location, forecast interval, audio playlist, voice and audio profile. Enable Station. Open the base URL and press Connect to Stream.
7. Use SAME Encoder to preview and queue messages.

Render Free sleeps after 15 minutes without inbound traffic. Opening the website wakes it. Uploaded audio, settings, queues and voice cache are LOST when it sleeps, restarts or redeploys. Keep copies and re-upload/reconfigure after a reset. Enable/Disable controls audio generation, not host service provisioning.

## Voice

Default voice: [VT] Current NWS Paul, voice ID paul.
Provider: Wags' Puzzle Space, https://wagspuzzle.space/tools/eas-tts/index.php

The provider uses a normal form submission, not a documented public synthesis API:
GET index.php for a session cookie and XSRF token; POST voice=paul, text and xsrf; download the WAV from the returned cache/*.wav URL.
A live short test returned valid 16 kHz mono WAV audio.

Text is sent to this provider for synthesis. Your station administrator token is never sent to it.
The provider currently displays 50 successful requests per IP per day and does not guarantee uptime.
Identical text is cached for seven days; requests are serialized; a local 50-attempt UTC-day budget and a five-minute outage cooldown reduce load. Shared host IPs may reach the provider limit earlier.
Local eSpeak fallback is enabled and logged on failure. Disable fallback to fail instead, or select Local eSpeak for local-only synthesis.
Speech speed 160 means normal Paul playback; other settings use FFmpeg tempo adjustment.
Paul is used for automatic forecasts, custom announcements and spoken SAME message bodies. Forecast text still comes from the NWS API.

## Audio profile

Enabled by default: mono, with an approximation of the supplied Filter Curve EQ screenshot.
Curve points (Hz, dB): (20,-90), (60,-90), (70,0), (100,0), (900,-6.5), (2700,0), (4000,-0.5), (5000,-90), (20000,-90).
Frequency interpolation is logarithmic. Values are estimated from the image; an exact match requires the original exported EQ curve.
There is no glitch, pitch wobble, dropout or time modulation processing.
Pink noise amplitude: -55 dB. White noise amplitude: -60 dB.
This is a subtle radio/VHS-inspired sound, not a literal radio carrier frequency.
Lower noise dB values are quieter. Turning off the profile removes filtering and both noise layers.
After changing profile settings, disable and enable the station to apply them.
SAME previews are clean; the live stream includes the EQ. Both noise layers are muted during EAS audio. The EQ does not shift SAME frequencies or baud rate.

## Existing station features

Loop your uploaded audio files in order (25 MB per file). Empty playlist produces silence, or quiet hiss with the profile enabled.
Automatic NWS forecasts for supported US coordinates; defaults are Virginia Beach, every 30 minutes.
Ordinary announcements interrupt the loop, play once, then resume it.
Submitted SAME/EAS recordings have priority. Once the full recording is generated, it interrupts the loop or ordinary announcement and goes ahead of pending ordinary messages. Interrupted ordinary speech is marked interrupted and not replayed. Pending ordinary messages and the paused loop resume after the alerts.
An EAS recording already on air finishes before the next EAS recording, preserving its end-of-message bursts. No background music or generated pink/white noise is mixed into the alert.
Priority applies to alerts submitted through /api/same. This package does not monitor an external EAS audio feed or automatically ingest NWS alerts.
MP3/proxy/browser buffering may delay when a remote listener hears the cutoff; no server can erase audio already buffered on a listener's device.
SAME uses 520.8333 baud, 16-byte AB preambles, least-significant bit first, three header bursts and three NNNN end bursts.
Optional attention signals: 1050 Hz for 10 seconds, or 853+960 Hz for 8 seconds.
Default event is EAS/RWT/TEST0001 with no attention signal. Supply valid geographic codes.
Timestamp is UTC at generation. Long queues can let messages expire before playback.
This is an independent internet test system, not a certified encoder or government service. Physical receiver interoperability has not been verified.
Stream is 128 kbps MP3, capped at 100 connections. Each listener uses about 58 MB per hour; free hosting bandwidth limits apply.
Administrative requests require the token. The public login page itself is not secret.
A fatal encoder error requires correcting the problem and re-enabling the station.

## Other hosts and standalone HTML

The backend Dockerfile includes FFmpeg and eSpeak. Run one instance and expose its PORT through HTTPS.
Persist /data on a host with persistent storage to retain uploaded files, cache and settings.
An HTML-only host cannot run the audio engine.
For a separately hosted panel, enter the server URL and add the panel's exact origin to ADMIN_ORIGINS.
For a separately hosted listener, set STREAM_URL to the server's HTTPS /stream.mp3 address.

## Verification

Run: node --test backend/tests/*.test.mjs

Eleven tests passed, covering remote controls, real MP3 loop/announcement streaming with the audio profile, SAME demodulation, repeat bursts, preview/queue authorization, Paul form cookies/tokens/cache behavior, optional fallback, quiet noise RMS, measured EQ response, EAS interruption and complete serialization of consecutive alerts.
A live request to the provider returned playable audio. A cloud deployment and real Docker/eSpeak output remain unverified.

Protocol: https://www.weather.gov/media/directives/010_pdfs/pd01017012curr.pdf
Hosting: https://render.com/docs/free
