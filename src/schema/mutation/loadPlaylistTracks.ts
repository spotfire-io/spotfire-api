import { stringArg } from "nexus/dist";
import { NexusOutputFieldConfig } from "nexus/dist/core";
import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";

import { Context, onError } from "../../utils";
import * as Prisma from "../../generated/prisma-client";
import logger from "../../logger";

import { PlaylistSnapshotUpdateInput } from "../../generated/prisma-client";

require("dotenv-flow").config();

export const loadPlaylistTracks: NexusOutputFieldConfig<
  "Mutation",
  "loadPlaylistTracks"
> = {
  args: {
    playlist_id: stringArg({
      description: "The playlist ID",
      nullable: false
    }),
    snapshot_id: stringArg({
      description: "The playlist snapshot ID",
      nullable: true
    })
  },
  type: "Playlist",
  resolve: async (
    root,
    { playlist_id, snapshot_id: snapshot_idArg },
    { prisma, spotify, pipelines, limiters }: Context
  ) => {
    if (!spotify) {
      throw new Error("Spotify not authorized");
    }
    if (!pipelines) {
      throw new Error("Pipelines not defined");
    }
    const { track: trackPipeline, playlist: playlistPipeline } = pipelines;
    const spotifyPlaylist = await playlistPipeline.spotifyLoader.load(
      playlist_id
    );
    if (!spotifyPlaylist) {
      throw new Error("Error fetching playlist");
    }
    const playlist = await playlistPipeline
      .mapToPrismaInput(spotifyPlaylist)
      .then(playlistPipeline.upsert);

    if (snapshot_idArg && snapshot_idArg != playlist.latest_snapshot_id) {
      throw new Error(
        `Latest playlist snapshot ID '${playlist.latest_snapshot_id}' does not match provided snapshot ID '${snapshot_idArg}'`
      );
    }

    const snapshot_id = playlist.latest_snapshot_id;

    const snapshot = await limiters.prisma.schedule(() =>
      prisma.updatePlaylistSnapshot({
        where: { snapshot_id },
        data: { status: "LOADING" }
      })
    );

    if (!snapshot) {
      throw new Error(`Cannot find playlist snapshot ${snapshot_id}`);
    }

    const { track_count } = snapshot;
    const pageSize = 100;
    let loadedCount = 0;

    const updatePlaylistSnapshotLoaded = _.throttle(
      async (
        prisma: Prisma.Prisma,
        playlist_id: string,
        snapshot_id: string,
        tracksLoaded: number,
        trackCount: number
      ) => {
        const data: PlaylistSnapshotUpdateInput = {
          loaded_tracks: tracksLoaded,
          status: tracksLoaded >= trackCount ? "LOADED" : "LOADING"
        };
        logger.info("Updating playlist snapshot", {
          ...data,
          snapshot_id,
          playlist_id
        });
        return await prisma.updatePlaylistSnapshot({
          where: { snapshot_id },
          data
        });
      },
      500
    );

    if (snapshot.status == "INITIALIZED" || snapshot.status == "LOADING") {
      // clear existing tracks in case there's overlap
      await limiters.prisma.schedule(() =>
        prisma.deleteManyPlaylistTracks({
          snapshot: { snapshot_id }
        })
      );
      for (
        let offset = 0;
        offset < Math.ceil(track_count / pageSize) * pageSize;
        offset += pageSize
      ) {
        const { body } = await limiters.spotify.schedule(
          {
            id: `playlistTracks:get:${playlist_id}:${offset}:${Math.random().toString(
              16
            )}`
          },
          () =>
            spotify
              .getPlaylistTracks(playlist_id, {
                limit: pageSize,
                offset
              })
              .catch(
                onError(`Error getting playlist tracks for playlist`, {
                  playlist,
                  limit: pageSize,
                  offset
                })
              )
        );
        await Promise.all(
          body.items.map(
            async (item: SpotifyWebApi.PlaylistTrack, trackIndex) => {
              const spotifyTrack = item.track;
              try {
                const input = await trackPipeline.mapToPrismaInput(
                  spotifyTrack
                );
                const order = offset + trackIndex + 1;
                await trackPipeline
                  .upsert(input)
                  .then(async track => {
                    logger.info("Adding playlist track", {
                      track_name: track.name,
                      order,
                      track_count
                    });
                    const ptInput: Prisma.PlaylistTrackCreateInput = {
                      snapshot: { connect: { snapshot_id } },
                      track: { connect: { id: track.id } },
                      order,
                      ..._.pick(item, "is_local", "added_at")
                    };
                    // Note: songs added by spotify don't specified a user id in the added_by field
                    const addedByUserId = _.get(item, "added_by.id", "spotify");
                    if (addedByUserId) {
                      ptInput.added_by = {
                        connect: await pipelines.user
                          .upsertAndConnect(addedByUserId)
                          .catch(
                            onError(
                              `Error upserting playlist track added by user`,
                              { user_id: addedByUserId }
                            )
                          )
                      };
                    }
                    return await limiters.prisma
                      .schedule(
                        {
                          id: `playlistTrack:create:${playlist_id}:${order}:${Math.random().toString(
                            16
                          )}`
                        },
                        () => prisma.createPlaylistTrack(ptInput).track()
                      )
                      .catch(
                        onError(
                          `Error creating playlist track in Prisma`,
                          ptInput
                        )
                      );
                  })
                  .then(async track => {
                    await pipelines.audioFeatures
                      .upsertAndConnect(track.id)
                      .catch(
                        onError(`Error getting audio features`, {
                          track_id: track.id
                        })
                      );
                    return track;
                  })
                  .then(() =>
                    updatePlaylistSnapshotLoaded(
                      prisma,
                      playlist_id,
                      snapshot_id,
                      ++loadedCount,
                      snapshot.track_count
                    )
                  )
                  .catch(
                    onError("Error updating playlist snapshot status", {
                      playlist_id,
                      snapshot_id,
                      loaded_count: loadedCount
                    })
                  );
              } catch (error) {
                logger.error("Error occurred loading playlist track", {
                  spotify_track_id: spotifyTrack.id,
                  track_name: spotifyTrack.name,
                  error
                });
                throw error;
              }
            }
          )
        );
      }
    }
    logger.info("Completed loading playlist", {
      playlist_id,
      snapshot_id
    });
    return limiters.prisma.schedule(async () => {
      const result = await prisma.playlist({ playlist_id });
      if (result) {
        return result;
      } else {
        throw new Error(`Could not retrieve playlist ${playlist_id}`);
      }
    });
  }
};

export default loadPlaylistTracks;
