import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import * as Prisma from "../generated/prisma-client";

import { Pipeline, ImagePipeline } from "./";
import { Limiters, onError } from "../utils";
import { GenrePipeline } from "./genre";

export class ArtistPipeline extends Pipeline<
  SpotifyWebApi.Artist,
  Prisma.Artist,
  Prisma.ArtistCreateInput,
  Prisma.ArtistWhereUniqueInput
> {
  imagePipeline: ImagePipeline;
  genrePipeline: GenrePipeline;

  spotifyLoader: DataLoader<String, SpotifyWebApi.Artist>;
  prismaLoader: DataLoader<String, Prisma.Artist>;

  constructor(
    imagePipeline: ImagePipeline,
    genrePipeline: GenrePipeline,
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("artist_id", limiters, prisma, spotify);
    this.imagePipeline = imagePipeline;
    this.genrePipeline = genrePipeline;

    this.spotifyLoader = new DataLoader(
      (ids: string[]) =>
        this.limiters.spotify.schedule(
          { id: `artists:get:${ids}:${Math.random().toString(16)}` },
          () =>
            this.spotify!.getArtists(ids)
              .then(resp => {
                const lookup = _.keyBy(resp.body.artists, "id");
                return ids.map(id => lookup[id]);
              })
              .catch(onError)
        ),
      { maxBatchSize: 50 }
    );

    this.prismaLoader = new DataLoader(
      (ids: string[]) =>
        this.limiters.prisma.schedule(
          { id: `artists:get:${ids}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .artists({
                where: { artist_id_in: ids }
              })
              .then(r => {
                const lookup = _.keyBy(r, this.prismaKey);
                return ids.map(id => lookup[id]);
              })
        ),
      { maxBatchSize: 100 }
    );
  }

  mapToPrismaInput = async (spotifyArtist: SpotifyWebApi.Artist) => {
    const input = {
      artist_id: spotifyArtist.id,
      follower_count: spotifyArtist.followers.total,
      genres: {
        connect: await this.genrePipeline
          .upsertAndConnectMany(spotifyArtist.genres)
          .catch(onError)
      },
      images: {
        connect: await this.imagePipeline
          .upsertAndConnectMany(spotifyArtist.images)
          .catch(onError)
      },
      ..._.pick(spotifyArtist, "name", "uri", "href", "popularity")
    };
    return input;
  };

  upsert = (input: Prisma.ArtistCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      {
        id: `artist:upsert:${input.artist_id}:${Math.random().toString(16)}`
      },
      () =>
        this.prisma
          .upsertArtist({
            where,
            update: input,
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              return this.prisma.artist(where);
            } else {
              throw err;
            }
          })
    );
  };

  upsertAndConnectMany = async (
    spotifyArtists: SpotifyWebApi.SimplifiedArtist[]
  ) => {
    return _.compact(
      await Promise.all<Prisma.ArtistWhereUniqueInput | undefined>(
        spotifyArtists.map(async ({ id }) => {
          const prismaHit = await this.prismaLoader.load(id).catch(onError);
          if (prismaHit) return this.whereUnique(prismaHit);
          const spotifyHit = await this.spotifyLoader.load(id).catch(onError);
          if (spotifyHit) {
            const input = await this.mapToPrismaInput(spotifyHit).catch(
              onError
            );
            const artist = await this.upsert(input).catch(onError);
            return this.whereUnique(artist);
          } else {
            console.warn(`Could not find artist with id ${id}`);
          }
        })
      )
    );
  };
}
