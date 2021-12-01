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
import MetamaskSVG from "../../../static/icons/metamask-fox.svg";
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
import QRScanner from "../QRScanner";
import Modal from "../Modal";
import ExportPrivateKeyModal from "../ExportPrivateKeyModal";
import config from "../../util/config";

type Props = {
    onConnect?: () => Promise<void>;
    onDisconnect?: () => Promise<void>|void;
    onClick?: () => Promise<void>;
    className?: string;
}

export default function Web3Button(props: Props): ReactElement {
    const account = useAccount();
    const web3Loading = useWeb3Loading();
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

    if (selectedLocalId?.type ===  'interrep') {
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
                    'web3-button__content',
                    {
                        'text-gray-100 bg-gray-800': selectedLocalId?.type ===  'interrep',
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
    const gunPair = useGunKey();
    const loggedIn = useLoggedIn();
    const dispatch = useDispatch();
    const selectedLocalId = useSelectedLocalId();
    const [opened, setOpened] = useState(false);

    const lock = useCallback(async () => {
        gun.user().leave();
        await dispatch(setSemaphoreID({
            commitment: null,
            identityNullifier: null,
            identityTrapdoor: null,
        }))
        await dispatch(setGunPrivateKey(''));
        await dispatch(setSemaphoreIDPath(null));
        setOpened(false);
    }, []);


    if (!selectedLocalId) {
        return (
            <UnauthButton
                {...props}
                opened={opened}
                setOpened={setOpened}
            />
        );
    }

    if (selectedLocalId) {
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
    const [showingScanner, showScanner] = useState(false);

    const connectWallet = useCallback(async () => {
        await dispatch(connectWeb3());
        return props.onConnect && props.onConnect();
    }, []);

    const genGunKey = useCallback(async (e, reset) => {
        try {
            await dispatch(loginGun(gunNonce));
            reset();
            setOpened(false);
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
        const hasPath = await dispatch(genSemaphore(web2Provider));

        if (!hasPath) {
            history.push('/onboarding/interrep');
        }

        setOpened(false);
    }, []);

    const logout = useCallback(async () => {
        // @ts-ignore
        if (gun.user().is) {
            gun.user().leave();
        }

        await dispatch(setSemaphoreID({
            commitment: null,
            identityNullifier: null,
            identityTrapdoor: null,
        }))
        await dispatch(setGunPrivateKey(''));
        await dispatch(setSemaphoreIDPath(null));
        await postWorkerMessage(setIdentity(null));
        await fetch(`${config.indexerAPI}/oauth/reset`, {
            credentials: 'include',
        });
    }, []);

    let items: ItemProps[] = [];

    if (identities.length || selectedLocalId) {
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
                    // {
                    //     label: 'Github',
                    //     iconUrl: GithubLogoPNG,
                    //     onClick: () => unlockSemaphore('Github'),
                    // },
                    // {
                    //     label: 'Reddit',
                    //     iconUrl: RedditLogoSVG,
                    //     onClick: () => unlockSemaphore('Reddit'),
                    // },
                ],
            },
            {
                label: 'QR Code',
                iconFA: 'fas fa-qrcode',
                onClick: () => showScanner(true),
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

    if (!account && !selectedLocalId && !identities.length) {
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
            {
                showingScanner && (
                    <Modal onClose={() => showScanner(false)}>
                        <QRScanner onSuccess={() => showScanner(false)} />
                    </Modal>
                )
            }
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
    const [showingExportPrivateKey, showExportPrivateKey] = useState(false);
    const [publicKey, setPublicKey] = useState('');
    const selectedUser = useUser(selectedLocalId?.address);

    const openLogin = useCallback(async (pubkey: string) => {
        if (unlocked) {
            await fetch(`${config.indexerAPI}/oauth/reset`, {
                credentials: 'include',
            });
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

    const onShowExportPrivateKey = useCallback(() => {
        showExportPrivateKey(true);
        setShowingLogin(true);
    }, []);

    const onSuccess = useCallback(async () => {
        if (showingExportPrivateKey) {
            return;
        }

        await fetch(`${config.indexerAPI}/oauth/reset`, {
            credentials: 'include',
        });

        const id: any = await postWorkerMessage(selectIdentity(publicKey));
        if (id && id.type === 'gun') {
            authenticateGun({
                pub: id.publicKey,
                priv: id.privateKey,
            });
        }
        props.setOpened(false);
    }, [publicKey, showingExportPrivateKey]);

    const availableIds = identities.filter(id => {
        if (id.type === 'gun' && selectedLocalId?.type === 'gun') {
            return id.publicKey !== selectedLocalId?.publicKey;
        }

        if (id.type === 'interrep' && selectedLocalId?.type === 'interrep') {
            return id.identityCommitment !== selectedLocalId?.identityCommitment;
        }

        return id.type !== selectedLocalId?.type;
    })

    return (
        <>
            { showingLogin && <LoginModal onClose={onClose} onSuccess={onSuccess} /> }
            { !showingLogin && showingExportPrivateKey && (
                <ExportPrivateKeyModal onClose={() => showExportPrivateKey(false)} />
            )}
            <div className="flex flex-col flex-nowrap w-full">
                <CurrentUserItem onShowExportPrivateKey={onShowExportPrivateKey} />
                {
                    !!availableIds.length && (
                        <div className="border-b w-full pb-2 mb-2 local-users-menu__container">
                            {
                                availableIds.map(id => {
                                    return (
                                        <UserMenuItem
                                            key={id.type === 'gun' ? id.publicKey : id.identityCommitment}
                                            identity={id}
                                            openLogin={() => openLogin(id.type === 'gun' ? id.publicKey : id.identityCommitment)}
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
}

function CurrentUserItem(props: {
    onShowExportPrivateKey: () => void;
}): ReactElement {
    const selectedLocalId = useSelectedLocalId();
    const selectedUser = useUser(selectedLocalId?.address);

    if (!selectedLocalId) return <></>;

    return (
        <div
            className={classNames(
                "local-users-menu__selected-item border-b mb-2",
            )}
        >
            <Avatar
                className="w-20 h-20 mb-2"
                address={selectedUser?.address}
                incognito={selectedLocalId.type === 'interrep'}
            />
            <Button
                className="my-2"
                btnType="secondary"
                onClick={props.onShowExportPrivateKey}
                small
            >
                Link Device
            </Button>
            <div className="flex flex-col flex-nowrap items-center w-full">
                <div className="text-base font-bold w-full truncate text-center">
                    {
                        selectedLocalId.type === 'interrep'
                            ? 'Incognito'
                            : getName(selectedUser)
                    }
                </div>
                <div className="text-sm">
                    {
                        selectedLocalId.type === 'interrep'
                            ? `${selectedLocalId.provider}${selectedLocalId.name ? ` (${selectedLocalId.name})` : ''}`
                            : `@${getHandle(selectedUser)}`
                    }

                </div>
            </div>
        </div>
    )
}

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
                "local-users-menu__item",
            )}
            onClick={openLogin}
        >
            <Avatar
                className="w-9 h-9 mr-2"
                address={user?.username}
                incognito={identity.type === 'interrep'}
            />
            <div className="flex flex-col flex-nowrap w-0 flex-grow">
                <div className="text-sm font-bold truncate">
                    {
                        identity.type === 'interrep'
                            ? identity.provider
                            : getName(user)
                    }
                </div>
                <div className="text-xs">
                    {
                        identity.type === 'interrep'
                            ? `${identity.name}`
                            : `@${getHandle(user)}`
                    }

                </div>
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
    const [showingScanner, showScanner] = useState(false);
    const identities = useIdentities();

    const connectWallet = useCallback(async () => {
        await dispatch(connectWeb3());
        return props.onConnect && props.onConnect();
    }, []);

    if (!account && !selectedLocalId && !identities.length) {
        return (
            <>
                {
                    showingScanner && (
                        <Modal onClose={() => showScanner(false)}>
                            <QRScanner onSuccess={() => showScanner(false)}  />
                        </Modal>
                    )
                }
                <Menuable
                    className={classNames(
                        "flex flex-row flex-nowrap items-center",
                        "web3-button__alt-action",
                    )}
                    items={[
                        {
                            label: 'Metamask',
                            iconUrl: MetamaskSVG,
                            onClick: connectWallet,
                        },
                        {
                            label: 'QR Code',
                            iconFA: 'fas fa-qrcode',
                            onClick: () => showScanner(true),
                        }
                    ]}
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
                </Menuable>
            </>
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