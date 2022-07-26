import EC from "elliptic";
import {RLNFullProof} from "@zk-kit/protocols";
import crypto from "crypto";
import {ZkIdentity} from "@zk-kit/identity";
import config from "./config";
import EventEmitter2, {ConstructorOptions} from "eventemitter2";
import {decrypt, encrypt} from "./encrypt";
import {base64ToArrayBuffer} from "./crypto";

export enum ChatMessageType {
    DIRECT = 'DIRECT',
    PUBLIC_ROOM = 'PUBLIC_ROOM',
    PRIVATE_ROOM = 'PRIVATE_ROOM',
}

export type DirectChatMessage = {
    messageId: string;
    timestamp: Date;
    type: ChatMessageType.DIRECT;
    sender: {
        address?: string;
        ecdh?: string;
        hash?: string;
    };
    rln?: RLNFullProof & {
        epoch: number;
        x_share: string;
    };
    receiver: string;
    ciphertext: string;
    content?: string;
    reference?: string;
    attachment?: string;
    encryptionError?: boolean;
}

export type PublicRoomChatMessage = {
    messageId: string;
    timestamp: Date;
    type: ChatMessageType.PUBLIC_ROOM;
    sender: {
        address?: string;
        ecdh?: string;
        hash?: string;
    };
    rln?: RLNFullProof & {
        epoch: number;
        x_share: string;
    };
    receiver: string;
    content: string;
    reference: string;
    attachment: string;
    encryptionError?: boolean;
}

export type ChatMessage = DirectChatMessage | PublicRoomChatMessage;

export type Chat = {
    type: 'DIRECT';
    receiver: string;
    senderECDH: string;
    senderHash?: string;
} | {
    type: 'PUBLIC_ROOM';
    receiver: string;
}

export const deriveSharedKey = (receiverPubkey: string, senderPrivateKey: string): string => {
    const ec = new EC.ec('curve25519');
    const sendKey = ec.keyFromPrivate(senderPrivateKey);
    const receiverKey = ec.keyFromPublic(receiverPubkey, 'hex');
    const shared = sendKey.derive(receiverKey.getPublic());
    return shared.toString(16);
}

const signWithP256 = (base64PrivateKey: string, data: string) => {
    const buff = base64ToArrayBuffer(base64PrivateKey);
    const hex = Buffer.from(buff).toString('hex');
    const ec = new EC.ec('p256');
    const key = ec.keyFromPrivate(hex);
    const msgHash = Buffer.from(data, 'utf-8').toString('hex');
    const signature = key.sign(msgHash);
    return Buffer.from(signature.toDER()).toString('hex');
}

type createMessageBundleOptions = {
    type: 'DIRECT',
        sender: {
        address?: string;
        ecdh?: string;
        hash?: string;
    };
    timestamp?: Date;
    pubkey?: string;
    receiver: string;
    ciphertext?: string;
    rln?: RLNFullProof & {
        epoch: number;
        x_share: string;
    };
} | {
    type: 'PUBLIC_ROOM',
        sender: {
        address?: string;
        ecdh?: string;
        hash?: string;
    };
    timestamp?: Date;
    pubkey?: string;
    receiver: string;
    content?: string;
    reference?: string;
    attachment?: string;
    rln?: RLNFullProof & {
        epoch: number;
        x_share: string;
    };
}

export const createMessageBundle = async (options: createMessageBundleOptions) => {
    if (options.type === 'DIRECT') {
        const chat: ChatMessage = {
            messageId: '',
            type: ChatMessageType.DIRECT,
            timestamp: options.timestamp || new Date(),
            sender: options.sender,
            receiver: options.receiver,
            rln: options.rln,
            ciphertext: options.ciphertext || '',
        };
        const messageId = await deriveMessageId(chat);
        return {
            ...chat,
            messageId,
            timestamp: chat.timestamp.getTime(),
        };
    }

    return null;
}

