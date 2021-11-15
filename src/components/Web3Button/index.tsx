import React, {ReactElement, ReactNode, useCallback, useEffect, useState} from "react";
import "./web3-btn.scss";
import Button from "../Button";
import {
    setWeb3,
    connectWeb3,
    useAccount,
    useWeb3Loading,
    useENSName,
    useGunKey,
    useLoggedIn,
    useWeb3Unlocking,
    useENSFetching,
    setGunPrivateKey,
    loginGun, genSemaphore, setSemaphoreID, useSemaphoreID, setSemaphoreIDPath, useGunNonce, UserNotExistError,
} from "../../ducks/web3";
import {useDispatch} from "react-redux";
import classNames from "classnames";
import Avatar from "../Avatar";
import Icon from "../Icon";
import Menuable, {ItemProps} from "../Menuable";
import TwitterLogoSVG from "../../../static/icons/twitter.svg";
import RedditLogoSVG from "../../../static/icons/reddit.svg";
import GithubLogoPNG from "../../../static/icons/github.png";
import SpinnerGIF from "../../../static/icons/spinner.gif";
import gun, {authenticateGun} from "../../util/gun";
import {useHistory} from "react-router";
import {ellipsify, getHandle, getName} from "../../util/user";
import {useHasIdConnected, useIdentities, useSelectedLocalId, useWorkerUnlocked} from "../../ducks/worker";
import LoginModal from "../LoginModal";
import {fetchNameByAddress} from "../../util/web3";
import {useUser} from "../../ducks/users";
import {selectIdentity, setIdentity} from "../../serviceWorkers/util";
import {postWorkerMessage} from "../../util/sw";
import {Identity} from "../../serviceWorkers/identity";

type Props = {
    onConnect?: () => Promise<void>;
    onDisconnect?: () => Promise<void>|void;
    onClick?: () => Promise<void>;
    className?: string;
}

export default function Web3Button(props: Props): ReactElement {
    const account = useAccount();
    const web3Loading = useWeb3Loading();
    const semaphoreId = useSemaphoreID();
    const dispatch = useDispatch();
    const selectedLocalId = useSelectedLocalId();
    const [ensName, setEnsName] = useState('');

    useEffect(() => {
        (async () => {
            if (!account) return;
            setEnsName('');
            const ens = await fetchNameByAddress(account);
            setEnsName(ens);
        })();
    }, [account]);

    const disconnect = useCallback(async () => {
        await dispatch(setWeb3(null, ''));
        return props.onDisconnect && props.onDisconnect();
    }, []);

    let btnContent;

    if (semaphoreId.keypair.privKey) {
        btnContent = (
            <>
                <div>Incognito</div>
                <Avatar className="ml-2" incognito />
            </>
        )
    } else if (ensName) {
        btnContent = (
            <>
                <div>{ensName}</div>
                <Avatar className="ml-2 w-6 h-6" name={ensName} />
            </>
        )
    } else if (selectedLocalId) {
        btnContent = (
            <>
                <div>{ellipsify(selectedLocalId.address)}</div>
                <Avatar className="ml-2 w-6 h-6" address={selectedLocalId.address} />
            </>
        )
    } else if (account) {
        btnContent = (
            <>
                <div>{ellipsify(account)}</div>
                <Avatar className="ml-2 w-6 h-6" address={account} />
            </>
        )
    } else {
        btnContent = (
            <>
                <div>Connect to a wallet</div>
            </>
        )
    }

    return (
        <div
            className={classNames(
                "flex flex-row flex-nowrap items-center",
                "rounded-xl bg-gray-100",
                props.className,
            )}
        >
            <Web3ButtonLeft {...props} />
            <Button
                className={classNames(
                    'text-black',
                    'bg-white',
                    'font-inter',
                    {
                        'text-gray-100 bg-gray-800': semaphoreId.keypair.privKey,
                    }
                )}
                onClick={props.onClick}
                disabled={web3Loading}
                loading={web3Loading}
            >
                {btnContent}
            </Button>
        </div>
    )
}

function Web3ButtonLeft(props: Props): ReactElement {
    const web3Loading = useWeb3Loading();
    const gunPair = useGunKey();
    const loggedIn = useLoggedIn();
    const account = useAccount();
    const dispatch = useDispatch();
    const [opened, setOpened] = useState(false);

    const lock = useCallback(async () => {
        gun.user().leave();
        await dispatch(setSemaphoreID({
            keypair: {
                pubKey: '',
                privKey: null,
            },
            commitment: null,
            identityNullifier: null,
            identityTrapdoor: null,
        }))
        await dispatch(setGunPrivateKey(''));
        await dispatch(setSemaphoreIDPath(null));
        setOpened(false);
    }, []);


    if (!loggedIn) {
        return (
            <UnauthButton
                {...props}
                opened={opened}
                setOpened={setOpened}
            />
        );
    }

    if (loggedIn || !gunPair.joinedTx) {
        return (
            <UserMenuable
                opened={opened}
                setOpened={setOpened}
            >
                <Icon
                    className={classNames(
                        "text-gray-500 hover:text-gray-800",
                        "transition-colors",
                    )}
                    fa="fas fa-ellipsis-h"
                />
            </UserMenuable>
        );
    }

    return <></>;
}


