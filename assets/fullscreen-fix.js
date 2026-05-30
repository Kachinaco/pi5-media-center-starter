(() => {
  const EXTRA_ALLOW = [
    "autoplay *",
    "fullscreen *",
    "picture-in-picture *",
    "encrypted-media *",
    "accelerometer *",
    "gyroscope *"
  ];

  function mergeAllow(value) {
    const parts = String(value || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    const seen = new Set(parts.map((part) => part.split(/\s+/)[0]));
    for (const part of EXTRA_ALLOW) {
      const feature = part.split(/\s+/)[0];
      if (!seen.has(feature)) {
        parts.push(part);
        seen.add(feature);
      } else if (feature === "fullscreen" && !parts.some((item) => item === "fullscreen *")) {
        const index = parts.findIndex((item) => item.split(/\s+/)[0] === "fullscreen");
        if (index >= 0) parts[index] = "fullscreen *";
      }
    }
    return parts.join("; ");
  }

  function normalizeStreamSrc(src) {
    let url;
    try { url = new URL(src); } catch (error) { return src; }
    const host = url.hostname.toLowerCase();
    const movieTvProvider = /vidfast|videasy|vsembed|vidlink|111movies/.test(host);
    if (!movieTvProvider) return src;
    if (isReplayModeActive()) {
      url.searchParams.delete("nextButton");
      if (host.includes("vidfast")) {
        url.searchParams.delete("t");
        url.searchParams.set("startAt", "0");
      } else {
        url.searchParams.delete("startAt");
        url.searchParams.set("t", "0");
      }
      if (!url.searchParams.has("autoplay")) url.searchParams.set("autoplay", "true");
      if (!url.searchParams.has("autoPlay")) url.searchParams.set("autoPlay", "true");
      return url.toString();
    }
    if (!url.searchParams.has("autoplay")) url.searchParams.set("autoplay", "true");
    if (!url.searchParams.has("autoPlay")) url.searchParams.set("autoPlay", "true");
    if (host.includes("vidfast") && url.pathname.startsWith("/tv/")) {
      if (!url.searchParams.has("nextButton")) {
        url.searchParams.set("nextButton", "true");
      }
    }
    return url.toString();
  }

  function prepareIframe(frame) {
    if (!frame) return;
    const currentSrc = frame.src || frame.getAttribute("src") || "";
    if (currentSrc && isStreamProviderSrc(currentSrc)) {
      frame.removeAttribute("sandbox");
    }
    if (frame.dataset.fullscreenFixed === "1") return;
    frame.dataset.fullscreenFixed = "1";
    frame.allowFullscreen = true;
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("webkitallowfullscreen", "");
    frame.setAttribute("mozallowfullscreen", "");
    frame.setAttribute("allow", mergeAllow(frame.getAttribute("allow")));
    const normalizedSrc = normalizeStreamSrc(currentSrc);
    if (normalizedSrc && normalizedSrc !== frame.src) frame.src = normalizedSrc;
  }

  function prepareAll() {
    document.querySelectorAll("iframe").forEach(prepareIframe);
  }

  function lockPlayerFullscreen(frame) {
    if (!frame) return false;
    const rect = frame.getBoundingClientRect();
    const coversViewport = rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.85;
    if (document.fullscreenElement === frame || document.fullscreenElement || coversViewport) {
      document.body.classList.add("simplstream-keep-player-fullscreen");
      return true;
    }
    return false;
  }

  window.simplstreamLockPlayerFullscreen = lockPlayerFullscreen;

  window.simplstreamFullscreenCurrentPlayer = function simplstreamFullscreenCurrentPlayer() {
    const frames = Array.from(document.querySelectorAll("iframe"));
    const frame = frames.find((item) => /vidfast|videasy|vsembed|vidlink|111movies|dlhd|streamed|buffstreams|nhl/i.test(item.src)) || frames[0];
    if (frame && frame.requestFullscreen) return frame.requestFullscreen();
    return Promise.reject(new Error("No fullscreen-capable player iframe found"));
  };

  window.simplstreamToggleFillMode = function simplstreamToggleFillMode(force) {
    const enabled = typeof force === "boolean"
      ? force
      : !document.body.classList.contains("simplstream-fill-player");
    document.body.classList.toggle("simplstream-fill-player", enabled);
    return enabled;
  };

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat) return;
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
    const key = event.key ? event.key.toLowerCase() : "";
    if (key === "f") {
      const frame = document.querySelector("iframe");
      if (!frame) return;
      event.preventDefault();
      if (document.fullscreenElement) {
        document.body.classList.remove("simplstream-keep-player-fullscreen");
        document.exitFullscreen().catch(() => {});
      } else if (document.body.classList.contains("simplstream-keep-player-fullscreen")) {
        document.body.classList.remove("simplstream-keep-player-fullscreen");
      } else {
        lockPlayerFullscreen(frame);
        window.simplstreamFullscreenCurrentPlayer().catch(() => {});
      }
    }
    if (key === "z") {
      event.preventDefault();
      window.simplstreamToggleFillMode();
    }
  });


  const TMDB_KEY = "REPLACE_WITH_TMDB_KEY";
  const TMDB_API = "https://api.themoviedb.org/3";
  const STALL_POLL_MS = 5000;
  const STALL_RELOAD_AFTER_MS = 12000;
  const STALL_RELOAD_COOLDOWN_MS = 45000;
  const PROVIDER_FALLBACK_ORDER = ["vidlink", "vidsrc", "111movies", "videasy", "vidfast"];
  let autoNextInFlight = false;
  let autoNextLastKey = "";
  let replayModeStartedAt = null;
  let stallWatchInFlight = false;
  let stallWatchState = null;
  let stallLastReloadAt = 0;

  function isReplayModeActive() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("type") === "tv") return true;
      return params.get("mode") === "replay";
    } catch (error) {
      return false;
    }
  }

  function shouldSuppressReplayAutoNext() {
    if (!isReplayModeActive()) {
      replayModeStartedAt = null;
      return false;
    }
    if (replayModeStartedAt === null) replayModeStartedAt = Date.now();
    return Date.now() - replayModeStartedAt < 120000;
  }

  function parseTvProviderSrc(src) {
    let url;
    try { url = new URL(src); } catch (error) { return null; }
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (host.includes("vsembed.ru")) {
      const id = Number(url.searchParams.get("tmdb") || 0);
      const season = Number(url.searchParams.get("season") || 1);
      const episode = Number(url.searchParams.get("episode") || 1);
      return id ? { provider: "vidsrc", id, season, episode } : null;
    }
    if (!/vidfast|videasy|vidlink|111movies/.test(host) || parts[0] !== "tv") return null;
    return { provider: host.includes("vidfast") ? "vidfast" : host.includes("videasy") ? "videasy" : host.includes("vidlink") ? "vidlink" : "111movies", id: Number(parts[1] || 0), season: Number(parts[2] || 1), episode: Number(parts[3] || 1) };
  }

  function isStreamProviderSrc(src) {
    let url;
    try { url = new URL(src); } catch (error) { return false; }
    return /vidfast|videasy|vsembed|vidlink|111movies|dlhd|streamed|buffstreams|nhl/i.test(url.hostname + url.pathname);
  }

  function comparableStreamSrc(src) {
    let url;
    try { url = new URL(src); } catch (error) { return String(src || ""); }
    url.searchParams.delete("_reload");
    url.searchParams.delete("_ss_stall_reload");
    return url.toString();
  }

  function buildPlaybackKey(current) {
    if (!current) return "";
    return [
      comparableStreamSrc(current.url || ""),
      current.tmdb_id || "",
      current.media_type || "",
      current.season || "",
      current.episode || "",
      current.video_src || ""
    ].join(":");
  }

  function findPlaybackFrame(current) {
    const frames = Array.from(document.querySelectorAll("iframe"));
    if (!frames.length) return null;
    const currentUrl = current && current.url ? comparableStreamSrc(current.url) : "";
    if (currentUrl) {
      const exact = frames.find((frame) => comparableStreamSrc(frame.src || frame.getAttribute("src") || "") === currentUrl);
      if (exact) return exact;
    }
    return frames.find((frame) => isStreamProviderSrc(frame.src || frame.getAttribute("src") || "")) || frames[0];
  }

  function withStallReloadBust(src) {
    let url;
    try { url = new URL(src); } catch (error) { return src; }
    url.searchParams.set("_ss_stall_reload", String(Date.now()));
    return url.toString();
  }

  function buildStallRecoverySrc(src, position) {
    let url;
    try { url = new URL(src); } catch (error) { return withStallReloadBust(src); }
    const host = url.hostname.toLowerCase();
    const resumeAt = Math.max(0, Math.floor(Number(position) || 0));
    if (host.includes("vidfast")) {
      url.searchParams.delete("t");
      url.searchParams.set("startAt", String(resumeAt));
    } else {
      url.searchParams.delete("startAt");
      url.searchParams.set("t", String(resumeAt));
    }
    url.searchParams.set("_ss_stall_reload", String(Date.now()));
    if (!url.searchParams.has("autoplay")) url.searchParams.set("autoplay", "true");
    if (!url.searchParams.has("autoPlay")) url.searchParams.set("autoPlay", "true");
    return url.toString();
  }

  async function fetchCurrentPlayback() {
    const response = await fetch("http://127.0.0.1:8899/api/current-playback?t=" + Date.now());
    if (!response.ok) return null;
    return response.json();
  }

  function isAiredEpisode(ep) {
    if (!ep || !ep.episode_number || !ep.air_date) return false;
    return new Date(ep.air_date + "T00:00:00").getTime() <= Date.now();
  }

  async function getSeasonDetails(id, season) {
    const response = await fetch(TMDB_API + "/tv/" + encodeURIComponent(id) + "/season/" + encodeURIComponent(season) + "?api_key=" + TMDB_KEY);
    if (!response.ok) throw new Error("TMDB season " + response.status);
    return response.json();
  }

  async function getShowDetails(id) {
    const response = await fetch(TMDB_API + "/tv/" + encodeURIComponent(id) + "?api_key=" + TMDB_KEY);
    if (!response.ok) throw new Error("TMDB show " + response.status);
    return response.json();
  }

  async function resolveNextEpisode(state) {
    const currentSeason = Number(state.season) || 1;
    const currentEpisode = Number(state.episode) || 1;
    const seasonDetails = await getSeasonDetails(state.id, currentSeason);
    const sameSeasonNext = ((seasonDetails && seasonDetails.episodes) || []).filter((ep) => isAiredEpisode(ep) && Number(ep.episode_number) > currentEpisode).sort((a, b) => Number(a.episode_number) - Number(b.episode_number))[0];
    if (sameSeasonNext) return { season: currentSeason, episode: Number(sameSeasonNext.episode_number) };
    const showDetails = await getShowDetails(state.id);
    const seasons = ((showDetails && showDetails.seasons) || []).filter((season) => Number(season.season_number) > currentSeason && Number(season.season_number) > 0 && Number(season.episode_count || 0) > 0).sort((a, b) => Number(a.season_number) - Number(b.season_number));
    for (const season of seasons) {
      try {
        const details = await getSeasonDetails(state.id, Number(season.season_number));
        const first = ((details && details.episodes) || []).filter(isAiredEpisode).sort((a, b) => Number(a.episode_number) - Number(b.episode_number))[0];
        if (first) return { season: Number(season.season_number), episode: Number(first.episode_number) };
      } catch (error) {}
    }
    return null;
  }

  function buildNextProviderSrc(state, next) {
    const id = state.id, season = next.season, episode = next.episode;
    return buildProviderSrc(state.provider, id, season, episode);
  }

  function buildProviderSrc(provider, id, season, episode) {
    if (provider === "vidfast") return normalizeStreamSrc("https://vidfast.pro/tv/" + id + "/" + season + "/" + episode + "?theme=2980B9&nextButton=true&autoPlay=true&autoplay=true");
    if (provider === "videasy") return normalizeStreamSrc("https://player.videasy.net/tv/" + id + "/" + season + "/" + episode + "?color=3B82F6&autoplay=true&autoPlay=true");
    if (provider === "vidlink") return normalizeStreamSrc("https://vidlink.pro/tv/" + id + "/" + season + "/" + episode + "?autoplay=true&autoPlay=true");
    if (provider === "111movies") return normalizeStreamSrc("https://111movies.net/tv/" + id + "/" + season + "/" + episode + "?autoplay=true&autoPlay=true");
    return normalizeStreamSrc("https://vsembed.ru/embed/tv?tmdb=" + id + "&season=" + season + "&episode=" + episode + "&autoplay=true&autoPlay=true");
  }

  function nextFallbackProvider(provider) {
    const start = PROVIDER_FALLBACK_ORDER.indexOf(provider);
    if (start < 0) return "vidlink";
    for (let i = 1; i <= PROVIDER_FALLBACK_ORDER.length; i++) {
      const candidate = PROVIDER_FALLBACK_ORDER[(start + i) % PROVIDER_FALLBACK_ORDER.length];
      if (candidate && candidate !== provider) return candidate;
    }
    return "";
  }

  function buildFallbackProviderSrc(src) {
    const state = parseTvProviderSrc(src);
    if (!state || !state.id) return "";
    const provider = nextFallbackProvider(state.provider);
    if (!provider) return "";
    try { localStorage.setItem("simplstream_preferred_server", provider); } catch (error) {}
    return buildProviderSrc(provider, state.id, state.season, state.episode);
  }

  async function simplstreamAutoNextPoller() {
    if (autoNextInFlight || document.hidden) return;
    if (shouldSuppressReplayAutoNext()) return;
    const frame = Array.from(document.querySelectorAll("iframe")).find((item) => parseTvProviderSrc(item.src));
    if (!frame) return;
    const state = parseTvProviderSrc(frame.src);
    if (!state || !state.id) return;
    let playback;
    try {
      playback = await fetchCurrentPlayback();
    } catch (error) { return; }
    const current = playback && playback.current;
    if (!current || Number(current.tmdb_id) !== Number(state.id) || Number(current.season) !== Number(state.season) || Number(current.episode) !== Number(state.episode)) return;
    const position = Number(current.current_time || 0);
    const duration = Number(current.duration || 0);
    if (!duration || !position || duration - position > 8) return;
    const key = state.id + ':' + state.season + ':' + state.episode;
    if (autoNextLastKey === key) return;
    autoNextInFlight = true;
    try {
      const next = await resolveNextEpisode(state);
      if (next) {
        autoNextLastKey = key;
        lockPlayerFullscreen(frame);
        const nextSrc = buildNextProviderSrc(state, next);
        frame.addEventListener("load", () => {
          prepareIframe(frame);
          lockPlayerFullscreen(frame);
        }, { once: true });
        frame.src = nextSrc;
      }
    } catch (error) {
    } finally {
      autoNextInFlight = false;
    }
  }

  window.simplstreamAutoNextPoller = simplstreamAutoNextPoller;
  setInterval(simplstreamAutoNextPoller, 3000);

  async function simplstreamStallWatchdog() {
    if (stallWatchInFlight || document.hidden) return;
    stallWatchInFlight = true;
    try {
      const playback = await fetchCurrentPlayback();
      const current = playback && playback.current;
      const frame = findPlaybackFrame(current);
      if (!frame || !current) {
        stallWatchState = null;
        return;
      }

      const position = Number(current.current_time || 0);
      const duration = Number(current.duration || 0);
      const key = buildPlaybackKey(current);
      const now = Date.now();
      const nearEnd = duration > 0 && position > 0 && duration - position <= 12;
      const activelyPlaying = current.paused === false && !current.ended && position > 0 && !nearEnd;

      if (!activelyPlaying) {
        stallWatchState = key ? { key, position, checkedAt: now, stalledSince: 0 } : null;
        return;
      }

      if (!stallWatchState || stallWatchState.key !== key || Math.abs(position - stallWatchState.position) > 0.75) {
        stallWatchState = { key, position, checkedAt: now, stalledSince: 0 };
        return;
      }

      if (!stallWatchState.stalledSince) stallWatchState.stalledSince = stallWatchState.checkedAt || now;
      stallWatchState.checkedAt = now;

      const stalledFor = now - stallWatchState.stalledSince;
      if (stalledFor < STALL_RELOAD_AFTER_MS || now - stallLastReloadAt < STALL_RELOAD_COOLDOWN_MS) return;

      const currentSrc = frame.src || frame.getAttribute("src") || current.url || "";
      const nextSrc = buildStallRecoverySrc(currentSrc, position);
      if (!nextSrc || nextSrc === currentSrc) return;

      stallLastReloadAt = now;
      stallWatchState = { key, position, checkedAt: now, stalledSince: 0 };
      lockPlayerFullscreen(frame);
      frame.addEventListener("load", () => {
        prepareIframe(frame);
        lockPlayerFullscreen(frame);
      }, { once: true });
      console.info("[SimplStream] Recovering stalled provider iframe", {
        source: current.source,
        position,
        stalledFor,
        recoveryAt: Math.max(0, Math.floor(Number(position) || 0)),
        action: "reload"
      });
      frame.src = nextSrc;
    } catch (error) {
    } finally {
      stallWatchInFlight = false;
    }
  }

  window.simplstreamStallWatchdog = simplstreamStallWatchdog;
  setInterval(simplstreamStallWatchdog, STALL_POLL_MS);


  prepareAll();
  new MutationObserver(prepareAll).observe(document.documentElement, { childList: true, subtree: true });
})();
