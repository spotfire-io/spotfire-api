import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import * as Prisma from "../generated/prisma-client";

import { Pipeline, ImagePipeline } from "./";
import { Limiters, onError } from "../utils";
import { ArtistPipeline } from "./artist";
import { GenrePipeline } from "./genre";

export class AlbumPipeline extends Pipeline<
  SpotifyWebApi.Album,
  Prisma.Album,
  Prisma.AlbumCreateInput,
  Prisma.AlbumWhereUniqueInput
> {
  imagePipeline: ImagePipeline;
  artistPipeline: ArtistPipeline;
  genrePipeline: GenrePipeline;

  spotifyLoader: DataLoader<String, SpotifyWebApi.Album>;
  prismaLoader: DataLoader<String, Prisma.Album>;

  constructor(
    imagePipeline: ImagePipeline,
    artistPipeline: ArtistPipeline,
    genrePipeline: GenrePipeline,
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("album_id", limiters, prisma, spotify);
    this.imagePipeline = imagePipeline;
    this.artistPipeline = artistPipeline;
    this.genrePipeline = genrePipeline;

    this.spotifyLoader = new DataLoader(
      (ids: string[]) =>
        limiters.spotify.schedule(
          { id: `albums:get:${ids}:${Math.random().toString(16)}` },
          () =>
            spotify!
              .getAlbums(ids)
              .then(resp => {
                const lookup = _.keyBy(resp.body.albums, "id");
                return ids.map(id => lookup[id]);
              })
              .catch(
                onError(`Error retrieving albums from Spotify`, {
                  album_ids: ids
                })
              )
        ),
      { maxBatchSize: 20 }
    );

    this.prismaLoader = new DataLoader(
      (ids: string[]) =>
        limiters.prisma.schedule(
          { id: `albums:get:${ids}:${Math.random().toString(16)}` },
          () =>
            prisma
              .albums({
                where: { album_id_in: ids }
              })
              .then(r => {
                const lookup = _.keyBy(r, "album_id");
                return ids.map(id => lookup[id]);
              })
        ),
      { maxBatchSize: 10 }
    );
  }

  mapToPrismaInput = async (spotifyAlbum: SpotifyWebApi.Album) => {
    const input = {
      album_id: spotifyAlbum.id,
      album_type: spotifyAlbum.album_type
        ? <Prisma.AlbumType>spotifyAlbum.album_type.toUpperCase()
        : undefined,
      release_date: spotifyAlbum.release_date,
      release_date_precision: spotifyAlbum.release_date_precision
        ? <Prisma.ReleaseDatePrecision>(
            spotifyAlbum.release_date_precision.toUpperCase()
          )
        : undefined,
      artists: {
        connect: await this.artistPipeline
          .upsertAndConnectMany(spotifyAlbum.artists)
          .catch(
            onError(`Error upserting and connecting artists`, {
              artist_ids: spotifyAlbum.artists.map(a => a.id)
            })
          )
      },
      genres: {
        connect: await this.genrePipeline
          .upsertAndConnectMany(spotifyAlbum.genres)
          .catch(
            onError(`Error upserting and connecting genres`, {
              genres: spotifyAlbum.genres
            })
          )
      },
      images: {
        connect: await this.imagePipeline
          .upsertAndConnectMany(spotifyAlbum.images)
          .catch(
            onError(`Error upserting and connecting images`, {
              image_urls: spotifyAlbum.images.map(i => i.url)
            })
          )
      },
      ..._.pick(spotifyAlbum, "uri", "href", "label", "name", "popularity")
    };
    return input;
  };

  upsert = (input: Prisma.AlbumCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      { id: `album:upsert:${input.album_id}:${Math.random().toString(16)}` },
      () =>
        this.prisma
          .upsertAlbum({
            where,
            update: _.omit(input, this.prismaKey),
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              return this.prisma.album(where);
            } else {
              throw err;
            }
          })
    );
  };
}
