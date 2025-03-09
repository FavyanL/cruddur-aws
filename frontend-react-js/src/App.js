import './App.css';
import HomeFeedPage from './pages/HomeFeedPage';
import NotificationsFeedPage from './pages/NotificationsFeedPage';
import UserFeedPage from './pages/UserFeedPage';
import SignupPage from './pages/SignupPage';
import SigninPage from './pages/SigninPage';
import RecoverPage from './pages/RecoverPage';
import MessageGroupsPage from './pages/MessageGroupsPage';
import MessageGroupPage from './pages/MessageGroupPage';
import ConfirmationPage from './pages/ConfirmationPage';

import React, { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import awsConfig from './aws-exports';
import { getCurrentUser, signOut } from '@aws-amplify/auth';
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

// ✅ Debugging: Log environment variables
console.log("Amplify Config - User Pool ID:", process.env.REACT_APP_AWS_COGNITO_USER_POOLS_ID);
console.log("Amplify Config - Client ID:", process.env.REACT_APP_CLIENT_ID);
console.log("Amplify Config - OAuth Domain:", process.env.REACT_APP_OAUTH_DOMAIN);

// ✅ Configure Amplify
Amplify.configure(awsConfig);

function App() {
  const [user, setUser] = useState(null);

  // ✅ Fetch the current user on app load
  const fetchUser = async () => {
    try {
      const authUser = await getCurrentUser();
      setUser(authUser); // ✅ Set the authenticated user
      console.log("✅ User fetched:", authUser);
    } catch (error) {
      console.log("🚫 Not signed in");
      setUser(null);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  return (
    <Router>
      <Routes>
        {/* ✅ Pass fetchUser function to re-fetch user after login */}
        <Route path="/" element={user ? <HomeFeedPage /> : <SigninPage refreshUser={fetchUser} />} />
        <Route path="/notifications" element={<NotificationsFeedPage />} />
        <Route path="/@:handle" element={<UserFeedPage />} />
        <Route path="/messages" element={<MessageGroupsPage />} />
        <Route path="/messages/@:handle" element={<MessageGroupPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signin" element={<SigninPage refreshUser={fetchUser} />} />
        <Route path="/confirm" element={<ConfirmationPage />} />
        <Route path="/forgot" element={<RecoverPage />} />
        <Route
          path="/profile"
          element={
            user ? (
              <div>
                <h1>Welcome, {user.username || 'User'}</h1>
                <button
                  onClick={async () => {
                    await signOut();
                    setUser(null); // ✅ Reset user state
                    window.location.href = "/signin"; // ✅ Redirect to sign-in page
                  }}
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <SigninPage refreshUser={fetchUser} />
            )
          }
        />
      </Routes>
    </Router>
  );
}

export default App;

