import { prismaObjectType } from "nexus-prisma";
import { Context } from "../utils";
import { intArg } from "nexus/dist";
import DataLoader from "dataloader";

export const Playlist = prismaObjectType({
  name: "Playlist",
  definition: t => {
    t.prismaFields({ filter: ["playlist_id"] });
    t.string("id", {
      resolve: root => root.playlist_id || root.id
    });
    t.field("latest_snapshot", {
      type: "PlaylistSnapshot",
      nullable: true,
      resolve: async (root, args, { prisma }: Context) => {
        const snapshot_id = root.latest_snapshot_id;
        const found =
          root.latest_snapshot ||
          (await prisma.playlistSnapshot({ snapshot_id }));
        return found || { snapshot_id, id: snapshot_id, status: "NOT_LOADED" };
      }
    });
    t.field("image", {
      type: "Image",
      nullable: true,
      args: {
        size: intArg({ required: true })
      },
      resolve: (root, args) => {
        if (!root.images) return null;
        const filtered = root.images.filter(i => i.width == args.size);
        return filtered.length > 0 ? filtered[0] : root.images[0];
      }
    });
    t.field("images", {
      type: "Image",
      list: true,
      resolve: (root, args) => root.images || []
    });
    t.field("owner", {
      type: "User",
      resolve: root => root.owner
    });
    ["created_at", "updated_at"].forEach(f => {
      t.string(f, { nullable: true });
    });
  }
});
