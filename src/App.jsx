import { useEffect, useState, useMemo, useRef } from "react";

// env
const API_BASE = "";

// helpers
function google(q) {
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Normalize names of track, artist, etc.
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[()\-–—.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Sanitize filename for CSV download
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvField(field) {
  if (field == null) return '""';
  return `"${String(field).replace(/"/g, '""')}"`;
}

// Generate CSV content (always export original order)
function generateCSV(playlist) {
  const headers = [
    "Track",
    "Artist",
    "Album",
    "Year",
    "Lyrics",
    "YouTube",
    "Color Coded",
    "Fandom",
  ].map(csvField);

  const rows = playlist.tracks.map((t) => {
    const trackName = t?.track ?? "unknown track";
    const artistName = t?.artist ?? "unknown artist";
    const albumName = t?.album ?? "unknown album";
    const year = t?.year ?? "unknown year";
    const base = `${trackName} ${artistName}`;

    return [
      csvField(trackName),
      csvField(artistName),
      csvField(albumName),
      csvField(year),
      csvField(
        google(
          `${base} lyrics site:genius.com OR site:azlyrics.com OR site:musixmatch.com`
        )
      ),
      csvField(google(`${base} site:youtube.com`)),
      csvField(google(`${base} color coded lyrics`)),
      csvField(google(`${base} lyrics site:fandom.com`)),
    ];
  });

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// Download CSV file
function downloadCSV(playlist) {
  const csvContent = generateCSV(playlist);
  const BOM = "\uFEFF";

  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${sanitizeFilename(playlist.name)}_lyrics.csv`;
  link.click();

  URL.revokeObjectURL(url);
}

export default function App() {
  const [url, setUrl] = useState("");
  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [viewMode, setViewMode] = useState("default order");
  const [searchQuery, setSearchQuery] = useState("");

  const searchInputRef = useRef(null);
  const viewMenuRef = useRef(null);

  // --------- Command/Ctrl+F + esc key -> app's playlist search ---------
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Cmd/Ctrl + F → focus playlist search
      if (isCmdOrCtrl && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }

      // ESC → clear playlist search + close view menu
      if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
          searchInputRef.current?.blur();
        }
        setViewOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [searchQuery]);

  // --------- Close "view as" when clicking outside ---------
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        viewMenuRef.current &&
        !viewMenuRef.current.contains(e.target)
      ) {
        setViewOpen(false);
      }
    };

    if (viewOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [viewOpen]);

  // ---------- OAuth: read token from URL ----------
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get("access_token");

    if (accessToken) {
      setToken(accessToken);
      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );
      fetchUser(accessToken);
    }
  }, []);

  // ---------- Fetch user profile ----------
  const fetchUser = async (accessToken) => {
    try {
      const res = await fetch("https://api.spotify.com/v1/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!res.ok) {
        return;
      }

      const data = await res.json();
      setUser(data);
    } catch (err) {
      console.error("Error fetching user:", err);
    }
  };

  const loginWithSpotify = () => {
    window.location.href = `${API_BASE}/api/auth`;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setPlaylist(null);
    setUrl("");
  };

  const fetchPlaylist = async () => {
    if (!url.trim()) {
      setError("paste a spotify playlist url first.");
      return;
    }

    setLoading(true);
    setError("");
    setPlaylist(null);

    try {
      const headers = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const res = await fetch(
        `/api/playlist?url=${encodeURIComponent(url.trim())}`,
        { headers }
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          data?.error || `failed to fetch playlist (http ${res.status})`
        );
      }

      setPlaylist({
        name: data?.name || "unknown playlist",
        tracks: Array.isArray(data?.tracks) ? data.tracks : [],
      });
    } catch (err) {
      setError(err?.message || "something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const getUserDisplayName = () => {
    if (!user) return "spotify user";
    return user.display_name || user.id || "spotify user";
  };

  const sortedTracks = useMemo(() => {
    if (!playlist) return [];

    const tracks = [...playlist.tracks];

    switch (viewMode) {
      case "artist (a–z)":
        return tracks.sort((a, b) =>
          (a.artist ?? "").localeCompare(b.artist ?? "")
        );
      case "artist (z–a)":
        return tracks.sort((a, b) =>
          (b.artist ?? "").localeCompare(a.artist ?? "")
        );
      case "track (a–z)":
        return tracks.sort((a, b) =>
          (a.track ?? "").localeCompare(b.track ?? "")
        );
      case "track (z–a)":
        return tracks.sort((a, b) =>
          (b.track ?? "").localeCompare(a.track ?? "")
        );
      case "default order":
      default:
        return tracks;
    }
  }, [playlist, viewMode]);

  const filteredTracks = useMemo(() => {
    if (!searchQuery) return sortedTracks;

    const tokens = normalize(searchQuery)
      .split(" ")
      .filter((t) => t.length > 1);

    if (tokens.length === 0) return sortedTracks;

    return sortedTracks.filter((t) => {
      const haystack = normalize(
        `${t?.track ?? ""} ${t?.artist ?? ""} ${t?.album ?? ""}`
      );

      return tokens.every((token) => haystack.includes(token));
    });
  }, [sortedTracks, searchQuery]);

  return (
    <div className="min-h-screen bg-black text-white p-4 sm:p-6">
      {/* header */}
      <h1 className="text-3xl font-bold tracking-tight">
        <a
          href="/"
          className="text-white no-underline focus:outline-none focus:ring-2 focus:ring-gray-700 rounded-lg"
        >
          spotify playlist lyrics finder
        </a>
      </h1>
      <p className="text-sm text-gray-400 mb-8">get lyrics, youtube, and more — straight from ur playlist</p>

      {/* main row: input + developer login */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Playlist input section */}
        <div className="flex-1 flex flex-col gap-2 mt-6">
          <div className="flex gap-2">
            <input
              className="px-2 py-1 text-black w-full rounded"
              placeholder="spotify playlist url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchPlaylist()}
            />
            <button
              onClick={fetchPlaylist}
              disabled={loading}
              className="bg-green-500 px-4 py-1 text-black font-semibold rounded disabled:opacity-60"
            >
              {loading ? "fetching..." : "fetch lyrics"}
            </button>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px bg-gray-600"></div>

        {/* Developer login section */}
        <div className="flex-1 flex flex-col items-start sm:items-center justify-center gap-2 text-center">
          <p className="text-white font-bold text-sm">FOR SPOTIFY DEVELOPERS ONLY</p>
          <p className="text-gray-400 text-xs mb-2">
            access your private playlists (*requires a Spotify Developer account; see README for details*)
          </p>

          {!token ? (
            <button
              onClick={loginWithSpotify}
              className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-semibold px-4 py-2 rounded"
            >
              login with spotify
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm">
              <span className="text-green-400">logged in as {getUserDisplayName()}</span>
              <button onClick={logout} className="text-gray-400 hover:text-white underline">
                logout
              </button>
            </div>
          )}
        </div>
      </div>

      {/* loading */}
      {loading && <p className="mt-2 text-gray-400">loading…</p>}

      {/* playlist */}
      {playlist && (
        <>
          {/* Playlist name with download button */}
          <div className="flex items-center justify-between mt-6 mb-2">
            <h2 className="text-xl font-semibold tracking-tight">{playlist.name}</h2>
            <button
              onClick={() => downloadCSV(playlist)}
              className="group relative p-2 hover:opacity-80 transition"
              title="download as csv"
            >
              <img src="/download_downarrow.png" alt="download" className="w-5 h-5" />
              <span className="absolute bottom-full right-0 mb-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap">
                download as csv
              </span>
            </button>
          </div>

          {/* view as + search controls */}
          <div className="flex justify-between mt-8 gap-4">
            {/* view as */}
            <div ref={viewMenuRef} className="relative">
              <button
                onClick={() => setViewOpen((v) => !v)}
                className="
                  h-8 px-2 text-[11px]
                  text-gray-400
                  bg-gray-900/20
                  border border-gray-700/10
                  rounded
                  hover:text-gray-300
                  hover:border-gray-600/30
                  focus:outline-none
                "
              >
                view as: {viewMode}
              </button>

              {viewOpen && (
                <div
                  className="
                    absolute left-0 mt-1 w-36
                    rounded
                    bg-gray-900/95
                    border border-gray-700/20
                    shadow-lg
                    z-20
                  "
                >
                  {["default order", "artist (a–z)", "artist (z–a)", "track (a–z)", "track (z–a)"].map(
                    (option) => (
                      <button
                        key={option}
                        onClick={() => {
                          setViewMode(option);
                          setViewOpen(false);
                        }}
                        className={`
                          w-full text-left px-2 py-1.5 text-[11px]
                          ${
                            viewMode === option
                              ? "text-white bg-gray-800/70"
                              : "text-gray-400 hover:text-white hover:bg-gray-800/40"
                          }
                        `}
                      >
                        {option}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {/* search */}
            <div className="relative">
              {/* search icon */}
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <svg
                  viewBox="0 0 24 24"
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="6" />
                  <line x1="16" y1="16" x2="21" y2="21" />
                </svg>
              </span>

              <input
                ref={searchInputRef}
                type="text"
                placeholder="search in playlist"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="
                  h-8 w-44 pl-7 pr-6 text-[11px] leading-none
                  text-gray-300 placeholder-gray-500
                  bg-gray-900/20
                  border border-gray-600/20
                  rounded
                  focus:outline-none focus:border-gray-400
                "
              />

              {/* clear (x) */}
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-sm"
                  aria-label="clear search"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* mobile */}
          <div className="md:hidden space-y-4 mt-4">
            {filteredTracks.map((t, i) => {
              const trackName = t?.track ?? "unknown track";
              const artistName = t?.artist ?? "unknown artist";
              const albumName = t?.album ?? "unknown album";
              const year = t?.year ?? "unknown year";
              const albumImage = t?.albumImage ?? null;
              const trackUrl = t?.trackUrl ?? null;
              const base = `${trackName} ${artistName}`;

              return (
                <div key={i} className="border border-gray-800 rounded-lg p-4 bg-gray-900/40">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-green-400">{trackName}</div>
                      <div className="text-gray-300 text-sm">
                        {artistName} <span className="text-gray-500">({year})</span>
                      </div>
                      <div className="text-gray-500 text-xs italic">{albumName}</div>
                    </div>

                    {/* album art (click -> open track on spotify) */}
                    {albumImage &&
                      (trackUrl ? (
                        <a
                          href={trackUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="
                            group relative shrink-0
                            focus:outline-none
                            focus:ring-2 focus:ring-gray-700
                            rounded-md
                          "
                          aria-label="open on spotify"
                        >
                          <img
                            src={albumImage}
                            alt=""
                            loading="lazy"
                            className="
                              w-12 h-12
                              rounded-md
                              border border-gray-800/60
                              hover:opacity-90
                              transition
                            "
                          />
                          <span
                            className="
                              absolute bottom-full right-0 mb-2
                              px-2 py-1 text-[10px]
                              text-white bg-gray-800 rounded
                              opacity-0
                              group-hover:opacity-100
                              group-focus-within:opacity-100
                              transition
                              whitespace-nowrap
                              pointer-events-none
                            "
                          >
                            open on spotify
                          </span>
                        </a>
                      ) : (
                        <img
                          src={albumImage}
                          alt=""
                          loading="lazy"
                          className="w-12 h-12 rounded-md border border-gray-800/60 shrink-0"
                        />
                      ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <a
                      href={google(`${base} lyrics site:genius.com OR site:azlyrics.com OR site:musixmatch.com`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#58A6FF] underline text-center py-2"
                    >
                      lyrics
                    </a>
                    <a
                      href={google(`${base} site:youtube.com`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-red-400 underline text-center py-2"
                    >
                      youtube
                    </a>
                    <a
                      href={google(`${base} color coded lyrics`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pink-400 underline text-center py-2"
                    >
                      color coded
                    </a>
                    <a
                      href={google(`${base} lyrics site:fandom.com`)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-orange-400 underline text-center py-2"
                    >
                      fandom
                    </a>
                  </div>
                </div>
              );
            })}
          </div>

          {/* desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full table-fixed border-collapse mt-4 text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="text-left p-2 w-[45%]">track</th>
                  <th className="p-2 w-[15%]">lyrics (genius, azlyrics, musixmatch)</th>
                  <th className="p-2 w-[13%]">youtube</th>
                  <th className="p-2 w-[14%]">color coded</th>
                  <th className="p-2 w-[13%]">fandom wiki</th>
                </tr>
              </thead>

              <tbody>
                {filteredTracks.map((t, i) => {
                  const trackName = t?.track ?? "unknown track";
                  const artistName = t?.artist ?? "unknown artist";
                  const albumName = t?.album ?? "unknown album";
                  const year = t?.year ?? "unknown year";
                  const albumImage = t?.albumImage ?? null;
                  const trackUrl = t?.trackUrl ?? null;
                  const base = `${trackName} ${artistName}`;

                  return (
                    <tr key={i} className="border-b border-gray-800 hover:bg-gray-900/40">
                      <td className="p-2 leading-snug">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-semibold text-green-400">{trackName}</span>{" "}
                            <span className="text-gray-500">
                              (album: <em>{albumName}</em>)
                            </span>
                            <div className="text-gray-300">
                              — {artistName} <span className="text-gray-500">({year})</span>
                            </div>
                          </div>

                          {/* album art (click -> open track on spotify) */}
                          {albumImage &&
                            (trackUrl ? (
                              <a
                                href={trackUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="
                                  group relative shrink-0
                                  focus:outline-none
                                  focus:ring-2 focus:ring-gray-700
                                  rounded-md
                                "
                                aria-label="open on spotify"
                              >
                                <img
                                  src={albumImage}
                                  alt=""
                                  loading="lazy"
                                  className="
                                    w-10 h-10
                                    rounded-md
                                    border border-gray-800/60
                                    hover:opacity-90
                                    transition
                                  "
                                />
                                <span
                                  className="
                                    absolute bottom-full right-0 mb-2
                                    px-2 py-1 text-[10px]
                                    text-white bg-gray-800 rounded
                                    opacity-0
                                    group-hover:opacity-100
                                    group-focus-within:opacity-100
                                    transition
                                    whitespace-nowrap
                                    pointer-events-none
                                  "
                                >
                                  open on spotify
                                </span>
                              </a>
                            ) : (
                              <img
                                src={albumImage}
                                alt=""
                                loading="lazy"
                                className="w-10 h-10 rounded-md border border-gray-800/60 shrink-0"
                              />
                            ))}
                        </div>
                      </td>

                      <td className="p-2 text-center">
                        <a
                          href={google(`${base} lyrics site:genius.com OR site:azlyrics.com OR site:musixmatch.com`)}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-[#58A6FF]"
                        >
                          search
                        </a>
                      </td>

                      <td className="p-2 text-center">
                        <a
                          href={google(`${base} site:youtube.com`)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-500 underline"
                        >
                          youtube
                        </a>
                      </td>

                      <td className="p-2 text-center">
                        <a
                          href={google(`${base} color coded lyrics`)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-pink-400 underline"
                        >
                          color coded
                        </a>
                      </td>

                      <td className="p-2 text-center">
                        <a
                          href={google(`${base} lyrics site:fandom.com`)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-orange-400 underline"
                        >
                          fandom
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Footer */}
      <footer className="text-gray-500 text-sm mt-6 text-center flex items-center justify-center gap-2">
        <a
          href="https://github.com/elisesykimgit/spotify-playlist-lyrics-finder"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-gray-400 hover:text-white transition"
        >
          {/* GitHub logo */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="opacity-80"
          >
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.3 9.4 7.9 10.95.6.1.8-.25.8-.55v-2c-3.2.7-3.9-1.55-3.9-1.55-.55-1.4-1.3-1.75-1.3-1.75-1.1-.75.1-.75.1-.75 1.2.1 1.85 1.25 1.85 1.25 1.05 1.9 2.75 1.35 3.45 1.05.1-.8.4-1.35.75-1.65-2.55-.3-5.25-1.3-5.25-5.75 0-1.3.45-2.35 1.25-3.15-.15-.3-.55-1.55.1-3.2 0 0 1-.3 3.3 1.2a11 11 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.65 1.65.25 2.9.1 3.2.8.8 1.25 1.85 1.25 3.15 0 4.45-2.7 5.45-5.3 5.75.45.4.85 1.15.85 2.35v3.5c0 .3.2.65.8.55A10.98 10.98 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
          </svg>
          Built by <span className="underline">elisesykimgit</span>
        </a>
      </footer>
    </div>
  );
}