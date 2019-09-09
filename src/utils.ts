import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";
import Bottleneck from "bottleneck";
import logger from "./logger";

import { Prisma } from "./generated/prisma-client";
import {
  AlbumPipeline,
  ArtistPipeline,
  AudioFeaturesPipeline,
  ImagePipeline,
  PlaylistPipeline,
  TrackPipeline,
  UserPipeline
} from "./pipelines";
import { GenrePipeline } from "./pipelines/genre";

export interface Limiters {
  spotify: Bottleneck;
  prisma: Bottleneck;
}

export const limiters: Limiters = {
  spotify: new Bottleneck({
    maxConcurrent: 8,
    minTime: 100
  }),
  prisma: new Bottleneck({
    maxConcurrent: 8,
    minTime: 10
  })
};

Object.keys(limiters).forEach(name => {
  const limiter = limiters[name];
  limiter.on("error", err =>
    console.error(`Error making ${name} request`, err)
  );
  limiter.on("failed", (err, jobInfo) =>
    console.error(`Retrying ${name} request: ${jobInfo}`, err)
  );
  // limiter.on("debug", (message, data) => {
  //   if (message.startsWith("Executing")) {
  //     console.log(`Limiter ${name} message: ${message}`);
  //   } else {
  //     void 0;
  //   }
  // });
});

export const onError = (err: Error) => {
  console.error("A Spotify error occurred", err);
  throw err;
};

export interface Pipelines {
  album: AlbumPipeline;
  artist: ArtistPipeline;
  audioFeatures: AudioFeaturesPipeline;
  genre: GenrePipeline;
  image: ImagePipeline;
  playlist: PlaylistPipeline;
  track: TrackPipeline;
  user: UserPipeline;
}

export const getPipelines = (
  prisma: Prisma,
  spotify?: SpotifyWebApi
): Pipelines => {
  const audioFeatures = new AudioFeaturesPipeline(limiters, prisma, spotify!);
  const genre = new GenrePipeline(limiters, prisma);
  const image = new ImagePipeline(limiters, prisma);
  const user = new UserPipeline(limiters, prisma, spotify!);
  const artist = new ArtistPipeline(image, genre, limiters, prisma, spotify!);
  const album = new AlbumPipeline(
    image,
    artist,
    genre,
    limiters,
    prisma,
    spotify!
  );
  const track = new TrackPipeline(artist, album, limiters, prisma, spotify!);
  const playlist = new PlaylistPipeline(
    user,
    image,
    limiters,
    prisma,
    spotify!
  );

  return {
    album,
    artist,
    audioFeatures,
    genre,
    image,
    playlist,
    track,
    user
  };
};

export interface Context {
  spotify?: SpotifyWebApi;
  pipelines?: Pipelines;
  prisma: Prisma;
  limiters: Limiters;
}

export const getSpotifyIfExists = (ctx: Context): SpotifyWebApi => {
  if (!ctx.spotify) {
    throw new Error("Missing Spotify credentials");
  } else {
    return ctx.spotify;
  }
};

export const getPipelinesIfExists = (ctx: Context): Pipelines => {
  if (!ctx.pipelines) {
    throw new Error("Missing Pipeline configurations");
  } else {
    return ctx.pipelines;
  }
};
