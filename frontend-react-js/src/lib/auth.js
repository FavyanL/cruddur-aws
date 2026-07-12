import { fetchAuthSession } from '@aws-amplify/auth';

// Returns a valid Cognito access token, or null if not signed in.
//
// fetchAuthSession() is the single source of truth for tokens in Amplify v6:
// it returns the cached access token while it's still valid, and silently
// uses the refresh token to get a new one when it has expired. This is why
// callers should ask for the token right before each request instead of
// stashing a copy in localStorage that will go stale after ~1 hour.
export async function getAccessToken() {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch (err) {
    console.log('Error fetching auth session:', err);
    return null;
  }
}
