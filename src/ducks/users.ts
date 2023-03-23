import { Dispatch } from 'redux';
import { AppRootState } from '../store/configureAppStore';
import { useSelector } from 'react-redux';
import deepEqual from 'fast-deep-equal';
import config from '~/config';
import { fetchAddressByName as _fetchAddressByName, fetchNameByAddress } from '~/web3';
import { ThunkDispatch } from 'redux-thunk';
import { getContextNameFromState } from './posts';

enum ActionTypes {
  SET_USER = 'users/setUser',
  SET_USER_META = 'users/setUserMeta',
  RESET_USERS = 'users/resetUsers',
  SET_FOLLOWED = 'users/setFollowed',
  SET_BLOCKED = 'users/setBlocked',
  SET_USER_ADDRESS = 'users/setUserAddress',
  SET_ECDH = 'users/setECDH',
  SET_ID_COMMITMENT = 'users/setIdCommitment',
  SET_ACCEPTANCE_SENT = 'users/setAcceptanceSent',
}

type Action<payload> = {
  type: ActionTypes;
  payload?: payload;
  meta?: any;
  error?: boolean;
};

export type UserMeta = {
  blockedCount: number;
  blockingCount: number;
  followerCount: number;
  followingCount: number;
  postingCount: number;
  followed: string | null;
  blocked: string | null;
  inviteSent: string | null;
  acceptanceReceived: string | null;
  inviteReceived: string | null;
  acceptanceSent: string | null;
};

export type User = {
  username: string;
  ens?: string;
  name: string;
  pubkey: string;
  address: string;
  coverImage: string;
  profileImage: string;
  twitterVerification: string;
  bio: string;
  website: string;
  group: boolean;
  ecdh: string;
  idcommitment: string;
  joinedAt: number;
  joinedTx: string;
  type: 'ens' | 'arbitrum' | '';
};

type State = {
  map: {
    [name: string]: User;
  };
  meta: {
    [name: string]: UserMeta;
  };
  ecdh: {
    [ecdh: string]: string;
  };
};

const initialState: State = {
  map: {},
  meta: {},
  ecdh: {},
};

let fetchPromises: any = {};
let cachedUser: any = {};

export const fetchAddressByName = (ens: string) => async (dispatch: Dispatch) => {
  const address = await _fetchAddressByName(ens);
  dispatch({
    type: ActionTypes.SET_USER_ADDRESS,
    payload: {
      ens: ens,
      address: address === '0x0000000000000000000000000000000000000000' ? '' : address,
    },
  });
  return address;
};

export const watchUser = (username: string) => async (dispatch: ThunkDispatch<any, any, any>) => {
  return new Promise(async (resolve, reject) => {
    _getUser();

    async function _getUser() {
      const user: any = await dispatch(getUser(username));

      if (!user?.joinedTx) {
        setTimeout(_getUser, 5000);
        return;
      }

      resolve(user);
    }
  });
};

async function _maybePreloadUserFromZkitter(
  address: string,
  dispatch: Dispatch,
  getState: () => AppRootState
) {
  const {
    zkitter: { client },
  } = getState();

  if (false) {
    const user = await client.getUser(address);
    const meta = await client.getUserMeta(address);
    if (user) {
      dispatch(
        setUser({
          username: user.address,
          ens: await fetchNameByAddress(address),
          name: meta.nickname,
          pubkey: user.pubkey,
          address: user.address,
          coverImage: meta.coverImage,
          profileImage: meta.profileImage,
          twitterVerification: meta.twitterVerification,
          bio: meta.bio,
          website: meta.website,
          group: meta.group,
          ecdh: meta.ecdh,
          idcommitment: meta.idCommitment,
          joinedAt: user.joinedAt.getTime(),
          joinedTx: user.tx,
          type: user.type,
        })
      );
    }
  }
}

export const getUser =
  (address: string) =>
  async (dispatch: Dispatch, getState: () => AppRootState): Promise<User> => {
    const contextualName = getContextNameFromState(getState());
    const key = contextualName + address;

    if (fetchPromises[key]) {
      return fetchPromises[key];
    }

    const fetchPromise = new Promise<User>(async (resolve, reject) => {
      let payload;

      if (cachedUser[key]) {
        payload = cachedUser[key];
      } else {
        await _maybePreloadUserFromZkitter(address, dispatch, getState);
        const resp = await fetch(`${config.indexerAPI}/v1/users/${address}`, {
          method: 'GET',
          // @ts-ignore
          headers: {
            'x-contextual-name': contextualName,
          },
        });
        const json = await resp.json();
        // @ts-ignore
        payload = dispatch(processUserPayload({ ...json.payload }));
        if (payload?.joinedTx) {
          cachedUser[key] = payload;
        }
      }

      dispatch({
        type: ActionTypes.SET_USER,
        payload: payload,
      });

      resolve(payload);
    });

    fetchPromises[key] = fetchPromise;

    return fetchPromise;
  };

