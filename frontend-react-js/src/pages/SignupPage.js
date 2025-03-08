import './SignupPage.css';
import React, { useState } from "react";
import { ReactComponent as Logo } from '../components/svg/logo.svg';
import { Link } from "react-router-dom";

// Import correct Amplify Auth function
import { signUp } from '@aws-amplify/auth';

export default function SignupPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState('');

  const handleSignup = async (event) => {
    event.preventDefault();
    setErrors('');

    try {
      // Call Cognito's signUp function
      const { user } = await signUp({
        username: email, // Cognito requires a username (using email for simplicity)
        password,
        attributes: {
          email,  // Required attribute
          name,   // Optional - stores user’s real name
          preferred_username: username, // Optional
        },
        autoSignIn: { enabled: true }, // Auto sign-in after confirmation
      });

      console.log("User signed up:", user);

      // Redirect to confirmation page
      window.location.href = `/confirm?email=${email}`;

    } catch (error) {
      console.error("Error signing up:", error);
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
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className='field text_field email'>
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className='field text_field username'>
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className='field text_field password'>
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
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
