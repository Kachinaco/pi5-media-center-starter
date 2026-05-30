# Pi 5 Media Center Starter

This repo is a Raspberry Pi 5 starter kit for a local TV dashboard and SimplStream-style static media UI.

It includes:

- A static web dashboard served by Nginx on port `8888`
- A small local launcher/status API on port `8899`
- Deploy, snapshot, and health-check scripts
- A one-command installer for a fresh Raspberry Pi OS setup

It intentionally does not include personal photos, watch history, analytics secrets, budget data, device metadata, or private network details.

## Fresh Pi Install

On the Raspberry Pi:

```bash
sudo apt update
sudo apt install -y git
mkdir -p ~/repos
cd ~/repos
git clone https://github.com/Kachinaco/pi5-media-center-starter.git pi5-media-center
cd pi5-media-center
sudo tools/install-pi5-media-center
```

When it finishes, open:

- Dashboard: `http://PI_ADDRESS:8888/dashboard.html`
- SimplStream home: `http://PI_ADDRESS:8888/`
- Launcher status: `http://PI_ADDRESS:8899/api/status`

Replace `PI_ADDRESS` with the Pi hostname or IP address.

## Daily Workflow

Edit files in:

```bash
~/repos/pi5-media-center
```

Check them:

```bash
pi-home-check
```

Commit your changes:

```bash
git add .
git commit -m "Describe change"
```

Deploy to the live Nginx folder:

```bash
pi-home-deploy
```

The deploy script refuses to deploy uncommitted changes, snapshots the previous live folder, copies the committed source into the live folder, reloads Nginx, and runs the health check.

## Runtime Files

These files are local to the Pi and are not committed:

- `watch-history.json`
- `budget-data.json`
- `assets/slideshow-tv/` personal photo files

The installer creates safe empty data defaults under `~/.local/share/pi-home`, outside the public Nginx document root.

## Configuration

The installer writes:

```bash
~/.config/pi-home/pi-home.env
```

Useful defaults:

```bash
PI_HOME_SOURCE_ROOT=/home/pi/repos/pi5-media-center
PI_HOME_LIVE_ROOT=/home/pi/pi-home-live
PI_HOME_ARCHIVE_DIR=/home/pi/pi-home-archives
PI_HOME_DATA_DIR=/home/pi/.local/share/pi-home
PI_HOME_PORT=8888
PI_HOME_LAUNCHER_PORT=8899
```

Change the values there if your clone path or ports are different, then run:

```bash
sudo systemctl restart pi-home-launcher
sudo systemctl reload nginx
pi-home-deploy
```

## Notes

This is a starter repo, not a fully managed appliance image. It expects Raspberry Pi OS, normal Linux permissions, and a user comfortable running shell commands.

The media UI uses third-party embeds and APIs. Replace any API keys or providers with your own choices and follow the rules for the content/services you use.

Search for `REPLACE_WITH_TMDB_KEY` and add your own TMDB API key if you want poster/details metadata to work.
