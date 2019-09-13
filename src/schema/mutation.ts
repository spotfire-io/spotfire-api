import { prismaObjectType } from "nexus-prisma";

import { loadPlaylistTracks } from "./mutation/loadPlaylistTracks";
import { startPlaylistOptimization } from "./mutation/startPlaylistOptimization";
import { completePlaylistOptimization } from "./mutation/completePlaylistOptimization";

export const Mutation = prismaObjectType({
  name: "Mutation",
  definition: t => {
    t.prismaFields(["createSolverStatusUpdate"]);
    t.field("loadPlaylistTracks", loadPlaylistTracks);
    t.field("completePlaylistOptimization", completePlaylistOptimization);
    t.field("startPlaylistOptimization", startPlaylistOptimization);
  }
});
