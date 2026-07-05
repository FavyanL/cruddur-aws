import './MessageForm.css';
import React from "react";
import process from 'process';
import { useParams } from 'react-router-dom';

export default function ActivityForm(props) {
  const [count, setCount] = React.useState(0);
  const [message, setMessage] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const params = useParams();

  const classes = []
  classes.push('count')
  if (1024-count < 0){
    classes.push('err')
  }

  const onsubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const backend_url = `${process.env.REACT_APP_BACKEND_URL}/api/messages`
      // URL may give us "@hugol" or "hugol" — strip the leading "@" before sending.
      const rawHandle = params.handle;
      const cleanHandle = rawHandle.startsWith('@') ? rawHandle.slice(1) : rawHandle;
      console.log('onsubmit payload', message)
      const res = await fetch(backend_url, {
        method: "POST",
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem("access_token")}`
        },
        body: JSON.stringify({
          message: message,
          user_receiver_handle: cleanHandle
        }),
      });
      let data = await res.json();
      if (res.status === 200) {
        props.setMessages(current => [...current,data]);
        // Reset the form after a successful send.
        setMessage('');
        setCount(0);
      } else {
        console.log(res)
      }
    } catch (err) {
      console.log(err);
    } finally {
      setSubmitting(false);
    }
  }

  const textarea_onchange = (event) => {
    setCount(event.target.value.length);
    setMessage(event.target.value);
  }

  // Clear the form whenever we switch to a different conversation.
  React.useEffect(() => {
    setMessage('');
    setCount(0);
  }, [params.handle]);

  return (
    <form 
      className='message_form'
      onSubmit={onsubmit}
    >
      <textarea
        type="text"
        placeholder="send a direct message..."
        value={message}
        onChange={textarea_onchange} 
      />
      <div className='submit'>
        <div className={classes.join(' ')}>{1024-count}</div>
        <button type='submit' disabled={submitting}>
          {submitting ? 'Sending…' : 'Message'}
        </button>
      </div>
    </form>
  );
}