export const fetchUsers =
  () =>
  async (dispatch: Dispatch, getState: () => AppRootState): Promise<string[]> => {
    const contextualName = getContextNameFromState(getState());
    const resp = await fetch(`${config.indexerAPI}/v1/users?limit=5`, {
      method: 'GET',
      // @ts-ignore
      headers: {
        'x-contextual-name': contextualName,
      },
    });

    const json = await resp.json();
    const list: string[] = [];

    for (const user of json.payload) {
      // @ts-ignore
      const payload = dispatch(processUserPayload(user));
      const key = contextualName + user.address;
      if (payload?.joinedTx) {
        cachedUser[key] = payload;
      }
      list.push(user.address);
    }

    return list;
  };

export const searchUsers =
  (query: string) =>
  async (dispatch: Dispatch, getState: () => AppRootState): Promise<string[]> => {
    const contextualName = getContextNameFromState(getState());
    const resp = await fetch(
      `${config.indexerAPI}/v1/users/search/${encodeURIComponent(query)}?limit=5`,
      {
        method: 'GET',
        // @ts-ignore
        headers: {
          'x-contextual-name': contextualName,
        },
      }
    );

    const json = await resp.json();
    const list: string[] = [];

    for (const user of json.payload) {
      // @ts-ignore
      const payload = dispatch(processUserPayload(user));
      const key = contextualName + user.address;
      if (payload?.joinedTx) {
        cachedUser[key] = payload;
      }
      list.push(user.address);
    }

    return json.payload;
  };

export const fetchUserByECDH =
  (ecdh: string) => async (dispatch: Dispatch, getState: () => AppRootState) => {
    const resp = await fetch(`${config.indexerAPI}/v1/ecdh/${ecdh}`);
    const json = await resp.json();

    if (!json.error && json.payload) {
      dispatch(setEcdh(json.payload, ecdh));
    }
  };

export const setAcceptanceSent = (
  address: string,
  acceptanceSent: string | null
): Action<{ address: string; acceptanceSent: string | null }> => ({
  type: ActionTypes.SET_ACCEPTANCE_SENT,
  payload: { address, acceptanceSent },
});

export const setFollowed = (
  address: string,
  followed: string | null
): Action<{ address: string; followed: string | null }> => ({
  type: ActionTypes.SET_FOLLOWED,
  payload: { address, followed },
});

export const setBlocked = (
  address: string,
  blocked: string | null
): Action<{ address: string; blocked: string | null }> => ({
  type: ActionTypes.SET_BLOCKED,
  payload: { address, blocked },
});

export const setEcdh = (
  address: string,
  ecdh: string
): Action<{ address: string; ecdh: string }> => ({
  type: ActionTypes.SET_ECDH,
  payload: { address, ecdh },
});

export const setIdCommitment = (
  address: string,
  idcommitment: string
): Action<{ address: string; idcommitment: string }> => ({
  type: ActionTypes.SET_ID_COMMITMENT,
  payload: { address, idcommitment },
});

export const resetUser = () => {
  fetchPromises = {};
  cachedUser = {};
  return {
    type: ActionTypes.RESET_USERS,
  };
};

const processUserPayload = (user: any) => (dispatch: Dispatch) => {
  const payload: User = {
    address: user.username,
    ens: user.ens,
    username: user.username,
    name: user.name || '',
    pubkey: user.pubkey || '',
    bio: user.bio || '',
    profileImage: user.profileImage || '',
    coverImage: user.coverImage || '',
    group: !!user.group,
    twitterVerification: user.twitterVerification || '',
    website: user.website || '',
    ecdh: user.ecdh || '',
    idcommitment: user.idcommitment || '',
    joinedAt: user.joinedAt || '',
    joinedTx: user.joinedTx || '',
    type: user.type || '',
  };

  const meta = {
    followerCount: user.meta?.followerCount || 0,
    followingCount: user.meta?.followingCount || 0,
    blockedCount: user.meta?.blockedCount || 0,
    blockingCount: user.meta?.blockingCount || 0,
    postingCount: user.meta?.postingCount || 0,
    followed: user.meta?.followed || null,
    blocked: user.meta?.blocked || null,
    inviteSent: user.meta?.inviteSent || null,
    acceptanceReceived: user.meta?.acceptanceReceived || null,
    inviteReceived: user.meta?.inviteReceived || null,
    acceptanceSent: user.meta?.acceptanceSent || null,
  };

  dispatch({
    type: ActionTypes.SET_USER,
    payload: payload,
  });

  dispatch({
    type: ActionTypes.SET_USER_META,
    payload: { meta, address: user.username },
  });

  if (payload.ecdh) {
    dispatch(setEcdh(payload.address, payload.ecdh));
  }

  return payload;
};

export const setUser = (user: User) => ({
  type: ActionTypes.SET_USER,
  payload: user,
});

export const useConnectedTwitter = (address = '') => {
  return useSelector((state: AppRootState) => {
    const user = state.users.map[address];

    if (!user?.twitterVerification) return null;

    const [twitterHandle] = user.twitterVerification.replace('https://twitter.com/', '').split('/');
    return twitterHandle;
  }, deepEqual);
};

export const useUserByECDH = (ecdh: string): string | null => {
  return useSelector((state: AppRootState) => {
    return state.users.ecdh[ecdh] || null;
  }, deepEqual);
};

