// api/playlist.js
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Get client credentials token (for public playlists)
async function getClientToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Missing Spotify credentials");
  }

  const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error("Failed to get client credentials token: " + JSON.stringify(errData));
  }

  const data = await res.json();
  return data.access_token;
}

// Extract playlist ID from URL
function extractPlaylistId(url) {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)(\?.*)?/);
  return match ? match[1] : null;
}

// Main handler
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const playlistUrl = req.query.url;
    if (!playlistUrl) return res.status(400).json({ error: "missing playlist url" });

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId) return res.status(400).json({ error: "invalid spotify playlist url" });

    const authHeader = req.headers.authorization;
    const userToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

    let accessToken;
    let tokenType;

    if (userToken) {
      accessToken = userToken;
      tokenType = "USER TOKEN";
    } else {
      accessToken = await getClientToken();
      tokenType = "CLIENT CREDENTIALS";
    }

    console.log(`Using token type: ${tokenType}`);

    // Fetch playlist
    const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!playlistRes.ok) {
      const errorData = await playlistRes.json().catch(() => ({}));
      console.error("Spotify API error:", playlistRes.status, errorData);

      let msg = "failed to fetch playlist";

      if (playlistRes.status === 401) {
        msg = tokenType === "USER TOKEN"
          ? "user token invalid or expired, please login again"
          : "client token invalid, try again later";
      } else if (playlistRes.status === 403) {
        msg =
          tokenType === "CLIENT CREDENTIALS"
            ? "private playlist — login with Spotify to access it"
            : "not authorized (missing scope or no access to playlist)";
      }

      return res.status(playlistRes.status).json({ error: msg });
    }

    const playlistData = await playlistRes.json();

    // Collect all tracks with pagination
    let tracks = [];

    // Add first page tracks
    tracks.push(
      ...playlistData.tracks.items
        .filter((i) => i.track)
        .map((i) => ({
          track: i.track.name,
          artist: i.track.artists.map((a) => a.name).join(", "),
          album: i.track.album?.name,
          year: i.track.album?.release_date?.slice(0, 4),
        }))
    );

    // Fetch remaining pages
    let next = playlistData.tracks.next;
    while (next) {
      const trackRes = await fetch(next, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const trackData = await trackRes.json();
      tracks.push(
        ...trackData.items
          .filter((i) => i.track)
          .map((i) => ({
            track: i.track.name,
            artist: i.track.artists.map((a) => a.name).join(", "),
            album: i.track.album?.name,
            year: i.track.album?.release_date?.slice(0, 4),
          }))
      );
      next = trackData.next;
    }

    res.json({
      name: playlistData.name,
      tracks,
    });
  } catch (err) {
    console.error("API ERROR:", err);
    res.status(500).json({ error: err.message || "internal server error" });
  }
}
