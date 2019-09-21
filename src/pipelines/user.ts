import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import { Pipeline } from "./";
import * as Prisma from "../generated/prisma-client";
import { Limiters, onError } from "../utils";

export class UserPipeline extends Pipeline<
  SpotifyWebApi.PublicUser,
  Prisma.User,
  Prisma.UserCreateInput,
  Prisma.UserWhereUniqueInput
> {
  spotifyLoader: DataLoader<String, SpotifyWebApi.PublicUser>;
  prismaLoader: DataLoader<String, Prisma.User>;

  constructor(
    limiters: Limiters,
    prisma: Prisma.Prisma,
    spotify: SpotifyWebApi
  ) {
    super("user_id", limiters, prisma, spotify);

    this.spotifyLoader = new DataLoader(
      (ids: string[]) =>
        Promise.all(
          ids.map(async id =>
            this.limiters.spotify.schedule(
              { id: `users:get:${ids}:${Math.random().toString(16)}` },
              () =>
                this.spotify!.getUser(id)
                  .then(resp => resp.body)
                  .catch(
                    onError(`Error retrieving users from Spotify`, {
                      user_ids: ids
                    })
                  )
            )
          )
        ),
      { maxBatchSize: 1 }
    );

    this.prismaLoader = new DataLoader(
      async (ids: string[]) =>
        this.limiters.prisma.schedule(
          { id: `users:get:${ids}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .users({
                where: { user_id_in: ids }
              })
              .then(r => {
                const lookup = _.keyBy(r, "user_id");
                return ids.map(id => lookup[id]);
              })
              .catch(
                onError(`Error loading users from Prisma`, {
                  user_ids: ids
                })
              )
        ),
      { maxBatchSize: 100 }
    );
  }

  mapToPrismaInput = (spotifyVal: SpotifyWebApi.PublicUser) => {
    return {
      user_id: spotifyVal.id,
      display_name: spotifyVal.display_name
    };
  };

  upsert = (input: Prisma.UserCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      { id: `user:upsert:${input.user_id}:${Math.random().toString(16)}` },
      () =>
        this.prisma
          .upsertUser({
            where,
            update: input,
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              return this.prisma.user(where);
            } else {
              throw err;
            }
          })
    );
  };
}
