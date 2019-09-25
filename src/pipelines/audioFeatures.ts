import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import * as Prisma from "../generated/prisma-client";

import { Pipeline, ImagePipeline } from "./";
import { Limiters, onError } from "../utils";
import { GenrePipeline } from "./genre";

export class AudioFeaturesPipeline extends Pipeline<
  SpotifyWebApi.AudioFeatures,
  Prisma.AudioFeatures,
  Prisma.AudioFeaturesCreateInput,
  Prisma.AudioFeaturesWhereUniqueInput
> {
  spotifyLoader: DataLoader<String, SpotifyWebApi.AudioFeatures>;
  prismaLoader: DataLoader<String, Prisma.AudioFeatures>;

  constructor(
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("uri", limiters, prisma, spotify);

    this.spotifyLoader = new DataLoader(
      (uris: string[]) => {
        const ids = uris.map(uri => uri.replace("spotify:track:", ""));
        return this.limiters.spotify.schedule(
          { id: `audioFeatures:get:${ids}:${Math.random().toString(16)}` },
          () =>
            this.spotify!.getAudioFeaturesForTracks(ids)
              .then(resp => {
                const lookup = _.keyBy(resp.body["audio_features"], "id");
                return ids.map(id => lookup[id]);
              })
              .catch(
                onError(`Error retrieving audio features from Spotify`, {
                  track_ids: ids
                })
              )
        );
      },
      { maxBatchSize: 100 }
    );

    this.prismaLoader = new DataLoader(
      (uris: string[]) =>
        this.limiters.prisma.schedule(
          { id: `audioFeatures:get:${uris}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .audioFeatureses({
                where: { uri_in: uris }
              })
              .then(r => {
                const lookup = _.keyBy(r, this.prismaKey);
                return uris.map(id => lookup[id]);
              })
        ),
      { maxBatchSize: 100 }
    );
  }

  mapToPrismaInput = async (
    spotifyAudioFeatures: SpotifyWebApi.AudioFeatures
  ) => {
    return this.keyLoader
      .load(_.pick(spotifyAudioFeatures, "key", "mode"))
      .then((key: Prisma.Key) => {
        return {
          track: {
            connect: { track_id: spotifyAudioFeatures.id }
          },
          key: key
            ? {
                connect: _.pick(key, "id")
              }
            : undefined,
          ..._.omit(
            spotifyAudioFeatures,
            "id",
            "key",
            "mode",
            "analysis_url",
            "track_href",
            "type"
          )
        };
      });
  };

  upsert = (input: Prisma.AudioFeaturesCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      {
        id: `audioFeatures:upsert:${input.uri}:${Math.random().toString(16)}`
      },
      () =>
        this.prisma
          .upsertAudioFeatures({
            where,
            update: input,
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              const found = this.prisma.audioFeatures(where);
              if (found) {
                return found;
              } else {
                throw err;
              }
            } else {
              throw err;
            }
          })
    );
  };
}
