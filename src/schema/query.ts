import { prismaObjectType } from "nexus-prisma";
import { stringArg } from "nexus/dist";
import { Context } from "../utils";
import { PlaylistPipeline } from "./playlist";

export const Query = prismaObjectType({
  name: "Query",
  definition: t => {
    t.field("playlist", {
      type: "Playlist",
      args: {
        uri: stringArg({
          description: "The URL or URI of a playlist",
          nullable: true
        }),
        id: stringArg({
          description: "The playlist ID",
          nullable: true
        })
      },
      resolve: async (root, { uri, id }, { spotify, prisma }: Context) => {
        if (!id) {
          if (!uri) {
            throw Error("Must provide URI or playlist ID");
          } else {
            const match = uri.match(
              /user[:\/]([^:\/]*)[:\/]playlist[:\/](\w*)(\?si=(\w+))?/
            );
            if (match) {
              id = match[2];
            }
          }
        }
        if (!id) {
          throw new Error("Could not find an ID for playlist");
        } else {
          const pipeline = new PlaylistPipeline();
          return await pipeline
            .fetch(spotify, id)
            .then(pipeline.mapToPrisma)
            .then(p => pipeline.saveToPrisma(prisma, p));
        }
      }
    });
  }
});
