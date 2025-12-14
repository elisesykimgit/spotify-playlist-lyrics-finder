// api/callback.js
export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) {
    console.error("OAuth error from Spotify:", error);
    return res.redirect(`/?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    console.error("No code received");
    return res.redirect("/?error=no_code");
  }

  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error("Missing Spotify credentials");
    return res.redirect("/?error=missing_credentials");
  }

  // redirect URI must exactly match the one used in /api/auth
  const redirectUri = `https://${req.headers.host}/api/callback`;
  console.log("Using redirect URI:", redirectUri);

  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: SPOTIFY_CLIENT_ID,
      client_secret: SPOTIFY_CLIENT_SECRET,
    });

    const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", tokenResponse.status, tokenData);
      return res.redirect(`/?error=token_exchange_failed`);
    }

    const { access_token, refresh_token, scope, expires_in } = tokenData;

    console.log("Token received successfully");
    console.log("Scopes granted:", scope);
    console.log("Expires in:", expires_in, "seconds");

    // Redirect to frontend with access_token (and optionally refresh_token)
    res.redirect(
      `/#access_token=${access_token}&refresh_token=${refresh_token || ""}`
    );
  } catch (err) {
    console.error("OAuth error:", err.message, err.stack);
    res.redirect("/?error=auth_failed");
  }
}
