import './MessageGroupPage.css';
import React from "react";
import { useParams } from 'react-router-dom';

import DesktopNavigation  from '../components/DesktopNavigation';
import MessageGroupFeed from '../components/MessageGroupFeed';
import MessagesFeed from '../components/MessageFeed';
import MessagesForm from '../components/MessageForm';
import { getAccessToken, fetchCurrentUser } from '../lib/auth';

export default function MessageGroupPage() {
  const [messageGroups, setMessageGroups] = React.useState([]);
  const [messages, setMessages] = React.useState([]);
  const [popped, setPopped] = React.useState([]);
  const [user, setUser] = React.useState(null);
  const dataFetchedRef = React.useRef(false);
  const params = useParams();

  const loadMessageGroupsData = async () => {
    try {
      const backend_url = `${process.env.REACT_APP_BACKEND_URL}/api/message_groups`
      // Ask Amplify for the token at request time; it refreshes silently if expired.
      const access_token = await getAccessToken();
      const res = await fetch(backend_url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
      let resJson = await res.json();
      if (res.status === 200) {
        setMessageGroups(resJson)
      } else {
        console.log(res)
      }
    } catch (err) {
      console.log(err);
    }
  };  

  const loadMessageGroupData = async () => {
    try {
      // URL may arrive with or without a leading "@" — normalize to exactly one.
      const rawHandle = params.handle;
      const cleanHandle = rawHandle.startsWith('@') ? rawHandle.slice(1) : rawHandle;
      const handle = `@${cleanHandle}`;
      const backend_url = `${process.env.REACT_APP_BACKEND_URL}/api/messages/${handle}`
      // Ask Amplify for the token at request time; it refreshes silently if expired.
      const access_token = await getAccessToken();
      const res = await fetch(backend_url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
      let resJson = await res.json();
      if (res.status === 200) {
        setMessages(resJson)
      } else {
        console.log(res)
      }
    } catch (err) {
      console.log(err);
    }
  };  

  const checkAuth = async () => {
    // fetchCurrentUser() returns our DB row for the signed-in user, or null.
    setUser(await fetchCurrentUser());
  };

  // Load the conversation list and current user once, on first mount.
  React.useEffect(()=>{
    if (dataFetchedRef.current) return;
    dataFetchedRef.current = true;
    loadMessageGroupsData();
    checkAuth();
  }, [])

  // Reload the messages whenever the URL handle changes (e.g. when you click
  // between conversations). Without this, the page silently shows stale data.
  React.useEffect(()=>{
    loadMessageGroupData();
  }, [params.handle])
  return (
    <article>
      <DesktopNavigation user={user} active={'home'} setPopped={setPopped} />
      <section className='message_groups'>
        <MessageGroupFeed message_groups={messageGroups} />
      </section>
      <div className='content messages'>
        <MessagesFeed messages={messages} />
        <MessagesForm setMessages={setMessages} />
      </div>
    </article>
  );
}