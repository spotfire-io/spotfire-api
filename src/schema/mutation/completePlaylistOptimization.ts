import { FieldOutConfig, stringArg } from "nexus/dist/core";
import { Context } from "../../utils";
import _ from "lodash";
import Bottleneck from "bottleneck";
import { AuthenticationError } from "apollo-server-core";
import { loadPlaylistTracks } from "./loadPlaylistTracks";
import logger from "../../logger";

export const completePlaylistOptimization: FieldOutConfig<
  "Mutation",
  "completePlaylistOptimization"
> = {
  type: "Playlist",
  args: {
    jobId: stringArg({
      description: "The name for the playlist",
      nullable: false
    }),
    trackIds: stringArg({
      description: "Spotify Track IDs in playlist order",
      nullable: false,
      list: true
    })
  },
  resolve: async (
    root,
    { jobId, trackIds },
    { prisma, spotify, pipelines, limiters },
    ctx: Context
  ) => {
    if (spotify == null) {
      throw new AuthenticationError("Must authenticate with Spotify");
    }
    if (pipelines == null) {
      throw new Error("Pipelines not defined");
    }

    const spotifyUser = await spotify.getMe().then(r => r.body);
    const spotifyUserId = spotifyUser.id;
    const job = await prisma.optimizationJob({ id: jobId });
    if (!job) {
      throw Error(`Job ${jobId} not found`);
    }
    const playlistName = job.playlist_name;

    console.log(
      `Saving optimized playlist for job ${jobId} with name '${playlistName}'`
    );

    const optimizedPlaylist = await spotify
      .createPlaylist(spotifyUserId, playlistName)
      .then(async ({ body }) => {
        const playlistId = body.id;

        await Promise.all(
          _.chain(trackIds)
            .chunk(25)
            .map((trackIds: string[]) =>
              limiters.spotify.schedule(() => {
                console.log(
                  `Adding ${trackIds.length} tracks to playlist '${playlistName} (${playlistId})'`
                );
                return spotify
                  .addTracksToPlaylist(
                    playlistId,
                    trackIds.map(id => `spotify:track:${id}`)
                  )
                  .catch(e => {
                    logger.error(
                      "An error occurred adding tracks to playlist",
                      e
                    );
                  });
              })
            )
            .value()
        ).catch(e => logger.error("An error occurred", e));

        return body;
      });

    if (!loadPlaylistTracks.resolve) {
      throw new Error("Could not find resolver for loadPlaylistTracks");
    }

    const playlist = await loadPlaylistTracks.resolve!!(
      {},
      {
        playlist_id: optimizedPlaylist.id,
        snapshot_id: optimizedPlaylist.snapshot_id
      },
      ctx,
      undefined
    );

    prisma.updateOptimizationJob({
      where: { id: jobId },
      data: {
        status: "SAVED",
        new_playlist_snapshot: {
          connect: { snapshot_id: playlist.latest_snapshot_id }
        },
        end: new Date()
      }
    });

    return playlist;
  }
};
