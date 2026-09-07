import { supabase } from "@/shared/api/supabase";
import type { ChatPeerEndpoint, ChatRoomKind } from "../types";

export interface DeviceKeyRow {
  profile_id: string;
  device_id: string;
  x25519_public: string;
  updated_at: string;
}

export interface ChatRoomMetaRow {
  id: string;
  workspace_id: string;
  kind: ChatRoomKind;
  name: string | null;
  host_profile_id: string | null;
  member_ids: string[];
  created_at: string;
}

export interface PeerSessionRow {
  workspace_id: string;
  profile_id: string;
  device_id: string;
  lan_hosts: string[];
  lan_port: number;
  tunnel_url: string | null;
  is_host: boolean;
  updated_at: string;
}

export async function upsertDeviceKey(row: {
  profileId: string;
  deviceId: string;
  x25519Public: string;
}): Promise<void> {
  const { error } = await supabase.from("device_keys").upsert(
    {
      profile_id: row.profileId,
      device_id: row.deviceId,
      x25519_public: row.x25519Public,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,device_id" },
  );
  if (error) {
    throw error;
  }
}

export async function listDeviceKeys(profileIds: string[]): Promise<DeviceKeyRow[]> {
  if (profileIds.length === 0) {
    return [];
  }
  const { data, error } = await supabase.from("device_keys").select("*").in("profile_id", profileIds);
  if (error) {
    throw error;
  }
  return (data ?? []) as DeviceKeyRow[];
}

export async function upsertPeerSession(row: {
  workspaceId: string;
  profileId: string;
  deviceId: string;
  lanHosts: string[];
  lanPort: number;
  tunnelUrl: string | null;
  isHost: boolean;
}): Promise<void> {
  const { error } = await supabase.from("peer_sessions").upsert(
    {
      workspace_id: row.workspaceId,
      profile_id: row.profileId,
      device_id: row.deviceId,
      lan_hosts: row.lanHosts,
      lan_port: row.lanPort,
      tunnel_url: row.tunnelUrl,
      is_host: row.isHost,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,profile_id,device_id" },
  );
  if (error) {
    throw error;
  }
}

export async function listPeerSessions(workspaceId: string): Promise<PeerSessionRow[]> {
  const { data, error } = await supabase.from("peer_sessions").select("*").eq("workspace_id", workspaceId);
  if (error) {
    throw error;
  }
  return (data ?? []) as PeerSessionRow[];
}

export async function upsertChatRoomMeta(row: {
  id: string;
  workspaceId: string;
  kind: ChatRoomKind;
  name: string | null;
  hostProfileId: string | null;
  memberIds: string[];
}): Promise<void> {
  const { error } = await supabase.from("chat_rooms").upsert({
    id: row.id,
    workspace_id: row.workspaceId,
    kind: row.kind,
    name: row.name,
    host_profile_id: row.hostProfileId,
    member_ids: row.memberIds,
    created_at: new Date().toISOString(),
  });
  if (error) {
    throw error;
  }
}

export async function listChatRoomMeta(workspaceId: string): Promise<ChatRoomMetaRow[]> {
  const { data, error } = await supabase.from("chat_rooms").select("*").eq("workspace_id", workspaceId);
  if (error) {
    throw error;
  }
  return (data ?? []) as ChatRoomMetaRow[];
}

export function peerSessionToEndpoint(row: PeerSessionRow, pub: string | undefined): ChatPeerEndpoint | null {
  if (!pub) {
    return null;
  }
  return {
    profileId: row.profile_id,
    deviceId: row.device_id,
    lanHosts: row.lan_hosts ?? [],
    lanPort: row.lan_port,
    tunnelUrl: row.tunnel_url,
    x25519Public: pub,
    updatedAt: row.updated_at,
    isHost: row.is_host,
  };
}
