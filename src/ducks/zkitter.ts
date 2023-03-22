import { Zkitter, Message as ZkitterMessage, Post } from 'zkitter-js';
import { Dispatch } from 'redux';
import { useSelector } from 'react-redux';
import deepEqual from 'fast-deep-equal';
import { AppRootState } from '../store/configureAppStore';
import { safeJsonParse } from '~/misc';
import { setPost } from '@ducks/posts';

const FILTERS_LS_KEY = 'zkitter/filters';
let resolveSync: null | any = null;
const waitForSync = new Promise<Zkitter>(resolve => {
  resolveSync = resolve;
});

export enum ActionType {
  SET_CLIENT = 'zkitter-js/SET_CLIENT',
  SET_LOADING = 'zkitter-js/SET_LOADING',
  SET_FILTERS = 'zkitter-js/SET_FILTERS',
  SET_SYNC_ARBITRUM = 'zkitter-js/SET_SYNC_ARBITRUM',
}

export type Action<payload> = {
  type: ActionType;
  payload?: payload;
  meta?: any;
  error?: boolean;
};

export type State = {
  client: Zkitter | null;
  loading: boolean;
  filters: {
    groups: string[];
    users: string[];
    threads: string[];
  };
  sync: {
    arbitrum: {
      fromBlock: number;
      toBlock: number;
      latest: number;
    };
  };
};

const initialState: State = {
  client: null,
  loading: false,
  filters: {
    groups: [],
    users: [],
    threads: [],
  },
  sync: {
    arbitrum: {
      fromBlock: 0,
      toBlock: 0,
      latest: 0,
    },
  },
};

export const setSyncArbitrum = (sync: State['sync']['arbitrum']) => ({
  type: ActionType.SET_SYNC_ARBITRUM,
  payload: sync,
});

export const initZkitter = () => async (dispatch: Dispatch) => {
  const opts: any = {};

  if (process.env.NODE_ENV !== 'production') opts.topicPrefix = 'zkitter-dev';

  dispatch({
    type: ActionType.SET_LOADING,
    payload: true,
  });

  const client = await Zkitter.initialize(opts);
  const filters = getFilters();

  client.on('Users.ArbitrumSynced', data => dispatch(setSyncArbitrum(data)));

  if (process.env.NODE_ENV === 'development') {
    client.on('Group.NewGroupMemberCreated', (member, groupId) => {
      console.log(groupId + ': new group member ' + member);
    });
  }

  client.on('Zkitter.NewMessageCreated', async (msg: ZkitterMessage) => {
    switch (msg.type) {
      case 'POST':
        dispatch(setPost(msg as Post));
        break;
    }
  });

  await client.start();
  await client.downloadHistoryFromAPI();

  dispatch({
    type: ActionType.SET_LOADING,
    payload: false,
  });

  dispatch({
    type: ActionType.SET_FILTERS,
    payload: filters,
  });

  dispatch({
    type: ActionType.SET_CLIENT,
    payload: client,
  });

  resolveSync(client);
};

export const updateFilter = () => async (dispatch: Dispatch, getState: () => AppRootState) => {
  const {
    worker: { selected },
    zkitter: { client: _client },
  } = getState();
  const client = _client || (await waitForSync);

  if (selected?.type !== 'gun' || !client) {
    return;
  }

  const address = selected.address;
  await client.queryUser(address);
  const followings = await client.getFollowings(address);

  await client.updateFilter({
    address: followings.concat(address),
  });
};

export default function reducer(state = initialState, action: Action<any>) {
  switch (action.type) {
    case ActionType.SET_CLIENT:
      return {
        ...state,
        client: action.payload,
      };
    case ActionType.SET_LOADING:
      return {
        ...state,
        loading: action.payload,
      };
    case ActionType.SET_FILTERS:
      return {
        ...state,
        filters: action.payload,
      };
    case ActionType.SET_SYNC_ARBITRUM:
      return {
        ...state,
        sync: {
          ...state.sync,
          arbitrum: action.payload,
        },
      };
    default:
      return state;
  }
}

export const useZkitter = (): Zkitter | null => {
  return useSelector((state: AppRootState) => {
    return state.zkitter.client;
  }, deepEqual);
};

export const useZkitterSync = (): State['sync'] => {
  return useSelector((state: AppRootState) => {
    return state.zkitter.sync;
  }, deepEqual);
};

export const getFilters = (): {
  groups: string[];
  users: string[];
  threads: string[];
} => {
  const data = localStorage.getItem(FILTERS_LS_KEY);
  const parsed = data ? safeJsonParse(data) : {};
  return {
    groups: parsed?.groups || [],
    users: parsed?.users || [],
    threads: parsed?.threads || [],
  };
};

export const extendFilters = (options: {
  groups?: string[];
  users?: string[];
  threads?: string[];
}): {
  groups: string[];
  users: string[];
  threads: string[];
} => {
  const filters = getFilters();

  const { groups = [], users = [], threads = [] } = options;

  filters.users = [...new Set(filters.users.concat(users))];
  filters.groups = [...new Set(filters.groups.concat(groups))];
  filters.threads = [...new Set(filters.threads.concat(threads))];

  localStorage.setItem(FILTERS_LS_KEY, JSON.stringify(filters));

  return filters;
};