export const deriveMessageId = async (chatMessage: ChatMessage): Promise<string> => {
    let data = '';
    data += chatMessage.type;
    data += chatMessage.timestamp.getTime();
    data += chatMessage.sender;

    if (chatMessage.rln) {
        data += JSON.stringify(chatMessage.rln)
    } else if (chatMessage.sender.address) {
        data += chatMessage.sender.address || '';
    } else if (chatMessage.sender.ecdh) {
        data += chatMessage.sender.ecdh || '';
        data += chatMessage.sender.hash || '';
    }

    data += chatMessage.receiver;

    if (chatMessage.type === 'DIRECT') {
        data += chatMessage.ciphertext;
    }

    if (chatMessage.type === 'PUBLIC_ROOM') {
        data += chatMessage.content;
        data += chatMessage.reference;
        data += chatMessage.attachment;
    }

    return crypto.createHash('sha256').update(data).digest('hex');
}

type ZKChatIdentity = {
    address: string;
    ecdh: { pub: string, priv: string };
    zk: ZkIdentity;
}

export class ZKChatClient extends EventEmitter2 {
    static EVENTS = {
        MESSAGE_APPENDED: 'MESSAGE_APPENED',
        MESSAGE_PREPENDED: 'MESSAGE_PREPENDED',
        CHAT_CREATED: 'CHAT_CREATED',
    };

    activeChats: Chat[];
    dms: {
        [receiver: string]: string[];
    };
    messages: {
        [messageId: string]: ChatMessage & {
            decrypted: boolean;
        };
    };
    identity?: ZKChatIdentity
    api: string;
    lsPrefix: string;

    constructor(options: ConstructorOptions & {
        identity?: ZKChatIdentity
        api?: string,
        lsPrefix?: string,
    }) {
        super(options);
        this.activeChats = [];
        this.messages = {};
        this.dms = {};
        this.identity = options.identity;
        this.lsPrefix = options.lsPrefix || 'zkchat_ls_';
        this.api = options.api || 'http://localhost:8081';
    }

    private _ensureIdentity() {
        if (!this.identity) throw new Error('no identity');
    }

    private _save() {
        this._ensureIdentity();
        const address = this.identity!.address;
        const rawData = JSON.stringify({
            activeChats: this.activeChats,
        });
        localStorage.setItem(this.lsPrefix + address, rawData);
    }

    private _load() {
        this._ensureIdentity();
        const address = this.identity!.address;
        const rawData = localStorage.getItem(this.lsPrefix + address);

        let bucket;

        try {
            bucket = rawData ? JSON.parse(rawData) : {
                activeChats: [],
            };
        } catch (e) {
            console.error(e);
            bucket = {
                activeChats: [],
            };
        }

        this.messages = {};
        this.dms = {};
        this.activeChats = bucket.activeChats;
    }

    importIdentity(identity: ZKChatIdentity) {
        this.identity = identity;
        this._load();
    }

    createDM = (receiver: string, isAnon?: boolean): Chat => {
        this._ensureIdentity();
        const chat: Chat = {
            type: 'DIRECT',
            receiver,
            senderECDH: this.identity!.ecdh.pub,
        };

        if (isAnon) {
            const token = crypto.randomBytes(16).toString('hex');
            const senderHash = signWithP256(this.identity!.ecdh.priv, receiver + token);
            chat.senderHash = senderHash;
        }

        this.appendActiveChats(chat);

        return chat;
    }

    appendActiveChats = (chat: Chat) => {
        const exist = this.activeChats.find((data) => {
            if (data.type === 'DIRECT') {
                return chat.type === data.type
                    && chat.receiver === data.receiver
                    && chat.senderECDH === data.senderECDH
                    && chat.senderHash === data.senderHash;
            }

            if (data.type === 'PUBLIC_ROOM') {
                return chat.type === data.type
                    && chat.receiver === data.receiver;
            }
        })

        if (!exist) {
            this.activeChats.push(chat);
            this.emit(ZKChatClient.EVENTS.CHAT_CREATED, chat);
            this._save();
        }
    }

