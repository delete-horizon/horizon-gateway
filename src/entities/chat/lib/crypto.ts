import { commands, unwrap } from "@/shared/api";

/** Ensure local X25519 keypair; returns public key (base64). */
export async function ensureChatIdentity(): Promise<{ deviceId: string; publicKey: string }> {
  return unwrap(await commands.chatEnsureIdentity());
}

export async function deriveDmRoomKey(myUserId: string, peerUserId: string, peerPublicKey: string): Promise<string> {
  return unwrap(await commands.chatDeriveDmKey(myUserId, peerUserId, peerPublicKey));
}

export async function generateGroupRoomKey(): Promise<string> {
  return unwrap(await commands.chatGenerateRoomKey());
}

export async function wrapRoomKey(roomKey: string, peerPublicKey: string): Promise<string> {
  return unwrap(await commands.chatWrapRoomKey(roomKey, peerPublicKey));
}

export async function unwrapRoomKey(wrapped: string): Promise<string> {
  return unwrap(await commands.chatUnwrapRoomKey(wrapped));
}

export async function sealChatPayload(roomKey: string, plaintext: string): Promise<string> {
  return unwrap(await commands.chatSeal(roomKey, plaintext));
}

export async function openChatPayload(roomKey: string, ciphertext: string): Promise<string> {
  return unwrap(await commands.chatOpen(roomKey, ciphertext));
}