function UserMenuable(props: {
    onConnect?: () => Promise<void>;
    opened: boolean;
    setOpened: (opened: boolean) => void;
    children: ReactNode;
}): ReactElement {
    const { opened, setOpened } = props;
    const account = useAccount();
    const gunNonce = useGunNonce();
    const web3Loading = useWeb3Loading();
    const gunPair = useGunKey();
    const dispatch = useDispatch();
    const history = useHistory();
    const selectedLocalId = useSelectedLocalId();
    const hasIdConnected = useHasIdConnected();
    const identities = useIdentities();

    const connectWallet = useCallback(async () => {
        await dispatch(connectWeb3());
        return props.onConnect && props.onConnect();
    }, []);

    const genGunKey = useCallback(async (e, reset) => {
        try {
            await dispatch(loginGun(gunNonce));
            reset();
        } catch (e) {
            if (e === UserNotExistError) {
                await gotoSignup();
            }
        }
    }, [gunNonce]);

    const gotoSignup = useCallback(async () => {
        history.push('/signup');
        setOpened(false);
    }, []);

    const unlockSemaphore = useCallback(async (
        web2Provider: 'Twitter' | 'Github' | 'Reddit',
    ) => {
        await dispatch(genSemaphore(web2Provider));
    }, []);

    const logout = useCallback(async () => {
        // @ts-ignore
        if (gun.user().is) {
            gun.user().leave();
        }

        await dispatch(setSemaphoreID({
            keypair: {
                pubKey: '',
                privKey: null,
            },
            commitment: null,
            identityNullifier: null,
            identityTrapdoor: null,
        }))
        await dispatch(setGunPrivateKey(''));
        await dispatch(setSemaphoreIDPath(null));
        await postWorkerMessage(setIdentity(null));
    }, []);

    let items: ItemProps[] = [];

    if (identities.length) {
        items.push({
            label: '',
            className: 'local-users-menu',
            component: (
                <UserMenu
                    setOpened={setOpened}
                />
            )
        });
    }

    if (account && !hasIdConnected) {
        const children = [
            {
                label: 'Wallet',
                iconFA: 'fas fa-wallet',
                onClick: !gunPair.joinedTx ? gotoSignup : genGunKey,
                disabled: web3Loading,
            },
            {
                label: 'Incognito (Beta)',
                iconFA: 'fas fa-user-secret',
                disabled: web3Loading,
                children: [
                    {
                        label: 'Twitter',
                        iconUrl: TwitterLogoSVG,
                        onClick: () => unlockSemaphore('Twitter'),
                    },
                    {
                        label: 'Github',
                        iconUrl: GithubLogoPNG,
                        onClick: () => unlockSemaphore('Github'),
                    },
                    {
                        label: 'Reddit',
                        iconUrl: RedditLogoSVG,
                        onClick: () => unlockSemaphore('Reddit'),
                    },
                ],
            }
        ];

        if (identities.length) {
            items.push({
                label: 'Add new identity',
                iconFA: 'fas fa-plus',
                disabled: web3Loading,
                children: children,
            });
        } else {
            items = items.concat(children);
        }
    } else if (!account) {
        items.push({
            label: 'Connect to wallet',
            iconFA: 'fas fa-plug',
            onClick: connectWallet,
            disabled: web3Loading,
        })
    }

    if (selectedLocalId) {
        items.push({
            label: 'Logout',
            iconFA: 'fas fa-sign-out-alt',
            onClick: logout,
        })
    }

    if (!account && !selectedLocalId) {
        return (
            <div
                className={classNames(
                    "flex flex-row flex-nowrap items-center",
                    "web3-button__alt-action",
                )}
                onClick={connectWallet}
            >
                {
                    !web3Loading && (
                        <Icon
                            className={classNames(
                                "hover:text-green-500 transition-colors",
                            )}
                            fa="fas fa-plug"
                        />
                    )
                }
            </div>
        )
    }

    return (
        <>
            <Menuable
                menuClassName="web3-button__unlock-menu"
                onOpen={() => setOpened(true)}
                onClose={() => setOpened(false)}
                opened={opened}
                items={items}
            >
                <div
                    className={classNames(
                        "flex flex-row flex-nowrap items-center",
                        "web3-button__alt-action",
                    )}
                >
                    { props.children }
                </div>
            </Menuable>
        </>
    );
}

