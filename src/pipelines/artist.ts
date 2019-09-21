import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import * as Prisma from "../generated/prisma-client";

import { Pipeline, ImagePipeline } from "./";
import { Limiters, onError } from "../utils";
import { GenrePipeline } from "./genre";
import logger from "../logger";

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
              .catch(
                onError(`Error retrieving artists from Spotify`, {
                  artist_ids: ids
                })
              )
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
          .catch(
            onError(
              `Error upsetting and connecting artist genres into Primsa`,
              { artist_id: spotifyArtist.id, genres: spotifyArtist.genres }
            )
          )
      },
      images: {
        connect: await this.imagePipeline
          .upsertAndConnectMany(spotifyArtist.images)
          .catch(
            onError(
              `Error upsetting and connecting artist images into Primsa`,
              {
                artist_id: spotifyArtist.id,
                image_urls: spotifyArtist.images.map(i => i.url)
              }
            )
          )
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
          const prismaHit = await this.prismaLoader
            .load(id)
            .catch(
              onError(`Error retrieving artist from cache`, { artist_id: id })
            );
          if (prismaHit) return this.whereUnique(prismaHit);
          const spotifyHit = await this.spotifyLoader
            .load(id)
            .catch(
              onError(`Error retrieving artist from Spotify`, { artist_id: id })
            );
          if (spotifyHit) {
            const input = await this.mapToPrismaInput(spotifyHit).catch(
              onError(`Error mapping artist to Spotify Input`)
            );
            const artist = await this.upsert(input)
              .then(this.whereUnique)
              .catch(
                onError(`Error upserting Artist into Prisma`, { artist_id: id })
              );
          } else {
            console.warn(`Could not find artist with id ${id}`);
          }
        })
      )
    );
  };
}
