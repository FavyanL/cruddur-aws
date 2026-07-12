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

// Returns the Cognito ID token, or null.
//
// Cognito issues two tokens and they are not interchangeable:
//   - the ACCESS token answers "is this request allowed?" — it carries 'sub' and little else
//   - the ID token answers "who is this?" — it carries email, name and preferred_username
//
// Every normal API call sends the access token, because 'sub' is all the backend needs to
// look you up. Provisioning is the one exception: to CREATE your row we need the attributes,
// and only the ID token has them. Like the access token, this is refreshed automatically.
export async function getIdToken() {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch (err) {
    console.log('Error fetching auth session:', err);
    return null;
  }
}

// Creates this user's row in our database, and returns it.
//
// Called only when /api/users/me came back 404 — i.e. Cognito knows you but our database
// doesn't yet, which is exactly the state a brand-new account is in right after confirming
// their email. The backend reads your handle and email out of the ID token's *verified*
// claims, so nothing here can be spoofed by the browser.
async function provisionCurrentUser() {
  try {
    const id_token = await getIdToken();
    if (!id_token) return null;

    const backend_url = `${process.env.REACT_APP_BACKEND_URL}/api/users/provision`;
    const res = await fetch(backend_url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${id_token}`
      }
    });

    if (res.status === 200) {
      return await res.json();
    }
    console.log('provisionCurrentUser: unexpected status', res.status);
    return null;
  } catch (err) {
    console.log('Error provisioning user:', err);
    return null;
  }
}

// Returns the signed-in user's row from OUR database, or null if there isn't one.
//
// Why ask the backend at all, when Amplify already knows who signed in? Because
// Amplify only knows the Cognito side of the story (an email, a "sub" id). It has
// no idea what our users table calls you. The handle, display_name and uuid live
// in Postgres, and the backend is the only thing that can verify the token and
// look them up. So: Amplify says "this person is authentic", the backend says
// "and here is who they are to us".
//
// Returns null on 401 (not signed in) and on 404 (valid Cognito account with no
// matching users row). Callers treat null as "no user" and render a signed-out UI.
export async function fetchCurrentUser() {
  try {
    const access_token = await getAccessToken();
    if (!access_token) return null;   // not signed in — don't bother calling the API

    const backend_url = `${process.env.REACT_APP_BACKEND_URL}/api/users/me`;
    const res = await fetch(backend_url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${access_token}`
      }
    });

    if (res.status === 200) {
      return await res.json();
    }

    // 404 means: your token is perfectly valid, but our users table has no row for you.
    // That is precisely what a brand-new account looks like the first time it signs in —
    // Cognito created the account, but nothing has created the profile yet. So create it.
    if (res.status === 404) {
      console.log('No user row yet — provisioning one from the ID token.');
      return await provisionCurrentUser();
    }

    // Anything else (401/500) means we have no usable user. Log the status so a 401
    // ("your token was rejected") is distinguishable from a 500 ("the backend broke")
    // when you're staring at the console.
    console.log('fetchCurrentUser: unexpected status', res.status);
    return null;
  } catch (err) {
    console.log('Error fetching current user:', err);
    return null;
  }
}
