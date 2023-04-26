import React, { ReactElement, useContext, useEffect, useState } from 'react';
import { Redirect, Route, RouteProps, Switch, useHistory, useLocation } from 'react-router';
import TopNav from '@components/TopNav';
import GlobalFeed from '../GlobalFeed';
import './app.scss';
import { useGunLoggedIn } from '@ducks/web3';
import { useDispatch } from 'react-redux';
import PostView from '../PostView';
import ProfileView from '../ProfileView';
import HomeFeed from '../HomeFeed';
import TagFeed from '@components/TagFeed';
import SignupView, { ViewType } from '../SignupView';
import { syncWorker, useSelectedLocalId } from '@ducks/worker';
import BottomNav from '@components/BottomNav';
import InterrepOnboarding from '../InterrepOnboarding';
import ConnectTwitterView from '../ConnectTwitterView';
import { loginUser } from '~/user';
import SettingView from '../SettingView';
import MetaPanel from '@components/MetaPanel';
import ChatView from '../ChatView';
import { fetchChats, fetchUnreads } from '@ducks/chats';
import ThemeContext from '@components/ThemeContext';
import classNames from 'classnames';
import TazModal from '@components/TazModal';
import NotificationView from '../NotificationView';
import { updateNotifications } from '@ducks/app';
import SearchResultsView from '../SearchResultsView';
import { initZkitter, updateFilter } from '@ducks/zkitter';
import OnboardingV2 from '../OnboardingV2';

export default function App(): ReactElement {
  const dispatch = useDispatch();
  const selected = useSelectedLocalId();
  const theme = useContext(ThemeContext);
  const loc = useLocation();
  const history = useHistory();
  const [tazIdentity, setTazIdentity] = useState<string[] | null>(null);
  const [showingTazModal, showTazModal] = useState(false);

  useEffect(() => {
    if (loc.pathname === '/taz/') {
      const [nullifer, trapdoor] = loc.hash.slice(1).split('_');
      history.push('/');
      setTazIdentity([nullifer, trapdoor]);
      showTazModal(true);
    }
  }, [loc]);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerText = `
            :root {
                color-scheme: ${theme};
            }
        `;
    document.head.appendChild(style);
  }, [theme]);

  useEffect(() => {
    (async function onAppMount() {
      const id: any = await dispatch(syncWorker());

      await dispatch(initZkitter());

      if (id) {
        await loginUser(id);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (selected?.type === 'gun') {
        await dispatch(updateNotifications());
        await dispatch(updateFilter());
      }

      await dispatch(fetchUnreads());
      await dispatch(fetchChats());
    })();
  }, [selected]);

  useEffect(() => {
    navigator.serviceWorker.addEventListener('message', event => {
      const data = event.data;

      if (!data) return;

      if (data.target === 'redux') {
        const action = data.action;
        dispatch(action);
      }
    });
  }, []);

  return (
    <div
      className={classNames('flex flex-col flex-nowrap w-screen h-screen overflow-hidden app', {
        dark: theme === 'dark',
        light: theme !== 'light',
      })}>
      {showingTazModal && (
        <TazModal tazIdentity={tazIdentity} onClose={() => showTazModal(false)} />
      )}
      <TopNav />
      <div className="flex flex-row flex-nowrap app__content">
        <Switch>
          <Route path="/explore">
            <GlobalFeed />
          </Route>
          <Route path="/tag/:tagName">
            <TagFeed />
          </Route>
          <Route path="/:name/status/:hash">
            <PostView />
          </Route>
          <Route path="/post/:hash">
            <PostView />
          </Route>
          <AuthRoute path="/home">
            <HomeFeed />
          </AuthRoute>
          <Route path="/notifications">
            <NotificationView />
          </Route>
          <Route path="/create-local-backup">
            <SignupView viewType={ViewType.localBackup} />
          </Route>
          <Route path="/onboarding/interrep">
            <InterrepOnboarding />
          </Route>
          <Route path="/signup/interep">
            <InterrepOnboarding />
          </Route>
          <Route path="/connect/twitter">
            <ConnectTwitterView />
          </Route>
          <Route path="/signup">
            <OnboardingV2 />
          </Route>
          <Route path="/settings">
            <SettingView />
          </Route>
          <Route path="/chat">
            <ChatView />
          </Route>
          <Route path="/taz">
            <GlobalFeed />
          </Route>
          <Route path="/search">
            <SearchResultsView />
          </Route>
          <Route path="/:name">
            <ProfileView />
          </Route>
          <Route path="/">
            <Redirect to="/explore" />
          </Route>
        </Switch>
        <MetaPanel className="mobile-hidden" />
      </div>
      <BottomNav />
    </div>
  );
}

function AuthRoute(
  props: {
    redirect?: string;
  } & RouteProps
): ReactElement {
  const { redirect = '/', ...routeProps } = props;
  const loggedIn = useGunLoggedIn();

  if (loggedIn) {
    return <Route {...routeProps} />;
  }

  return (
    <Route {...routeProps}>
      <Redirect to={redirect} />
    </Route>
  );
}
