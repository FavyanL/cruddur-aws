import './UserFeedPage.css';
import React from "react";
import { useParams } from 'react-router-dom';

import DesktopNavigation  from '../components/DesktopNavigation';
import DesktopSidebar     from '../components/DesktopSidebar';
import ActivityFeed from '../components/ActivityFeed';
import ActivityForm from '../components/ActivityForm';
import ReplyForm from '../components/ReplyForm';
import { fetchCurrentUser } from '../lib/auth';

export default function UserFeedPage() {
  const [activities, setActivities] = React.useState([]);
  const [popped, setPopped] = React.useState([]);
  const [poppedReply, setPoppedReply] = React.useState(false);
  const [replyActivity, setReplyActivity] = React.useState({});
  const [user, setUser] = React.useState(null);
  const dataFetchedRef = React.useRef(false);

  const params = useParams();
  // The URL may arrive with or without a leading "@" — normalize it,
  // then build the display/back-end title with exactly one "@".
  const cleanHandle = params.handle.startsWith('@') ? params.handle.slice(1) : params.handle;
  const title = `@${cleanHandle}`;

  const loadData = async () => {
    try {
      const backend_url = `${process.env.REACT_APP_BACKEND_URL}/api/activities/${title}`
      const res = await fetch(backend_url, {
        method: "GET"
      });
      let resJson = await res.json();
      if (res.status === 200) {
        setActivities(resJson)
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

  React.useEffect(()=>{
    //prevents double call
    if (dataFetchedRef.current) return;
    dataFetchedRef.current = true;

    loadData();
    checkAuth();
  }, [])

  return (
    <article>
      <DesktopNavigation user={user} active={'profile'} setPopped={setPopped} />
      <div className='content'>
        <ActivityForm popped={popped} setActivities={setActivities} />
        <ActivityFeed 
          title={title} 
          setReplyActivity={setReplyActivity} 
          setPopped={setPoppedReply}           
          activities={activities} />
        <ReplyForm 
          activity={replyActivity} 
          popped={poppedReply} 
          setPopped={setPoppedReply} 
          setActivities={setActivities} 
          activities={activities} 
        />        
      </div>
      <DesktopSidebar user={user} />
    </article>
  );
}