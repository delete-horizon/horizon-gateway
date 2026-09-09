export type ChatRoomKind = "dm" | "group";

export type ChatMessageKind = "text" | "system" | "action";

export type ChatConnState = "idle" | "lan_try" | "tunnel_try" | "online" | "offline";

export interface ChatSendResult {
  state: ChatConnState | string;
  via: "lan" | "tunnel" | "none" | string;
}

export type CommActionKind =
  | "poke"
  | "sparkle"
  | "ping"
  | "float"
  | "burst"
  | "wave"
  | "coffee_ask"
  | "coffee_give"
  | "fly";

export interface ChatRoom {
  id: string;
  workspaceId: string;
  kind: ChatRoomKind;
  name: string | null;
  /** Sorted profile ids for DM; members for group. */
  memberIds: string[];
  hostProfileId: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  lastPreview: string | null;
  unread: number;
}

export type ChatWireFrameKind = "text" | "system" | "action" | "typing" | "reaction" | "ack";

export interface ChatReaction {
  emoji: string;
  senderIds: string[];
}

export interface ChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  kind: ChatMessageKind;
  body: string;
  /** Action payload when kind === "action". */
  actionKind?: CommActionKind;
  createdAt: string;
  /** True when still waiting for local peer/host delivery. */
  pending?: boolean;
  /** True when delivered acknowledgment has been received from peer. */
  delivered?: boolean;
  /** Emoji reactions on this message. */
  reactions?: ChatReaction[];
}

export interface ChatPeerEndpoint {
  profileId: string;
  deviceId: string;
  lanHosts: string[];
  lanPort: number;
  tunnelUrl: string | null;
  x25519Public: string;
  updatedAt: string;
  isHost?: boolean;
}

export interface ChatOutboxItem {
  id: string;
  roomId: string;
  peerProfileId: string | null;
  frameJson: string;
  createdAt: string;
}
