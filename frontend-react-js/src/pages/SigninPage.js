import './SigninPage.css';
import React, { useState } from "react";
import { ReactComponent as Logo } from '../components/svg/logo.svg';
import { Link, useNavigate } from "react-router-dom";
import { signIn } from '@aws-amplify/auth';

export default function SigninPage({ refreshUser }) { // Accept refreshUser function from App.js
  const navigate = useNavigate(); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState('');

  const onsubmit = async (event) => {
    event.preventDefault(); // Prevent form submission from reloading the page
    setErrors('');
    
    try {
      const user = await signIn({ username: email, password });
      
      console.log("Signed in:", user);
      
      // Store session token properly for future API requests
      if (user.signInUserSession) {
        localStorage.setItem("access_token", user.signInUserSession.accessToken.jwtToken);
      }

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
