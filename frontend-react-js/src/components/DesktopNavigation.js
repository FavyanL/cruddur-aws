import './DesktopNavigation.css';
import {ReactComponent as Logo} from './svg/logo.svg';
import DesktopNavigationLink from '../components/DesktopNavigationLink';
import CrudButton from '../components/CrudButton';
import ProfileInfo from '../components/ProfileInfo';

export default function DesktopNavigation(props) {

  let button;
  let profile;
  let notificationsLink;
  let messagesLink;
  let profileLink;
  let signinLink;
  if (props.user) {
    button = <CrudButton setPopped={props.setPopped} />;
    profile = <ProfileInfo user={props.user} />;
    notificationsLink = <DesktopNavigationLink 
      url="/notifications" 
      name="Notifications" 
      handle="notifications" 
      active={props.active} />;
    messagesLink = <DesktopNavigationLink 
      url="/messages"
      name="Messages"
      handle="messages" 
      active={props.active} />
    profileLink = <DesktopNavigationLink
      url={`/@${props.user.handle}`}
      name="Profile"
      handle="profile"
      active={props.active} />
  } else {
    // No user means either "never signed in" or "session expired". Either way the
    // signed-in nav (including the Sign Out button inside ProfileInfo) is hidden,
    // so without this link there is literally no way out of the app from the UI —
    // you'd have to clear localStorage by hand in the console to recover.
    signinLink = <DesktopNavigationLink
      url="/signin"
      name="Sign In"
      handle="signin"
      active={props.active} />
  }

  return (
    <nav>
      <Logo className='logo' />
      <DesktopNavigationLink url="/" 
        name="Home"
        handle="home"
        active={props.active} />
      {notificationsLink}
      {messagesLink}
      {profileLink}
      <DesktopNavigationLink url="/#"
        name="More"
        handle="more"
        active={props.active} />
      {signinLink}
      {button}
      {profile}
    </nav>
  );
}