import { broadcastOwnBubble, ensureDmRoom, sendTextMessage } from "@/entities/chat";
import { listMembers } from "@/entities/team";
import { isLocalDummy } from "./localDummies";

export interface TeamLineResult {
  delivered: number;
  missed: string[];
  /** True when every recipient was a local dummy, so nothing left this machine. */
  localOnly: boolean;
}

function memberLabel(
  profile: { display_name: string | null; email: string | null } | null | undefined,
  id: string,
): string {
  const name = profile?.display_name?.trim() || profile?.email?.trim();
  return name || id.slice(0, 8);
}

/**
 * Fan a line out as a DM to the chosen teammates.
 * The bubble is drawn on the sender, and only after someone actually received it.
 */
export async function sendTeamLine(opts: {
  workspaceId: string;
  myId: string;
  body: string;
  profileIds: string[];
  ko?: boolean;
}): Promise<TeamLineResult> {
  const ko = opts.ko !== false;
  const picked = new Set(opts.profileIds);
  const dummyCount = [...picked].filter(isLocalDummy).length;
  const members = await listMembers(opts.workspaceId);
  const others = members.filter((member) => member.profile_id !== opts.myId && picked.has(member.profile_id));
  if (opts.profileIds.length === 0) {
    throw new Error(ko ? "받을 사람을 고르세요." : "Choose who receives this.");
  }
  if (others.length === 0 && dummyCount === 0) {
    throw new Error(ko ? "팀원이 없습니다." : "No teammates.");
  }

  let delivered = 0;
  const missed: string[] = [];
  for (const member of others) {
    const label = memberLabel(member.profile, member.profile_id);
    try {
      const room = await ensureDmRoom({
        workspaceId: opts.workspaceId,
        myId: opts.myId,
        peerId: member.profile_id,
        peerName: label,
      });
      await sendTextMessage({
        roomId: room.id,
        myId: opts.myId,
        workspaceId: opts.workspaceId,
        body: opts.body,
      });
      delivered += 1;
    } catch {
      missed.push(label);
    }
  }

  delivered += dummyCount;

  if (delivered === 0) {
    throw new Error(
      ko
        ? "팀원에게 전달되지 않았습니다. Hub가 켜져 있고 같은 네트워크인지 확인해 주세요."
        : "Nobody received it. Keep Hub open on the same network.",
    );
  }

  await broadcastOwnBubble(opts.myId, opts.body);
  return { delivered, missed, localOnly: others.length === 0 };
}
