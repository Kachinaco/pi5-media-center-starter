# Pi Home Notes

This Pi serves a deployed static copy through Nginx on `http://localhost:8888`.

- Source repo: `$HOME/repos/pi5-media-center`
- Live deploy root: `$HOME/pi-home-live`
- Runtime data root: `$HOME/.local/share/pi-home`
- Config file: `$HOME/.config/pi-home/pi-home.env`

## Important Files

- `dashboard.html` / `dashboard.css` - Pi Home dashboard.
- `dashboard-tv.html` - TV-first dashboard view.
- `library.html` - TV/movie library and detail view.
- `play.html` - sandboxed embedded playback page.
- `watch-history.json` - runtime-local watch history file created outside the served live folder.

## Runtime APIs

- Launcher API: `http://127.0.0.1:8899`
- Static site: `http://127.0.0.1:8888`

## Archive

Timestamped rollback copies are stored outside the served document root under `$HOME/pi-home-archives/`.

Keep rollback files outside `$HOME/repos/pi5-media-center` and `$HOME/pi-home-live` so they cannot be served by Nginx or accidentally committed.

## Git Workflow

Before changing live files, make an archive with:

```bash
pi-home-snapshot
```

Edit source files under:

```bash
cd ~/repos/pi5-media-center
```

Then check, commit, and deploy:

```bash
pi-home-check
git add .
git commit -m "Describe Pi Home change"
pi-home-deploy
```

`pi-home-deploy` refuses to run with uncommitted source changes, snapshots the current live root, copies source to `$HOME/pi-home-live`, reloads Nginx, and runs the health check.
