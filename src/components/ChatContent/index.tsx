import "./chat-content.scss";
import React, {ReactElement, useState, KeyboardEvent, useCallback, useEffect} from "react";
import classNames from "classnames";
import {useParams} from "react-router";
import InfiniteScrollable from "../InfiniteScrollable";
import {useSelectedLocalId, useSelectedZKGroup} from "../../ducks/worker";
import Nickname from "../Nickname";
import Avatar, {Username} from "../Avatar";
import Textarea from "../Textarea";
import {generateECDHKeyPairFromhex, generateZkIdentityFromHex, sha256, signWithP256} from "../../util/crypto";
import {FromNow} from "../ChatMenu";
import chats, {InflatedChat, useChatId, useChatMessage, useMessagesByChatId, zkchat} from "../../ducks/chats";
import Icon from "../Icon";
import SpinnerGIF from "../../../static/icons/spinner.gif";
import {useDispatch} from "react-redux";
import {findProof} from "../../util/merkle";
import {Strategy, ZkIdentity} from "@zk-kit/identity";

export default function ChatContent(): ReactElement {
    const { chatId } = useParams<{chatId: string}>();
    const messages = useMessagesByChatId(chatId);
    const chat = useChatId(chatId);

    useEffect(() => {
        (async () => {
            if (!chat) return;
            await zkchat.fetchMessagesByChat(chat);
        })();
    }, [chat]);

    if (!chat) return <></>;

    return (
        <div
            className={classNames('chat-content', {
                'chat-content--anon': chat?.senderHash,
            })}>
            <ChatHeader />
            <InfiniteScrollable
                className="chat-content__messages"
            >
                {messages.map(messageId => {
                   return (
                       <ChatMessageBubble
                           key={messageId}
                           messageId={messageId}
                           chat={chat}
                       />
                   );
                })}
            </InfiniteScrollable>
            <ChatEditor />
        </div>
    );
}

function ChatHeader(): ReactElement {
    const { chatId } = useParams<{chatId: string}>();
    const chat = useChatId(chatId);

    return (
        <div className="chat-content__header">
            <Avatar
                className="w-10 h-10"
                address={chat?.receiver}
                incognito={!chat?.receiver}
                group={chat.type === 'DIRECT' ? chat.group : undefined}
            />
            <div className="flex flex-col flex-grow flex-shrink ml-2">
                <Nickname
                    className="font-bold"
                    address={chat?.receiver}
                    group={chat.type === 'DIRECT' ? chat.group : undefined}
                />
                <div
                    className={classNames("text-xs", {
                        'text-gray-500': true,
                        // 'text-gray-400': chat?.senderHash,
                    })}
                >
                    {chat?.receiver && (
                        <>
                            <span>@</span>
                            <Username address={chat?.receiver || ''} />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function ChatEditor(): ReactElement {
    const { chatId } = useParams<{chatId: string}>();
    const selected = useSelectedLocalId();
    const [content, setContent] = useState('');
    const chat = useChatId(chatId);
    const [error, setError] = useState('');
    const [isSending, setSending] = useState(false);
    const dispatch = useDispatch();
    const zkGroup = useSelectedZKGroup();

    useEffect(() => {
        setContent('');
    }, [chatId]);

    const submitMessage = useCallback(async () => {
        if (!chat) return;

        let signature = '';
        let merkleProof, identitySecretHash;

        if (selected?.type === 'gun') {
            signature = signWithP256(selected.privateKey, selected.address) + '.' + selected.address;
            if (chat.senderHash) {
                const zkseed = await signWithP256(selected.privateKey, 'signing for zk identity - 0');
                const zkHex = await sha256(zkseed);
                const zkIdentity = await generateZkIdentityFromHex(zkHex);
                merkleProof = await findProof(
                    'zksocial_all',
                    zkIdentity.genIdentityCommitment().toString(16),
                );
                identitySecretHash = zkIdentity.getSecretHash();
            }
        } else if (selected?.type === 'interrep') {
            const {type, provider, name, identityCommitment, serializedIdentity} = selected;
            const group = `${type}_${provider.toLowerCase()}_${name}`;
            const zkIdentity = new ZkIdentity(Strategy.SERIALIZED, serializedIdentity);
            merkleProof = await findProof(
                group,
                BigInt(identityCommitment).toString(16),
            );
            identitySecretHash = zkIdentity.getSecretHash();
        }

        const json = await zkchat.sendDirectMessage(
            chat,
            content,
            {
                'X-SIGNED-ADDRESS': signature,
            },
            merkleProof,
            identitySecretHash,
        );


        setContent('');
    }, [content, selected, chat]);

    const onEnter = useCallback(async (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            setSending(true);
            setError('');
            try {
                await submitMessage();
            } catch (e) {
                setError(e.message);
            } finally {
                setSending(false);
            }
        }
    }, [submitMessage]);

    const onChange = useCallback(async (e: KeyboardEvent<HTMLTextAreaElement>) => {
        setContent(e.target.value);
        setError('');
    }, []);

    return (
        <div className="chat-content__editor-wrapper">
            { !!error && <small className="error-message text-xs text-center text-red-500 mb-1 mt-2">{error}</small> }
            <div className="flex flex-row w-full">
                <div className="chat-content__editor ml-2">
                    <Textarea
                        className="text-light border mr-2 my-2"
                        rows={Math.max(0, content.split('\n').length)}
                        value={content}
                        onChange={onChange}
                        onKeyPress={onEnter}
                        disabled={isSending}
                    />
                </div>
                <div className="relative flex flex-row items-center">
                    <Avatar
                        className={classNames("w-10 h-10 m-2", {
                            'opacity-50': isSending,
                        })}
                        address={selected?.address}
                        incognito={!!chat.senderHash}
                        group={zkGroup}
                    />
                    { isSending && <Icon className="chat-content__editor__loading-gif" url={SpinnerGIF} size={3}/>}
                </div>
            </div>
        </div>
    );
}

function ChatMessageBubble(props: {
    messageId: string;
    chat: InflatedChat;
}) {
    const chatMessage = useChatMessage(props.messageId);

    useEffect(() => {
        // console.log(props.chat.nickname, chatMessage.rln?.group_id);
    }, [props.chat.nickname, chatMessage])

    if (chatMessage?.type !== 'DIRECT') return <></>;

    return (
        <div
            key={chatMessage.messageId}
            className={classNames("chat-message", {
                'chat-message--self': chatMessage.sender.ecdh === props.chat.senderECDH,
                'chat-message--anon': chatMessage.sender.hash,
            })}
        >
            <div className={classNames("chat-message__content text-light", {
                'italic opacity-70': chatMessage.encryptionError,
            })}>
                {chatMessage.encryptionError ? 'Cannot decrypt message' : chatMessage.content}
            </div>
            <FromNow
                className="chat-message__time text-xs mt-2 text-gray-700"
                timestamp={chatMessage.timestamp}
            />
        </div>
    );
}

