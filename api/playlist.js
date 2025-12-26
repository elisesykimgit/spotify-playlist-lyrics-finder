// api/playlist.js
const TOKEN_URL = "https://accounts.spotify.com/api/token";

// Get client credentials token (for public playlists)
async function getClientToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Missing Spotify credentials");
  }

  const auth = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

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
    throw new Error(
      "Failed to get client credentials token: " + JSON.stringify(errData)
    );
  }

  const data = await res.json();
  return data.access_token;
}

// Extract playlist ID from URL
function extractPlaylistId(url) {
  const match = url.match(/playlist\/([a-zA-Z0-9]+)(\?.*)?/);
  return match ? match[1] : null;
}

// Pick a small-ish album image for UI thumbnails
function pickAlbumImage(track) {
  const images = track?.album?.images;
  if (!Array.isArray(images) || images.length === 0) return null;

  return images[2]?.url || images[images.length - 1]?.url || images[0]?.url || null;
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
    if (!playlistUrl)
      return res.status(400).json({ error: "missing playlist url" });

    const playlistId = extractPlaylistId(playlistUrl);
    if (!playlistId)
      return res.status(400).json({ error: "invalid spotify playlist url" });

    const authHeader = req.headers.authorization;
    const userToken = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;

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
    const playlistRes = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!playlistRes.ok) {
      const errorData = await playlistRes.json().catch(() => ({}));
      console.error("Spotify API error:", playlistRes.status, errorData);

      let msg = "failed to fetch playlist";

      if (playlistRes.status === 401) {
        msg =
          tokenType === "USER TOKEN"
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

    const mapItemToTrack = (item) => {
      const tr = item?.track;
      if (!tr) return null;

      return {
        track: tr.name,
        artist: tr.artists?.map((a) => a.name).join(", "),
        album: tr.album?.name,
        year: tr.album?.release_date?.slice(0, 4),

        // NEW: for album cover UI + click-to-open-on-spotify
        albumImage: pickAlbumImage(tr),
        trackUrl: tr.external_urls?.spotify || null,
      };
    };

    // Add first page tracks
    tracks.push(
      ...playlistData.tracks.items
        .map(mapItemToTrack)
        .filter(Boolean)
    );

    // Fetch remaining pages
    let next = playlistData.tracks.next;
    while (next) {
      const trackRes = await fetch(next, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!trackRes.ok) {
        const errText = await trackRes.text().catch(() => "");
        console.error("Spotify pagination error:", trackRes.status, errText);
        break; // fail soft: return what we already have
      }

      const trackData = await trackRes.json();

      tracks.push(
        ...trackData.items
          .map(mapItemToTrack)
          .filter(Boolean)
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