import { subscriptionField, stringArg } from "nexus/dist";
import { Context } from "../utils";

export const SubscriptionPlaylistSnapshot = subscriptionField(
  "playlistSnapshot",
  {
    type: "PlaylistSnapshotSubscriptionPayload",
    args: {
      snapshot_id: stringArg({ required: true })
    },
    subscribe: (root, args, ctx: Context) => {
      return ctx.prisma.$subscribe.playlistSnapshot(args) as any;
    },
    resolve(payload) {
      return payload;
    }
  }
);
