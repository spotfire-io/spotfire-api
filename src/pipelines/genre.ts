import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import { Pipeline } from "./";
import * as Prisma from "../generated/prisma-client";
import { Limiters, onError } from "../utils";

export class GenrePipeline extends Pipeline<
  string,
  Prisma.Genre,
  Prisma.GenreCreateInput,
  Prisma.GenreWhereUniqueInput
> {
  spotifyLoader: undefined;
  prismaLoader: DataLoader<String, Prisma.Genre>;

  constructor(limiters: Limiters, prisma: Prisma.Prisma) {
    super("name", limiters, prisma);

    this.mapToPrismaInput.bind(this);
    this.upsert.bind(this);
    this.upsertAndConnectMany.bind(this);

    this.prismaLoader = new DataLoader(
      (names: string[]) =>
        this.limiters.prisma.schedule(
          { id: `genres:get:${names}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .genres({
                where: { name_in: names }
              })
              .then(r => {
                const lookup = _.keyBy(r, "name");
                return names.map(url => lookup[url]);
              })
        ),
      { maxBatchSize: 100 }
    );
  }

  mapToPrismaInput = (name: string) => {
    return { name };
  };

  upsert = (input: Prisma.GenreCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      { id: `genre:upsert:${input.name}:${Math.random().toString(16)}` },
      () =>
        this.prisma
          .upsertGenre({
            where: where,
            update: input,
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              return this.prisma.genre(where);
            } else {
              throw err;
            }
          })
    );
  };

  upsertAndConnectMany = async (names: string[]) => {
    return await Promise.all<Prisma.ImageWhereUniqueInput>(
      names.map(async name => {
        const cacheHit = await this.prismaLoader.load(name).catch(
          onError(`Error retrieving cached genre from Prisma`, {
            genre: name
          })
        );
        if (cacheHit) return this.whereUnique(cacheHit);
        const input = this.mapToPrismaInput(name);
        return await this.upsert(input)
          .then(this.whereUnique)
          .catch(onError(`Error upserting genre into Primsa`, { genre: name }));
      })
    );
  };
}
