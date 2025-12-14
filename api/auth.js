// api/auth.js
export default function handler(req, res) {
  const { SPOTIFY_CLIENT_ID } = process.env;

  if (!SPOTIFY_CLIENT_ID) {
    return res.status(500).json({ error: "Missing Spotify client ID" });
  }

  // Use your actual Vercel domain
  const redirectUri = `https://${req.headers.host}/api/callback`;

  // Added playlist-read-private scope which is required for private playlists
  const scopes = "playlist-read-private playlist-read-collaborative user-read-private user-read-email";

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.append("client_id", SPOTIFY_CLIENT_ID);
  authUrl.searchParams.append("response_type", "code");
  authUrl.searchParams.append("redirect_uri", redirectUri);
  authUrl.searchParams.append("scope", scopes);

  res.redirect(authUrl.toString());
}