export const useUser = (address = ''): (User & { meta: UserMeta }) | null => {
  return useSelector((state: AppRootState) => {
    if (!address) return null;

    const user = state.users.map[address];
    const meta = state.users.meta[address];

    if (!user) {
      return {
        username: address,
        name: '',
        pubkey: '',
        address: address,
        coverImage: '',
        profileImage: '',
        twitterVerification: '',
        bio: '',
        website: '',
        ecdh: '',
        idcommitment: '',
        joinedAt: 0,
        joinedTx: '',
        type: '',
        group: false,
        meta: {
          followerCount: 0,
          followingCount: 0,
          blockedCount: 0,
          blockingCount: 0,
          postingCount: 0,
          followed: null,
          blocked: null,
          inviteSent: null,
          acceptanceReceived: null,
          inviteReceived: null,
          acceptanceSent: null,
        },
      };
    }

    return {
      ...user,
      meta,
    };
  }, deepEqual);
};

export default function users(state = initialState, action: Action<any>): State {
  switch (action.type) {
    case ActionTypes.SET_USER:
      return reduceSetUser(state, action);
    case ActionTypes.SET_USER_META:
      return reduceSetUserMeta(state, action);
    case ActionTypes.RESET_USERS:
      return {
        ...state,
        meta: {},
      };
    case ActionTypes.SET_ACCEPTANCE_SENT:
      return {
        ...state,
        meta: {
          ...state.meta,
          [action.payload.address]: {
            ...state.meta[action.payload.address],
            acceptanceSent: action.payload.acceptanceSent,
          },
        },
      };
    case ActionTypes.SET_FOLLOWED:
      return {
        ...state,
        meta: {
          ...state.meta,
          [action.payload.address]: {
            ...state.meta[action.payload.address],
            followed: action.payload.followed,
            followerCount:
              state.meta[action.payload.address]?.followerCount +
              (action.payload.followed ? 1 : -1),
          },
        },
      };
    case ActionTypes.SET_BLOCKED:
      return {
        ...state,
        meta: {
          ...state.meta,
          [action.payload.address]: {
            ...state.meta[action.payload.address],
            blocked: action.payload.blocked,
          },
        },
      };
    case ActionTypes.SET_ECDH:
      return {
        ...state,
        ecdh: {
          ...state.ecdh,
          [action.payload.ecdh]: action.payload.address,
        },
      };
    case ActionTypes.SET_ID_COMMITMENT:
      return {
        ...state,
        map: {
          ...state.map,
          [action.payload.address]: {
            ...state.map[action.payload.address],
            idcommitment: action.payload.idcommitment,
          },
        },
      };
    case ActionTypes.SET_USER_ADDRESS:
      return reduceSetUserAddress(state, action);
    default:
      return state;
  }
}

function reduceSetUserAddress(
  state: State,
  action: Action<{ ens: string; address: string }>
): State {
  if (!action.payload) return state;

  const user = state.map[action.payload.address];

  return {
    ...state,
    map: {
      ...state.map,
      [action.payload.address]: {
        ...user,
        ens: action.payload.ens,
        username: action.payload.address,
        address: action.payload.address,
      },
    },
  };
}

function reduceSetUser(state: State, action: Action<User>): State {
  if (!action.payload) return state;

  const user = state.map[action.payload.username];

  return {
    ...state,
    map: {
      ...state.map,
      [action.payload.username]: {
        ...user,
        username: action.payload.username,
        address: action.payload.address,
        name: action.payload.name,
        ens: action.payload.ens,
        pubkey: action.payload.pubkey,
        bio: action.payload.bio,
        profileImage: action.payload.profileImage,
        twitterVerification: action.payload.twitterVerification,
        coverImage: action.payload.coverImage,
        website: action.payload.website,
        ecdh: action.payload.ecdh,
        idcommitment: action.payload.idcommitment,
        joinedAt: action.payload.joinedAt,
        joinedTx: action.payload.joinedTx,
        type: action.payload.type,
        group: action.payload.group,
      },
    },
  };
}

function reduceSetUserMeta(
  state: State,
  action: Action<{
    meta: UserMeta;
    address: string;
  }>
): State {
  if (!action.payload) return state;

  const userMeta = state.meta[action.payload.address];

  return {
    ...state,
    meta: {
      ...state.meta,
      [action.payload.address]: {
        ...userMeta,
        followerCount: action.payload.meta?.followerCount || 0,
        followingCount: action.payload.meta?.followingCount || 0,
        blockedCount: action.payload.meta?.blockedCount || 0,
        blockingCount: action.payload.meta?.blockingCount || 0,
        postingCount: action.payload.meta?.postingCount || 0,
        followed: action.payload.meta?.followed || null,
        blocked: action.payload.meta?.blocked || null,
        inviteSent: action.payload.meta?.inviteSent || null,
        acceptanceReceived: action.payload.meta?.acceptanceReceived || null,
        inviteReceived: action.payload.meta?.inviteReceived || null,
        acceptanceSent: action.payload.meta?.acceptanceSent || null,
      },
    },
  };
}
