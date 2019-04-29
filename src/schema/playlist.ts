import { prismaObjectType } from "nexus-prisma";
import { Context } from "../utils";

export const Playlist = prismaObjectType({
  name: "Playlist",
  definition: t => {
    t.prismaFields(["*"]);
    t.field("latest_snapshot", {
      type: "PlaylistSnapshot",
      nullable: true,
      resolve: async (root, args, { prisma }: Context) => {
        const snapshot_id = root.latest_snapshot_id;
        return prisma.playlistSnapshot({ snapshot_id });
      }
    });
  }
});