    insertMessage = (message: ChatMessage) => {
        this.messages[message.messageId] = {
            ...message,
            decrypted: message.type === 'DIRECT' && !!message.ciphertext && !message.content,
        };
    }

    fetchMessagesByChat = async (chat: Chat): Promise<ChatMessage[]> => {
        this._ensureIdentity();
        const messages: ChatMessage[] = [];

        if (chat.type === 'DIRECT') {
            this.dms[chat.receiver] = this.dms[chat.receiver] || [];
            const order = this.dms[chat.receiver];
            const last = order[order.length - 1];
            const offset = last ? this.messages[last].timestamp.getTime() : Date.now();
            const url = `${this.api}/chat-messages/dm/${chat.receiver}/${this.identity!.address}`;
            const resp = await fetch(`${url}?offset=${offset}`);
            const json = await resp.json();

            for (const data of json.payload) {
                let content = '';
                let error = false;

                try {
                    if (data.ciphertext) {
                        const sk = deriveSharedKey(chat.senderECDH, this.identity!.ecdh.priv);
                        content = decrypt(data.ciphertext, sk);4
                        error = !content;
                    }
                } catch (e) {
                    error = true;
                }

                const message: ChatMessage = {
                    messageId: data.message_id,
                    ciphertext: data.ciphertext,
                    content: content,
                    timestamp: new Date(Number(data.timestamp)),
                    receiver: data.receiver_address,
                    sender: data.sender_address,
                    type: data.type,
                    encryptionError: error,
                };

                if (!this.messages[data.message_id]) {
                    this.insertMessage(message);
                    this.dms[chat.receiver] = [...(this.dms[chat.receiver] || []), data.message_id];
                    this.emit(ZKChatClient.EVENTS.MESSAGE_APPENDED, message);
                    messages.push(message);
                }

            }
        }

        return messages;
    }

    getMessage = (messageId: string): ChatMessage => {
        return this.messages[messageId];
    }

    fetchActiveChats = async (address: string): Promise<Chat[]> => {
        const resp = await fetch(`${this.api}/chats/dm/${address}`);
        const json = await resp.json();

        if (!json.error) {
            for (const chat of json.payload) {
                this.appendActiveChats(chat);
            }
            return json.payload;
        } else {
            throw new Error(json.payload);
        }
    }

    sendDirectMessage = async (chat: Chat, content: string, headerOptions?: {[key: string]: string}) => {
        this._ensureIdentity();
        if (chat.type !== 'DIRECT') return;
        const ecdh = chat.senderECDH;
        const sharedKey = deriveSharedKey(ecdh, this.identity!.ecdh.priv);
        const ciphertext = await encrypt(content, sharedKey);
        const bundle = await createMessageBundle({
            type: 'DIRECT',
            receiver: chat.receiver,
            ciphertext,
            sender: {
                address: this.identity!.address,
            },
        });

        const res = await fetch(`${config.indexerAPI}/v1/zkchat/chat-messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headerOptions,
            },
            body: JSON.stringify(bundle),
        });
        const json = await res.json();

        if (json.error) {
            throw new Error(json.payload);
        }

        const message: ChatMessage = {
            type: ChatMessageType.DIRECT,
            messageId: json.payload.message_id,
            timestamp: new Date(Number(json.payload.timestamp)),
            content,
            ciphertext: json.payload.ciphertext,
            receiver: json.payload.receiver_address,
            sender: json.payload.sender_address,
        };

        const order = this.dms[chat.receiver] || [];
        this.dms[chat.receiver] = [json.payload.message_id, ...order];
        this.insertMessage(message);
        this.emit(ZKChatClient.EVENTS.MESSAGE_PREPENDED, message);

        return json;
    }

}
