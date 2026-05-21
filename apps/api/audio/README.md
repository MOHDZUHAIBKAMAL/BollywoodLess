# Audio Sources

This folder is only for the demo seed rows. The preferred flow is now the Admin
page at `http://localhost:3000/admin`, which stores uploaded MP3s in
`apps/api/uploads/full`.

The demo seed data in `src/data/seedTracks.js` expects these optional files:

- `chaiyya-chaiyya.mp3`
- `tum-hi-ho.mp3`
- `kal-ho-naa-ho.mp3`
- `kabira.mp3`
- `badtameez-dil.mp3`
- `tere-bina.mp3`

The API will not expose these full files. It uses FFmpeg to render the configured 15-second slice into `../snippets`.
