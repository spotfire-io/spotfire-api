import { prismaObjectType } from "nexus-prisma";

import loadPlaylistTracks from "./mutation/loadPlaylistTracks";
import optimizePlaylist from "./mutation/optimizePlaylist";

export const Mutation = prismaObjectType({
  name: "Mutation",
  definition: t => {
    t.field("optimizePlaylist", optimizePlaylist);
    t.field("loadPlaylistTracks", loadPlaylistTracks);
  }
});
