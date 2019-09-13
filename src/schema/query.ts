import { prismaObjectType } from "nexus-prisma";
import { stringArg, booleanArg, subscriptionField } from "nexus/dist";
import { Context, getSpotifyIfExists, getPipelinesIfExists } from "../utils";
import _ from "lodash";
import { PlaylistDetails } from "../fragments/PlaylistDetails";

const transformPlaylistResults = async (results: any[]) => {
  return results.map(async p => {
    const result = {
      ..._.pick(
        p,
        "id",
        "description",
        "name",
        "uri",
        "href",
        "images",
        "public",
        "collaborative"
      ),
      latest_snapshot_id: p.snapshot_id,
      owner: {
        ..._.pick(p.owner, "display_name", "id", "href", "uri")
      }
    };
    return result;
  });
};

const playlistUrlPattern = /[:\/]playlist(s)?[:\/]([^/?\:]+)/;

subscriptionField;

export const Query = prismaObjectType({
  name: "Query",
  definition: t => {
    t.prismaFields([
      // "playlists",
      "albums",
      "album",
      "artist",
      "artists",
      "genre",
      "genres",
      "key",
      "keys",
      "optimizationJob",
      "optimizationJobs",
      // "playlistSnapshot",
      "track",
      "tracks",
      "playlistsConnection"
    ]);
    t.field("playlists", {
      type: "Playlist",
      list: true,
      args: {
        query: stringArg({
          description: "Search query or URI of playlist",
          nullable: true
        })
      },
      resolve: async (root, { query }, ctx: Context) => {
        const spotify = getSpotifyIfExists(ctx);
        const pipelines = getPipelinesIfExists(ctx);
        let playlists: any[];
        if (!query) {
          const me = await spotify.getMe().then(resp => resp.body);
          playlists = await spotify
            .getUserPlaylists(me.id)
            .then(resp => resp.body.items);
        } else {
          const urlMatch = query.match(playlistUrlPattern);
          if (urlMatch) {
            const playlistId = urlMatch[2];
            playlists = [
              await pipelines.playlist.spotifyLoader.load(playlistId)
            ];
          } else {
            playlists = await spotify
              .searchPlaylists(query)
              .then(resp => resp.body.playlists.items);
          }
        }
        return transformPlaylistResults(playlists);
      }
    });
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
        }),
        upsert: booleanArg({
          description:
            "Upsert the playlist if it doesn't exist in the database",
          default: true
        })
      },
      resolve: async (root, { uri, id, upsert }, ctx: Context) => {
        const spotify = getSpotifyIfExists(ctx);
        const pipelines = getPipelinesIfExists(ctx);
        if (!id) {
          if (!uri) {
            throw Error("Must provide URI or playlist ID");
          } else {
            const match = uri.match(playlistUrlPattern);
            if (match) {
              id = match[2];
            }
          }
        }
        if (!id) {
          throw new Error("Could not find an ID for playlist");
        } else {
          if (upsert) {
            const { playlist: pipeline } = getPipelinesIfExists(ctx);
            const playlist = await pipeline.spotifyLoader.load(id);
            if (playlist) {
              if (upsert) {
                await pipeline.mapToPrismaInput(playlist).then(pipeline.upsert);
              }
            } else {
              throw new Error(
                `Could not find playlist by id ${id} on Spotifys`
              );
            }
          }

          const result = await ctx.prisma
            .playlist({ playlist_id: id })
            .$fragment(PlaylistDetails);
          if (result) {
            return result;
          } else {
            throw new Error(`Could not retrieve playlist for is ${id}`);
          }
        }
      }
    });
  }
});
