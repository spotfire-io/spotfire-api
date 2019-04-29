import { prismaObjectType } from "nexus-prisma";
import { stringArg } from "nexus/dist";
import { Context } from "../utils";

export const Query = prismaObjectType({
  name: "Query",
  definition: t => {
    t.prismaFields([
      "playlists",
      "albums",
      "album",
      "artist",
      "artists",
      "genre",
      "genres",
      "key",
      "keys",
      "playlistSnapshot",
      "track",
      "tracks"
    ]);
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
      resolve: async (root, { uri, id }, ctx: Context) => {
        const { spotify, prisma, pipelines } = ctx;
        if (!spotify) {
          throw new Error("Not authorized for Spotify");
        }
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
        } else if (!pipelines) {
          throw new Error("Pipelines not defined");
        } else {
          const pipeline = pipelines.playlist;
          if (!pipeline) {
            throw new Error("Playlist pipeline not defined");
          }
          const playlist = await pipeline.spotifyLoader.load(id);
          if (playlist) {
            const upserted = await pipeline
              .mapToPrismaInput(playlist)
              .then(pipeline.upsert);
            return prisma.playlist({ playlist_id: id });
          } else {
            throw new Error(`Could not find playlist by id ${id}`);
          }
        }
      }
    });
  }
});
