import SpotifyWebApi from "spotify-web-api-node";
import * as Prisma from "../generated/prisma-client";
import _ from "lodash";
import DataLoader from "dataloader";

import { Pipeline, UserPipeline, ImagePipeline } from "./";
import { Limiters, onError } from "../utils";

export class PlaylistPipeline extends Pipeline<
  SpotifyWebApi.Playlist,
  Prisma.Playlist,
  Prisma.PlaylistCreateInput,
  Prisma.PlaylistWhereUniqueInput
> {
  imagePipeline: ImagePipeline;
  userPipeline: UserPipeline;

  constructor(
    userPipeline: UserPipeline,
    imagePipeline: ImagePipeline,
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("playlist_id", limiters, prisma, spotify);
    this.imagePipeline = imagePipeline;
    this.userPipeline = userPipeline;
  }

  spotifyLoader = new DataLoader(
    (ids: string[]) =>
      Promise.all(
        ids.map(async id =>
          this.limiters.spotify.schedule(
            { id: `playlists:get:${ids}:${Math.random().toString(16)}` },
            () =>
              this.spotify!.getPlaylist(id)
                .then(resp => resp.body)
                .catch(
                  onError(`Error loading playlists from Spotify`, {
                    playlist_ids: ids
                  })
                )
          )
        )
      ),
    { maxBatchSize: 1 }
  );

  prismaLoader: DataLoader<string, Prisma.Playlist> = new DataLoader(
    async (ids: string[]) =>
      this.limiters.prisma.schedule(
        { id: `playlists:get:${ids}:${Math.random().toString(16)}` },
        () =>
          this.prisma.playlists({ where: { playlist_id_in: ids } }).then(r => {
            const lookup = _.keyBy(r, this.prismaKey);
            return ids.map(id => lookup[id]);
          })
      ),
    { maxBatchSize: 100 }
  );

  mapToPrismaInput = async (spotifyVal: SpotifyWebApi.Playlist) => {
    const playlist_id = spotifyVal.id;
    const snapshot_id = spotifyVal.snapshot_id;
    const snapshotExists = await this.limiters.prisma.schedule(() =>
      this.prisma.$exists
        .playlistSnapshot({
          snapshot_id
        })
        .catch(
          onError(`Error checking snapshot existence`, {
            snapshot_id
          })
        )
    );

    const snapshots: Prisma.PlaylistSnapshotCreateManyWithoutPlaylistInput = snapshotExists
      ? {
          connect: [{ snapshot_id }]
        }
      : {
          create: [
            {
              snapshot_id: spotifyVal.snapshot_id,
              track_count: spotifyVal.tracks.total
            }
          ]
        };

    const input: Prisma.PlaylistCreateInput = {
      playlist_id,
      snapshots,
      latest_snapshot_id: snapshot_id,
      images: {
        connect: await this.imagePipeline
          .upsertAndConnectMany(spotifyVal.images)
          .catch(
            onError(`Error upserting images for snapshot`, {
              snapshot_id
            })
          )
      },
      owner: {
        connect: await this.userPipeline
          .upsertAndConnect(spotifyVal.owner.id)
          .catch(
            onError(`Error upserting playlist owner`, {
              user_id: spotifyVal.owner.id
            })
          )
      },
      ..._.pick(
        spotifyVal,
        "description",
        "name",
        "uri",
        "href",
        "public",
        "collaborative"
      )
    };

    return input;
  };

  upsert = (input: Prisma.PlaylistCreateInput) =>
    this.limiters.prisma.schedule(
      { id: `playlist:get:${input.playlist_id}:${Math.random().toString(16)}` },
      () =>
        this.prisma.upsertPlaylist({
          where: this.whereUnique(input),
          create: input,
          update: input
        })
    );
}
