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
      // Generate a unique username (Cognito requires a username)
      const generatedUsername = `user_${Date.now()}`;

      const { user } = await signUp({
        username: generatedUsername,  // Non-email username
        password,
        attributes: {
          email: email,  // Required
          name: name,    // Optional
          'custom:emails': email 
         },
      });

      console.log("User signed up:", user);
      navigate(`/confirm?email=${email}`);  // Redirect to confirmation page

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
              <label>UserName</label>
              <input type="text" value={username} onChange={(e) => setName(e.target.value)} required />
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

