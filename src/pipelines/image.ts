import _ from "lodash";
import DataLoader from "dataloader";
import SpotifyWebApi from "spotify-web-api-node";

import { Pipeline } from "./";
import * as Prisma from "../generated/prisma-client";
import { Limiters, onError } from "../utils";
import { randomBytes } from "crypto";

export class ImagePipeline extends Pipeline<
  SpotifyWebApi.Image,
  Prisma.Image,
  Prisma.ImageCreateInput,
  Prisma.ImageWhereUniqueInput
> {
  spotifyLoader: undefined;
  prismaLoader: DataLoader<String, Prisma.Image>;

  constructor(limiters: Limiters, prisma: Prisma.Prisma) {
    super("url", limiters, prisma);

    this.mapToPrismaInput.bind(this);
    this.upsert.bind(this);
    this.upsertAndConnectMany.bind(this);

    this.prismaLoader = new DataLoader(
      (urls: string[]) =>
        this.limiters.prisma.schedule(
          { id: `images:get:${urls.length}:${Math.random().toString(16)}` },
          () =>
            this.prisma
              .images({
                where: { url_in: urls }
              })
              .then(r => {
                const lookup = _.keyBy(r, this.prismaKey);
                return urls.map(url => lookup[url]);
              })
        ),
      { maxBatchSize: 100 }
    );
  }

  mapToPrismaInput = (spotifyVal: SpotifyWebApi.Image) => {
    return spotifyVal;
  };

  upsert = (input: Prisma.ImageCreateInput) => {
    const where = this.whereUnique(input);
    return this.limiters.prisma.schedule(
      { id: `image:upsert:${input.url}:${Math.random().toString(16)}` },
      () =>
        this.prisma
          .upsertImage({
            where: where,
            update: input,
            create: input
          })
          .catch((err: Error) => {
            if (
              err.message.startsWith("A unique constraint would be violated on")
            ) {
              return this.prisma.image(where);
            } else {
              throw err;
            }
          })
    );
  };

  upsertAndConnectMany = async (spotifyImages: SpotifyWebApi.Image[]) => {
    return await Promise.all<Prisma.ImageWhereUniqueInput>(
      spotifyImages.map(async img => {
        const cacheHit = await this.prismaLoader.load(img.url).catch(
          onError(`Error loading cached image from Prisma`, {
            image_url: img.url
          })
        );
        if (cacheHit) return this.whereUnique(cacheHit);
        const imgInput = this.mapToPrismaInput(img);
        return await this.upsert(imgInput)
          .then(this.whereUnique)
          .catch(
            onError(`Error upserting image into Prisma`, {
              image_url: img.url
            })
          );
      })
    );
  };
}
