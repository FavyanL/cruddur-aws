import './ConfirmationPage.css';
import React from "react";
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ReactComponent as Logo } from '../components/svg/logo.svg';

import { confirmSignUp, resendSignUpCode } from '@aws-amplify/auth';

export default function ConfirmationPage() {
  // `username` is the HANDLE — it's what Cognito knows this account by, and the only thing
  // confirmSignUp()/resendSignUpCode() can address an UNCONFIRMED account with. The email
  // is an alias, and aliases don't work until after confirmation, so it's useless here.
  // We keep the email purely to tell the user where their code went.
  const [username, setUsername] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [errors, setErrors] = React.useState('');
  const [codeSent, setCodeSent] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // These arrive from SignupPage as QUERY STRINGS: /confirm?username=me&email=me@example.com
  // The old code used useParams(), which only reads dynamic *route* segments (/confirm/:email).
  // Our route is a plain "/confirm", so useParams() always came back empty and the box was
  // always blank. useSearchParams() is the one that reads ?key=value.
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  React.useEffect(() => {
    const usernameParam = searchParams.get('username');
    const emailParam = searchParams.get('email');
    if (usernameParam) setUsername(usernameParam);
    if (emailParam) setEmail(emailParam);
  }, [searchParams]);

  const code_onchange = (event) => setCode(event.target.value);
  const username_onchange = (event) => setUsername(event.target.value);

  // Ask Cognito to email a fresh code. The old version of this function was empty —
  // it logged 'resend_code' and did nothing at all.
  const resend_code = async (event) => {
    event.preventDefault();
    setErrors('');
    try {
      await resendSignUpCode({ username: username });
      setCodeSent(true);
    } catch (error) {
      console.error('Error resending code:', error);
      if (error.name === 'UserNotFoundException') {
        setErrors('No account was found for that username.');
      } else if (error.name === 'LimitExceededException') {
        setErrors('Too many attempts. Wait a few minutes before requesting another code.');
      } else {
        setErrors(error.message);
      }
    }
  };

  // THIS is the call that was missing, and it's why the post-confirmation Lambda never ran.
  // confirmSignUp() is what marks the account confirmed in Cognito — and the Post Confirmation
  // trigger fires off *that* event. The old code just compared cookies that nothing ever set,
  // so Cognito was never told anything, and no trigger could ever fire.
  const onsubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrors('');

    try {
      await confirmSignUp({ username: username, confirmationCode: code });
      // Confirmed, but NOT signed in — Cognito hands out no tokens here. Send them to sign
      // in; their users row gets created on that first authenticated call to the backend.
      navigate('/signin');
    } catch (error) {
      console.error('Error confirming sign up:', error);
      if (error.name === 'CodeMismatchException') {
        setErrors('That code is not correct. Check it and try again.');
      } else if (error.name === 'ExpiredCodeException') {
        setErrors('That code has expired. Request a new one below.');
      } else {
        setErrors(error.message);
      }
    } finally {
      // Always re-enable the button, even when the request threw — otherwise one failed
      // attempt would leave it disabled forever and strand you on this page.
      setSubmitting(false);
    }
  };

  let el_errors;
  if (errors) {
    el_errors = <div className='errors'>{errors}</div>;
  }

  let code_button;
  if (codeSent) {
    code_button = <div className="sent-message">A new activation code has been sent to your email</div>
  } else {
    code_button = <button className="resend" onClick={resend_code}>Resend Activation Code</button>;
  }

  return (
    <article className="confirm-article">
      <div className='recover-info'>
        <Logo className='logo' />
      </div>
      <div className='recover-wrapper'>
        <form
          className='confirm_form'
          onSubmit={onsubmit}
        >
          <h2>Confirm your Email</h2>
          {email && <p className="sent-to">We sent a code to <strong>{email}</strong></p>}
          <div className='fields'>
            <div className='field text_field username'>
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={username_onchange}
              />
            </div>
            <div className='field text_field code'>
              <label>Confirmation Code</label>
              <input
                type="text"
                value={code}
                onChange={code_onchange}
              />
            </div>
          </div>
          {el_errors}
          <div className='submit'>
            <button type='submit' disabled={submitting}>
              {submitting ? 'Confirming…' : 'Confirm Email'}
            </button>
          </div>
        </form>
      </div>
      {code_button}
    </article>
  );
}