function UserMenu(props: {
    setOpened: (opened: boolean) => void;
}): ReactElement {
    const identities = useIdentities();
    const selectedLocalId = useSelectedLocalId();
    const unlocked = useWorkerUnlocked();
    const [showingLogin, setShowingLogin] = useState(false);
    const [publicKey, setPublicKey] = useState('');
    const selectedUser = useUser(selectedLocalId?.address);
    const dispatch = useDispatch();

    const openLogin = useCallback(async (pubkey: string) => {
        if (unlocked) {
            await postWorkerMessage(selectIdentity(pubkey));
            return;
        }
        setShowingLogin(true);
        setPublicKey(pubkey);
    }, [unlocked]);

    const onClose = useCallback(async () => {
        setShowingLogin(false);
        setPublicKey('');
    }, [publicKey]);

    const onSuccess = useCallback(async () => {
        const id: any = await postWorkerMessage(selectIdentity(publicKey));
        if (id) {
            authenticateGun({
                pub: id.publicKey,
                priv: id.privateKey,
            });
        }
    }, [publicKey]);

    const availableIds = identities.filter(id => {
        return id.publicKey !== selectedLocalId?.publicKey;
    })

    return (
        <>
            { showingLogin && <LoginModal onClose={onClose} onSuccess={onSuccess} /> }
            <div className="flex flex-col flex-nowrap w-full">
                {
                    selectedLocalId && (
                        <div
                            className={classNames(
                                "local-users-menu__selected-item border-b mb-2"
                            )}
                        >
                            <Avatar className="w-20 h-20 mb-2" address={selectedUser?.address} />
                            <div className="flex flex-col flex-nowrap items-center">
                                <div className="text-base font-bold">{getName(selectedUser)}</div>
                                <div className="text-sm">@{getHandle(selectedUser)}</div>
                            </div>
                        </div>
                    )
                }
                {
                    !!availableIds.length && (
                        <div className="border-b w-full pb-2 mb-2 local-users-menu__container">
                            {
                                availableIds.map(id => {
                                    return (
                                        <UserMenuItem
                                            key={id.publicKey}
                                            identity={id}
                                            openLogin={() => openLogin(id.publicKey)}
                                        />
                                    );
                                })
                            }
                        </div>
                    )
                }
            </div>
        </>
    )
};

function UserMenuItem(props: {
    identity: Identity;
    openLogin: () => void;
}) {
    const {identity, openLogin} = props;
    const user = useUser(identity.address);

    return (
        <div
            className={classNames(
                "flex flex-row flex-nowrap items-center",
                "hover:bg-gray-50 cursor-pointer",
                "local-users-menu__item"
            )}
            onClick={openLogin}
        >
            <Avatar className="w-9 h-9 mr-2" address={user?.username} />
            <div className="flex flex-col flex-nowrap">
                <div className="text-sm font-bold">{getName(user)}</div>
                <div className="text-xs">@{getHandle(user)}</div>
            </div>
        </div>
    );
}

function UnauthButton(props: {
    onConnect?: () => Promise<void>;
    opened: boolean;
    setOpened: (opened: boolean) => void;
}): ReactElement {
    const { opened, setOpened } = props;
    const account = useAccount();
    const web3Loading = useWeb3Loading();
    const web3Unlocking = useWeb3Unlocking();
    const dispatch = useDispatch();
    const selectedLocalId = useSelectedLocalId();

    const connectWallet = useCallback(async () => {
        await dispatch(connectWeb3());
        return props.onConnect && props.onConnect();
    }, []);

    if (!account && !selectedLocalId) {
        return (
            <div
                className={classNames(
                    "flex flex-row flex-nowrap items-center",
                    "web3-button__alt-action",
                )}
                onClick={connectWallet}
            >
                {
                    !web3Loading && (
                        <Icon
                            className={classNames(
                                "hover:text-green-500 transition-colors",
                            )}
                            fa="fas fa-plug"
                        />
                    )
                }
            </div>
        )
    }

    return (
        <UserMenuable
            opened={opened}
            setOpened={setOpened}
        >
            {
                web3Unlocking
                    ? <Icon url={SpinnerGIF} size={2} />
                    : (
                        <Icon
                            className={classNames(
                                "hover:text-green-500 transition-colors",
                                {
                                    "text-green-500": opened,
                                }
                            )}
                            fa={classNames({
                                "fas fa-unlock": opened,
                                "fas fa-lock": !opened,
                            })}
                        />
                    )
            }
        </UserMenuable>
    );
}