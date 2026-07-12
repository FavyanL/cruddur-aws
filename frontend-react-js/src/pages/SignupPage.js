import './SignupPage.css';
import React, { useState } from "react";
import { ReactComponent as Logo } from '../components/svg/logo.svg';
import { Link, useNavigate } from "react-router-dom";
import { signUp } from '@aws-amplify/auth';

export default function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState('');

  const handleSignup = async (event) => {
    event.preventDefault();
    setErrors('');

    try {
      // Amplify v6 changed the shape of this call. In v5 you passed a top-level
      // `attributes` object; in v6 it's `options.userAttributes`. v6 does NOT error on
      // the old shape — it just ignores it. That's why signup appeared to "work" and yet
      // no verification email ever arrived: Cognito was being handed an account with no
      // email address on it at all.
      // The Cognito username is the HANDLE, not the email.
      //
      // This pool has email configured as an *alias*, and Cognito forbids an email-shaped
      // username in that setup: if "you@x.com" were both a username and an alias, a login
      // attempt would be ambiguous. Passing the email here fails with
      //   "Username cannot be of email format"
      //
      // Using the handle also means one identifier instead of two, and Cognito enforces
      // its uniqueness for us. You still SIGN IN with your email — that's what the alias
      // is for, and it's why SigninPage passes an email as `username` and it works.
      const { isSignUpComplete, nextStep } = await signUp({
        username: username,
        password,
        options: {
          userAttributes: {
            email: email,
            name: name    // -> display_name in our users table
          }
        }
      });

      // preferred_username is the handle you'll be known by (@handle). It's stored on the
      // Cognito account, which means the backend can read it out of a signed token later
      // and create your database row without trusting anything the browser says.
      console.log('signUp complete?', isSignUpComplete, 'next step:', nextStep);

      // Pass BOTH on to the confirm page.
      //
      // The username is the one that matters: confirmSignUp() and resendSignUpCode() must
      // address the account by its real Cognito username (the handle). They cannot use the
      // email — an alias attribute only becomes usable AFTER the account is confirmed, and
      // an unconfirmed account is exactly what we have here. The email is carried along
      // only so we can show the user where their code was sent.
      //
      // These are QUERY STRINGS (?a=1&b=2), so the confirm page reads them with
      // useSearchParams — useParams() only sees /route/:segments and would find nothing.
      navigate(`/confirm?username=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}`);

    } catch (error) {
      console.error("❌ Error signing up:", error);
      setErrors(error.message);
    }
  };

  return (
    <article className='signup-article'>
      <div className='signup-info'>
        <Logo className='logo' />
      </div>
      <div className='signup-wrapper'>
        <form className='signup_form' onSubmit={handleSignup}>
          <h2>Sign up to create a Cruddur account</h2>
          <div className='fields'>
            <div className='field text_field name'>
              <label>Name</label>
              {/* Display name — shown on your profile. Sent to Cognito as `name`. */}
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className='field text_field username'>
              <label>Username</label>
              {/* Your @handle. Sent to Cognito as `preferred_username`.
                  This input used to read `value={username}` but write with setName() —
                  bound to one state, updating another — so it could never change as you
                  typed. Classic React bug: the input is only as live as its own state. */}
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>

            <div className='field text_field email'>
              <label>Email</label>
              <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div className='field text_field password'>
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>

          {errors && <div className='errors'>{errors}</div>}

          <div className='submit'>
            <button type='submit'>Sign Up</button>
          </div>
        </form>
        <div className="already-have-an-account">
          <span>Already have an account?</span>
          <Link to="/signin">Sign in!</Link>
        </div>
      </div>
    </article>
  );
}

