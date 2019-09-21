import { prismaObjectType } from "nexus-prisma";
import { stringArg, booleanArg, subscriptionField, intArg } from "nexus/dist";
import { Context, getSpotifyIfExists, getPipelinesIfExists } from "../utils";
import _ from "lodash";
import {
  Prisma,
  PlaylistSnapshot,
  FragmentableArray
} from "../generated/prisma-client";
import { PlaylistDetails } from "../fragments/PlaylistDetails";
import { gql } from "apollo-server-core";
import { PlaylistSnapshotStatus } from "../fragments/PlaylistSnapshotStatus";

const transformPlaylistResults = async (results: any[], prisma: Prisma) => {
  const snapshotIds = results.map(p => p.snapshot_id);

  const snapshots = await prisma
    .playlistSnapshots({
      where: { snapshot_id_in: snapshotIds }
    })
    .$fragment<FragmentableArray<PlaylistSnapshot>>(PlaylistSnapshotStatus);

  const statusLookup = _.keyBy(snapshots, "snapshot_id");

  return results.map(async p => {
    const snapshotId = p.snapshot_id;
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
      latest_snapshot_id: snapshotId,
      latest_snapshot: statusLookup[snapshotId] || {
        id: snapshotId,
        status: "NOT_LOADED",
        track_count: p.tracks.total,
        loaded_tracks: 0
      },
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
      "playlistSnapshot",
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
        }),
        limit: intArg({
          description: "Number of search results returned",
          nullable: true,
          default: 50
        })
      },
      resolve: async (root, { query, limit }, ctx: Context) => {
        const spotify = getSpotifyIfExists(ctx);
        const pipelines = getPipelinesIfExists(ctx);
        let playlists: any[];
        if (!query) {
          const userId =
            _.get(ctx, "user.spotifyUserId") ||
            (await spotify.getMe().then(resp => resp.body.id));
          playlists = await spotify
            .getUserPlaylists(userId, { limit: limit })
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
              .searchPlaylists(query, { limit: limit })
              .then(resp => resp.body.playlists.items);
          }
        }
        return transformPlaylistResults(playlists, ctx.prisma);
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
