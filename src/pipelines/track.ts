import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import { Pipeline, ArtistPipeline } from "./";
import * as Prisma from "../generated/prisma-client";
import { Limiters, onError } from "../utils";
import { AlbumPipeline } from "./album";

export class TrackPipeline extends Pipeline<
  SpotifyWebApi.Track,
  Prisma.Track,
  Prisma.TrackCreateInput,
  Prisma.TrackWhereUniqueInput
> {
  artistPipeline: ArtistPipeline;
  albumPipeline: AlbumPipeline;

  spotifyLoader: undefined;
  prismaLoader: DataLoader<String, Prisma.Track>;

  constructor(
    artistPipeline: ArtistPipeline,
    albumPipeline: AlbumPipeline,
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("track_id", limiters, prisma, spotify);
    this.artistPipeline = artistPipeline;
    this.albumPipeline = albumPipeline;

    this.prismaLoader = new DataLoader(
      (ids: string[]) =>
        this.limiters.prisma.schedule(
          { id: `tracks:get:${ids}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .tracks({
                where: { track_id_in: ids }
              })
              .then(r => {
                const lookup = _.keyBy(r, this.prismaKey);
                return ids.map(id => lookup[id]);
              })
        ),
      { maxBatchSize: 100 }
    );
  }

  mapToPrismaInput = async (spotifyTrack: SpotifyWebApi.Track) => {
    if (!spotifyTrack.album.id) {
      throw new Error(`No album found for track ${spotifyTrack.id}`);
    }
    return {
      track_id: spotifyTrack.id,
      album: {
        connect: await this.albumPipeline
          .upsertAndConnect(spotifyTrack.album.id)
          .catch(onError)
      },
      artists: {
        connect: await this.artistPipeline
          .upsertAndConnectMany(spotifyTrack.artists)
          .catch(onError)
      },
      ..._.pick(
        spotifyTrack,
        "uri",
        "href",
        "disc_number",
        "track_number",
        "duration_ms",
        "explicit",
        "name",
        "preview_url",
        "popularity"
      )
    };
  };

  upsert = (input: Prisma.TrackCreateInput) => {
    return this.limiters.prisma.schedule(
      { id: `track:upsert:${input.track_id}:${Math.random().toString(16)}` },
      () =>
        this.prisma
          .upsertTrack({
            where: this.whereUnique(input),
            update: input,
            create: input
          })
          .catch(onError)
    );
  };
}
