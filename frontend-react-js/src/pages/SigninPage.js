import './SigninPage.css';
import React, { useState } from "react";
import { ReactComponent as Logo } from '../components/svg/logo.svg';
import { Link, useNavigate, useLocation } from "react-router-dom";
import { signIn, signOut } from '@aws-amplify/auth';


export default function SigninPage({ refreshUser }) { // Accept refreshUser function from App.js
  const navigate = useNavigate(); 
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState('');

  const onsubmit = async (event) => {
    event.preventDefault(); // Prevent form submission from reloading the page
    setErrors('');
    
    try {
      // Clear any dead session Amplify may still be holding before signing in.
      //
      // If a refresh token has expired, Amplify still has stale credentials sitting in
      // localStorage even though nothing about them works any more. In that state
      // signIn() throws UserAlreadyAuthenticatedException ("you're already signed in")
      // and you'd be stuck on this page unable to sign in OR sign out. Clearing first
      // makes signing in always safe. It's a no-op when there's no session to clear,
      // so the catch is intentionally empty.
      try {
        await signOut();
      } catch (e) { /* nothing to sign out of — fine */ }

      const { isSignedIn } = await signIn({ username: email, password });

      console.log("Signed in:", isSignedIn);

      // No token is copied out here on purpose. Amplify already holds the session
      // after signIn(); callers get a fresh (auto-refreshed) token from
      // getAccessToken() in lib/auth.js at the moment they need it. Snapshotting
      // the token here would go stale in ~1 hour and 401 every request after that.

      refreshUser(); // Update the user state immediately
      navigate("/"); // Redirect user to homepage

    } catch (error) {
      console.error("❌ Error signing in:", error);

      // andle unconfirmed users by redirecting to confirmation page
      if (error.name === 'UserNotConfirmedException') {
        navigate("/confirm");
      }

      setErrors(error.message);
    }
  };

  return (
    <article className="signin-article">
      <div className='signin-info'>
        <Logo className='logo' />
      </div>
      <div className='signin-wrapper'>
        <form className='signin_form' onSubmit={onsubmit}>
          {location.state?.justConfirmed &&
            <div className='confirmed-notice'>Email verified! Sign in below to get started.</div>
          }       
          <h2>Sign into your Cruddur account</h2>
          <div className='fields'>
            <div className='field text_field username'>
              <label>Email</label>
              <input 
                type="text" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
              />
            </div>
            <div className='field text_field password'>
              <label>Password</label>
              <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
              />
            </div>
          </div>

          {/* Show errors if authentication fails */}
          {errors && <div className='errors'>{errors}</div>}

          <div className='submit'>
            <Link to="/forgot" className="forgot-link">Forgot Password?</Link>
            <button type='submit'>Sign In</button>
          </div>
        </form>

        <div className="dont-have-an-account">
          <span>Don't have an account?</span>
          <Link to="/signup">Sign up!</Link>
        </div>
      </div>
    </article>
  );
}
