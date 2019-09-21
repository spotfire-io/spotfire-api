import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import * as Prisma from "../generated/prisma-client";

import { Pipeline, ImagePipeline } from "./";
import { Limiters, onError } from "../utils";
import { GenrePipeline } from "./genre";

export class AudioAnalysisPipeline extends Pipeline<
  SpotifyWebApi.AudioAnalysis,
  Prisma.AudioAnalysis,
  Prisma.AudioAnalysisCreateInput,
  Prisma.AudioAnalysisWhereUniqueInput
> {
  spotifyLoader: DataLoader<String, SpotifyWebApi.AudioAnalysis>;
  prismaLoader: DataLoader<String, Prisma.AudioAnalysis>;

  constructor(
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("uri", limiters, prisma, spotify);

    this.spotifyLoader = new DataLoader(
      (uris: string[]) => {
        const ids = uris.map(uri => uri.replace("spotify:track:", ""));
        return Promise.all(
          ids.map(id =>
            this.limiters.spotify.schedule(
              { id: `audioAnalysis:get:${ids}:${Math.random().toString(16)}` },
              () =>
                this.spotify!.getAudioAnalysisForTrack(id)
                  .then(resp => {
                    const lookup = _.keyBy(resp.body["audio_analysus"], "id");
                    return ids.map(id => lookup[id]);
                  })
                  .catch(
                    onError(`Error retrieving audio analysis from Spotify`, {
                      track_id: id
                    })
                  )
            )
          )
        );
      },
      { maxBatchSize: 1 }
    );

    this.prismaLoader = new DataLoader(
      (uris: string[]) =>
        this.limiters.prisma.schedule(
          { id: `audioAnalysis:get:${uris}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .audioAnalyses({
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
    spotifyAudioAnalysis: SpotifyWebApi.AudioAnalysis
  ) => {
    const input = {
      mode: <Prisma.Mode>(spotifyAudioAnalysis.mode ? "MAJOR" : "MINOR"),
      track: {
        connect: { track_id: spotifyAudioAnalysis.id }
      },
      root_note: spotifyAudioAnalysis.key,
      ..._.omit(
        spotifyAudioAnalysis,
        "id",
        "key",
        "mode",
        "analysis_url",
        "track_href",
        "type"
      )
    };
    return input;
  };

  upsert = (input: Prisma.AudioAnalysisCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      {
        id: `audioAnalysis:upsert:${input.uri}:${Math.random().toString(16)}`
      },
      () =>
        this.prisma
          .upsertAudioAnalysis({
            where,
            update: input,
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              return this.prisma.audioAnalysis(where);
            } else {
              throw err;
            }
          })
    );
  };
}
