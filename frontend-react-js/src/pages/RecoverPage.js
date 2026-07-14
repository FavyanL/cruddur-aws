import './RecoverPage.css';
import React from "react";
import {ReactComponent as Logo} from '../components/svg/logo.svg';
import { Link } from "react-router-dom";
import { resetPassword, confirmResetPassword } from '@aws-amplify/auth';

export default function RecoverPage() {
  // The account is already CONFIRMED by the time anyone recovers a password,
  // so Cognito's email alias works here — email or handle both address the account.
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [passwordAgain, setPasswordAgain] = React.useState('');
  const [code, setCode] = React.useState('');
  const [errors, setErrors] = React.useState('');
  const [formState, setFormState] = React.useState('send_code');
  const [submitting, setSubmitting] = React.useState(false);

  // Step 1: ask Cognito to email a reset code to this account.
  const onsubmit_send_code = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrors('');
    try {
      await resetPassword({ username });
      setFormState('confirm_code');
    } catch (error) {
      console.log('resetPassword error:', error);
      setErrors(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Step 2: send back the code plus the new password.
  const onsubmit_confirm_code = async (event) => {
    event.preventDefault();
    if (submitting) return;
    // Check the passwords match BEFORE talking to Cognito — no point
    // spending the code (or a rate-limited email) on a typo.
    if (password !== passwordAgain) {
      setErrors('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setErrors('');
    try {
      await confirmResetPassword({
        username: username,
        confirmationCode: code,
        newPassword: password
      });
      setFormState('success');
    } catch (error) {
      console.log('confirmResetPassword error:', error);
      setErrors(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const username_onchange = (event) => {
    setUsername(event.target.value);
  }
  const password_onchange = (event) => {
    setPassword(event.target.value);
  }
  const password_again_onchange = (event) => {
    setPasswordAgain(event.target.value);
  }
  const code_onchange = (event) => {
    setCode(event.target.value);
  }

  let el_errors;
  if (errors){
    el_errors = <div className='errors'>{errors}</div>;
  }

  const send_code = () => {
    return (<form 
      className='recover_form'
      onSubmit={onsubmit_send_code}
    >
      <h2>Recover your Password</h2>
      <div className='fields'>
        <div className='field text_field username'>
          <label>Email or username</label>
          <input
            type="text"
            value={username}
            onChange={username_onchange} 
          />
        </div>
      </div>
      {el_errors}
      <div className='submit'>
        <button type='submit' disabled={submitting}>
          {submitting ? 'Sending…' : 'Send Recovery Code'}
        </button>
      </div>

    </form>
    )
  }

  const confirm_code = () => {
    return (<form 
      className='recover_form'
      onSubmit={onsubmit_confirm_code}
    >
      <h2>Recover your Password</h2>
      <div className='fields'>
        <div className='field text_field code'>
          <label>Reset Password Code</label>
          <input
            type="text"
            value={code}
            onChange={code_onchange} 
          />
        </div>
        <div className='field text_field password'>
          <label>New Password</label>
          <input
            type="password"
            value={password}
            onChange={password_onchange} 
          />
        </div>
        <div className='field text_field password_again'>
          <label>New Password Again</label>
          <input
            type="password"
            value={passwordAgain}
            onChange={password_again_onchange} 
          />
        </div>
      </div>
      {el_errors}
      <div className='submit'>
        <button type='submit' disabled={submitting}>
          {submitting ? 'Resetting…' : 'Reset Password'}
        </button>
      </div>
    </form>
    )
  }

  const success = () => {
    return (<form>
      <p>Your password has been successfully reset!</p>
      <Link to="/signin" className="proceed">Proceed to Signin</Link>
    </form>
    )
    }

  let form;
  if (formState == 'send_code') {
    form = send_code()
  }
  else if (formState == 'confirm_code') {
    form = confirm_code()
  }
  else if (formState == 'success') {
    form = success()
  }

  return (
    <article className="recover-article">
      <div className='recover-info'>
        <Logo className='logo' />
      </div>
      <div className='recover-wrapper'>
        {form}
      </div>

    </article>
  );
}