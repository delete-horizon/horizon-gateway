export type { AvatarSnapshot, OwnedAvatar, PartSlot, UserPart } from "./api/avatarOwnership";
export {
  authorName,
  copyOfficialKit,
  copyOwnedAvatar,
  forkSlot,
  listMyAvatars,
  listMyEntitlements,
  listSharedAvatars,
  loadParts,
  officialRef,
  ownedToKit,
  parsePartRef,
  purchaseAvatar,
  pushAvatarUpdate,
  setListedForSale,
  setVisibility,
  userPartIds,
} from "./api/avatarOwnership";
export * from "./api/signaling";
export type { GlyphCh, PartChroma, StudioCatalog, StudioPalette, StudioPart, StudioSet } from "./lib/avatarGlyphs";
export {
  AVATAR_COMPOSE_H,
  AVATAR_GRID,
  blitRgba,
  composeStudioRgba,
  drawGlyphGrid,
  emptyGlyphs,
  GLYPH_CHANNELS,
  setGlyphCell,
} from "./lib/avatarGlyphs";
export type { AvatarKit, AvatarPartOption, AvatarSlot } from "./lib/avatarKit";
export {
  AVATAR_CATALOG,
  applyAvatarSet,
  DEFAULT_AVATAR_KIT,
  FRIEND_AVATAR_KIT,
  slotsFromStudioCatalog,
} from "./lib/avatarKit";
export * from "./lib/crypto";
export {
  CHAT_TYPING_EVENT,
  CHAT_UPDATED_EVENT,
  emitChatTyping,
  emitChatUpdated,
  installChatUiBridge,
} from "./lib/events";
export type { IncomingMessageCard } from "./lib/incomingMessageCard";
export { emitIncomingMessageCard, INCOMING_MESSAGE_EVENT } from "./lib/incomingMessageCard";
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
export { overlayCharactersEnabledAtom } from "./lib/overlayPrefs";
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
export {
  announceWorn,
  defaultWornRefs,
  fetchWorn,
  kitsForWorn,
  kitToRefs,
  publishWorn,
  readLocalWorn,
  refsToKit,
  setWornHandshakeHandler,
  WORN_STORAGE_KEY,
  type WornLook,
  type WornRefs,
} from "./lib/wornAvatar";
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
