export * from "./api/signaling";
export * from "./lib/crypto";
export {
  CHAT_TYPING_EVENT,
  CHAT_UPDATED_EVENT,
  emitChatTyping,
  emitChatUpdated,
  installChatUiBridge,
} from "./lib/events";
export {
  appendLocalMessage,
  bumpUnread,
  dmRoomId,
  enqueueOutbox,
  getLocalRoom,
  listLocalMessages,
  listLocalRooms,
  listOutbox,
  markMessageDelivered,
  markRoomRead,
  removeOutbox,
  toggleReaction,
  updateLocalMessage,
  upsertLocalRoom,
} from "./lib/localStore";
export { ensureChatNotificationPermission, notifyIncomingChat } from "./lib/notify";
export type { InviteMembersResult } from "./lib/service";
export {
  announcePresence,
  bootstrapChatIdentity,
  createGroupRoom,
  ensureDmRoom,
  flushOutbox,
  getPeerPresence,
  handleIncomingFrame,
  inviteMembersToGroupRoom,
  loadInbox,
  loadMessages,
  refreshPeers,
  sendAction,
  sendReaction,
  sendTextMessage,
  sendTypingSignal,
  syncRemoteRooms,
} from "./lib/service";
export * from "./lib/transport";
export type {
  ChatConnState,
  ChatMessage,
  ChatMessageKind,
  ChatOutboxItem,
  ChatPeerEndpoint,
  ChatReaction,
  ChatRoom,
  ChatRoomKind,
  ChatWireFrameKind,
  CommActionKind,
} from "./types";
