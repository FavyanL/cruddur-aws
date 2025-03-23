import './ProfileInfo.css';
import {ReactComponent as ElipsesIcon} from './svg/elipses.svg';
import React from "react";

// Correct Authentication Import
import { signOut as amplifySignOut } from '@aws-amplify/auth';

export default function ProfileInfo(props) {
  const [popped, setPopped] = React.useState(false);

  const click_pop = () => {
    setPopped(!popped);
  };

  const handleSignOut = async () => {
    try {
      await amplifySignOut({ global: true });
      window.location.href = "/";
    } catch (error) {
      console.log("Error signing out: ", error);
    }
  };

  const classes = () => {
    let classes = ["profile-info-wrapper"];
    if (popped) {
      classes.push("popped");
    }
    return classes.join(" ");
  };

  return (
    <div className={classes()}>
      <div className="profile-dialog">
        <button onClick={handleSignOut}>Sign Out</button>
      </div>
      <div className="profile-info" onClick={click_pop}>
        <div className="profile-avatar"></div>
        <div className="profile-desc">
          <div className="profile-display-name">{props.user.display_name || "My Name"}</div>
          <div className="profile-username">@{props.user.handle || "handle"}</div>
        </div>
        <ElipsesIcon className="icon" />
      </div>
    </div>
  );
}
